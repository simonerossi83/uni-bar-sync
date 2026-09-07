import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { H3Event } from "h3-v2";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDatabase, databaseClient } from "./database";

const context = vi.hoisted(() => ({
  event: undefined as H3Event | undefined,
  client: undefined as ReturnType<typeof databaseClient> | undefined,
  databaseUnavailable: false,
  status: 200,
}));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from(table: string) {
      if (!context.databaseUnavailable) return context.client!.from(table);
      const query = new Proxy(
        {},
        {
          get: (_, key) =>
            key === "then"
              ? (resolve: (value: unknown) => unknown) =>
                  Promise.resolve({ data: null, error: new Error("Offline") }).then(resolve)
              : () => query,
        },
      );
      return query;
    },
  },
}));
vi.mock("@tanstack/react-start/server", async () => {
  const { useSession } = await import("h3-v2");
  return {
    useSession: (config: Parameters<typeof useSession>[1]) => useSession(context.event!, config),
    setResponseStatus: (status: number) => {
      context.status = status;
    },
  };
});
vi.mock("@/lib/rate-limit.server", () => ({
  enforceRateLimit: async () => {},
  getClientAddress: () => "192.0.2.10",
}));
import {
  isKitchenAuthenticated,
  loginKitchen,
  logoutKitchen,
  getOrCreateCustomerId,
  rememberCustomerOrder,
  customerOwnsOrder,
} from "../src/lib/kitchen-auth.server";

const password = "isolated-test-password-2026!";
function request(cookie?: string) {
  context.status = 200;
  context.event = new H3Event(
    new Request("https://isolated.invalid/cucina", { headers: cookie ? { cookie } : {} }),
  );
}
async function login() {
  expect(await loginKitchen("test-kitchen", password)).toBe(true);
  return context.event!.res.headers.getSetCookie().at(-1)!.split(";")[0]!;
}
let db: PGlite;
beforeAll(async () => {
  db = await createTestDatabase();
  context.client = databaseClient(db);
});
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec("TRUNCATE kitchen_sessions");
  context.databaseUnavailable = false;
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("KITCHEN_USERNAME", "test-kitchen");
  vi.stubEnv("KITCHEN_PASSWORD", password);
  request();
});

describe("revocable kitchen sessions with real cookies and isolated PostgreSQL", () => {
  it("rejects unauthenticated requests and tampered cookies", async () => {
    expect(await isKitchenAuthenticated()).toBe(false);
    const cookie = await login();
    request(cookie);
    expect(await isKitchenAuthenticated()).toBe(true);
    request(cookie + "tampered");
    expect(await isKitchenAuthenticated()).toBe(false);
  });
  it("issues Secure, HttpOnly, SameSite=Lax cookies", async () => {
    await login();
    const header = context.event!.res.headers.getSetCookie().at(-1)!;
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
  });
  it("revokes every issued cookie when credentials change, without rotating the customer secret", async () => {
    const cookie = await login();
    vi.stubEnv("KITCHEN_PASSWORD", "different-isolated-password-2026!");
    request(cookie);
    expect(await isKitchenAuthenticated()).toBe(false);
  });
  it("revokes copied cookies on logout, including duplicate logout requests", async () => {
    const copiedCookie = await login();
    request(copiedCookie);
    await logoutKitchen();
    expect(context.event!.res.headers.getSetCookie().at(-1)).toMatch(/Max-Age=0/i);
    request(copiedCookie);
    expect(await isKitchenAuthenticated()).toBe(false);
    await logoutKitchen();
    expect(await isKitchenAuthenticated()).toBe(false);
  });
  it("rejects legacy flag-only cookies", async () => {
    const { useSession } = await import("h3-v2");
    const legacy = await useSession(context.event!, {
      name: "uni_bar_kitchen",
      password: process.env["KITCHEN_SESSION_SECRET"]!,
      maxAge: 43200,
    });
    await legacy.update({ kitchenAuthenticated: true });
    const cookie = context.event!.res.headers.getSetCookie().at(-1)!.split(";")[0]!;
    request(cookie);
    expect(await isKitchenAuthenticated()).toBe(false);
  });
  it("rejects expired records, even if the encrypted cookie has not expired", async () => {
    const cookie = await login();
    await db.exec(
      "UPDATE kitchen_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day'",
    );
    request(cookie);
    expect(await isKitchenAuthenticated()).toBe(false);
  });
  it("fails closed when the session database is unavailable and does not pretend logout succeeded", async () => {
    const cookie = await login();
    context.databaseUnavailable = true;
    request(cookie);
    await expect(isKitchenAuthenticated()).rejects.toMatchObject({ statusCode: 503 });
    await expect(logoutKitchen()).rejects.toMatchObject({ statusCode: 503 });
    expect(context.event!.res.headers.getSetCookie()).toHaveLength(0);
    context.databaseUnavailable = false;
    request(cookie);
    expect(await isKitchenAuthenticated()).toBe(true);
  });
  it("denies invalid credentials with HTTP 401", async () => {
    expect(await loginKitchen("test-kitchen", "incorrect")).toBe(false);
    expect(context.status).toBe(401);
  });
  it("does not invalidate customer ownership on kitchen password change or logout", async () => {
    const customerId = await getOrCreateCustomerId();
    await rememberCustomerOrder("customer-order-fixture");
    const customerCookie = context.event!.res.headers.getSetCookie().at(-1)!.split(";")[0]!;
    const kitchenCookie = await login();
    vi.stubEnv("KITCHEN_PASSWORD", "new-isolated-password-2026!");
    request(customerCookie + "; " + kitchenCookie);
    expect(await isKitchenAuthenticated()).toBe(false);
    await logoutKitchen();
    request(customerCookie);
    expect(await getOrCreateCustomerId()).toBe(customerId);
    expect(await customerOwnsOrder("customer-order-fixture")).toBe(true);
  });
  it("does not grant public access to the session registry", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try {
        await expect(db.query("SELECT * FROM kitchen_sessions")).rejects.toThrow(
          /permission denied/,
        );
      } finally {
        await db.exec("RESET ROLE");
      }
    }
  });
});
