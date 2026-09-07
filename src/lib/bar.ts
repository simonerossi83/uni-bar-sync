import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";

export type OrderStatus = "received" | "preparing" | "ready" | "picked_up";

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
  initial_stock: number;
  stock_quantity: number;
  sort_order: number;
};

export type OrderItem = {
  id: string;
  order_id: string;
  name: string;
  unit_price: number;
  quantity: number;
};

export type Order = {
  id: string;
  order_number: number;
  status: OrderStatus;
  note: string | null;
  total: number;
  created_at: string;
  updated_at: string;
  estimated_ready_at: string | null;
  archived_at: string | null;
  order_items?: OrderItem[];
};

export type OrderStatusSnapshot = Pick<
  Order,
  "id" | "status" | "updated_at" | "estimated_ready_at" | "archived_at"
>;

export { KITCHEN_PAGE_SIZE } from "@/lib/traffic-policy";
export type KitchenPages = Record<OrderStatus, number>;
export type KitchenOrderPage = { orders: Order[]; count: number };
export type KitchenOrders = Record<OrderStatus, KitchenOrderPage>;
export const EMPTY_KITCHEN_PAGES: KitchenPages = {
  received: 0,
  preparing: 0,
  ready: 0,
  picked_up: 0,
};

export const CATEGORIES = ["Caffetteria", "Bevande", "Panini", "Snack", "Dolci"] as const;
export const MAX_ORDER_QUANTITY = 30;
export const MAX_ITEM_QUANTITY = 20;

export const STATUS_LABEL: Record<OrderStatus, string> = {
  received: "Ordine ricevuto",
  preparing: "In preparazione",
  ready: "Pronto",
  picked_up: "Ritirato",
};

export const formatPrice = (value: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(value);

export const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });

const uuidSchema = z.string().uuid();
const createOrderSchema = z
  .object({
    requestId: uuidSchema,
    lines: z
      .array(
        z.object({
          menuItemId: uuidSchema,
          quantity: z.number().int().min(1).max(MAX_ITEM_QUANTITY),
        }),
      )
      .min(1)
      .max(50),
    note: z.string().max(500),
  })
  .superRefine((value, context) => {
    const totalQuantity = value.lines.reduce((sum, line) => sum + line.quantity, 0);
    if (totalQuantity > MAX_ORDER_QUANTITY) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lines"],
        message: `Un ordine non può contenere più di ${MAX_ORDER_QUANTITY} prodotti`,
      });
    }
  });
const orderIdSchema = z.object({ orderId: uuidSchema });
const pageSchema = z.number().int().min(0).max(10_000);
const kitchenPagesSchema = z.object({
  pages: z.object({
    received: pageSchema,
    preparing: pageSchema,
    ready: pageSchema,
    picked_up: pageSchema,
  }),
  includeHistory: z.boolean(),
});
const kitchenStatusSchema = z.object({
  orderId: uuidSchema,
  status: z.enum(["preparing", "ready"]),
});
const availabilitySchema = z.object({ itemId: uuidSchema, available: z.boolean() });
const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

const createOrderServer = createServerFn({ method: "POST" })
  .validator(createOrderSchema)
  .handler(async ({ data }) => {
    const { createCustomerOrder } = await import("@/lib/bar.server");
    try {
      return { ok: true as const, ...(await createCustomerOrder(data)) };
    } catch (error) {
      // Expected throttling must survive server-function error serialization.
      const failure = error as {
        statusCode?: number;
        retryAfterSeconds?: number;
        message?: string;
      };
      if (failure.statusCode !== 429) throw error;
      return { ok: false as const, retryAfterSeconds: failure.retryAfterSeconds ?? 60 };
    }
  });

const fetchOrderServer = createServerFn({ method: "GET" })
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { getCustomerOrderWithAccess } = await import("@/lib/bar.server");
    return getCustomerOrderWithAccess(data.orderId);
  });

const fetchOrderStatusServer = createServerFn({ method: "GET" })
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { getCustomerOrderStatus } = await import("@/lib/bar.server");
    return getCustomerOrderStatus(data.orderId);
  });

const pickupOrderServer = createServerFn({ method: "POST" })
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { pickupCustomerOrder } = await import("@/lib/bar.server");
    return pickupCustomerOrder(data.orderId);
  });

const fetchKitchenOrdersServer = createServerFn({ method: "GET" })
  .validator(kitchenPagesSchema)
  .handler(async ({ data }) => {
    const { getKitchenOrders } = await import("@/lib/bar.server");
    return getKitchenOrders(data.pages, data.includeHistory);
  });

const updateKitchenStatusServer = createServerFn({ method: "POST" })
  .validator(kitchenStatusSchema)
  .handler(async ({ data }) => {
    const { updateKitchenOrderStatus } = await import("@/lib/bar.server");
    return updateKitchenOrderStatus(data.orderId, data.status);
  });

const setItemAvailabilityServer = createServerFn({ method: "POST" })
  .validator(availabilitySchema)
  .handler(async ({ data }) => {
    const { updateMenuItemAvailability } = await import("@/lib/bar.server");
    return updateMenuItemAvailability(data.itemId, data.available);
  });

const resetOrdersServer = createServerFn({ method: "POST" }).handler(async () => {
  const { archiveKitchenOrders } = await import("@/lib/bar.server");
  return archiveKitchenOrders();
});

const restoreInventoryServer = createServerFn({ method: "POST" }).handler(async () => {
  const { restoreMenuStock } = await import("@/lib/bar.server");
  return restoreMenuStock();
});

const kitchenAuthStatusServer = createServerFn({ method: "GET" }).handler(async () => {
  const { isKitchenAuthenticated } = await import("@/lib/kitchen-auth.server");
  return { authenticated: await isKitchenAuthenticated() };
});

const kitchenLoginServer = createServerFn({ method: "POST" })
  .validator(loginSchema)
  .handler(async ({ data }) => {
    const { loginKitchen } = await import("@/lib/kitchen-auth.server");
    return { authenticated: await loginKitchen(data.username, data.password) };
  });

const kitchenLogoutServer = createServerFn({ method: "POST" }).handler(async () => {
  const { logoutKitchen } = await import("@/lib/kitchen-auth.server");
  await logoutKitchen();
  return { authenticated: false };
});

const orderAccessKey = (orderId: string) => `uni_bar_order_access:${orderId}`;
const orderAccessMemory = new Map<string, string>();

function saveOrderAccess(orderId: string, accessToken: string) {
  if (typeof window === "undefined") return;
  // Private browsing/storage restrictions must not turn every poll into a Worker call.
  orderAccessMemory.set(orderId, accessToken);
  if (orderAccessMemory.size > 20) orderAccessMemory.delete(orderAccessMemory.keys().next().value!);
  try {
    window.localStorage.setItem(orderAccessKey(orderId), accessToken);
  } catch {
    // Signed server session remains the secure fallback when storage is unavailable.
  }
}

function readOrderAccess(orderId: string) {
  if (typeof window === "undefined") return null;
  const cached = orderAccessMemory.get(orderId);
  if (cached) return cached;
  try {
    return window.localStorage.getItem(orderAccessKey(orderId));
  } catch {
    return null;
  }
}

export const hasDirectOrderAccess = (orderId: string) => Boolean(readOrderAccess(orderId));

export async function fetchMenu(): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select(
      "id, name, description, price, category, available, initial_stock, stock_quantity, sort_order",
    )
    .order("category")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as MenuItem[];
}

export async function fetchMenuStock() {
  const { data, error } = await supabase.from("menu_items").select("id, available, stock_quantity");
  if (error) throw error;
  return data ?? [];
}

export class OrderRateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Troppi tentativi. Attendi ${retryAfterSeconds} secondi prima di riprovare.`);
  }
}

export type CartLine = { item: MenuItem; quantity: number };

export async function createOrder(lines: CartLine[], note: string, requestId: string) {
  const created = await createOrderServer({
    data: {
      requestId,
      lines: lines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })),
      note,
    },
  });
  if (!created.ok) throw new OrderRateLimitError(created.retryAfterSeconds);
  saveOrderAccess(created.order.id, created.accessToken);
  return created.order;
}

export async function fetchOrder(orderId: string) {
  const result = await fetchOrderServer({ data: { orderId } });
  if (result?.accessToken) saveOrderAccess(orderId, result.accessToken);
  return result?.order ?? null;
}

export async function fetchOrderStatus(orderId: string) {
  const accessToken = readOrderAccess(orderId);
  if (!accessToken) return fetchOrderStatusServer({ data: { orderId } });

  const { data, error } = await supabase.rpc("get_customer_order_status", {
    p_order_id: orderId,
    p_access_token: accessToken,
  });
  if (error) throw error;
  return (data?.[0] as OrderStatusSnapshot | undefined) ?? null;
}

export function pickupOrder(orderId: string) {
  return pickupOrderServer({ data: { orderId } });
}

export function fetchOrders(pages: KitchenPages, includeHistory: boolean) {
  return fetchKitchenOrdersServer({ data: { pages, includeHistory } });
}

export function setKitchenOrderStatus(orderId: string, status: "preparing" | "ready") {
  return updateKitchenStatusServer({ data: { orderId, status } });
}

export function setItemAvailability(itemId: string, available: boolean) {
  return setItemAvailabilityServer({ data: { itemId, available } });
}

export function resetOrders() {
  return resetOrdersServer();
}

export function restoreInventory() {
  return restoreInventoryServer();
}

export function getKitchenAuthStatus() {
  return kitchenAuthStatusServer();
}

export function authenticateKitchen(username: string, password: string) {
  return kitchenLoginServer({ data: { username, password } });
}

export function endKitchenSession() {
  return kitchenLogoutServer();
}
