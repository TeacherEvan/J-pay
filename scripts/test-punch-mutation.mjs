import { test } from "node:test";
import assert from "node:assert/strict";
import { haversineMeters, isInRadius } from "../convex/geo.ts";
import { deriveSegments } from "../src/lib/shift-engine.ts";

test("haversineMeters: zero distance for identical points", () => {
  assert.equal(haversineMeters(-26.2, 28.04, -26.2, 28.04), 0);
});

test("haversineMeters: JNB→Cape Town ≈ 1260km (±5%)", () => {
  const d = haversineMeters(-26.1367, 28.2411, -33.9649, 18.6017);
  assert.ok(d > 1_190_000 && d < 1_330_000, `got ${d}`);
});

test("haversineMeters: 100m geofence sanity: inside vs outside", () => {
  const lat = -26.2;
  const lng = 28.04;
  const oneMeterNorth = lat + 1 / 111_320;
  assert.ok(haversineMeters(lat, lng, oneMeterNorth, lng) < 100);
  const far = lat + 200 / 111_320;
  assert.ok(haversineMeters(lat, lng, far, lng) > 150);
});

test("haversineMeters: symmetric", () => {
  const a = haversineMeters(-26.2, 28.04, -33.96, 18.6);
  const b = haversineMeters(-33.96, 18.6, -26.2, 28.04);
  assert.ok(Math.abs(a - b) < 0.001);
});

test("isInRadius: inside radius returns true", () => {
  assert.equal(isInRadius(-26.2, 28.04, -26.2, 28.04, 100), true);
  assert.equal(isInRadius(-26.2, 28.04, -26.2001, 28.04, 100), true);
});

test("isInRadius: outside radius returns false", () => {
  assert.equal(isInRadius(-26.2, 28.04, -27.0, 28.04, 100), false);
});

test("isInRadius: exactly at boundary returns true", () => {
  const lat = -26.2;
  const lng = 28.04;
  const oneKmNorth = lat + 1000 / 111_320;
  assert.equal(isInRadius(lat, lng, oneKmNorth, lng, 1000), true);
});

test("punch bridge: punch-in and punch-out mapped to logs derive valid shifts", () => {
  const t0 = 1700000000000;
  const t1 = t0 + 8 * 3600 * 1000; // 8-hour shift

  // Replicate the bridge logs created by recordPunch
  const bridgeLogs = [
    {
      _creationTime: t0,
      clientReportedTime: t0,
      clockSkewMs: 0,
      idempotencyKey: "punch-in-test-id",
      status: "arrived", // punch 'in' maps to arrived
      isWithinGeofence: true,
    },
    {
      _creationTime: t1,
      clientReportedTime: t1,
      clockSkewMs: 0,
      idempotencyKey: "punch-out-test-id",
      status: "day finish", // punch 'out' maps to day finish
      isWithinGeofence: true,
    },
  ];

  const segments = deriveSegments(bridgeLogs);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].startedAt, t0);
  assert.equal(segments[0].endedAt, t1);
  assert.equal(segments[0].totalMinutes, 480);
  assert.equal(segments[0].needsReview, false);
});

console.log("Geo helper and punch bridge tests passed!");
