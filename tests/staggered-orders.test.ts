import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, databaseClient } from "./database";
import { KITCHEN_PAGE_SIZE, orderPollingInterval } from "../src/lib/traffic-policy";

const context = vi.hoisted(() => ({
  customer: "",
  kitchen: false,
  owned: new Map<string, Set<string>>(),
  client: undefined as ReturnType<typeof databaseClient> | undefined,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: new Proxy(
    {},
    { get: (_, key) => context.client![key as keyof typeof context.client] },
  ),
}));
vi.mock("@/lib/kitchen-auth.server", () => ({
  customerOwnsOrder: async (id: string) => context.owned.get(context.customer)?.has(id) ?? false,
  getOrCreateCustomerId: async () => context.customer,
  rememberCustomerOrder: async (id: string) => {
    const orders = context.owned.get(context.customer) ?? new Set<string>();
    orders.add(id);
    context.owned.set(context.customer, orders);
  },
  requireKitchenAuthenticated: async () => {
    if (!context.kitchen) throw Object.assign(new Error("Unauthenticated"), { statusCode: 401 });
  },
  httpError: (statusCode: number, message: string) =>
    Object.assign(new Error(message), { statusCode }),
}));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () =>
    new Request("https://isolated.invalid", { headers: { "cf-connecting-ip": "192.0.2.10" } }),
  getRequestIP: () => "192.0.2.10",
  setResponseHeader: vi.fn(),
  setResponseStatus: vi.fn(),
}));
import {
  archiveKitchenOrders,
  createCustomerOrder,
  getCustomerOrder,
  getCustomerOrderWithAccess,
  getKitchenOrders,
  pickupCustomerOrder,
  restoreMenuStock,
  updateKitchenOrderStatus,
} from "../src/lib/bar.server";

let db: PGlite;
let product: string;
const pages = { received: 0, preparing: 0, ready: 0, picked_up: 0 };
const input = (requestId = randomUUID(), quantity = 1) => ({
  requestId,
  note: "isolated test",
  lines: [{ menuItemId: product, quantity }],
});
beforeAll(async () => {
  db = await createTestDatabase();
  context.client = databaseClient(db);
  product = (await db.query<{ id: string }>("SELECT id FROM menu_items ORDER BY id LIMIT 1"))
    .rows[0]!.id;
});
beforeEach(async () => {
  await db.exec(
    "TRUNCATE public.orders CASCADE; TRUNCATE public.app_rate_limits; UPDATE public.menu_items SET initial_stock = 1000, stock_quantity = 1000, available = true;",
  );
  context.customer = randomUUID();
  context.kitchen = false;
  context.owned.clear();
});
afterAll(async () => {
  await db?.close();
});

describe("staggered visitors: real handlers and migrated isolated PostgreSQL", () => {
  it("completes 400 staggered orders and retries on one Wi-Fi, with bounded kitchen pages and exact stock", async () => {
    const visitors: Array<{ customer: string; id: string; token: string }> = [];
    for (let i = 0; i < 400; i++) {
      context.customer = randomUUID();
      const request = input();
      const created = await createCustomerOrder(request);
      const retry = await createCustomerOrder(request);
      expect(retry.order.id).toBe(created.order.id);
      visitors.push({
        customer: context.customer,
        id: created.order.id,
        token: created.accessToken,
      });
    }
    expect((await db.query<{ n: number }>("SELECT count(*)::int n FROM orders")).rows[0]!.n).toBe(
      400,
    );
    expect(
      (
        await db.query<{ n: number }>("SELECT stock_quantity n FROM menu_items WHERE id = $1", [
          product,
        ])
      ).rows[0]!.n,
    ).toBe(600);
    context.kitchen = true;
    const firstPage = await getKitchenOrders(pages, false);
    expect(firstPage.received.count).toBe(400);
    expect(firstPage.received.orders).toHaveLength(KITCHEN_PAGE_SIZE);
    const ids = new Set<string>();
    for (let page = 0; page < 8; page++) {
      const result = await getKitchenOrders({ ...pages, received: page }, false);
      result.received.orders.forEach((order) => ids.add(order.id));
    }
    expect(ids.size).toBe(400);
    await db.query("SELECT advance_kitchen_batch(10)");
    expect((await getKitchenOrders(pages, false)).preparing.count).toBe(400);
    // Accelerate only the isolated fixture clock; cron itself is not emulated.
    await db.exec("UPDATE orders SET estimated_ready_at = now() - interval '1 second'");
    await db.query("SELECT advance_kitchen_batch(10)");
    for (const visitor of visitors) {
      context.customer = visitor.customer;
      const recovered = await getCustomerOrderWithAccess(visitor.id);
      expect(recovered!.accessToken).toBe(visitor.token);
      const status = await db.query<{ id: string; status: string }>(
        "SELECT * FROM get_customer_order_status($1, $2)",
        [visitor.id, visitor.token],
      );
      expect(status.rows[0]!.status).toBe("ready");
      expect((await pickupCustomerOrder(visitor.id)).status).toBe("picked_up");
      expect((await pickupCustomerOrder(visitor.id)).status).toBe("picked_up");
    }
    const finished = await getKitchenOrders(pages, false);
    expect(finished.ready.count).toBe(0);
    expect(finished.picked_up.count).toBe(400);
    expect(finished.picked_up.orders).toHaveLength(0);
    expect((await getKitchenOrders(pages, true)).picked_up.orders).toHaveLength(KITCHEN_PAGE_SIZE);
  });

  it("preserves ownership, manual transitions, countdown deadline and logical archive", async () => {
    const created = await createCustomerOrder(input());
    const owner = context.customer;
    await expect(pickupCustomerOrder(created.order.id)).rejects.toMatchObject({ statusCode: 409 });
    context.customer = randomUUID();
    expect(await getCustomerOrder(created.order.id)).toBeNull();
    await expect(pickupCustomerOrder(created.order.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(
      (
        await db.query("SELECT * FROM get_customer_order_status($1, $2)", [
          created.order.id,
          "0".repeat(64),
        ])
      ).rows,
    ).toHaveLength(0);
    context.customer = owner;
    context.kitchen = true;
    await updateKitchenOrderStatus(created.order.id, "preparing");
    const preparing = await getCustomerOrder(created.order.id);
    expect(new Date(preparing!.estimated_ready_at!).getTime()).toBeGreaterThan(Date.now());
    expect((await getCustomerOrder(created.order.id))!.estimated_ready_at).toBe(
      preparing!.estimated_ready_at,
    );
    await updateKitchenOrderStatus(created.order.id, "ready");
    await updateKitchenOrderStatus(created.order.id, "ready");
    await updateKitchenOrderStatus(created.order.id, "preparing");
    expect((await getCustomerOrder(created.order.id))!.status).toBe("preparing");
    await updateKitchenOrderStatus(created.order.id, "ready");
    await pickupCustomerOrder(created.order.id);
    await expect(updateKitchenOrderStatus(created.order.id, "preparing")).rejects.toMatchObject({
      statusCode: 409,
    });
    await archiveKitchenOrders();
    await archiveKitchenOrders();
    expect((await getCustomerOrder(created.order.id))!.archived_at).not.toBeNull();
    expect((await getKitchenOrders(pages, true)).picked_up.count).toBe(0);
  });

  it("rejects every kitchen mutation and listing without authentication", async () => {
    const created = await createCustomerOrder(input());
    await expect(getKitchenOrders(pages, true)).rejects.toMatchObject({ statusCode: 401 });
    await expect(updateKitchenOrderStatus(created.order.id, "ready")).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(archiveKitchenOrders()).rejects.toMatchObject({ statusCode: 401 });
    await expect(restoreMenuStock()).rejects.toMatchObject({ statusCode: 401 });
  });

  it("keeps individual throttling and the 800-request shared-IP ceiling", async () => {
    for (let i = 0; i < 6; i++) await createCustomerOrder(input());
    await expect(createCustomerOrder(input())).rejects.toMatchObject({ statusCode: 429 });
    await db.exec("UPDATE app_rate_limits SET request_count = 800 WHERE scope = 'order_create_ip'");
    context.customer = randomUUID();
    await expect(createCustomerOrder(input())).rejects.toMatchObject({ statusCode: 429 });
    await db.exec("UPDATE app_rate_limits SET window_started_at = now() - interval '6 minutes'");
    expect((await createCustomerOrder(input())).order.status).toBe("received");
  });

  it("does not oversell and restores initial stock without altering orders", async () => {
    await db.query("UPDATE menu_items SET stock_quantity = 1 WHERE id = $1", [product]);
    await createCustomerOrder(input());
    await expect(createCustomerOrder(input())).rejects.toMatchObject({ statusCode: 400 });
    expect(
      (
        await db.query<{ n: number }>("SELECT stock_quantity n FROM menu_items WHERE id = $1", [
          product,
        ])
      ).rows[0]!.n,
    ).toBe(0);
    context.kitchen = true;
    await restoreMenuStock();
    await restoreMenuStock();
    expect(
      (
        await db.query<{ n: number }>("SELECT stock_quantity n FROM menu_items WHERE id = $1", [
          product,
        ])
      ).rows[0]!.n,
    ).toBe(1000);
    expect((await getKitchenOrders(pages, false)).received.count).toBe(1);
  });

  it("enforces database ACLs, capability isolation and rollback of conflicting idempotency tokens", async () => {
    const request = input();
    const created = await createCustomerOrder(request);
    context.customer = randomUUID();
    await expect(createCustomerOrder(request)).rejects.toMatchObject({ statusCode: 400 });
    await db.exec("SET ROLE anon");
    try {
      await expect(db.query("SELECT * FROM orders")).rejects.toThrow(/permission denied/);
      await expect(db.query("SELECT restore_menu_stock()")).rejects.toThrow(/permission denied/);
      await expect(db.query("SELECT advance_kitchen_batch(10)")).rejects.toThrow(
        /permission denied/,
      );
      expect(
        (
          await db.query("SELECT * FROM get_customer_order_status($1, $2)", [
            created.order.id,
            created.accessToken,
          ])
        ).rows,
      ).toHaveLength(1);
      expect(
        (
          await db.query("SELECT * FROM get_customer_order_status($1, $2)", [
            randomUUID(),
            created.accessToken,
          ])
        ).rows,
      ).toHaveLength(0);
    } finally {
      await db.exec("RESET ROLE");
    }
  });
});

describe("polling policy", () => {
  it("recovers from an initial read error and stops on pickup", () => {
    expect(orderPollingInterval(undefined, 1000, true)).toBe(4000);
    expect(orderPollingInterval({ status: "picked_up", archived_at: null }, 1000, true)).toBe(
      false,
    );
  });
  it("prioritizes preparation and protects the legacy Worker fallback", () => {
    expect(orderPollingInterval({ status: "preparing", archived_at: null }, 0, true)).toBe(3000);
    expect(orderPollingInterval({ status: "ready", archived_at: null }, 0, true)).toBe(8000);
    expect(orderPollingInterval({ status: "ready", archived_at: null }, 0, false)).toBe(30000);
  });
});
