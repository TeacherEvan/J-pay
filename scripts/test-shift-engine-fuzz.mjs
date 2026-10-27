import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveSegments } from "../src/lib/shift-engine.ts";
import { jpayConfig } from "../src/config/jpay.config.ts";

// Deterministic Mulberry32 PRNG for reproducible fuzzing runs
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES = [
  "arrived",
  "checkpoint",
  "lunch",
  "quick side mission",
  "feeling sick",
  "day finish",
  "job finish",
  "unknown_invalid_status",
];

const SIDE_DURATIONS = [undefined, 15, 30, 45, 60, 120, 240, 500];

test("fuzz: deriveSegments never crashes and respects mathematical invariants across 50,000 permutations", () => {
  const rand = mulberry32(1337);
  const baseEpoch = 1700000000000;
  const iterations = 50_000;

  for (let i = 0; i < iterations; i++) {
    // Generate a sequence of 1 to 20 logs
    const logCount = 1 + Math.floor(rand() * 20);
    const logs = [];
    let currentMs = baseEpoch + Math.floor(rand() * 10_000_000);

    for (let j = 0; j < logCount; j++) {
      // Simulate random forward or slightly backward (skewed) time jumps
      const deltaMs = Math.floor((rand() - 0.05) * 4 * 3600 * 1000);
      currentMs += Math.max(0, deltaMs);
      const skewMs = Math.floor((rand() - 0.5) * 60_000);
      const status = STATUSES[Math.floor(rand() * STATUSES.length)];
      const sideDuration = SIDE_DURATIONS[Math.floor(rand() * SIDE_DURATIONS.length)];
      const isWithinGeofence = rand() > 0.1 ? true : rand() > 0.5 ? false : undefined;
      const impossibleTravelFlag = rand() < 0.05 ? true : undefined;

      logs.push({
        _creationTime: currentMs,
        idempotencyKey: `fuzz-key-${i}-${rand() < 0.2 ? "dupe" : j}`,
        clientReportedTime: currentMs - skewMs,
        clockSkewMs: skewMs,
        status,
        sideMissionDurationMinutes: sideDuration,
        isWithinGeofence,
        impossibleTravelFlag,
        siteTimezone: rand() > 0.5 ? "Africa/Johannesburg" : "UTC",
      });
    }

    // Invariant 1: deriveSegments must never throw an uncaught exception
    let segments;
    try {
      segments = deriveSegments(logs);
    } catch (err) {
      assert.fail(`deriveSegments threw an error on iteration ${i}: ${String(err)}`);
    }

    assert.ok(Array.isArray(segments), `segments must be an array on iteration ${i}`);

    for (const seg of segments) {
      // Invariant 2: totalMinutes must never be negative
      if (seg.totalMinutes !== undefined) {
        assert.ok(
          seg.totalMinutes >= 0,
          `totalMinutes (${seg.totalMinutes}) must be >= 0 on iteration ${i}`
        );
      }

      // Invariant 3: startedAt must be a finite number
      assert.ok(
        Number.isFinite(seg.startedAt),
        `startedAt must be finite on iteration ${i}`
      );

      // Invariant 4: if endedAt is set, endedAt < startedAt MUST flag needsReview
      if (seg.endedAt !== undefined) {
        assert.ok(Number.isFinite(seg.endedAt), `endedAt must be finite on iteration ${i}`);
        if (seg.endedAt < seg.startedAt) {
          assert.equal(
            seg.needsReview,
            true,
            `reversed times must flag needsReview on iteration ${i}`
          );
        }
      }

      // Invariant 5: review reason must be a string if needsReview is true
      if (seg.needsReview) {
        assert.ok(
          typeof seg.reviewReason === "string" && seg.reviewReason.length > 0,
          `reviewReason must be present when needsReview is true on iteration ${i}`
        );
      }
    }
  }
});

test("fuzz: deriveSegments is deterministic and order-invariant across scrambled inputs", () => {
  const rand = mulberry32(4242);
  const baseEpoch = 1700000000000;

  for (let i = 0; i < 500; i++) {
    const logCount = 5 + Math.floor(rand() * 10);
    const logs = [];
    let currentMs = baseEpoch;

    for (let j = 0; j < logCount; j++) {
      currentMs += Math.floor(rand() * 1800 * 1000);
      logs.push({
        _creationTime: currentMs,
        idempotencyKey: `idem-${j}`,
        clientReportedTime: currentMs,
        clockSkewMs: 0,
        status: STATUSES[j % (STATUSES.length - 1)],
      });
    }

    // Baseline derivation
    const baseSegments = deriveSegments(logs);

    // Scramble order
    const scrambled = [...logs].sort(() => rand() - 0.5);
    const scrambledSegments = deriveSegments(scrambled);

    assert.equal(
      scrambledSegments.length,
      baseSegments.length,
      `scrambled log order produced different segment count on run ${i}`
    );

    for (let s = 0; s < baseSegments.length; s++) {
      assert.equal(
        scrambledSegments[s].startedAt,
        baseSegments[s].startedAt,
        `startedAt mismatch at segment ${s} on run ${i}`
      );
      assert.equal(
        scrambledSegments[s].endedAt,
        baseSegments[s].endedAt,
        `endedAt mismatch at segment ${s} on run ${i}`
      );
      assert.equal(
        scrambledSegments[s].totalMinutes,
        baseSegments[s].totalMinutes,
        `totalMinutes mismatch at segment ${s} on run ${i}`
      );
      assert.equal(
        scrambledSegments[s].needsReview,
        baseSegments[s].needsReview,
        `needsReview mismatch at segment ${s} on run ${i}`
      );
    }
  }
});
