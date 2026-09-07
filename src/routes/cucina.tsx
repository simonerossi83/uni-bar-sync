import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { ArchiveX, Flame, LogOut, PackageOpen, RefreshCcw, Timer, Utensils } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  endKitchenSession,
  EMPTY_KITCHEN_PAGES,
  KITCHEN_PAGE_SIZE,
  fetchOrders,
  formatTime,
  getKitchenAuthStatus,
  restoreInventory,
  resetOrders,
  setItemAvailability,
  setKitchenOrderStatus,
  type Order,
  type OrderStatus,
} from "@/lib/bar";
import { useMenu } from "@/hooks/use-menu";

const BATCH_SECONDS = 10;

export const Route = createFileRoute("/cucina")({
  beforeLoad: async () => {
    const { authenticated } = await getKitchenAuthStatus();
    if (!authenticated) throw redirect({ to: "/cucina/login" });
  },
  head: () => ({ meta: [{ title: "Dashboard Cucina — Bar Universitario" }] }),
  component: KitchenPage,
});

function KitchenPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const navigate = useNavigate();
  const orderRefreshMs = useMemo(() => 3_000 + Math.floor(Math.random() * 1_000), []);
  const [pages, setPages] = useState(EMPTY_KITCHEN_PAGES);
  const [includeHistory, setIncludeHistory] = useState(false);
  const {
    data: queues,
    isError: ordersError,
    isLoading: loadingOrders,
  } = useQuery({
    queryKey: ["orders", pages, includeHistory],
    queryFn: () => fetchOrders(pages, includeHistory),
    refetchInterval: orderRefreshMs,
    refetchIntervalInBackground: false,
  });
  const { data: menu, isError: menuError } = useMenu(true);
  useEffect(() => {
    if (!queues) return;
    setPages((current) => {
      const next = { ...current };
      for (const status of Object.keys(current) as OrderStatus[]) {
        next[status] = Math.min(
          current[status],
          Math.max(0, Math.ceil(queues[status].count / KITCHEN_PAGE_SIZE) - 1),
        );
      }
      return (Object.keys(current) as OrderStatus[]).some(
        (status) => next[status] !== current[status],
      )
        ? next
        : current;
    });
  }, [queues]);

  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [restoringStock, setRestoringStock] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const received = queues?.received.orders ?? [];
  const preparing = queues?.preparing.orders ?? [];
  const ready = queues?.ready.orders ?? [];
  const total = queues ? Object.values(queues).reduce((sum, queue) => sum + queue.count, 0) : 0;
  const pager = (status: OrderStatus) => (
    <QueuePagination
      page={pages[status]}
      count={queues?.[status].count ?? 0}
      onChange={(page) => setPages((current) => ({ ...current, [status]: page }))}
    />
  );

  const changeStatus = async (order: Order, status: "preparing" | "ready") => {
    if (busyOrderId) return;
    setBusyOrderId(order.id);
    try {
      await setKitchenOrderStatus(order.id, status);
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
    } catch {
      toast.error("Lo stato dell’ordine non è stato aggiornato");
    } finally {
      setBusyOrderId(null);
    }
  };

  const changeAvailability = async (itemId: string, available: boolean) => {
    try {
      await setItemAvailability(itemId, available);
      await queryClient.invalidateQueries({ queryKey: ["menu"] });
    } catch {
      toast.error("Disponibilità non aggiornata");
    }
  };

  const reset = async () => {
    if (resetting) return;
    setResetting(true);
    try {
      await resetOrders();
      await queryClient.cancelQueries({ queryKey: ["orders"] });
      queryClient.setQueriesData(
        { queryKey: ["orders"] },
        {
          received: { orders: [], count: 0 },
          preparing: { orders: [], count: 0 },
          ready: { orders: [], count: 0 },
          picked_up: { orders: [], count: 0 },
        },
      );
      setPages(EMPTY_KITCHEN_PAGES);
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
      toast.success("Ordini archiviati");
    } catch {
      toast.error("Non è stato possibile azzerare gli ordini");
    } finally {
      setResetting(false);
    }
  };

  const restoreStock = async () => {
    if (restoringStock) return;
    setRestoringStock(true);
    try {
      await restoreInventory();
      await queryClient.invalidateQueries({ queryKey: ["menu"] });
      toast.success("Scorte ripristinate alle quantità iniziali");
    } catch {
      toast.error("Non è stato possibile ripristinare le scorte");
    } finally {
      setRestoringStock(false);
    }
  };

  const logout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await endKitchenSession();
      queryClient.removeQueries({ queryKey: ["orders"] });
      await router.invalidate();
      await navigate({ to: "/cucina/login", replace: true });
    } catch {
      toast.error("Logout non riuscito. La sessione non è stata chiusa: riprova.");
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="kitchen min-h-screen p-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-black">Cucina · Bar Universitario</h1>
          <p className="text-muted-foreground">Area riservata · aggiornamento automatico</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-2xl border border-border bg-card px-6 py-3 text-center">
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Timer className="size-4" /> Avanzamento automatico
            </p>
            <p className="font-display text-4xl font-black tabular-nums">ogni {BATCH_SECONDS} s</p>
          </div>
          <Button asChild variant="outline">
            <Link to="/">Menu cliente</Link>
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={resetting}>
                <ArchiveX className="size-4" /> Azzera ordini
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Azzerare gli ordini?</AlertDialogTitle>
                <AlertDialogDescription>
                  Tutti gli ordini, comprese le altre pagine e quelli ritirati, verranno archiviati
                  e rimossi dalla dashboard. I dati non saranno cancellati definitivamente.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annulla</AlertDialogCancel>
                <AlertDialogAction onClick={reset} disabled={resetting}>
                  Conferma azzeramento
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button variant="outline" onClick={logout} disabled={loggingOut}>
            <LogOut className="size-4" /> Logout
          </Button>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Ordini totali" value={total} />
        <Stat label="Nuovi" value={queues?.received.count ?? 0} />
        <Stat label="In preparazione" value={queues?.preparing.count ?? 0} />
        <Stat label="Pronti" value={queues?.ready.count ?? 0} />
        <Stat label="Ritirati" value={queues?.picked_up.count ?? 0} />
      </section>
      {(ordersError || menuError) && (
        <p role="alert" className="mb-4 rounded-xl bg-warning/20 p-3">
          Aggiornamento non riuscito. Controlla la connessione; i dati visualizzati potrebbero non
          essere aggiornati.
        </p>
      )}
      {loadingOrders && <p className="mb-4">Caricamento ordini…</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Column
          title="Nuovi ordini"
          icon={<Utensils className="size-6" />}
          orders={received}
          count={queues?.received.count ?? 0}
          pagination={pager("received")}
          actionLabel="Avvia preparazione"
          busyOrderId={busyOrderId}
          onAction={(order) => changeStatus(order, "preparing")}
          secondaryActionLabel="Segna già pronto"
          onSecondaryAction={(order) => changeStatus(order, "ready")}
        />
        <Column
          title="In preparazione"
          icon={<Flame className="size-6" />}
          orders={preparing}
          count={queues?.preparing.count ?? 0}
          pagination={pager("preparing")}
          actionLabel="Segna pronto"
          busyOrderId={busyOrderId}
          onAction={(order) => changeStatus(order, "ready")}
        />
        <div className="rounded-3xl border-2 border-success bg-success/10 p-5">
          <h2 className="font-display text-3xl font-black tracking-wide">ORDINI PRONTI</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            {ready.length === 0 && (
              <p className="text-muted-foreground">Nessun ordine pronto al momento.</p>
            )}
            {ready.map((order) => (
              <div key={order.id} className="animate-pop-in rounded-2xl bg-card p-4 text-center">
                <p className="font-display text-6xl font-black tabular-nums text-success">
                  #{order.order_number}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  disabled={busyOrderId !== null}
                  onClick={() => changeStatus(order, "preparing")}
                >
                  {busyOrderId === order.id ? "Aggiornamento…" : "Non è ancora pronto"}
                </Button>
              </div>
            ))}
          </div>
          {pager("ready")}
        </div>
      </div>

      <section className="mt-6 rounded-3xl border border-border bg-card/40 p-5">
        <Button
          variant="outline"
          onClick={() => setIncludeHistory((value) => !value)}
          aria-expanded={includeHistory}
        >
          {includeHistory ? "Nascondi ordini ritirati" : "Mostra ordini ritirati"} (
          {queues?.picked_up.count ?? 0})
        </Button>
        {includeHistory && (
          <>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {(queues?.picked_up.orders ?? []).map((order) => (
                <article key={order.id} className="rounded-xl bg-card p-3">
                  <p className="font-bold">
                    #{order.order_number} · {formatTime(order.created_at)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {order.order_items?.map((item) => `${item.quantity}× ${item.name}`).join(", ")}
                  </p>
                </article>
              ))}
            </div>
            {pager("picked_up")}
          </>
        )}
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
              <PackageOpen className="size-6" /> Magazzino cucina
            </h2>
            <p className="text-sm text-muted-foreground">
              Le quantità vengono scalate automaticamente quando arriva un ordine.
            </p>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" disabled={restoringStock}>
                <RefreshCcw className="size-4" /> Ripristina scorte
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Ripristinare tutte le scorte?</AlertDialogTitle>
                <AlertDialogDescription>
                  Ogni prodotto tornerà alla propria quantità iniziale e sarà nuovamente disponibile
                  nel menu.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Annulla</AlertDialogCancel>
                <AlertDialogAction onClick={restoreStock} disabled={restoringStock}>
                  Conferma ripristino
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {menu.map((item) => {
            const stockPercent = Math.round((item.stock_quantity / item.initial_stock) * 100);
            const lowStock = item.stock_quantity <= Math.ceil(item.initial_stock * 0.25);
            return (
              <div key={item.id} className="rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span
                    className={
                      item.available && item.stock_quantity > 0
                        ? "font-medium"
                        : "font-medium text-muted-foreground line-through"
                    }
                  >
                    {item.name}
                  </span>
                  <Switch
                    checked={item.available && item.stock_quantity > 0}
                    disabled={item.stock_quantity === 0 || restoringStock}
                    onCheckedChange={(checked) => changeAvailability(item.id, checked)}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between text-sm">
                  <span
                    className={lowStock ? "font-bold text-destructive" : "text-muted-foreground"}
                  >
                    {item.stock_quantity} / {item.initial_stock} unità
                  </span>
                  {item.stock_quantity === 0 && (
                    <span className="font-semibold text-destructive">Esaurito</span>
                  )}
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full transition-[width] ${lowStock ? "bg-destructive" : "bg-primary"}`}
                    style={{ width: `${Math.max(0, Math.min(stockPercent, 100))}%` }}
                  />
                </div>
              </div>
            );
          })}
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

function QueuePagination({
  page,
  count,
  onChange,
}: {
  page: number;
  count: number;
  onChange: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(count / KITCHEN_PAGE_SIZE));
  if (pageCount === 1 && page === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm">
      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>
        Precedenti
      </Button>
      <span>
        Pagina {page + 1} / {pageCount} · {count} ordini
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page + 1 >= pageCount}
        onClick={() => onChange(page + 1)}
      >
        Successivi
      </Button>
    </div>
  );
}

function Column({
  title,
  icon,
  orders,
  count,
  pagination,
  actionLabel,
  busyOrderId,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  title: string;
  icon: React.ReactNode;
  orders: Order[];
  count: number;
  pagination: React.ReactNode;
  actionLabel: string;
  busyOrderId: string | null;
  onAction: (order: Order) => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: (order: Order) => void;
}) {
  return (
    <div className="rounded-3xl border border-border bg-card/40 p-5">
      <h2 className="flex items-center gap-2 font-display text-2xl font-bold">
        {icon} {title} <span className="text-muted-foreground">({count})</span>
      </h2>
      <div className="mt-4 space-y-3">
        {orders.length === 0 && <p className="text-muted-foreground">Nessun ordine.</p>}
        {orders.map((order) => (
          <article
            key={order.id}
            className="animate-pop-in rounded-2xl border border-border bg-card p-4"
          >
            <div className="flex items-baseline justify-between">
              <p className="font-display text-4xl font-black tabular-nums">#{order.order_number}</p>
              <p className="text-muted-foreground">{formatTime(order.created_at)}</p>
            </div>
            <ul className="mt-2 space-y-1 text-lg">
              {(order.order_items ?? []).map((item) => (
                <li key={item.id}>
                  <span className="font-bold">{item.quantity}×</span> {item.name}
                </li>
              ))}
            </ul>
            {order.note && (
              <p className="mt-2 rounded-lg bg-warning/20 px-3 py-2 text-base">
                <span className="font-semibold">Nota:</span> {order.note}
              </p>
            )}
            <Button
              className="mt-3 w-full"
              onClick={() => onAction(order)}
              disabled={busyOrderId !== null}
            >
              {busyOrderId === order.id ? "Aggiornamento…" : actionLabel}
            </Button>
            {secondaryActionLabel && onSecondaryAction && (
              <Button
                className="mt-2 w-full"
                variant="outline"
                onClick={() => onSecondaryAction(order)}
                disabled={busyOrderId !== null}
              >
                {busyOrderId === order.id ? "Aggiornamento…" : secondaryActionLabel}
              </Button>
            )}
          </article>
        ))}
      </div>
      {pagination}
    </div>
  );
}
