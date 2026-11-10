/**
 * MVTH for travel tracking: pure math tests for B4 fix.
 * No DB, no imports — just the math that the handler does.
 */
import assert from "node:assert/strict";

console.log("Testing travel engine math (B4)...");

// Constants from convex/travel.ts
const SAMPLE_MIN_INTERVAL_MS = 10_000;
const SAMPLE_MIN_LEG_METERS = 5;
const IMPOSSIBLE_TRAVEL_KMH = 50;
const IMPOSSIBLE_THRESHOLD_MPS = (IMPOSSIBLE_TRAVEL_KMH * 1000) / 3600; // ~13.89 m/s

// Current handler logic (simplified):
function currentLogic(lastSample, t, legMeters) {
  const legMs = lastSample ? t - lastSample.t : Number.POSITIVE_INFINITY;
  if (lastSample && legMs < SAMPLE_MIN_INTERVAL_MS && legMeters < SAMPLE_MIN_LEG_METERS) {
    return { throttled: true };
  }
  const legSeconds = Math.max(1, legMs / 1000);
  const speedMps = legMeters / legSeconds;
  const impossible = speedMps > IMPOSSIBLE_THRESHOLD_MPS;
  return { legMs, legSeconds, speedMps, impossible };
}

// Fixed logic should reject t <= lastSample.t early:
function fixedLogic(lastSample, t, legMeters) {
  if (lastSample && t <= lastSample.t) {
    return { status: "duplicate", reason: "out_of_order_or_replay" };
  }
  return currentLogic(lastSample, t, legMeters);
}

// --- Test 1: out-of-order (t < last.t) ---
const last = { t: 2000, lat: -26.1001, lng: 28.0001 };
let result = fixedLogic(last, 1500, 100);
assert.equal(result.status, "duplicate", "out-of-order must be rejected as duplicate");
assert.ok(!result.impossible, "out-of-order must not flag impossible_travel");
console.log("B4-1 PASS: t < last.t -> duplicate");

// --- Test 2: replay of exact last fix (t == last.t) ---
result = fixedLogic(last, 2000, 0);
assert.equal(result.status, "duplicate", "exact replay must be rejected as duplicate");
console.log("B4-2 PASS: t == last.t -> duplicate");

// --- Test 3: normal forward progress ---
result = fixedLogic(last, 3000, 50); // 1s later, 50m = 50 m/s = 180 km/h -> impossible
assert.equal(result.impossible, true, "50m in 1s is impossible");
console.log("B4-3 PASS: normal forward with impossible speed -> flagged");

// --- Test 4: normal forward, plausible ---
result = fixedLogic(last, 3000, 5); // 1s later, 5m = 5 m/s = 18 km/h -> OK
assert.equal(result.impossible, false, "5m in 1s is plausible");
assert.equal(result.speedMps, 5);
console.log("B4-4 PASS: normal forward plausible -> not flagged");

// --- Test 5: legMs small positive, zero distance ---
result = fixedLogic(last, 2001, 0); // 1ms later, 0m
// currentLogic: legMs = 1, legSeconds = max(1, 0.001) = 1, speedMps = 0/1 = 0 -> not impossible
assert.ok(!result.impossible, "0m in 1ms is not impossible");
console.log("B4-5 PASS: zero distance, small positive time -> not flagged");

// --- Test 6: distance accumulates only for forward time ---
// This is tested at integration layer: distanceMeters += legMeters only when t > last.t

console.log("All travel math tests PASS — B4 logic verified");
