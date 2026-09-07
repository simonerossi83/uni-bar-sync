import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

// Bounded diagnostic: no login, order creation, stock changes or admin keys.
// The status RPC is tested with an invalid token: this is NOT a successful
// customer-order flow or a benchmark of writes/locks.
if (!process.argv.includes("--live")) {
  console.log("Run explicitly with: node scripts/check-capacity-readonly.mjs --live");
  process.exit(0);
}
const env = {};
for (const file of [".env", ".env.local"]) {
  try {
    Object.assign(env, parseEnv(readFileSync(file, "utf8")));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const app = "https://simonerossi83-uni-bar-sync.ro-saimon.workers.dev";
const db = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
if (!db || !key) throw new Error("Missing public Supabase configuration");
if (new URL(db).hostname !== "sgziuagzvnmnzlqibgdo.supabase.co") {
  throw new Error("Unexpected project: refusing to load-test a different backend");
}
if (key.startsWith("sb_secret_")) throw new Error("A publishable key is required");
if (
  key.startsWith("eyJ") &&
  JSON.parse(Buffer.from(key.split(".")[1], "base64url")).role !== "anon"
) {
  throw new Error("A public anon key is required");
}
const publicHeaders = { apikey: key };
if (key.startsWith("eyJ")) publicHeaders.Authorization = `Bearer ${key}`;

const targets = {
  homepage: {
    url: `${app}/`,
    init: {},
    valid: (body) => body.includes("Bar Universitario"),
  },
  menu: {
    url: `${db}/rest/v1/menu_items?select=id,name,description,price,category,available,initial_stock,stock_quantity,sort_order&order=category.asc,sort_order.asc`,
    init: { headers: publicHeaders },
    valid: (body) => {
      const rows = JSON.parse(body);
      return Array.isArray(rows) && rows.length > 0;
    },
  },
  statusDenied: {
    url: `${db}/rest/v1/rpc/get_customer_order_status`,
    init: {
      method: "POST",
      headers: { ...publicHeaders, "content-type": "application/json" },
      body: JSON.stringify({
        p_order_id: "00000000-0000-0000-0000-000000000000",
        p_access_token: "0".repeat(64),
      }),
    },
    valid: (body) => body.trim() === "[]",
  },
  stock: {
    url: `${db}/rest/v1/menu_items?select=id,available,stock_quantity`,
    init: { headers: publicHeaders },
    valid: (body) => {
      const rows = JSON.parse(body);
      return Array.isArray(rows) && rows.length > 0;
    },
  },
};
const round = (n) => Math.round(n * 10) / 10;
const steadyOnly = process.argv.includes("--steady-only");
let active = 0;
let peakActive = 0;
async function request(target) {
  const started = performance.now();
  active++;
  peakActive = Math.max(peakActive, active);
  try {
    const response = await fetch(target.url, {
      ...target.init,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    const body = await response.text();
    return {
      status: response.status,
      ok: response.ok && target.valid(body),
      ms: performance.now() - started,
      bytes: Buffer.byteLength(body),
      encoding: response.headers.get("content-encoding"),
    };
  } catch (error) {
    return { status: error.name, ok: false, ms: performance.now() - started, bytes: 0 };
  } finally {
    active--;
  }
}
function summarize(name, users, started, results) {
  const latencies = results.map((r) => r.ms).sort((a, b) => a - b);
  const pct = (p) => round(latencies[Math.ceil(latencies.length * p) - 1]);
  const statuses = {};
  for (const r of results) statuses[r.status] = (statuses[r.status] || 0) + 1;
  const summary = {
    test: name,
    virtualUsers: users,
    requests: results.length,
    peakInFlight: peakActive,
    errors: results.filter((r) => !r.ok).length,
    statuses,
    elapsedSeconds: round((performance.now() - started) / 1000),
    p50ms: pct(0.5),
    p95ms: pct(0.95),
    p99ms: pct(0.99),
    maxMs: round(latencies.at(-1)),
    decodedBytes: results.reduce((s, r) => s + r.bytes, 0),
  };
  console.log(JSON.stringify(summary));
  if (summary.errors || summary.p95ms > 5000) {
    throw new Error(`Stopping after ${name}: errors or p95 over 5 seconds`);
  }
}

console.log(
  JSON.stringify({
    startedAt: new Date().toISOString(),
    mode: "read-only",
    app,
    supabase: db,
    maxRequests: 3500,
  }),
);
for (const name of ["homepage", "menu", "stock", "statusDenied"]) {
  const probe = await request(targets[name]);
  console.log(JSON.stringify({ probe: name, ...probe }));
  if (!probe.ok) throw new Error(`Baseline failed: ${name}`);
}
for (const users of steadyOnly ? [] : [25, 100, 200, 400]) {
  for (const name of ["homepage", "menu"]) {
    peakActive = 0;
    const start = performance.now();
    const results = await Promise.all(Array.from({ length: users }, () => request(targets[name])));
    summarize(`${name}-burst`, users, start, results);
    await sleep(500);
  }
}
if (steadyOnly) {
  for (const name of ["menu", "stock"]) {
    peakActive = 0;
    const started = performance.now();
    let stop = false;
    const samples = (
      await Promise.all(
        Array.from({ length: 400 }, async (_, i) => {
          await sleep(i * 50);
          if (stop) return [];
          const result = await request(targets[name]);
          if (!result.ok || result.ms > 5000) stop = true;
          return [result];
        }),
      )
    ).flat();
    summarize(`${name}-staggered-20-per-second`, 400, started, samples);
    if (stop) throw new Error("Stopped staggered menu reads early");
  }
}
// 400 virtual readers, each with a fixed 3-4.5 second cadence and a staggered
// start. Five polls each; status body intentionally remains unauthorized/empty.
peakActive = 0;
const start = performance.now();
let stopPolling = false;
const results = (
  await Promise.all(
    Array.from({ length: 400 }, async (_, i) => {
      const interval = 3000 + ((i * 37) % 1500);
      await sleep((i * 37) % 3750);
      const samples = [];
      for (let n = 0; n < 5 && !stopPolling; n++) {
        const sample = await request(targets.statusDenied);
        samples.push(sample);
        if (!sample.ok || sample.ms > 5000) stopPolling = true;
        if (n < 4 && !stopPolling) await sleep(interval);
      }
      return samples;
    }),
  )
).flat();
summarize("status-denied-staggered-polling", 400, start, results);
console.log(
  JSON.stringify({
    finishedAt: new Date().toISOString(),
    writesTested: false,
    authenticatedOrdersTested: false,
  }),
);
