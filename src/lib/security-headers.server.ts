import { randomBytes } from "node:crypto";
import { getRequest } from "@tanstack/react-start/server";

const requestNonces = new WeakMap<Request, string>();

export function getCspNonce(request: Request = getRequest()) {
  let nonce = requestNonces.get(request);
  if (!nonce) {
    nonce = randomBytes(18).toString("base64");
    requestNonces.set(request, nonce);
  }
  return nonce;
}

export function contentSecurityPolicy(nonce: string) {
  const configuredUrl = process.env["SUPABASE_URL"];
  const backend = configuredUrl ? new URL(configuredUrl).origin : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "script-src-attr 'none'",
    // Radix/Sonner and progress bars use dynamic inline styles, not inline JS.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${backend}`.trim(),
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function applySecurityHeaders(
  response: Response,
  request: Request,
  nonce = getCspNonce(request),
) {
  const production = process.env["NODE_ENV"] === "production";
  response.headers.set(
    "content-security-policy",
    production
      ? contentSecurityPolicy(nonce)
      : "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  // Dev/HMR injects its own scripts. Validate the stricter policy in production
  // preview; don't silently break the development server with an unsafe workaround.
  if (!production)
    response.headers.set("content-security-policy-report-only", contentSecurityPolicy(nonce));
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  const path = new URL(request.url).pathname;
  if (
    response.headers.get("content-type")?.includes("text/html") ||
    path.startsWith("/cucina") ||
    path.startsWith("/ordine/") ||
    path.startsWith("/_serverFn/") ||
    response.headers.has("set-cookie")
  ) {
    // A page's nonce must not be replayed from shared/browser HTML caches.
    // Fingerprinted static assets are still served/cached separately by Nitro.
    response.headers.set("cache-control", "no-store");
    response.headers.set("pragma", "no-cache");
  }
  if (production) response.headers.set("strict-transport-security", "max-age=31536000");
  return response;
}
