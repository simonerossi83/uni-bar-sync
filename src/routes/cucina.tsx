import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Flame, Timer, Utensils } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  fetchMenu,
  fetchOrders,
  formatTime,
  runKitchenBatch,
  setItemAvailability,
  useBarRealtime,
  type Order,
} from "@/lib/bar";

const BATCH_SECONDS = 10;

export const Route = createFileRoute("/cucina")({
  head: () => ({
    meta: [
      { title: "Dashboard Cucina — Bar Universitario" },
      {
        name: "description",
        content:
          "Schermo cucina con ordini nuovi, in preparazione e pronti, batch automatico ogni 10 secondi.",
      },
      { property: "og:title", content: "Dashboard Cucina — Bar Universitario" },
      {
        property: "og:description",
        content: "Monitor in tempo reale degli ordini del bar universitario.",
      },
    ],
  }),
  component: KitchenPage,
});

function KitchenPage() {
  const { data: orders = [] } = useQuery({ queryKey: ["orders"], queryFn: fetchOrders });
  const { data: menu = [] } = useQuery({ queryKey: ["menu"], queryFn: fetchMenu });
  useBarRealtime([["orders"], ["menu"]]);

  const [countdown, setCountdown] = useState(BATCH_SECONDS);
  const running = useRef(false);

  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((c) => {
        if (c > 1) return c - 1;
        if (!running.current) {
          running.current = true;
          runKitchenBatch()
            .catch((error) => console.error(error))
            .finally(() => {
              running.current = false;
            });
        }
        return BATCH_SECONDS;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const received = orders.filter((o) => o.status === "received");
  const preparing = orders.filter((o) => o.status === "preparing");
  const ready = orders.filter((o) => o.status === "ready");
  const pickedUp = orders.filter((o) => o.status === "picked_up");

  return (
    <div className="kitchen min-h-screen p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-black">Cucina · Bar Universitario</h1>
          <p className="text-muted-foreground">Aggiornamento automatico in tempo reale</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="rounded-2xl border border-border bg-card px-6 py-3 text-center">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Timer className="size-4" /> Prossimo batch tra
            </p>
            <p className="font-display text-4xl font-black tabular-nums">{countdown} s</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/">Menu cliente</Link>
          </Button>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Ordini totali" value={orders.length} />
        <Stat label="Nuovi" value={received.length} />
        <Stat label="In preparazione" value={preparing.length} />
        <Stat label="Pronti" value={ready.length} />
        <Stat label="Ritirati" value={pickedUp.length} />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Column title="Nuovi ordini" icon={<Utensils className="size-6" />} orders={received} />
        <Column title="In preparazione" icon={<Flame className="size-6" />} orders={preparing} />
        <div className="rounded-3xl border-2 border-success bg-success/10 p-5">
          <h2 className="font-display text-3xl font-black tracking-wide">ORDINI PRONTI</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {ready.length === 0 && (
              <p className="text-muted-foreground">Nessun ordine pronto al momento.</p>
            )}
            {ready.map((o) => (
              <div
                key={o.id}
                className="animate-pop-in rounded-2xl bg-card px-6 py-4 font-display text-6xl font-black tabular-nums text-success"
              >
                #{o.order_number}
              </div>
            ))}
          </div>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="font-display text-2xl font-bold">Disponibilità prodotti</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {menu.map((item) => (
            <label
              key={item.id}
              className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-2.5"
            >
              <span className={item.available ? "" : "text-muted-foreground line-through"}>
                {item.name}
              </span>
              <Switch
                checked={item.available}
                onCheckedChange={(checked) => setItemAvailability(item.id, checked)}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-display text-4xl font-black tabular-nums">{value}</p>
    </div>
  );
}

function Column({
  title,
  icon,
  orders,
}: {
  title: string;
  icon: React.ReactNode;
  orders: Order[];
}) {
  return (
    <div className="rounded-3xl border border-border bg-card/40 p-5">
      <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
        {icon} {title} <span className="text-muted-foreground">({orders.length})</span>
      </h2>
      <div className="mt-4 space-y-3">
        {orders.length === 0 && <p className="text-muted-foreground">Nessun ordine.</p>}
        {orders.map((o) => (
          <article
            key={o.id}
            className="animate-pop-in rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex items-baseline justify-between">
              <p className="font-display text-4xl font-black tabular-nums">#{o.order_number}</p>
              <p className="text-muted-foreground">{formatTime(o.created_at)}</p>
            </div>
            <ul className="mt-2 space-y-1 text-lg">
              {(o.order_items ?? []).map((item) => (
                <li key={item.id}>
                  <span className="font-bold">{item.quantity}×</span> {item.name}
                </li>
              ))}
            </ul>
            {o.note && (
              <p className="mt-2 rounded-lg bg-warning/20 px-3 py-2 text-base">
                <span className="font-semibold">Nota:</span> {o.note}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}