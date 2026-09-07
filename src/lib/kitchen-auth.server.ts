import { setResponseStatus, useSession as getServerSession } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { httpError } from "@/lib/http-error.server";

type KitchenSessionData = {
  kitchenToken?: string;
};

type CustomerSessionData = {
  orderIds?: string[];
  customerId?: string;
};

const KITCHEN_SESSION_NAME = "uni_bar_kitchen";
const CUSTOMER_SESSION_NAME = "uni_bar_customer";
const MAX_CUSTOMER_ORDERS = 20;
const KITCHEN_SESSION_SECONDS = 60 * 60 * 12;
const INSECURE_DEFAULT_PASSWORD_SHA256 =
  "a37c507a0ac4aa9ddde41555c3b3667d867f84155771d6a10c12a161c201cacb";
function getSessionSecret() {
  const secret = process.env["KITCHEN_SESSION_SECRET"];
  if (!secret || secret.length < 32) throw httpError(500, "Session secret non configurato");
  return secret;
}

function sessionCookie() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env["NODE_ENV"] === "production",
    path: "/",
  };
}

async function getKitchenSession() {
  return getServerSession<KitchenSessionData>({
    name: KITCHEN_SESSION_NAME,
    password: getSessionSecret(),
    maxAge: KITCHEN_SESSION_SECONDS,
    sessionHeader: false,
    cookie: sessionCookie(),
  });
}

async function getCustomerSession() {
  return getServerSession<CustomerSessionData>({
    name: CUSTOMER_SESSION_NAME,
    password: getSessionSecret(),
    maxAge: 60 * 60 * 24 * 7,
    cookie: sessionCookie(),
  });
}

async function safeEquals(actual: string, expected: string) {
  const { createHash, timingSafeEqual } = await import("node:crypto");
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

async function validateProductionKitchenPassword(password: string) {
  if (process.env["NODE_ENV"] !== "production") return;
  const { createHash } = await import("node:crypto");
  const digest = createHash("sha256").update(password, "utf8").digest("hex");
  if (password.length < 16 || digest === INSECURE_DEFAULT_PASSWORD_SHA256) {
    throw httpError(500, "Password cucina di produzione non sicura");
  }
}

export async function isKitchenAuthenticated() {
  const session = await getKitchenSession();
  const token = session.data.kitchenToken;
  // Reject old flag-only cookies and malformed values before contacting the DB.
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return false;
  const { data, error } = await supabaseAdmin
    .from("kitchen_sessions")
    .select("session_hash")
    .eq("session_hash", await hashSessionToken(token))
    .eq("credential_version", await kitchenCredentialVersion())
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  // No positive auth cache: a copied cookie must stop working on the next request.
  if (error) throw httpError(503, "Verifica sessione cucina temporaneamente non disponibile");
  return Boolean(data);
}

async function hashSessionToken(token: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function kitchenCredentialVersion() {
  const username = process.env["KITCHEN_USERNAME"];
  const password = process.env["KITCHEN_PASSWORD"];
  if (!username || !password) throw httpError(503, "Credenziali cucina non configurate");
  await validateProductionKitchenPassword(password);
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", getSessionSecret())
    .update(JSON.stringify(["kitchen-credentials-v1", username, password]), "utf8")
    .digest("hex");
}

async function revokeKitchenToken(token: string | undefined) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return;
  const { error } = await supabaseAdmin
    .from("kitchen_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("session_hash", await hashSessionToken(token))
    .is("revoked_at", null);
  if (error) throw httpError(503, "Revoca sessione non riuscita. Riprova.");
}

export async function requireKitchenAuthenticated() {
  if (!(await isKitchenAuthenticated())) {
    throw httpError(401, "Autenticazione cucina richiesta");
  }
}

export async function loginKitchen(username: string, password: string) {
  const expectedUsername = process.env["KITCHEN_USERNAME"];
  const expectedPassword = process.env["KITCHEN_PASSWORD"];
  if (!expectedUsername || !expectedPassword) {
    throw httpError(500, "Credenziali cucina non configurate lato server");
  }
  await validateProductionKitchenPassword(expectedPassword);

  const { enforceRateLimit, getClientAddress } = await import("@/lib/rate-limit.server");
  await enforceRateLimit({
    scope: "kitchen_login_ip",
    identifier: getClientAddress(),
    windowSeconds: 15 * 60,
    maxRequests: 8,
    message: "Troppi tentativi di accesso. Riprova più tardi.",
  });

  const [usernameMatches, passwordMatches] = await Promise.all([
    safeEquals(username, expectedUsername),
    safeEquals(password, expectedPassword),
  ]);
  if (!usernameMatches || !passwordMatches) {
    setResponseStatus(401);
    return false;
  }

  const session = await getKitchenSession();
  await revokeKitchenToken(session.data.kitchenToken);
  const { randomBytes } = await import("node:crypto");
  const kitchenToken = randomBytes(32).toString("hex");
  const { error } = await supabaseAdmin.from("kitchen_sessions").insert({
    session_hash: await hashSessionToken(kitchenToken),
    credential_version: await kitchenCredentialVersion(),
    expires_at: new Date(Date.now() + KITCHEN_SESSION_SECONDS * 1000).toISOString(),
  });
  if (error) throw httpError(503, "Creazione sessione cucina non riuscita. Riprova.");
  // Fresh container/expiry on login; no inherited flag or session fixation.
  await session.clear();
  const freshSession = await getKitchenSession();
  await freshSession.update({ kitchenToken });
  return true;
}

export async function logoutKitchen() {
  const session = await getKitchenSession();
  await revokeKitchenToken(session.data.kitchenToken);
  // If revocation failed, keep the cookie so the user can retry logout.
  await session.clear();
}

export async function rememberCustomerOrder(orderId: string) {
  const session = await getCustomerSession();
  const currentIds = session.data.orderIds ?? [];
  const orderIds = [orderId, ...currentIds.filter((id) => id !== orderId)].slice(
    0,
    MAX_CUSTOMER_ORDERS,
  );
  await session.update({ ...session.data, orderIds });
}

export async function getOrCreateCustomerId() {
  const session = await getCustomerSession();
  if (session.data.customerId) return session.data.customerId;
  const { randomUUID } = await import("node:crypto");
  const customerId = randomUUID();
  await session.update({ ...session.data, customerId });
  return customerId;
}

export async function customerOwnsOrder(orderId: string) {
  const session = await getCustomerSession();
  return (session.data.orderIds ?? []).includes(orderId);
}

export { httpError };
