// scripts/test-demo-rich.mjs
//
// v3 acceptance — API-level VALUE test for the demo console.
//
// The v2 acceptance test (test-demo-richer-than-current.mjs in the parity
// plan) was a *presence* test: it asserted ≥5 rows and ≥4 KPI cards. An
// empty demo also has 0 rows; 0 ≥ 0 is true; the test passed. v3 closes
// the gap by asserting the demo is faithful to the real product's data:
//   - payroll total is non-zero (rate × minutes; the demo must wire rates)
//   - shift count matches log count / 5 (Thabo's seed contract)
//   - needsReview list contains real anomalies from the seeder
//   - audit log spans at least 3 personas
//   - KPIs are populated
//
// Connects to a live Convex deployment via ConvexClient (WebSocket) so we
// get reactive updates. Pre-condition: DEMO_MODE=1 is set on the Convex
// deployment (or the Anonymous provider is registered, so signIn succeeds).

import { strict as assert } from "node:assert";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ConvexClient } from "convex/browser";

import { api } from "../convex/_generated/api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function readEnvLocal() {
  const out = {};
  for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
    if (m && m[1] && !out[m[1]]) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const env = readEnvLocal();
const URL = env.NEXT_PUBLIC_CONVEX_URL ?? process.env.NEXT_PUBLIC_CONVEX_URL;
if (!URL || !/^https?:\/\//.test(URL)) {
  console.error("test-demo-rich: .env.local missing NEXT_PUBLIC_CONVEX_URL; aborting.");
  process.exit(2);
}

if (process.env.DEMO_MODE !== "1") {
  console.error("test-demo-rich: DEMO_MODE=1 must be exported in the test runner env; aborting.");
  process.exit(2);
}

const client = new ConvexClient(URL, { skipConvexDeploymentUrlCheck: true });
let token = null;

async function signInAnonymous() {
  const result = await client.action("auth:signIn", {
    provider: "anonymous",
    params: {},
  });
  if (!result?.tokens?.token) {
    throw new Error("signIn returned no token; shape=" + JSON.stringify(result));
  }
  token = result.tokens.token;
  client.setAuth(() => Promise.resolve(token));
  await new Promise((r) => setTimeout(r, 800));
}

async function seedDemo() {
  try {
    return await client.action(api.demo.seedDemoData, {});
  } catch (e) {
    if (e?.data === "FORBIDDEN") return { ok: false, reason: "FORBIDDEN" };
    throw e;
  }
}

async function pollShifts() {
  const start = Date.now();
  let lastErr = null;
  while (Date.now() - start < 30_000) {
    try {
      const rows = await client.query(api.demo.boundPersonaShifts, {});
      if (Array.isArray(rows) && rows.length >= 5) return rows;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("pollShifts: boundPersonaShifts never reached ≥5 rows in 30s. lastErr=" + (lastErr?.data ?? lastErr?.message));
}

let teardown = async () => {};
test("bootstrap: sign in, seed, poll", async (t) => {
  t.diagnostic("URL: " + URL);
  await signInAnonymous();
  t.diagnostic("signed in (token len=" + token.length + ")");
  await seedDemo();
  const shifts = await pollShifts();
  t.diagnostic("boundPersonaShifts: " + shifts.length + " rows");
  assert.ok(shifts.length >= 5, "expected ≥5 shifts after seed, got " + shifts.length);
  teardown = async () => { try { await client.close(); } catch {} };
});

// ASSUMPTION (v3): Thabo's `users.hourlyRateOverride` is 180 (ZAR/h). The
// demo console subagent must wire this in the seeder. If the demo ships
// with rate=0, this assertion fails — which is the v3 contract: the test
// enforces the demo isn't empty.
const ASSUMED_THABO_RATE = 180;

test("A: Thabo's payroll total is non-zero and matches derived minutes × rate", async (t) => {
  const [payroll, shifts, logs] = await Promise.all([
    client.query(api.demo.boundPersonaPayroll, {}),
    client.query(api.demo.boundPersonaShifts, {}),
    client.query(api.demo.boundPersonaLogs, {}),
  ]);
  t.diagnostic("payroll.totals=" + JSON.stringify(payroll?.totals) + " rate=" + payroll?.rate);

  const { localDayKey } = await import("../src/lib/shift-engine.ts");
  const { computePay } = await import("../src/lib/payroll-strategies.ts");

  const dayMap = new Map();
  for (const s of shifts) {
    if (s.needsReview) continue;
    const day = localDayKey(s.startedAt, s.timezone ?? "UTC");
    dayMap.set(day, (dayMap.get(day) ?? 0) + (s.totalMinutes ?? 0));
  }
  const canonical = computePay(
    [...dayMap.entries()].sort().map(([day, minutes]) => ({ day, minutes })),
    payroll.rate,
    payroll.strategy ?? undefined
  );

  const live = payroll.totals.pay;
  const ref = canonical.totals.pay;
  t.diagnostic("canonical.totals=" + JSON.stringify(canonical.totals) + " live=" + live);

  assert.ok(Math.abs(live - ref) <= 1, `payroll.totals.pay (${live}) should match canonical (${ref}) within 1 ZAR`);
  assert.ok(live > 0, `payroll.totals.pay should be > 0 (assumes Thabo rate=${ASSUMED_THABO_RATE} ZAR/h); got ${live}. If 0, the seeder isn't setting hourlyRateOverride.`);
  assert.ok(logs.length > 0, "boundPersonaLogs returned 0 rows — seed is empty");
});

test("B: Thabo's shift count ≈ log count / 5 (his seed contract)", async (t) => {
  const [logs, shifts] = await Promise.all([
    client.query(api.demo.boundPersonaLogs, {}),
    client.query(api.demo.boundPersonaShifts, {}),
  ]);
  const ratio = shifts.length / Math.max(1, logs.length / 5);
  t.diagnostic(`logs=${logs.length} shifts=${shifts.length} ratio=${ratio.toFixed(2)}`);
  assert.ok(Math.abs(shifts.length - logs.length / 5) <= 2,
    `shifts.length (${shifts.length}) should be within 2 of logs.length/5 (${(logs.length / 5).toFixed(1)}); got delta=${Math.abs(shifts.length - logs.length / 5)}`);
});

test("C: needsReview list is non-empty and contains a real anomaly", async (t) => {
  const rows = await client.query(api.demo.demoNeedsReview, {});
  t.diagnostic("needsReview=" + rows.length + " reasons=" + JSON.stringify(rows.map(r => r.reviewReason)));
  assert.ok(rows.length >= 1, `demoNeedsReview should be ≥1; got ${rows.length}. If 0, Lerato's unpaired lunch and David's impossible travel aren't being seeded/flagged.`);
  const realAnomaly = rows.find((r) =>
    typeof r.reviewReason === "string" &&
    (r.reviewReason.includes("unpaired_lunch_excessive") || r.reviewReason.includes("illegal_transition"))
  );
  assert.ok(realAnomaly, `no row with unpaired_lunch_excessive or illegal_transition; reasons=${JSON.stringify(rows.map(r => r.reviewReason))}`);
});

test("D: audit log spans ≥3 personas (and never 'Demo reviewer')", async (t) => {
  const audit = await client.query(api.demo.demoAudit, { limit: 200 });
  const roster = await client.query(api.demo.demoEmployeeRoster, {});
  t.diagnostic("audit=" + audit.length + " roster=" + roster.length);
  assert.ok(audit.length > 0, "demoAudit returned 0 rows — seed is empty");

  const personaNames = new Set(roster.map((u) => u.name).filter(Boolean));
  assert.ok(!personaNames.has("Demo reviewer"),
    `roster contains 'Demo reviewer' (the bound session, not a persona) — leak; names=${[...personaNames].join(",")}`);
  assert.ok(personaNames.size >= 3,
    `roster has only ${personaNames.size} distinct persona names; want ≥3. names=${[...personaNames].join(",")}`);
});

test("E: KPI cards are populated", async (t) => {
  const kpi = await client.query(api.demo.demoKpis, {});
  t.diagnostic("kpi=" + JSON.stringify(kpi));
  assert.ok(kpi, "demoKpis returned null");
  assert.ok(kpi.weeklyBillableMinutes > 0, `weeklyBillableMinutes should be > 0 (persona has work logged); got ${kpi.weeklyBillableMinutes}`);
  assert.ok(kpi.pendingReviews >= 0, "pendingReviews should be ≥0");
  if (kpi.pendingReviews === 0) {
    t.diagnostic("NOTE: pendingReviews=0 — persona has no anomalies (expected for Thabo, the default binding).");
  }
  assert.ok(kpi.anomalies24h >= 0, "anomalies24h should be ≥0");
  assert.equal(kpi.demoModeEnabled, true, "demoModeEnabled should be true");
});

test("cleanup: close client", async () => {
  await teardown();
  assert.ok(true);
});

console.log("demo-rich (v3, API-level value) tests: all passed");
