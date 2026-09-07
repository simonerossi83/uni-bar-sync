import { getRequest, getRequestIP, setResponseHeader } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { httpError } from "@/lib/http-error.server";

type RateLimitOptions = {
  scope: string;
  identifier: string;
  windowSeconds: number;
  maxRequests: number;
  message: string;
};

function rateLimitError(retryAfterSeconds: number, message: string) {
  setResponseHeader("retry-after", String(retryAfterSeconds));
  throw Object.assign(httpError(429, message), { retryAfterSeconds });
}

async function hashIdentifier(scope: string, identifier: string) {
  const secret = process.env["KITCHEN_SESSION_SECRET"];
  if (!secret || secret.length < 32) {
    throw httpError(500, "Rate limiting non configurato");
  }
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret)
    .update("uni-bar-rate-limit:" + scope + ":" + identifier, "utf8")
    .digest("hex");
}

export function getClientAddress() {
  const request = getRequest();
  const cloudflareAddress = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareAddress) return cloudflareAddress.slice(0, 128);
  const realAddress = request.headers.get("x-real-ip")?.trim();
  if (realAddress) return realAddress.slice(0, 128);
  const forwardedAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwardedAddress) return forwardedAddress.slice(0, 128);
  return (getRequestIP() ?? "unknown").slice(0, 128);
}

export async function enforceRateLimit(options: RateLimitOptions) {
  const identifierHash = await hashIdentifier(options.scope, options.identifier);
  const { data, error } = await supabaseAdmin.rpc("consume_rate_limit", {
    p_scope: options.scope,
    p_identifier_hash: identifierHash,
    p_window_seconds: options.windowSeconds,
    p_max_requests: options.maxRequests,
  });
  if (error) throw httpError(503, "Rate limiting temporaneamente non disponibile");
  const result = data?.[0];
  if (!result) {
    throw httpError(503, "Rate limiting non disponibile");
  }
  if (!result.allowed) {
    rateLimitError(Math.max(1, result.retry_after_seconds), options.message);
  }
}
