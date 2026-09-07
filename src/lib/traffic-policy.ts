// Keep the free Worker out of repeated customer reads. Only the kitchen and
// authenticated mutations use it; public menu/status reads go directly to Supabase.
export const KITCHEN_PAGE_SIZE = 50;
export const ORDER_RATE_WINDOW_SECONDS = 300;
export const ORDER_CUSTOMER_MAX_REQUESTS = 6;
export const ORDER_SHARED_IP_MAX_REQUESTS = 800;

export function orderPollingInterval(
  snapshot: { status: string; archived_at: string | null } | null | undefined,
  jitter: number,
  hasDirectAccess: boolean,
): number | false {
  if (snapshot?.status === "picked_up") return false;
  // Old orders without capability tokens still work through their signed cookie,
  // but must not exhaust the daily free Worker quota with fast polling.
  if (!hasDirectAccess) return 30_000 + jitter;
  // Retry even after the first request fails (no snapshot yet).
  if (!snapshot || snapshot.status === "preparing") return 3_000 + jitter;
  return snapshot.status === "ready" ? 8_000 + jitter : 5_000 + jitter;
}
