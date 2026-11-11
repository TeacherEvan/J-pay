/**
 * MVTH — deriveForUser is idempotent (audit 2026-11-11, P2-B3).
 * Exercises the real internal handler `shifts:deriveForUser` through the
 * runtime against the in-memory DB stub.
 *
 * Contract: running derivation twice in a row produces the SAME rows with
 * the SAME _id (upsert-in-place, not delete+insert); unrelated sealed rows
 * are untouched; legacy unsealed duplicates for the same (userId, startedAt)
 * converge to one row (earliest kept). The 0015 migration is the physical
 * anchor — this test proves the handler does not churn rows on its own.
 */
import assert from "node:assert/strict";
import { register } from "node:module";

process.env.DEVICE_TOKEN_SECRET = "test-secret";
register("./lib/ts-transpile-loader.mjs", import.meta.url);

const { __stub } = await import("./lib/db-stub.mjs");
const { invoke } = await import("../src/lib/backend/runtime.ts");

const T0 = 1_700_000_000_000;
const H = 3600_000;

__stub.reset();
const s = __stub.store;
s.logs.length = 0;
s.shifts.length = 0;

// One full shift: arrive, then day finish.
s.logs.push(
  { _id: "log-1", _creationTime: T0, userId: "user-1", siteId: "site-a", status: "arrived", clientReportedTime: T0, clockSkewMs: 0, idempotencyKey: "k-1", isWithinGeofence: true },
  { _id: "log-2", _creationTime: T0 + 8 * H, userId: "user-1", siteId: "site-a", status: "day finish", clientReportedTime: T0 + 8 * H, clockSkewMs: 0, idempotencyKey: "k-2", isWithinGeofence: true },
);
s.sites.push({ _id: "site-a", _creationTime: 1, name: "Alpha", latitude: -26, longitude: 28, geofenceRadiusMeters: 100, timezone: "Africa/Johannesburg" });

await invoke({ module: "shifts", fn: "deriveForUser" }, { userId: "user-1" }, null, true);
const first = s.shifts.map((r) => ({ ...r }));
assert.equal(first.length, 1, "one derived shift");
assert.equal(first[0].startedAt, T0);
const firstId = first[0]._id;

await invoke({ module: "shifts", fn: "deriveForUser" }, { userId: "user-1" }, null, true);
const second = s.shifts.map((r) => ({ ...r }));
assert.equal(second.length, 1, "re-derivation must not duplicate the shift");
assert.equal(second[0]._id, firstId, "re-derivation must upsert in place (row _id preserved)");

// A new log later the same day is absorbed without a duplicate row.
s.logs.push({ _id: "log-3", _creationTime: T0 + 8 * H + 30 * 60 * 1000, userId: "user-1", siteId: "site-a", status: "arrived", clientReportedTime: T0 + 8 * H + 30 * 60 * 1000, clockSkewMs: 0, idempotencyKey: "k-3", isWithinGeofence: true });
await invoke({ module: "shifts", fn: "deriveForUser" }, { userId: "user-1" }, null, true);
const third = s.shifts.map((r) => ({ ...r }));
assert.ok(third.length >= 1 && third.length <= 2, "new segment absorbed without a (userId, startedAt) collision");
const counts = new Map();
for (const r of third) counts.set(r.startedAt, (counts.get(r.startedAt) ?? 0) + 1);
for (const [startedAt, n] of counts) assert.equal(n, 1, `duplicate rows for startedAt=${startedAt}`);

// Legacy duplicates collapse deterministically to the earliest row.
__stub.reset();
const s2 = __stub.store;
s2.logs.length = 0;
s2.logs.push(
  { _id: "log-9", _creationTime: T0, userId: "user-1", siteId: "site-a", status: "arrived", clientReportedTime: T0, clockSkewMs: 0, idempotencyKey: "k-9", isWithinGeofence: true },
  { _id: "log-10", _creationTime: T0 + 8 * H, userId: "user-1", siteId: "site-a", status: "day finish", clientReportedTime: T0 + 8 * H, clockSkewMs: 0, idempotencyKey: "k-10", isWithinGeofence: true },
);
s2.sites.push({ _id: "site-a", _creationTime: 1, name: "Alpha", latitude: -26, longitude: 28, geofenceRadiusMeters: 100, timezone: "Africa/Johannesburg" });
s2.shifts.push(
  { _id: "legacy-old", _creationTime: 5, userId: "user-1", startedAt: T0, needsReview: true, reviewReason: "needsReview" },
  { _id: "legacy-new", _creationTime: 6, userId: "user-1", startedAt: T0, needsReview: false },
);
await invoke({ module: "shifts", fn: "deriveForUser" }, { userId: "user-1" }, null, true);
const collapsed = s2.shifts.filter((r) => r.startedAt === T0);
assert.equal(collapsed.length, 1, "legacy duplicates converge to one row");
assert.equal(collapsed[0]._id, "legacy-old", "earliest legacy row is kept");

console.log("derivation idempotency OK: re-derive stable (_id preserved), no duplicates, legacy dupes collapse");
