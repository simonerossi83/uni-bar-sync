import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { ZodTypeAny } from "zod";

const mocks = vi.hoisted(() => ({
  createCustomerOrder: vi.fn(),
  getCustomerOrderWithAccess: vi.fn(),
  getCustomerOrderStatus: vi.fn(),
  getKitchenOrders: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/bar.server", () => mocks);
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock("@tanstack/react-start", () => ({
  createServerFn: () => {
    let schema: ZodTypeAny | undefined;
    return {
      validator(value: ZodTypeAny) {
        schema = value;
        return this;
      },
      handler(handler: (args: { data: unknown }) => unknown) {
        return async (args?: { data: unknown }) =>
          handler({ data: schema ? schema.parse(args?.data) : args?.data });
      },
    };
  },
}));
import {
  createOrder,
  fetchOrder,
  fetchOrderStatus,
  fetchOrders,
  hasDirectOrderAccess,
  OrderRateLimitError,
  type MenuItem,
} from "../src/lib/bar";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", {
    localStorage: {
      setItem: () => {
        throw new Error("Storage unavailable");
      },
      getItem: () => {
        throw new Error("Storage unavailable");
      },
    },
  });
});
const item: MenuItem = {
  id: randomUUID(),
  name: "Test",
  description: "",
  category: "Snack",
  price: 1,
  available: true,
  initial_stock: 100,
  stock_quantity: 100,
  sort_order: 1,
};

describe("customer access and request validation", () => {
  it("keeps direct polling when browser storage is blocked", async () => {
    const id = randomUUID(),
      token = "a".repeat(64);
    mocks.createCustomerOrder.mockResolvedValueOnce({ order: { id }, accessToken: token });
    mocks.rpc.mockResolvedValueOnce({ data: [{ id, status: "received" }], error: null });
    await createOrder([{ item, quantity: 1 }], "", randomUUID());
    expect(hasDirectOrderAccess(id)).toBe(true);
    await fetchOrderStatus(id);
    expect(mocks.rpc).toHaveBeenCalledWith("get_customer_order_status", {
      p_order_id: id,
      p_access_token: token,
    });
    expect(mocks.getCustomerOrderStatus).not.toHaveBeenCalled();
  });
  it("recovers the token on reload through the signed server session", async () => {
    const id = randomUUID();
    mocks.getCustomerOrderWithAccess.mockResolvedValueOnce({
      order: { id },
      accessToken: "b".repeat(64),
    });
    expect(hasDirectOrderAccess(id)).toBe(false);
    expect(await fetchOrder(id)).toEqual({ id });
    expect(hasDirectOrderAccess(id)).toBe(true);
  });
  it("retains a signed-cookie fallback only for legacy orders", async () => {
    const id = randomUUID();
    mocks.getCustomerOrderStatus.mockResolvedValueOnce({ id, status: "ready" });
    expect(await fetchOrderStatus(id)).toEqual({ id, status: "ready" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not disclose an order rejected by the server", async () => {
    const id = randomUUID();
    mocks.getCustomerOrderWithAccess.mockResolvedValueOnce(null);
    expect(await fetchOrder(id)).toBeNull();
    expect(hasDirectOrderAccess(id)).toBe(false);
  });
  it("rejects oversized quantities and invalid pagination before entering handlers", async () => {
    await expect(createOrder([{ item, quantity: 21 }], "", randomUUID())).rejects.toThrow();
    await expect(
      fetchOrders({ received: -1, preparing: 0, ready: 0, picked_up: 0 }, false),
    ).rejects.toThrow();
    expect(mocks.createCustomerOrder).not.toHaveBeenCalled();
    expect(mocks.getKitchenOrders).not.toHaveBeenCalled();
  });
  it("returns the throttling delay without leaking unexpected server errors", async () => {
    mocks.createCustomerOrder.mockRejectedValueOnce(
      Object.assign(new Error("Throttled"), { statusCode: 429, retryAfterSeconds: 42 }),
    );
    await expect(createOrder([{ item, quantity: 1 }], "", randomUUID())).rejects.toEqual(
      new OrderRateLimitError(42),
    );
  });
});
