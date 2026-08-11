import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Minus, Plus, ShoppingBag, Trash2, ChefHat, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  CATEGORIES,
  createOrder,
  fetchMenu,
  formatPrice,
  useBarRealtime,
  type MenuItem,
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
  const [cart, setCart] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [sending, setSending] = useState(false);

  const { data: menu = [], isLoading } = useQuery({ queryKey: ["menu"], queryFn: fetchMenu });
  useBarRealtime([["menu"]]);

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
    setCart((c) => ({ ...c, [item.id]: (c[item.id] ?? 0) + 1 }));
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
    const orderable = lines.filter((l) => l.item.available);
    if (orderable.length === 0) {
      toast.error("Il carrello è vuoto o contiene solo prodotti esauriti");
      return;
    }
    setSending(true);
    try {
      const order = await createOrder(orderable, note);
      setCart({});
      setNote("");
      navigate({ to: "/ordine/$orderId", params: { orderId: order.id } });
    } catch {
      toast.error("Non è stato possibile inviare l'ordine. Riprova.");
    } finally {
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
          <Button asChild variant="ghost" size="sm">
            <Link to="/cucina">
              <ChefHat className="size-4" /> Cucina
            </Link>
          </Button>
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
          return (
            <article
              key={item.id}
              className={`flex items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-soft)] transition-opacity ${
                item.available ? "" : "opacity-60"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate font-display text-base font-semibold">{item.name}</h2>
                  {!item.available && <Badge variant="destructive">Esaurito</Badge>}
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                  {item.description}
                </p>
                <p className="mt-1 font-semibold text-primary">{formatPrice(item.price)}</p>
              </div>
              {item.available ? (
                qty > 0 ? (
                  <div className="flex items-center gap-2">
                    <Button size="icon" variant="outline" onClick={() => dec(item.id)}>
                      <Minus className="size-4" />
                    </Button>
                    <span className="w-6 text-center font-semibold">{qty}</span>
                    <Button size="icon" onClick={() => add(item)}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <Button size="icon" onClick={() => add(item)} aria-label={`Aggiungi ${item.name}`}>
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
                          {!l.item.available && " · esaurito"}
                        </p>
                      </div>
                      <Button size="icon" variant="outline" onClick={() => dec(l.item.id)}>
                        <Minus className="size-4" />
                      </Button>
                      <span className="w-6 text-center font-semibold">{l.quantity}</span>
                      <Button size="icon" variant="outline" onClick={() => add(l.item)}>
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
