import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChefHat, Clock, PartyPopper, Timer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  STATUS_LABEL,
  fetchOrder,
  fetchOrderStatus,
  hasDirectOrderAccess,
  formatPrice,
  formatTime,
  pickupOrder,
  type OrderStatus,
} from "@/lib/bar";
import { orderPollingInterval } from "@/lib/traffic-policy";

export const Route = createFileRoute("/ordine/$orderId")({
  head: () => ({
    meta: [
      { title: "Il tuo ordine — Bar Universitario" },
      { name: "description", content: "Segui in tempo reale lo stato del tuo ordine." },
    ],
  }),
  component: OrderPage,
});

const STEPS: OrderStatus[] = ["received", "preparing", "ready", "picked_up"];

function useOrderCountdown(estimatedReadyAt: string | null | undefined, active: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !estimatedReadyAt) {
      setNow(null);
      return;
    }
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active, estimatedReadyAt]);

  if (!active || !estimatedReadyAt || now === null) return null;
  const remainingSeconds = Math.max(
    0,
    Math.ceil((new Date(estimatedReadyAt).getTime() - now) / 1000),
  );
  if (remainingSeconds === 0) return "Quasi pronto";
  const minutes = Math.floor(remainingSeconds / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (remainingSeconds % 60).toString().padStart(2, "0");
  return minutes + ":" + seconds;
}

function OrderPage() {
  const { orderId } = Route.useParams();
  const queryClient = useQueryClient();
  const [pickingUp, setPickingUp] = useState(false);
  const pickingUpRef = useRef(false);
  const pollingJitter = useMemo(() => Math.floor(Math.random() * 1_500), []);
  const { data: baseOrder, isLoading } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => fetchOrder(orderId),
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
  });
  const { data: liveStatus, isError: statusError } = useQuery({
    queryKey: ["order-status", orderId],
    queryFn: () => fetchOrderStatus(orderId),
    enabled: Boolean(baseOrder),
    staleTime: 1_500,
    refetchInterval: (query) =>
      orderPollingInterval(query.state.data, pollingJitter, hasDirectOrderAccess(orderId)),
    refetchIntervalInBackground: false,
  });
  const order = baseOrder && liveStatus ? { ...baseOrder, ...liveStatus } : baseOrder;
  const countdown = useOrderCountdown(order?.estimated_ready_at, order?.status === "preparing");

  if (isLoading) {
    return <p className="p-10 text-center text-muted-foreground">Carico l&apos;ordine…</p>;
  }
  if (!order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-2xl font-bold">Ordine non trovato</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Questo ordine non appartiene alla sessione corrente oppure non esiste.
        </p>
        <Button asChild>
          <Link to="/">Torna al menu</Link>
        </Button>
      </div>
    );
  }

  const isPreparing = order.status === "preparing";
  const isReady = order.status === "ready";
  const isPickedUp = order.status === "picked_up";
  const stepIndex = STEPS.indexOf(order.status);

  const pickup = async () => {
    if (pickingUpRef.current || !isReady) return;
    pickingUpRef.current = true;
    setPickingUp(true);
    try {
      const updated = await pickupOrder(order.id);
      await queryClient.cancelQueries({ queryKey: ["order-status", orderId] });
      queryClient.setQueryData(["order", orderId], updated);
      queryClient.setQueryData(["order-status", orderId], updated);
      if (updated.status === "picked_up") toast.success("Ritiro confermato");
      else toast.info("La cucina ha aggiornato lo stato dell’ordine. Attendi che sia pronto.");
    } catch {
      toast.error("Non è stato possibile confermare il ritiro. Riprova.");
    } finally {
      pickingUpRef.current = false;
      setPickingUp(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="mx-auto max-w-xl space-y-5 p-4">
        {statusError && (
          <p role="alert" className="rounded-xl bg-warning/15 p-3 text-sm">
            Connessione momentaneamente instabile. Aggiornamento dello stato in corso…
          </p>
        )}
        <div
          className="animate-pop-in rounded-3xl p-6 text-center text-primary-foreground shadow-[var(--shadow-soft)]"
          style={{ backgroundImage: isReady ? "var(--gradient-ready)" : "var(--gradient-primary)" }}
        >
          <p className="text-sm font-medium opacity-90">Numero ordine</p>
          <p className="font-display text-7xl font-black leading-none">#{order.order_number}</p>
          <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-black/15 px-4 py-1.5 text-sm font-semibold">
            <Clock className="size-4" /> {formatTime(order.created_at)}
          </p>
        </div>

        {isPreparing && (
          <div className="animate-pop-in rounded-3xl border-2 border-warning bg-warning/15 p-6 text-center">
            <Timer className="mx-auto size-10 text-warning" />
            <h1 className="mt-2 font-display text-2xl font-black">In preparazione</h1>
            <p className="mt-3 font-display text-5xl font-black tabular-nums">
              {countdown ?? "--:--"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {countdown === "Quasi pronto"
                ? "La cucina sta completando il tuo ordine."
                : "Tempo stimato al completamento"}
            </p>
          </div>
        )}

        {isReady && (
          <div className="animate-pop-in rounded-3xl border-2 border-success bg-success/10 p-6 text-center">
            <PartyPopper className="mx-auto size-10 text-success" />
            <h1 className="animate-ready-pulse mt-2 font-display text-3xl font-black">
              Il tuo ordine è pronto per il ritiro
            </h1>
            <p className="mt-1 text-muted-foreground">Vai al bancone e mostra il numero ordine.</p>
            <Button
              size="lg"
              className="mt-4 h-16 w-full text-lg font-bold"
              disabled={pickingUp}
              onClick={pickup}
            >
              {pickingUp ? "Conferma in corso…" : "Ho ritirato l’ordine"}
            </Button>
          </div>
        )}

        {isPickedUp && (
          <div className="rounded-3xl border border-border bg-card p-6 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <h1 className="mt-2 font-display text-2xl font-bold">Ordine ritirato</h1>
            <p className="mt-1 text-muted-foreground">Ritiro confermato. Buon appetito!</p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/">Nuovo ordine</Link>
            </Button>
          </div>
        )}

        {order.status === "received" && (
          <div className="rounded-3xl border border-border bg-card p-6 text-center">
            <ChefHat className="mx-auto size-10 text-primary" />
            <h1 className="mt-2 font-display text-2xl font-bold">{STATUS_LABEL[order.status]}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              La cucina prenderà in carico il tuo ordine a breve.
            </p>
          </div>
        )}

        <ol className="flex items-center gap-2">
          {STEPS.map((status, index) => (
            <li key={status} className="flex-1 text-center">
              <div
                className={`h-2 rounded-full ${index <= stepIndex ? "bg-primary" : "bg-muted"}`}
                aria-hidden
              />
              <p
                className={`mt-1.5 text-[11px] font-medium ${index <= stepIndex ? "text-foreground" : "text-muted-foreground"}`}
              >
                {STATUS_LABEL[status]}
              </p>
            </li>
          ))}
        </ol>

        <section className="rounded-3xl border border-border bg-card p-5">
          <h2 className="font-display text-lg font-bold">Prodotti ordinati</h2>
          <ul className="mt-3 space-y-2">
            {(order.order_items ?? []).map((item) => (
              <li key={item.id} className="flex justify-between text-sm">
                <span>
                  <span className="font-semibold">{item.quantity}×</span> {item.name}
                </span>
                <span className="text-muted-foreground">
                  {formatPrice(item.unit_price * item.quantity)}
                </span>
              </li>
            ))}
          </ul>
          {order.note && (
            <p className="mt-3 rounded-xl bg-muted p-3 text-sm">
              <span className="font-semibold">Nota:</span> {order.note}
            </p>
          )}
          <div className="mt-3 flex justify-between border-t border-border pt-3 font-display text-lg font-bold">
            <span>Totale</span>
            <span>{formatPrice(order.total)}</span>
          </div>
        </section>
      </div>
    </div>
  );
}
