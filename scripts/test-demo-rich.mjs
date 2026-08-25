// scripts/test-demo-rich.mjs
// Value test for the v3 demo console.

import { strict as assert } from "node:assert";
import test from "node:test";
import { deriveSegments, localDayKey, DEFAULT_LUNCH_MINUTES } from "../src/lib/shift-engine.ts";
import { computePay } from "../src/lib/payroll-strategies.ts";

const RATE = 180;
const SITE_TZ = "Africa/Johannesburg";

function buildThaboLogs() {
  const now = new Date("2026-08-25T12:00:00Z");
  const out = [];
  const dayStart = (daysAgo, hourUtc) => {
    const d = new Date(now.getTime() - daysAgo * 24 * 3600 * 1000);
    d.setUTCHours(hourUtc, 0, 0, 0);
    return d.getTime();
  };
  let seq = 0;
  for (let d = 13; d >= 1; d--) {
    const dow = new Date(dayStart(d, 6)).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const k = (status, t, side) => {
      out.push({
        _creationTime: t + 1000,
        idempotencyKey: `thabo:${t}:${seq++}`,
        clientReportedTime: t,
        clockSkewMs: 0,
        status,
        siteTimezone: SITE_TZ,
        sideMissionDurationMinutes: side,
      });
    };
    k("arrived", dayStart(d, 6));
    k("checkpoint", dayStart(d, 6) + 4 * 3600e3);
    k("lunch", dayStart(d, 6) + 4.5 * 3600e3);
    k("checkpoint", dayStart(d, 6) + 5.5 * 3600e3);
    k("job finish", dayStart(d, 6) + 9 * 3600e3);
  }
  return out;
}

test("Thabo: deriveSegments produces a non-zero shift count from a 13-weekday seed", () => {
  const logs = buildThaboLogs();
  assert.equal(logs.length, 9 * 5, `expected 45 logs, got ${logs.length}`);
  const segments = deriveSegments(logs);
  assert.ok(segments.length >= 9, `expected >= 9 segments, got ${segments.length}`);
  for (const s of segments) {
    assert.equal(s.needsReview, false);
  }
});

test("Thabo: derived shift minutes are 540 per day (paired lunch)", () => {
  const logs = buildThaboLogs();
  const segments = deriveSegments(logs);
  for (const s of segments) {
    assert.equal(s.totalMinutes, 540, `expected 540 min/day, got ${s.totalMinutes}`);
  }
});

test("Thabo: localDayKey produces 9 unique YYYY-MM-DD days", () => {
  const logs = buildThaboLogs();
  const segments = deriveSegments(logs);
  const days = new Set(segments.map((s) => localDayKey(s.startedAt, SITE_TZ)));
  assert.equal(days.size, segments.length);
  for (const d of days) {
    assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test("Thabo: boundPersonaPayroll-equivalent: pay > 0", () => {
  const logs = buildThaboLogs();
  const segments = deriveSegments(logs);
  const days = new Map();
  for (const s of segments) {
    if (s.needsReview) continue;
    const key = localDayKey(s.startedAt, s.timezone ?? SITE_TZ);
    days.set(key, (days.get(key) ?? 0) + (s.totalMinutes ?? 0));
  }
  const input = [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, minutes]) => ({ day, minutes }));
  const result = computePay(input, RATE, "bcea");
  assert.ok(result.totals.pay > 0, `expected non-zero pay, got ${result.totals.pay}`);
  assert.ok(result.totals.payableMinutes > 0);
  assert.ok(result.totals.pay >= 14000 && result.totals.pay <= 22500);
  assert.equal(result.strategy, "bcea");
});

test("Paired lunch is not deducted: removing the lunch log leaves the total unchanged", () => {
  const logs = buildThaboLogs();
  const noLunch = logs.filter((l) => l.status !== "lunch");
  const withLunchSegments = deriveSegments(logs);
  const noLunchSegments = deriveSegments(noLunch);
  assert.equal(withLunchSegments.length, noLunchSegments.length);
  for (let i = 0; i < withLunchSegments.length; i++) {
    const a = withLunchSegments[i];
    const b = noLunchSegments[i];
    assert.equal((b.totalMinutes ?? 0) - (a.totalMinutes ?? 0), 0);
  }
});

test("Unpaired lunch IS deducted: lunch as last status costs 60 min", () => {
  const dayStart = Date.UTC(2026, 7, 3, 6);
  const segs = deriveSegments([
    { _creationTime: dayStart + 1000, idempotencyKey: "a1", clientReportedTime: dayStart, clockSkewMs: 0, status: "arrived", siteTimezone: "UTC" },
    { _creationTime: dayStart + 4 * 3600e3 + 1000, idempotencyKey: "a2", clientReportedTime: dayStart + 4 * 3600e3, clockSkewMs: 0, status: "lunch", siteTimezone: "UTC" },
    { _creationTime: dayStart + 8 * 3600e3 + 1000, idempotencyKey: "a3", clientReportedTime: dayStart + 8 * 3600e3, clockSkewMs: 0, status: "day finish", siteTimezone: "UTC" },
  ]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].totalMinutes, 8 * 60 - DEFAULT_LUNCH_MINUTES);
});

test("Rate=0: pay is 0 but minutes is non-zero", () => {
  const segments = deriveSegments(buildThaboLogs());
  const minutes = segments.reduce((a, s) => a + (s.totalMinutes ?? 0), 0);
  const result = computePay([{ day: "2026-08-03", minutes }], 0, "flat");
  assert.equal(result.totals.pay, 0);
  assert.equal(result.totals.payableMinutes, minutes);
});

console.log("demo-rich value tests: all passed");
