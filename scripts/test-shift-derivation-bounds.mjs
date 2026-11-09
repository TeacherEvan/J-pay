import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSegments } from "../src/lib/shift-engine.ts";

// Helper simulating the bounded horizon derivation logic from convex/shifts.ts
const HORIZON_SAFETY_BUFFER_MS = 16 * 60 * 60 * 1000;

function simulateBoundedDerivation({
  userId,
  existingShifts,
  logs,
}) {
  // 1. Query existing shifts desc
  const userShifts = existingShifts
    .filter((s) => s.userId === userId)
    .sort((a, b) => b.startedAt - a.startedAt);

  const latestSealed = userShifts.find((s) => s.sealed === true);
  const horizonCutoff = latestSealed !== undefined
    ? latestSealed.startedAt - HORIZON_SAFETY_BUFFER_MS
    : undefined;

  // 2. Fetch logs with filter
  const queriedLogs = logs
    .filter((l) => l.userId === userId)
    .filter((l) => horizonCutoff === undefined || l.clientReportedTime >= horizonCutoff);

  // 3. Derive segments
  const segments = deriveSegments(queriedLogs);

  // 4. Clean up unsealed shifts in active horizon
  const sealedStarts = new Set(
    userShifts.filter((r) => r.sealed === true).map((r) => r.startedAt)
  );

  let updatedShifts = [...userShifts];
  // Filter out deleted shifts
  updatedShifts = updatedShifts.filter((row) => {
    if (row.sealed === true) return true;
    if (horizonCutoff !== undefined && row.startedAt < horizonCutoff) return true;
    return false; // deleted
  });

  // 5. Insert new segments within active horizon
  for (const seg of segments) {
    if (sealedStarts.has(seg.startedAt)) continue;
    if (horizonCutoff !== undefined && seg.startedAt < horizonCutoff) continue;

    updatedShifts.push({
      _id: `shift_${seg.startedAt}`,
      userId,
      startedAt: seg.startedAt,
      endedAt: seg.endedAt,
      totalMinutes: seg.totalMinutes,
      needsReview: seg.needsReview,
    });
  }

  return {
    horizonCutoff,
    queriedLogCount: queriedLogs.length,
    finalShifts: updatedShifts.sort((a, b) => a.startedAt - b.startedAt),
  };
}

test("bounded horizon: processes all logs when no sealed shift exists", () => {
  const userId = "user1";
  const t0 = 1700000000000;
  const t1 = t0 + 8 * 3600 * 1000;

  const logs = [
    {
      _id: "l1",
      userId,
      siteId: "s1",
      _creationTime: t0,
      idempotencyKey: "k1",
      clientReportedTime: t0,
      status: "arrived",
      isWithinGeofence: true,
    },
    {
      _id: "l2",
      userId,
      siteId: "s1",
      _creationTime: t1,
      idempotencyKey: "k2",
      clientReportedTime: t1,
      status: "day finish",
      isWithinGeofence: true,
    },
  ];

  const result = simulateBoundedDerivation({
    userId,
    existingShifts: [],
    logs,
  });

  assert.equal(result.horizonCutoff, undefined);
  assert.equal(result.queriedLogCount, 2);
  assert.equal(result.finalShifts.length, 1);
  assert.equal(result.finalShifts[0].startedAt, t0);
  assert.equal(result.finalShifts[0].endedAt, t1);
  assert.equal(result.finalShifts[0].totalMinutes, 480);
});

test("bounded horizon: excludes historical logs strictly before cutoff when sealed shift exists", () => {
  const userId = "user1";
  // Day 1 shift: 48h before now, sealed
  const day1Start = 1700000000000;
  const day1End = day1Start + 8 * 3600 * 1000;

  // Day 2 shift: 24h later, sealed
  const day2Start = day1Start + 24 * 3600 * 1000;
  const day2End = day2Start + 8 * 3600 * 1000;

  // Day 3 shift: 48h later, active (not sealed)
  const day3Start = day1Start + 48 * 3600 * 1000;
  const day3End = day3Start + 8 * 3600 * 1000;

  const existingShifts = [
    {
      _id: "s1",
      userId,
      startedAt: day1Start,
      endedAt: day1End,
      totalMinutes: 480,
      needsReview: false,
      sealed: true,
    },
    {
      _id: "s2",
      userId,
      startedAt: day2Start,
      endedAt: day2End,
      totalMinutes: 480,
      needsReview: false,
      sealed: true,
    },
  ];

  const logs = [
    // Day 1 logs (well before day2Start - 16h = day1Start + 8h)
    // day1Start (0h) and day1End (8h - 1min = 7h59m) are strictly < cutoff
    {
      _id: "l1_in",
      userId,
      siteId: "s1",
      _creationTime: day1Start,
      idempotencyKey: "k1_in",
      clientReportedTime: day1Start,
      status: "arrived",
      isWithinGeofence: true,
    },
    {
      _id: "l1_out",
      userId,
      siteId: "s1",
      _creationTime: day1End - 60000,
      idempotencyKey: "k1_out",
      clientReportedTime: day1End - 60000,
      status: "day finish",
      isWithinGeofence: true,
    },
    // Day 2 logs (at cutoff boundary / in buffer)
    {
      _id: "l2_in",
      userId,
      siteId: "s1",
      _creationTime: day2Start,
      idempotencyKey: "k2_in",
      clientReportedTime: day2Start,
      status: "arrived",
      isWithinGeofence: true,
    },
    {
      _id: "l2_out",
      userId,
      siteId: "s1",
      _creationTime: day2End,
      idempotencyKey: "k2_out",
      clientReportedTime: day2End,
      status: "day finish",
      isWithinGeofence: true,
    },
    // Day 3 logs (active horizon)
    {
      _id: "l3_in",
      userId,
      siteId: "s1",
      _creationTime: day3Start,
      idempotencyKey: "k3_in",
      clientReportedTime: day3Start,
      status: "arrived",
      isWithinGeofence: true,
    },
    {
      _id: "l3_out",
      userId,
      siteId: "s1",
      _creationTime: day3End,
      idempotencyKey: "k3_out",
      clientReportedTime: day3End,
      status: "day finish",
      isWithinGeofence: true,
    },
  ];

  const result = simulateBoundedDerivation({
    userId,
    existingShifts,
    logs,
  });

  // latest sealed shift is day2Start
  // cutoff = day2Start - 16h = day1Start + 8h
  assert.equal(result.horizonCutoff, day2Start - HORIZON_SAFETY_BUFFER_MS);

  // Day 1 logs (0h, 7h59m) are strictly < cutoff (8h) and are NOT queried
  // Only logs >= cutoff (day2 logs and day3 logs) are queried: exactly 4 logs
  assert.equal(result.queriedLogCount, 4);

  // Sealed shifts are preserved, day 3 shift is derived and added
  assert.equal(result.finalShifts.length, 3);
  assert.equal(result.finalShifts[0].startedAt, day1Start);
  assert.equal(result.finalShifts[0].sealed, true);
  assert.equal(result.finalShifts[1].startedAt, day2Start);
  assert.equal(result.finalShifts[1].sealed, true);
  assert.equal(result.finalShifts[2].startedAt, day3Start);
  assert.equal(result.finalShifts[2].totalMinutes, 480);
});

test("bounded horizon: cross-window continuity with straddling punch boundary", () => {
  const userId = "user1";
  const now = Date.now();
  // Sealed shift from 10 hours ago
  const sealedStart = now - 10 * 3600 * 1000;
  const sealedEnd = sealedStart + 6 * 3600 * 1000;

  const existingShifts = [
    {
      _id: "s_sealed",
      userId,
      startedAt: sealedStart,
      endedAt: sealedEnd,
      totalMinutes: 360,
      needsReview: false,
      sealed: true,
    },
  ];

  // Active shift started 2 hours ago, currently open
  const activeStart = now - 2 * 3600 * 1000;
  const logs = [
    // Historical log before buffer (28h ago)
    {
      _id: "old_log",
      userId,
      siteId: "s1",
      _creationTime: sealedStart - 18 * 3600 * 1000,
      idempotencyKey: "old_k",
      clientReportedTime: sealedStart - 18 * 3600 * 1000,
      status: "arrived",
      isWithinGeofence: true,
    },
    // Sealed shift's logs (within 16h buffer)
    {
      _id: "sealed_in",
      userId,
      siteId: "s1",
      _creationTime: sealedStart,
      idempotencyKey: "k_sealed_in",
      clientReportedTime: sealedStart,
      status: "arrived",
      isWithinGeofence: true,
    },
    {
      _id: "sealed_out",
      userId,
      siteId: "s1",
      _creationTime: sealedEnd,
      idempotencyKey: "k_sealed_out",
      clientReportedTime: sealedEnd,
      status: "day finish",
      isWithinGeofence: true,
    },
    // Active shift punch
    {
      _id: "active_in",
      userId,
      siteId: "s1",
      _creationTime: activeStart,
      idempotencyKey: "k_active_in",
      clientReportedTime: activeStart,
      status: "arrived",
      isWithinGeofence: true,
    },
  ];

  const result = simulateBoundedDerivation({
    userId,
    existingShifts,
    logs,
  });

  // old_log was filtered out; sealed shift is preserved without duplicate insertion;
  // active shift is derived
  assert.equal(result.queriedLogCount, 3);
  assert.equal(result.finalShifts.length, 2);
  const activeDerived = result.finalShifts.find((s) => s.startedAt === activeStart);
  assert.ok(activeDerived);
  assert.equal(activeDerived.endedAt, undefined); // open shift
});
