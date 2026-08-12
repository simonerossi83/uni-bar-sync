import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { Minus, Plus, ShoppingBag, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  CATEGORIES,
  MAX_ORDER_QUANTITY,
  createOrder,
  fetchMenu,
  formatPrice,
  type MenuItem,
  type Order,
} from "@/lib/bar";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Bar Universitario — Ordina dal tuo posto" },
      {
        name: "description",
        content:
          "Ordina caffè, panini e snack dal bar universitario e segui lo stato del tuo ordine in tempo reale.",
      },
      { property: "og:title", content: "Bar Universitario — Ordina dal tuo posto" },
      {
        property: "og:description",
        content: "Menu digitale, ordine con un tap e stato in tempo reale fino al ritiro.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [cart, setCart] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const requestIdRef = useRef<string | null>(null);
  const menuRefreshMs = useMemo(() => 15_000 + Math.floor(Math.random() * 10_000), []);

  const { data: menu = [], isLoading } = useQuery({
    queryKey: ["menu"],
    queryFn: fetchMenu,
    staleTime: 10_000,
    refetchInterval: menuRefreshMs,
    refetchIntervalInBackground: false,
  });

  const byId = useMemo(() => new Map(menu.map((m) => [m.id, m])), [menu]);
  const lines = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, quantity]) => ({ item: byId.get(id), quantity }))
        .filter((l): l is { item: MenuItem; quantity: number } => Boolean(l.item)),
    [cart, byId],
  );
  const count = lines.reduce((s, l) => s + l.quantity, 0);
  const total = lines.reduce((s, l) => s + l.item.price * l.quantity, 0);

  const add = (item: MenuItem) =>
    setCart((current) => {
      const quantity = current[item.id] ?? 0;
      const currentCount = Object.values(current).reduce((sum, value) => sum + value, 0);
      if (
        !item.available ||
        quantity >= item.stock_quantity ||
        currentCount >= MAX_ORDER_QUANTITY
      ) {
        return current;
      }
      return { ...current, [item.id]: quantity + 1 };
    });
  const dec = (id: string) =>
    setCart((c) => {
      const next = (c[id] ?? 0) - 1;
      const { [id]: _removed, ...rest } = c;
      return next > 0 ? { ...c, [id]: next } : rest;
    });
  const remove = (id: string) =>
    setCart((c) => {
      const { [id]: _removed, ...rest } = c;
      return rest;
    });

  const submit = async () => {
    if (sendingRef.current) return;
    if (lines.length === 0) {
      toast.error("Il carrello è vuoto o contiene solo prodotti esauriti");
      return;
    }
    const unavailableLine = lines.find(
      (line) => !line.item.available || line.quantity > line.item.stock_quantity,
    );
    if (unavailableLine) {
      toast.error(
        `${unavailableLine.item.name}: sono disponibili ${unavailableLine.item.stock_quantity} unità`,
      );
      return;
    }
    sendingRef.current = true;
    setSending(true);
    requestIdRef.current ??= crypto.randomUUID();
    try {
      const order = await createOrder(lines, note, requestIdRef.current);
      const orderWithItems: Order = {
        ...order,
        order_items: lines.map(({ item, quantity }) => ({
          id: item.id,
          order_id: order.id,
          name: item.name,
          unit_price: item.price,
          quantity,
        })),
      };
      queryClient.setQueryData(["order", order.id], orderWithItems);
      queryClient.setQueryData(["order-status", order.id], order);
      requestIdRef.current = null;
      setCart({});
      setNote("");
      navigate({ to: "/ordine/$orderId", params: { orderId: order.id } });
    } catch {
      await queryClient.invalidateQueries({ queryKey: ["menu"] });
      toast.error("Non è stato possibile inviare l'ordine. Riprova.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const visible = menu.filter((m) => m.category === category);

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="font-display text-xl font-bold leading-tight">Bar Universitario</h1>
            <p className="text-xs text-muted-foreground">Ordina e ritira al bancone</p>
          </div>
        </div>
        <div className="mx-auto flex max-w-2xl gap-2 overflow-x-auto px-4 pb-3">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                c === category
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-3 px-4 py-4">
        {isLoading && (
          <p className="py-10 text-center text-sm text-muted-foreground">Carico il menu…</p>
        )}
        {visible.map((item) => {
          const qty = cart[item.id] ?? 0;
          const orderable = item.available && item.stock_quantity > 0;
          return (
            <article
              key={item.id}
              className={`flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] transition-opacity ${
                orderable ? "" : "opacity-60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-display text-base font-semibold">{item.name}</h2>
                  {!orderable && (
                    <Badge variant="destructive">
                      {item.stock_quantity === 0 ? "Esaurito" : "Non disponibile"}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                  {item.description}
                </p>
                <p className="mt-1 font-semibold text-primary">{formatPrice(item.price)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {item.stock_quantity} disponibili
                </p>
              </div>
              {orderable ? (
                qty > 0 ? (
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant="outline" onClick={() => dec(item.id)}>
                      <Minus className="size-4" />
                    </Button>
                    <span className="w-6 text-center font-semibold">{qty}</span>
                    <Button
                      size="icon"
                      onClick={() => add(item)}
                      disabled={qty >= item.stock_quantity || count >= MAX_ORDER_QUANTITY}
                    >
                      <Plus className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="icon"
                    onClick={() => add(item)}
                    aria-label={`Aggiungi ${item.name}`}
                    disabled={count >= MAX_ORDER_QUANTITY}
                  >
                    <Plus className="size-4" />
                  </Button>
                )
              ) : null}
            </article>
          );
        })}
      </main>

      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card p-4">
          <div className="mx-auto max-w-2xl">
            <Sheet>
              <SheetTrigger asChild>
                <Button size="lg" className="h-14 w-full justify-between text-base">
                  <span className="flex items-center gap-2">
                    <ShoppingBag className="size-5" /> Carrello · {count}
                  </span>
                  <span>{formatPrice(total)}</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
                <SheetHeader>
                  <SheetTitle className="font-display text-xl">Il tuo ordine</SheetTitle>
                </SheetHeader>
                <div className="space-y-3 px-4">
                  {lines.map((l) => (
                    <div key={l.item.id} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{l.item.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatPrice(l.item.price * l.quantity)}
                          {(!l.item.available || l.quantity > l.item.stock_quantity) &&
                            ` · solo ${l.item.stock_quantity} disponibili`}
                        </p>
                      </div>
                      <Button size="icon" variant="outline" onClick={() => dec(l.item.id)}>
                        <Minus className="size-4" />
                      </Button>
                      <span className="w-6 text-center font-semibold">{l.quantity}</span>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => add(l.item)}
                        disabled={
                          !l.item.available ||
                          l.quantity >= l.item.stock_quantity ||
                          count >= MAX_ORDER_QUANTITY
                        }
                      >
                        <Plus className="size-4" />
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(l.item.id)}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Nota per la cucina (opzionale): es. senza zucchero"
                    rows={2}
                  />
                  <Button
                    size="lg"
                    className="h-14 w-full text-base"
                    disabled={sending}
                    onClick={submit}
                  >
                    {sending && <Loader2 className="size-5 animate-spin" />}
                    Conferma ordine · {formatPrice(total)}
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      )}
    </div>
  );
}
