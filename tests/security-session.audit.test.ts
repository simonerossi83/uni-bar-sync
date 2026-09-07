import { beforeEach, describe, expect, it, vi } from "vitest";
import { H3Event } from "h3-v2";

const context = vi.hoisted(() => ({ event: undefined as H3Event | undefined }));
vi.mock("@tanstack/react-start/server", async () => {
  const { useSession } = await import("h3-v2");
  return {
    useSession: (config: Parameters<typeof useSession>[1]) => useSession(context.event!, config),
  };
});
vi.mock("@/lib/rate-limit.server", () => ({
  enforceRateLimit: async () => {},
  getClientAddress: () => "192.0.2.10",
}));
import {
  isKitchenAuthenticated,
  loginKitchen,
  logoutKitchen,
} from "../src/lib/kitchen-auth.server";

const password = "isolated-test-password-2026!";
function request(cookie?: string) {
  context.event = new H3Event(
    new Request("https://isolated.invalid/cucina", { headers: cookie ? { cookie } : {} }),
  );
}
async function login() {
  expect(await loginKitchen("test-kitchen", password)).toBe(true);
  return context.event!.res.headers.getSetCookie().at(-1)!.split(";")[0]!;
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("KITCHEN_USERNAME", "test-kitchen");
  vi.stubEnv("KITCHEN_PASSWORD", password);
  request();
});

describe("security audit with real encrypted cookies (no production requests)", () => {
  it("rejects unauthenticated requests and tampered cookies", async () => {
    expect(await isKitchenAuthenticated()).toBe(false);
    const cookie = await login();
    request(cookie);
    expect(await isKitchenAuthenticated()).toBe(true);
    request(cookie + "tampered");
    expect(await isKitchenAuthenticated()).toBe(false);
  });
  it("issues Secure, HttpOnly, SameSite=Lax cookies", async () => {
    await login();
    const header = context.event!.res.headers.getSetCookie().at(-1)!;
    expect(header).toMatch(/Secure/i);
    expect(header).toMatch(/HttpOnly/i);
    expect(header).toMatch(/SameSite=Lax/i);
  });
  it("documents finding SEC-01: password rotation does not revoke an issued cookie", async () => {
    const cookie = await login();
    vi.stubEnv("KITCHEN_PASSWORD", "different-isolated-password-2026!");
    request(cookie);
    // This assertion reproduces the open finding, not the desired secure behavior.
    expect(await isKitchenAuthenticated()).toBe(true);
  });
  it("documents finding SEC-01: logout clears the browser cookie but a copied cookie remains valid", async () => {
    const copiedCookie = await login();
    request(copiedCookie);
    await logoutKitchen();
    expect(context.event!.res.headers.getSetCookie().at(-1)).toMatch(/Max-Age=0/i);
    request(copiedCookie);
    // A server-side revocation/session-version check is still missing.
    expect(await isKitchenAuthenticated()).toBe(true);
  });
});
