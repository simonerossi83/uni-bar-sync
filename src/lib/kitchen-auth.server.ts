import { useSession as getServerSession } from "@tanstack/react-start/server";

type KitchenSessionData = {
  kitchenAuthenticated?: boolean;
  authenticatedAt?: string;
};

type CustomerSessionData = {
  orderIds?: string[];
  customerId?: string;
};

const KITCHEN_SESSION_NAME = "uni_bar_kitchen";
const CUSTOMER_SESSION_NAME = "uni_bar_customer";
const MAX_CUSTOMER_ORDERS = 20;
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
    maxAge: 60 * 60 * 12,
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
  return session.data.kitchenAuthenticated === true;
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
  if (!usernameMatches || !passwordMatches) return false;

  const session = await getKitchenSession();
  await session.update({
    kitchenAuthenticated: true,
    authenticatedAt: new Date().toISOString(),
  });
  return true;
}

export async function logoutKitchen() {
  const session = await getKitchenSession();
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

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}
