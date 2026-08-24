import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveSegments,
  localDayKey,
  MAX_SHIFT_MS,
} from "../src/lib/shift-engine.ts";

const MIN = 60_000;
const T0 = Date.UTC(2026, 7, 3, 6); // 08:00 SAST

function log(status, offsetMin, extra = {}) {
  return {
    _creationTime: T0 + (extra.serverOffsetMin ?? offsetMin + 500) * MIN,
    idempotencyKey: `k-${status}-${offsetMin}-${Math.random().toString(36).slice(2)}`,
    clientReportedTime: T0 + offsetMin * MIN,
    clockSkewMs: 0,
    status,
    ...extra.fields,
  };
}

test("rule 1: orders by skew-corrected client time, not server arrival", () => {
  const late = log("arrived", 0, { serverOffsetMin: 900 });
  const ontime = log("day finish", 480, { serverOffsetMin: 485 });
  const segs = deriveSegments([late, ontime]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].startedAt, T0);
  assert.equal(segs[0].endedAt, T0 + 480 * MIN);
});

test("rule 1: skewed log (>30s) falls back to server time for ordering", () => {
  const skewed = log("arrived", -600);
  skewed.clockSkewMs = -9_000_000;
  skewed._creationTime = T0 + 60 * MIN;
  const segs = deriveSegments([skewed]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].startedAt, T0 + 60 * MIN);
});

test("rule 2: duplicate idempotencyKey dropped before evaluation", () => {
  const a = log("arrived", 0);
  const dup = { ...a, idempotencyKey: a.idempotencyKey };
  const end = log("day finish", 60);
  const segs = deriveSegments([a, dup, end]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].totalMinutes, 60);
});

test("clean day: arrived→checkpoint→lunch→checkpoint→day finish", () => {
  const segs = deriveSegments([
    log("arrived", 0),
    log("lunch", 240),
    log("checkpoint", 300),
    log("day finish", 540),
  ]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].needsReview, false);
  assert.equal(segs[0].totalMinutes, 540);
});

test("illegal transition flags needsReview with reason", () => {
  const segs = deriveSegments([
    log("arrived", 0),
    log("arrived", 60),
    log("day finish", 120),
  ]);
  assert.equal(segs.length, 2);
  assert.equal(segs[0].needsReview, true);
  assert.match(segs[0].reviewReason ?? "", /illegal_transition/);
  assert.equal(segs[1].needsReview, false);
});

test("rule 3: open shift auto-closes at 16h with needsReview", () => {
  const now = Date.now();
  const start = now - MAX_SHIFT_MS - 2 * 60 * MIN;
  const arrived = log("arrived", 0);
  arrived.clientReportedTime = start;
  const segs = deriveSegments([arrived]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].needsReview, true);
  assert.equal(segs[0].reviewReason, "auto_closed_no_terminal");
  assert.equal(segs[0].endedAt, start + MAX_SHIFT_MS);
});

test("rule 4: unpaired lunch within 2× default deducts 60 without flag", () => {
  const segs = deriveSegments([
    log("arrived", 0),
    log("lunch", 240),
    log("day finish", 300),
  ]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].needsReview, false);
  assert.equal(segs[0].totalMinutes, 300 - 60);
});

test("rule 4b: unpaired lunch >2h flags unpaired_lunch_excessive", () => {
  const segs = deriveSegments([
    log("arrived", 0),
    log("lunch", 240),
    log("day finish", 700),
  ]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].needsReview, true);
  assert.equal(segs[0].reviewReason, "unpaired_lunch_excessive");
  assert.equal(segs[0].totalMinutes, 700 - 60);
});

test("rules 6-8: side mission deducts min(declared, wallclock), implicit exit", () => {
  const segs = deriveSegments([
    log("arrived", 0),
    log("quick side mission", 120, { fields: { sideMissionDurationMinutes: 45 } }),
    log("job finish", 300),
  ]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].needsReview, false);
  assert.equal(segs[0].totalMinutes, 300 - 45);
});

test("rule 7: wallclock shorter than declared wins", () => {
  const segs = deriveSegments([
    log("arrived", 0),
    log("checkpoint", 10),
    log("quick side mission", 20, { fields: { sideMissionDurationMinutes: 120 } }),
    log("checkpoint", 50),
    log("day finish", 400),
  ]);
  assert.equal(segs[0].totalMinutes, 400 - 30);
});

test("rule 9: unpaired side mission deducts declared; >240 flags", () => {
  const NOW = Date.now();
  const mk = (offsetMin, status, dur) => {
    const l = log(status, 0, { fields: dur ? { sideMissionDurationMinutes: dur } : {} });
    l.clientReportedTime = NOW + offsetMin * MIN;
    l._creationTime = NOW + offsetMin * MIN;
    return l;
  };
  const okSegs = deriveSegments([
    mk(0, "arrived"),
    mk(60, "quick side mission", 120),
  ]);
  assert.equal(okSegs.length, 1);
  assert.equal(okSegs[0].needsReview, false);

  const syntheticLegacy = mk(90, "quick side mission", 120);
  syntheticLegacy.sideMissionDurationMinutes = 300;
  const segs2 = deriveSegments([mk(0, "arrived"), syntheticLegacy]);
  assert.equal(segs2.length, 1);
  assert.equal(segs2[0].needsReview, true);
  assert.equal(segs2[0].reviewReason, "unpaired_side_mission_excessive");
  assert.equal(segs2[0].totalMinutes, 0);
});

test("terminal without arrival creates orphan needsReview segment", () => {
  const segs = deriveSegments([log("day finish", 100)]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].needsReview, true);
  assert.equal(segs[0].reviewReason, "terminal_without_arrival");
});

test("skew-tie keeps insertion order; zero-length shift stays clean", () => {
  const arrived = log("arrived", 0);
  arrived.clockSkewMs = 25_000;
  const finish = log("day finish", 0);
  const segs = deriveSegments([arrived, finish]);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].totalMinutes, 0);
  assert.equal(segs[0].needsReview, false);
});

test("localDayKey: timezone shifts the calendar day near midnight", () => {
  const utc = Date.UTC(2026, 7, 3, 22, 30);
  assert.equal(localDayKey(utc, "UTC"), "2026-08-03");
  assert.equal(localDayKey(utc, "Africa/Johannesburg"), "2026-08-04");
  assert.equal(localDayKey(utc, "America/New_York"), "2026-08-03");
});

test("localDayKey: Europe/London mid-day vs post-transition instants", () => {
  const midday = Date.UTC(2026, 2, 29, 12, 0);
  assert.equal(localDayKey(midday, "Europe/London"), "2026-03-29");
  const afterTransition = Date.UTC(2026, 2, 29, 23, 30);
  assert.equal(localDayKey(afterTransition, "Europe/London"), "2026-03-30");
});
