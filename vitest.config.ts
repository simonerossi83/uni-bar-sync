import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    hookTimeout: 60_000,
    env: { KITCHEN_SESSION_SECRET: "isolated-test-secret-not-used-in-production-2026" },
  },
});
