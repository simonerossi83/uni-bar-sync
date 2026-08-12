import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import type { MenuItem, Order, OrderStatus, OrderStatusSnapshot } from "@/lib/bar";
import {
  customerOwnsOrder,
  getOrCreateCustomerId,
  httpError,
  rememberCustomerOrder,
  requireKitchenAuthenticated,
} from "@/lib/kitchen-auth.server";
import { enforceRateLimit, getClientAddress } from "@/lib/rate-limit.server";

const PREPARATION_SECONDS = 10;
const MENU_CACHE_MS = 2_000;

let menuCache: { data: MenuItem[]; expiresAt: number } | undefined;
let menuRequest: Promise<MenuItem[]> | undefined;

export async function getPublicMenu(): Promise<MenuItem[]> {
  const now = Date.now();
  if (menuCache && menuCache.expiresAt > now) return menuCache.data;
  if (menuRequest) return menuRequest;

  menuRequest = (async () => {
    try {
      const { data, error } = await supabaseAdmin
        .from("menu_items")
        .select(
          "id, name, description, price, category, available, initial_stock, stock_quantity, sort_order",
        )
        .order("category")
        .order("sort_order");
      if (error) throw error;
      const menu = (data ?? []) as MenuItem[];
      menuCache = { data: menu, expiresAt: Date.now() + MENU_CACHE_MS };
      return menu;
    } catch (error) {
      if (menuCache) return menuCache.data;
      throw error;
    }
  })().finally(() => {
    menuRequest = undefined;
  });

  return menuRequest;
}

function invalidateMenuCache() {
  menuCache = undefined;
}

type CreateOrderInput = {
  requestId: string;
  lines: Array<{ menuItemId: string; quantity: number }>;
  note: string;
};

export async function createCustomerOrder(input: CreateOrderInput): Promise<Order> {
  const customerId = await getOrCreateCustomerId();
  await enforceRateLimit({
    scope: "order_create_customer",
    identifier: customerId,
    windowSeconds: 5 * 60,
    maxRequests: 6,
    message: "Hai inviato troppi ordini in pochi minuti. Riprova più tardi.",
  });
  await enforceRateLimit({
    scope: "order_create_ip",
    identifier: getClientAddress(),
    windowSeconds: 5 * 60,
    maxRequests: 400,
    message: "Il servizio sta ricevendo troppi ordini. Riprova tra poco.",
  });

  const { data, error } = await supabaseAdmin.rpc("create_bar_order", {
    p_client_request_id: input.requestId,
    p_lines: input.lines.map((line) => ({
      menu_item_id: line.menuItemId,
      quantity: line.quantity,
    })) as Json,
    p_note: input.note.trim() || null,
  });
  const order = data?.[0];
  if (error || !order) throw httpError(400, error?.message ?? "Ordine non creato");
  await rememberCustomerOrder(order.id);
  return order as Order;
}

export async function getCustomerOrder(orderId: string): Promise<Order | null> {
  if (!(await customerOwnsOrder(orderId))) return null;
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, status, note, total, created_at, updated_at, estimated_ready_at, archived_at, order_items(id, order_id, name, unit_price, quantity)",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (error) throw error;
  return (data as Order | null) ?? null;
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

export async function getKitchenOrders(): Promise<Order[]> {
  await requireKitchenAuthenticated();
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, order_number, status, note, total, created_at, updated_at, estimated_ready_at, archived_at, order_items(id, order_id, name, unit_price, quantity)",
    )
    .is("archived_at", null)
    .order("order_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Order[];
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
  invalidateMenuCache();
}

export async function restoreMenuStock() {
  await requireKitchenAuthenticated();
  const { error } = await supabaseAdmin.rpc("restore_menu_stock");
  if (error) throw error;
  invalidateMenuCache();
}

export async function archiveKitchenOrders() {
  await requireKitchenAuthenticated();
  const { error } = await supabaseAdmin
    .from("orders")
    .update({ archived_at: new Date().toISOString() })
    .is("archived_at", null);
  if (error) throw error;
}
