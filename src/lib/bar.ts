import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

export const CATEGORIES = ["Caffetteria", "Bevande", "Panini", "Snack", "Dolci"] as const;
export const MAX_ORDER_QUANTITY = 30;

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
      .array(z.object({ menuItemId: uuidSchema, quantity: z.number().int().min(1).max(20) }))
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
    return createCustomerOrder(data);
  });

const fetchOrderServer = createServerFn({ method: "GET" })
  .validator(orderIdSchema)
  .handler(async ({ data }) => {
    const { getCustomerOrder } = await import("@/lib/bar.server");
    return getCustomerOrder(data.orderId);
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

const fetchKitchenOrdersServer = createServerFn({ method: "GET" }).handler(async () => {
  const { getKitchenOrders } = await import("@/lib/bar.server");
  return getKitchenOrders();
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

const fetchMenuServer = createServerFn({ method: "GET" }).handler(async () => {
  const { getPublicMenu } = await import("@/lib/bar.server");
  return getPublicMenu();
});

export function fetchMenu(): Promise<MenuItem[]> {
  return fetchMenuServer();
}

export type CartLine = { item: MenuItem; quantity: number };

export function createOrder(lines: CartLine[], note: string, requestId: string) {
  return createOrderServer({
    data: {
      requestId,
      lines: lines.map((line) => ({ menuItemId: line.item.id, quantity: line.quantity })),
      note,
    },
  });
}

export function fetchOrder(orderId: string) {
  return fetchOrderServer({ data: { orderId } });
}

export function fetchOrderStatus(orderId: string) {
  return fetchOrderStatusServer({ data: { orderId } });
}

export function pickupOrder(orderId: string) {
  return pickupOrderServer({ data: { orderId } });
}

export function fetchOrders() {
  return fetchKitchenOrdersServer();
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
