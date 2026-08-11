import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CheckCircle2, ChefHat, Clock, PartyPopper } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  STATUS_LABEL,
  fetchOrder,
  formatPrice,
  formatTime,
  setOrderStatus,
  useBarRealtime,
  type OrderStatus,
} from "@/lib/bar";

export const Route = createFileRoute("/ordine/$orderId")({
  head: () => ({
    meta: [
      { title: "Il tuo ordine — Bar Universitario" },
      {
        name: "description",
        content: "Segui in tempo reale lo stato del tuo ordine al bar universitario.",
      },
      { property: "og:title", content: "Il tuo ordine — Bar Universitario" },
      {
        property: "og:description",
        content: "Numero ordine, prodotti e stato aggiornato automaticamente fino al ritiro.",
      },
    ],
  }),
  component: OrderPage,
});

const STEPS: OrderStatus[] = ["received", "preparing", "ready", "picked_up"];

function OrderPage() {
  const { orderId } = Route.useParams();
  const [pickingUp, setPickingUp] = useState(false);
  const { data: order, isLoading } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => fetchOrder(orderId),
  });
  useBarRealtime([["order", orderId]]);

  if (isLoading) {
    return <p className="p-10 text-center text-muted-foreground">Carico l'ordine…</p>;
  }
  if (!order) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <h1 className="font-display text-2xl font-bold">Ordine non trovato</h1>
        <Button asChild>
          <Link to="/">Torna al menu</Link>
        </Button>
      </div>
    );
  }

  const isReady = order.status === "ready";
  const isPickedUp = order.status === "picked_up";
  const stepIndex = STEPS.indexOf(order.status);

  const pickup = async () => {
    setPickingUp(true);
    try {
      await setOrderStatus(order.id, "picked_up");
    } catch {
      toast.error("Non è stato possibile confermare il ritiro. Riprova.");
    } finally {
      setPickingUp(false);
    }
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="mx-auto max-w-xl space-y-5 p-4">
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

        {isReady && (
          <div className="animate-pop-in rounded-3xl border-2 border-success bg-success/10 p-6 text-center">
            <PartyPopper className="mx-auto size-10 text-success" />
            <h1 className="animate-ready-pulse mt-2 font-display text-3xl font-black">
              Il tuo ordine è pronto!
            </h1>
            <p className="mt-1 text-muted-foreground">Vai al bancone e ritira il tuo ordine.</p>
            <Button
              size="lg"
              className="mt-4 h-16 w-full text-lg font-bold"
              disabled={pickingUp}
              onClick={pickup}
            >
              Ritira ordine
            </Button>
          </div>
        )}

        {isPickedUp && (
          <div className="rounded-3xl border border-border bg-card p-6 text-center">
            <CheckCircle2 className="mx-auto size-10 text-success" />
            <h1 className="mt-2 font-display text-2xl font-bold">Ordine ritirato</h1>
            <p className="mt-1 text-muted-foreground">Buon appetito!</p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/">Nuovo ordine</Link>
            </Button>
          </div>
        )}

        {!isReady && !isPickedUp && (
          <div className="rounded-3xl border border-border bg-card p-6 text-center">
            <ChefHat className="mx-auto size-10 text-primary" />
            <h1 className="mt-2 font-display text-2xl font-bold">{STATUS_LABEL[order.status]}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Lo stato si aggiorna da solo: tieni aperta questa pagina.
            </p>
          </div>
        )}

        <ol className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1 text-center">
              <div
                className={`h-2 rounded-full ${i <= stepIndex ? "bg-primary" : "bg-muted"}`}
                aria-hidden
              />
              <p
                className={`mt-1.5 text-[11px] font-medium ${
                  i <= stepIndex ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {STATUS_LABEL[s]}
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