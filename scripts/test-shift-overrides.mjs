import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveSegments,
  DEFAULT_LUNCH_MINUTES,
} from "../src/lib/shift-engine.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.UTC(2026, 7, 3, 6);

function log(status, offsetMin, extra = {}) {
  return {
    _creationTime: T0 + offsetMin * MIN,
    idempotencyKey: `k-${status}-${offsetMin}-${Math.random().toString(36).slice(2)}`,
    clientReportedTime: T0 + offsetMin * MIN,
    clockSkewMs: 0,
    status,
    ...extra.fields,
  };
}

test("override: forgotten log-off closes the open segment at the corrected end", () => {
  const segs = deriveSegments([log("arrived", 0)], new Map([
    [T0, { endedAt: T0 + 8 * HOUR, reason: "employee forgot to log off", overrideId: "o1" }],
  ]));
  assert.equal(segs.length, 1);
  assert.equal(segs[0].endedAt, T0 + 8 * HOUR);
  assert.equal(segs[0].totalMinutes, 480);
  assert.equal(segs[0].needsReview, false);
  assert.equal(segs[0].reviewReason, "moderator_override");
});

test("override: corrected end replaces a natural close, lunch deduction preserved", () => {
  // Shift ends inside the lunch substate — the only path that deducts
  // DEFAULT_LUNCH_MINUTES (grammar: deduction at terminal inside lunch).
  const logs = [
    log("arrived", 0),
    log("lunch", 240),
    log("day finish", 480),
  ];
  const base = deriveSegments(logs);
  const overridden = deriveSegments(logs, new Map([
    [T0, { endedAt: T0 + 9 * HOUR, reason: "extends actual departure", overrideId: "o2" }],
  ]));
  assert.equal(base[0].totalMinutes, 480 - DEFAULT_LUNCH_MINUTES);
  assert.equal(overridden[0].endedAt, T0 + 9 * HOUR);
  // 9h span minus the same lunch deduction — the override does not wipe it.
  assert.equal(overridden[0].totalMinutes, 540 - DEFAULT_LUNCH_MINUTES);
  assert.equal(overridden[0].needsReview, false);
});

test("override: earlier end is allowed (flagged shift resolved without re-review)", () => {
  const segs = deriveSegments([log("arrived", 0)], new Map([
    [T0, { endedAt: T0 + 4 * HOUR, reason: "left early, called in", overrideId: "o3" }],
  ]));
  assert.equal(segs[0].totalMinutes, 240);
});

test("override: only the targeted segment is affected", () => {
  const T1 = T0 + 24 * HOUR;
  const logs = [
    log("arrived", 0),
    log("day finish", 480),
    { ...log("arrived", 24 * 60), clientReportedTime: T1, _creationTime: T1 },
  ];
  const segs = deriveSegments(logs, new Map([
    [T0, { endedAt: T0 + 10 * HOUR, reason: "corrects morning end", overrideId: "o4" }],
  ]));
  assert.equal(segs.length, 2);
  assert.equal(segs[0].endedAt, T0 + 10 * HOUR);
  assert.equal(segs[1].startedAt, T1);
  assert.notEqual(segs[1].endedAt, T0 + 10 * HOUR);
});

test("override: empty map is byte-identical to no override", () => {
  const logs = [log("arrived", 0), log("lunch", 120), log("day finish", 480)];
  assert.deepEqual(deriveSegments(logs), deriveSegments(logs, new Map()));
});

test("override: unknown segment start is a no-op", () => {
  const logs = [log("arrived", 0), log("day finish", 60)];
  const segs = deriveSegments(logs, new Map([
    [T0 + 999_000 * MIN, { endedAt: T0, reason: "unrelated", overrideId: "o5" }],
  ]));
  assert.equal(segs[0].endedAt, T0 + 60 * MIN);
  assert.equal(segs[0].reviewReason, undefined);
});
