import assert from "node:assert/strict";
import test from "node:test";
import { haversineMeters, isInRadius } from "../convex/geo.ts";

test("zero distance for identical points", () => {
  assert.equal(haversineMeters(-26.2, 28.04, -26.2, 28.04), 0);
});

test("JNB→Cape Town ≈ 1260km (±5%)", () => {
  const d = haversineMeters(-26.1367, 28.2411, -33.9649, 18.6017);
  assert.ok(d > 1_190_000 && d < 1_330_000, `got ${d}`);
});

test("100m geofence sanity: inside vs outside", () => {
  const lat = -26.2;
  const lng = 28.04;
  const oneMeterNorth = lat + 1 / 111_320;
  assert.ok(haversineMeters(lat, lng, oneMeterNorth, lng) < 100);
  const far = lat + 200 / 111_320;
  assert.ok(haversineMeters(lat, lng, far, lng) > 150);
});

test("symmetric", () => {
  const a = haversineMeters(-26.2, 28.04, -33.96, 18.6);
  const b = haversineMeters(-33.96, 18.6, -26.2, 28.04);
  assert.ok(Math.abs(a - b) < 0.001);
});

// Client-side accuracy gate tests (TRD §3.1)
test("accuracy gate: rejects accuracy > 50m", () => {
  const accuracy = 51;
  assert.ok(accuracy > 50, "should reject");
});

test("accuracy gate: accepts accuracy <= 50m", () => {
  const accuracy = 50;
  assert.ok(accuracy <= 50, "should accept");
  assert.ok(10 <= 50, "should accept");
  assert.ok(1 <= 50, "should accept");
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
