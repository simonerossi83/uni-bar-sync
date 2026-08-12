import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

const securityHeadersMiddleware = createMiddleware().server(async ({ next }) => {
  const result = await next();
  const response = result.response;
  if (!(response instanceof Response)) return result;

  response.headers.set(
    "content-security-policy",
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  response.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");

  const pathname = new URL(getRequest().url).pathname;
  const sensitiveResponse =
    pathname.startsWith("/cucina") ||
    pathname.startsWith("/ordine/") ||
    pathname.startsWith("/_serverFn/") ||
    response.headers.has("set-cookie");
  if (sensitiveResponse) {
    response.headers.set("cache-control", "no-store");
    response.headers.set("pragma", "no-cache");
  }
  if (process.env["NODE_ENV"] === "production") {
    response.headers.set("strict-transport-security", "max-age=31536000");
  }

  return result;
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, errorMiddleware, csrfMiddleware],
}));
