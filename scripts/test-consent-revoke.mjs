/**
 * MVTH for consent revocation (B2 + P2-consent): tests the real `travel:setConsent`
 * mutation via runtime `invoke` and `db-stub`.
 *
 * Verifies:
 *  - Granting consent sets `travelConsentAt` and leaves segments untouched.
 *  - Revoking consent clears `travelConsentAt`, closes open segments for that
 *    user with `needsReview: true, reviewReason: "consent_revoked"`, and purges
 *    their `pathSamples`.
 *  - Already-closed segments and other users' segments remain untouched.
 */
import assert from "node:assert/strict";

const { __stub } = await import("./lib/db-stub.mjs");
const { invoke } = await import("../src/lib/backend/runtime.ts");

function asEmployee(subject) {
  return { subject, email: `${subject}@example.com`, name: subject };
}

function seedBase() {
  __stub.reset();
  const s = __stub.store;
  s.travelSegments ??= [];
  s.users.push(
    { _id: "emp-1", _creationTime: 1, role: "employee", isActive: true, email: "emp-1@example.com", travelConsentAt: 1000 },
    { _id: "emp-2", _creationTime: 1, role: "employee", isActive: true, email: "emp-2@example.com", travelConsentAt: 1000 },
  );
  s.travelSegments.push(
    {
      _id: "seg-open",
      _creationTime: 100,
      userId: "emp-1",
      departedAt: 100,
      distanceMeters: 250,
      pathSamples: [{ lat: -26.2, lng: 28.04, at: 100 }],
      needsReview: false,
    },
    {
      _id: "seg-closed",
      _creationTime: 50,
      userId: "emp-1",
      departedAt: 50,
      arrivedAt: 90,
      distanceMeters: 100,
      pathSamples: [{ lat: -26.2, lng: 28.05, at: 50 }],
      needsReview: false,
    },
    {
      _id: "seg-other",
      _creationTime: 100,
      userId: "emp-2",
      departedAt: 100,
      distanceMeters: 300,
      pathSamples: [{ lat: -26.1, lng: 28.0, at: 100 }],
      needsReview: false,
    },
  );
  return s;
}

// 1. Grant consent leaves segments open and untouched
const s1 = seedBase();
const grantRes = await invoke({ module: "travel", fn: "setConsent" }, { consent: true }, asEmployee("emp-1"), false);
assert.ok(typeof grantRes.travelConsentAt === "number", "granting consent returns timestamp");
const openAfterGrant = s1.travelSegments.find((r) => r._id === "seg-open");
assert.equal(openAfterGrant.arrivedAt, undefined, "granting consent keeps open segment open");
assert.equal(openAfterGrant.pathSamples.length, 1, "granting consent keeps pathSamples");

// 2. Revoke consent clears travelConsentAt, closes open segment, and purges pathSamples
const s2 = seedBase();
const revokeRes = await invoke({ module: "travel", fn: "setConsent" }, { consent: false }, asEmployee("emp-1"), false);
assert.equal(revokeRes.travelConsentAt, undefined, "revoking consent clears returned travelConsentAt");
const emp1 = s2.users.find((u) => u._id === "emp-1");
assert.equal(emp1.travelConsentAt, undefined, "revoking consent clears stored travelConsentAt");

const openAfterRevoke = s2.travelSegments.find((r) => r._id === "seg-open");
assert.ok(typeof openAfterRevoke.arrivedAt === "number", "open segment closed on revoke");
assert.equal(openAfterRevoke.needsReview, true, "open segment flagged needsReview");
assert.equal(openAfterRevoke.reviewReason, "consent_revoked", "open segment reason set");
assert.deepEqual(openAfterRevoke.pathSamples, [], "open segment pathSamples purged on revoke");

// 3. Already-closed segment and other user's segment untouched
const closedAfterRevoke = s2.travelSegments.find((r) => r._id === "seg-closed");
assert.equal(closedAfterRevoke.arrivedAt, 90, "closed segment arrivedAt untouched");
assert.equal(closedAfterRevoke.needsReview, false, "closed segment needsReview untouched");
assert.equal(closedAfterRevoke.pathSamples.length, 1, "closed segment pathSamples untouched");

const otherAfterRevoke = s2.travelSegments.find((r) => r._id === "seg-other");
assert.equal(otherAfterRevoke.arrivedAt, undefined, "other user segment untouched");
assert.equal(otherAfterRevoke.pathSamples.length, 1, "other user pathSamples untouched");

console.log("travel consent revocation OK: open segment closed + pathSamples purged, others untouched");
