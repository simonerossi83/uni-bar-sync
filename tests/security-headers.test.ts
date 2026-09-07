import { beforeEach, describe, expect, it, vi } from "vitest";
const context = vi.hoisted(() => ({ request: undefined as Request | undefined, status: 200 }));
vi.mock("@tanstack/react-start/server", () => ({
  getRequest: () => context.request,
  setResponseStatus: (status: number) => {
    context.status = status;
  },
}));
import {
  applySecurityHeaders,
  contentSecurityPolicy,
  getCspNonce,
} from "../src/lib/security-headers.server";
import { httpError } from "../src/lib/http-error.server";

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SUPABASE_URL", "https://isolated.supabase.co");
  context.request = new Request("https://isolated.invalid/");
});
describe("response security", () => {
  it("uses one unpredictable nonce per request, never from client headers", () => {
    const nonce = getCspNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{24}$/);
    expect(getCspNonce()).toBe(nonce);
    expect(
      getCspNonce(new Request("https://isolated.invalid/", { headers: { "x-csp-nonce": nonce } })),
    ).not.toBe(nonce);
  });
  it("enforces nonce-based scripts, blocks objects/frames/inline handlers, and permits the real backend", () => {
    const policy = contentSecurityPolicy(getCspNonce());
    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("connect-src 'self' https://isolated.supabase.co");
    const scriptPolicy = policy.split(";").find((part) => part.trim().startsWith("script-src "))!;
    expect(scriptPolicy).not.toContain("unsafe-inline");
    expect(scriptPolicy).not.toContain("unsafe-eval");
  });
  it("does not cache nonce-bearing HTML or sensitive RPC responses", () => {
    const html = applySecurityHeaders(
      new Response("<html></html>", { headers: { "content-type": "text/html" } }),
      context.request!,
    );
    expect(html.headers.get("cache-control")).toBe("no-store");
    expect(html.headers.get("content-security-policy")).toContain(getCspNonce());
    const rpc = applySecurityHeaders(
      Response.json({ error: true }, { status: 401 }),
      new Request("https://isolated.invalid/_serverFn/test"),
    );
    expect(rpc.status).toBe(401);
    expect(rpc.headers.get("cache-control")).toBe("no-store");
    expect(rpc.headers.get("x-frame-options")).toBe("DENY");
  });
  it.each([400, 401, 403, 409, 429, 503])(
    "sets HTTP %i as well as the application error",
    (status) => {
      expect(httpError(status, "Expected error")).toMatchObject({ statusCode: status });
      expect(context.status).toBe(status);
    },
  );
});
