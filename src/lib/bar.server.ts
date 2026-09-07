import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type {
  KitchenOrders,
  KitchenPages,
  Order,
  OrderStatus,
  OrderStatusSnapshot,
} from "@/lib/bar";
import {
  KITCHEN_PAGE_SIZE,
  ORDER_RATE_WINDOW_SECONDS,
  ORDER_CUSTOMER_MAX_REQUESTS,
  ORDER_SHARED_IP_MAX_REQUESTS,
} from "@/lib/traffic-policy";
import {
  customerOwnsOrder,
  getOrCreateCustomerId,
  httpError,
  rememberCustomerOrder,
  requireKitchenAuthenticated,
} from "@/lib/kitchen-auth.server";
import { enforceRateLimit, getClientAddress } from "@/lib/rate-limit.server";

const PREPARATION_SECONDS = 10;

type CreateOrderInput = {
  requestId: string;
  lines: Array<{ menuItemId: string; quantity: number }>;
  note: string;
};

type CreatedOrder = {
  order: Order;
  accessToken: string;
};

async function createOrderAccess(customerId: string, requestId: string) {
  const secret = process.env["KITCHEN_SESSION_SECRET"];
  if (!secret || secret.length < 32) throw httpError(500, "Session secret non configurato");
  const { createHash, createHmac } = await import("node:crypto");
  const accessToken = createHmac("sha256", secret)
    .update(`order-access:${customerId}:${requestId}`, "utf8")
    .digest("hex");
  return {
    accessToken,
    accessHash: createHash("sha256").update(accessToken, "utf8").digest("hex"),
  };
}

export async function createCustomerOrder(input: CreateOrderInput): Promise<CreatedOrder> {
  const customerId = await getOrCreateCustomerId();
  await enforceRateLimit({
    scope: "order_create_customer",
    identifier: customerId,
    windowSeconds: ORDER_RATE_WINDOW_SECONDS,
    maxRequests: ORDER_CUSTOMER_MAX_REQUESTS,
    message: "Hai inviato troppi ordini in pochi minuti. Riprova più tardi.",
  });
  await enforceRateLimit({
    scope: "order_create_ip",
    identifier: getClientAddress(),
    windowSeconds: ORDER_RATE_WINDOW_SECONDS,
    // Shared university Wi-Fi/NAT: two attempts per 400 visitors, while the
    // independent per-session limit remains six attempts per five minutes.
    maxRequests: ORDER_SHARED_IP_MAX_REQUESTS,
    message: "Il servizio sta ricevendo troppi ordini. Riprova tra poco.",
  });

  const { accessToken, accessHash } = await createOrderAccess(customerId, input.requestId);
  const { data, error } = await supabaseAdmin.rpc("create_bar_order_secured", {
    p_client_request_id: input.requestId,
    p_customer_access_hash: accessHash,
    p_lines: input.lines.map((line) => ({
      menu_item_id: line.menuItemId,
      quantity: line.quantity,
    })) as Json,
    p_note: input.note.trim() || null,
  });
  const order = data?.[0];
  if (error || !order) throw httpError(400, error?.message ?? "Ordine non creato");
  await rememberCustomerOrder(order.id);
  return { order: order as Order, accessToken };
}

export async function getCustomerOrder(orderId: string): Promise<Order | null> {
  const result = await getCustomerOrderWithAccess(orderId);
  return result?.order ?? null;
}

export async function getCustomerOrderWithAccess(orderId: string) {
  if (!(await customerOwnsOrder(orderId))) return null;
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, status, note, total, created_at, updated_at, estimated_ready_at, archived_at, client_request_id, customer_access_hash, order_items(id, order_id, name, unit_price, quantity)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { client_request_id, customer_access_hash, ...order } = data;
  let accessToken: string | null = null;
  if (client_request_id && customer_access_hash) {
    const access = await createOrderAccess(await getOrCreateCustomerId(), client_request_id);
    if (access.accessHash === customer_access_hash) accessToken = access.accessToken;
  }
  // Never disclose the stored hash/request ID or rotate another device's token.
  return { order: order as Order, accessToken };
}

export async function getCustomerOrderStatus(orderId: string): Promise<OrderStatusSnapshot | null> {
  if (!(await customerOwnsOrder(orderId))) return null;
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, status, updated_at, estimated_ready_at, archived_at")
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return (data as OrderStatusSnapshot | null) ?? null;
}

export async function pickupCustomerOrder(orderId: string): Promise<Order> {
  if (!(await customerOwnsOrder(orderId))) {
    throw httpError(403, "Non puoi modificare questo ordine");
  }
  const { data: current, error: currentError } = await supabaseAdmin
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw httpError(404, "Ordine non trovato");
  if (current.status !== "ready" && current.status !== "picked_up") {
    throw httpError(409, "Ordine non ancora pronto per il ritiro");
  }

  if (current.status === "ready") {
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status: "picked_up" })
      .eq("id", orderId)
      .eq("status", "ready");
    if (error) throw error;
  }
  const order = await getCustomerOrder(orderId);
  if (!order) throw httpError(404, "Ordine non trovato");
  return order;
}

export async function getKitchenOrders(
  pages: KitchenPages,
  includeHistory: boolean,
): Promise<KitchenOrders> {
  await requireKitchenAuthenticated();
  const statuses = ["received", "preparing", "ready", "picked_up"] as const;
  const entries = await Promise.all(
    statuses.map(async (status) => {
      const historyHidden = status === "picked_up" && !includeHistory;
      const offset = pages[status] * KITCHEN_PAGE_SIZE;
      const { data, error, count } = await supabaseAdmin
        .from("orders")
        .select(
          "id, order_number, status, note, total, created_at, updated_at, estimated_ready_at, archived_at, order_items(id, order_id, name, unit_price, quantity)",
          { count: "exact", head: historyHidden },
        )
        .is("archived_at", null)
        .eq("status", status)
        .order("order_number", { ascending: status !== "picked_up" })
        .range(offset, offset + KITCHEN_PAGE_SIZE - 1);
      if (error) throw error;
      return [status, { orders: (data ?? []) as Order[], count: count ?? 0 }] as const;
    }),
  );
  return Object.fromEntries(entries) as KitchenOrders;
}

export async function updateKitchenOrderStatus(orderId: string, status: OrderStatus) {
  await requireKitchenAuthenticated();
  if (status !== "preparing" && status !== "ready") {
    throw httpError(400, "Stato cucina non consentito");
  }
  const { data: current, error: currentError } = await supabaseAdmin
    .from("orders")
    .select("status")
    .eq("id", orderId)
    .is("archived_at", null)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw httpError(404, "Ordine non trovato");
  if (current.status === status) return;

  const allowed =
    (status === "preparing" && (current.status === "received" || current.status === "ready")) ||
    (status === "ready" && (current.status === "received" || current.status === "preparing"));
  if (!allowed) {
    throw httpError(409, "Transizione " + current.status + " -> " + status + " non consentita");
  }
  const update =
    status === "preparing"
      ? {
          status,
          estimated_ready_at: new Date(Date.now() + PREPARATION_SECONDS * 1000).toISOString(),
        }
      : { status };
  const { data: updated, error } = await supabaseAdmin
    .from("orders")
    .update(update)
    .eq("id", orderId)
    .eq("status", current.status)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!updated) throw httpError(409, "Ordine già modificato da un altro dispositivo");
}

export async function updateMenuItemAvailability(itemId: string, available: boolean) {
  await requireKitchenAuthenticated();
  const { data: item, error: itemError } = await supabaseAdmin
    .from("menu_items")
    .select("stock_quantity")
    .eq("id", itemId)
    .maybeSingle();
  if (itemError) throw itemError;
  if (!item) throw httpError(404, "Prodotto non trovato");
  if (available && item.stock_quantity === 0) {
    throw httpError(409, "Ripristina le scorte prima di rendere disponibile il prodotto");
  }
  const { data, error } = await supabaseAdmin
    .from("menu_items")
    .update({ available })
    .eq("id", itemId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw httpError(404, "Prodotto non trovato");
}

export async function restoreMenuStock() {
  await requireKitchenAuthenticated();
  const { error } = await supabaseAdmin.rpc("restore_menu_stock");
  if (error) throw error;
}

export async function archiveKitchenOrders() {
  await requireKitchenAuthenticated();
  const { error } = await supabaseAdmin
    .from("orders")
    .update({ archived_at: new Date().toISOString() })
    .is("archived_at", null);
  if (error) throw error;
}
