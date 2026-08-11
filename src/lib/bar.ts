import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OrderStatus = "received" | "preparing" | "ready" | "picked_up";

export type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
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
  order_items?: OrderItem[];
};

export const CATEGORIES = ["Caffetteria", "Bevande", "Panini", "Snack", "Dolci"] as const;

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

export async function fetchMenu(): Promise<MenuItem[]> {
  const { data, error } = await supabase
    .from("menu_items")
    .select("*")
    .order("category")
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as MenuItem[];
}

export async function fetchOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .order("order_number", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Order[];
}

export async function fetchOrder(id: string): Promise<Order | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*, order_items(*)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Order) ?? null;
}

export type CartLine = { item: MenuItem; quantity: number };

export async function createOrder(lines: CartLine[], note: string): Promise<Order> {
  const total = lines.reduce((sum, l) => sum + l.item.price * l.quantity, 0);
  const { data: order, error } = await supabase
    .from("orders")
    .insert({ note: note.trim() || null, total, status: "received" })
    .select()
    .single();
  if (error || !order) throw error ?? new Error("Ordine non creato");

  const { error: itemsError } = await supabase.from("order_items").insert(
    lines.map((l) => ({
      order_id: order.id,
      menu_item_id: l.item.id,
      name: l.item.name,
      unit_price: l.item.price,
      quantity: l.quantity,
    })),
  );
  if (itemsError) throw itemsError;
  return order as Order;
}

export async function setOrderStatus(id: string, status: OrderStatus) {
  const { error } = await supabase.from("orders").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function setItemAvailability(id: string, available: boolean) {
  const { error } = await supabase.from("menu_items").update({ available }).eq("id", id);
  if (error) throw error;
}

/** Kitchen batch: preparing -> ready, then received -> preparing. */
export async function runKitchenBatch() {
  const { error: readyError } = await supabase
    .from("orders")
    .update({ status: "ready" })
    .eq("status", "preparing");
  if (readyError) throw readyError;
  const { error: prepError } = await supabase
    .from("orders")
    .update({ status: "preparing" })
    .eq("status", "received");
  if (prepError) throw prepError;
}

/** Subscribe to realtime changes and refresh the given query keys. */
export function useBarRealtime(keys: string[][]) {
  const queryClient = useQueryClient();
  const signature = JSON.stringify(keys);

  useEffect(() => {
    const invalidate = () => {
      for (const key of JSON.parse(signature) as string[][]) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    };
    const channel = supabase
      .channel("bar-realtime-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_items" }, invalidate)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, signature]);
}