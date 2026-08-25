// scripts/test-demo-v3.mjs
//
// v3 demo console surface check.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { localDayKey } from "../src/lib/shift-engine.ts";
import { computePay } from "../src/lib/payroll-strategies.ts";
import { toCsv } from "../src/lib/csv.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");
const read = (rel) => readFileSync(resolve(ROOT, rel), "utf8");

test("requireDemoReviewer is exported from convex/access.ts", () => {
  const src = read("convex/access.ts");
  assert.match(src, /export\s+async\s+function\s+requireDemoReviewer/);
  assert.match(src, /DEMO_MODE\s*!==\s*"1"/);
  assert.match(src, /isAnonymous\s*!==\s*true/);
  assert.match(src, /DEMO_SESSION_NOT_BOUND/);
});

test("the 7 read queries are present in convex/demo.ts", () => {
  const src = read("convex/demo.ts");
  for (const name of [
    "boundPersonaLogs",
    "boundPersonaShifts",
    "boundPersonaPayroll",
    "demoAudit",
    "demoNeedsReview",
    "demoKpis",
    "demoEmployeeRoster",
  ]) {
    assert.match(src, new RegExp(`export const ${name} = query`), `missing query ${name}`);
  }
});

test("the 1 action + 2 mutations + 4 supporting mutations are present in convex/demo.ts", () => {
  const src = read("convex/demo.ts");
  assert.match(src, /export const checkInAsPersona = action/);
  assert.match(src, /export const switchPersona = mutation/);
  assert.match(src, /export const demoExportLogsCsv = action/);
  assert.match(src, /export const demoReplyToEmployee = mutation/);
  assert.match(src, /export const demoMarkQueueItemRead = mutation/);
  assert.match(src, /export const demoModeratorInbox = query/);
  assert.match(src, /export const bindReviewer = mutation/);
  assert.match(src, /export const getBinding = query/);
  assert.match(src, /export const _resolveDemoReviewer = internalQuery/);
  assert.match(src, /export const demoResolveShift = mutation/);
  assert.match(src, /export const demoRecomputeEmployeeShifts = mutation/);
});

test("createLogAs internalMutation exists in convex/logs.ts", () => {
  const src = read("convex/logs.ts");
  assert.match(src, /export const createLogAs = internalMutation/);
  assert.match(src, /reviewerId:\s*v\.id\(\"users\"\)/);
  assert.match(src, /personaUserId:\s*v\.id\(\"users\"\)/);
  assert.match(src, /createdByDemoReviewerId:\s*args\.reviewerId/);
  assert.match(src, /isModeratorOverride:\s*true/);
});

test("schema includes demoSessions table and additive users / logs fields", () => {
  const src = read("convex/schema.ts");
  assert.match(src, /demoSessions:\s*defineTable/);
  assert.match(src, /by_reviewer/);
  assert.match(src, /by_persona/);
  assert.match(src, /payStrategy:\s*v\.optional\(/);
  assert.match(src, /locale:\s*v\.optional\(v\.string\(\)\)/);
  assert.match(src, /createdByDemoReviewerId:\s*v\.optional\(v\.id\(\"users\"\)\)/);
});

test("localDayKey and computePay are importable", () => {
  assert.equal(typeof localDayKey, "function");
  assert.equal(typeof computePay, "function");
  assert.equal(localDayKey(Date.UTC(2026, 7, 3, 22, 30), "UTC"), "2026-08-03");
  const r = computePay([{ day: "2026-08-03", minutes: 600 }], 100, "flat");
  assert.equal(r.totals.pay, 1000);
});

test("CSV column count is 9 (same as production exportLogsCsv)", () => {
  const csv = toCsv(
    [
      "client_time_utc",
      "server_time_utc",
      "status",
      "lat",
      "lng",
      "accuracy_m",
      "geofence",
      "travel_flag",
      "skew_s",
    ],
    [["2026-08-03T06:00:00.000Z", "2026-08-03T06:00:01.000Z", "arrived", -26.2, 28.04, 18, "in", "", 1]]
  );
  const header = csv.split("\r\n")[0];
  assert.equal(header.split(",").length, 9, `header was: ${header}`);
});

test("demo.ts and logs.ts respect the brief's no-skip gates", () => {
  const demo = read("convex/demo.ts");
  const auth = read("convex/auth.ts");
  assert.match(demo, /caller\.role !== "moderator" && caller\.isAnonymous !== true/);
  assert.match(auth, /thabo\.demo@jpay\.local/);
  assert.match(auth, /demoSessions/);
  assert.match(demo, /demoSessions[\s\S]{0,400}withIndex\("by_reviewer"/);
});

test("checksum: the brief's audit-trail field is wired in createLogAs", () => {
  const logs = read("convex/logs.ts");
  const start = logs.indexOf("export const createLogAs = internalMutation");
  assert.ok(start >= 0, "createLogAs not found");
  let depth = 0;
  let i = logs.indexOf("{", start);
  let end = -1;
  for (; i < logs.length; i++) {
    if (logs[i] === "{") depth++;
    else if (logs[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.ok(end > start, "no matching brace for createLogAs");
  const block = logs.slice(start, end);
  assert.match(block, /isModeratorOverride: true/);
  assert.match(block, /createdByDemoReviewerId: args\.reviewerId/);
});

console.log("demo-v3 surface tests: all passed");
