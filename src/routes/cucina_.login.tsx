import { createFileRoute, redirect, useNavigate, useRouter } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { ChefHat, Loader2, LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authenticateKitchen, getKitchenAuthStatus } from "@/lib/bar";

export const Route = createFileRoute("/cucina_/login")({
  beforeLoad: async () => {
    const { authenticated } = await getKitchenAuthStatus();
    if (authenticated) throw redirect({ to: "/cucina" });
  },
  head: () => ({ meta: [{ title: "Accesso cucina — Bar Universitario" }] }),
  component: KitchenLoginPage,
});

function KitchenLoginPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await authenticateKitchen(username, password);
      if (!result.authenticated) {
        setError("Username o password non corretti");
        return;
      }
      await router.invalidate();
      await navigate({ to: "/cucina", replace: true });
    } catch {
      setError("Accesso non disponibile. Riprova tra poco.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <main className="w-full max-w-sm rounded-3xl border border-border bg-card p-6 shadow-[var(--shadow-soft)]">
        <div className="text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <ChefHat className="size-8" />
          </div>
          <h1 className="mt-4 font-display text-3xl font-black">Accesso cucina</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Area riservata al personale autorizzato
          </p>
        </div>

        <form className="mt-6 space-y-4" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              required
            />
          </div>
          {error && (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <Button type="submit" size="lg" className="h-12 w-full" disabled={submitting}>
            {submitting ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <LockKeyhole className="size-5" />
            )}
            Accedi
          </Button>
        </form>
      </main>
    </div>
  );
}
