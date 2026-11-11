/**
 * MVTH#2 — derivation failure must not die silently.
 * Exercises the real internal handler `shifts:markDerivationFailed` (the
 * runtime's scheduled-job failure path, C1/503afa1) through
 * src/lib/backend/runtime.ts against the in-memory DB stub.
 *
 * Contract: unsealed shifts for the user are stamped needsReview=true /
 * reviewReason="derivation_failed"; sealed (payroll-finalized) shifts are
 * untouched; exactly one systemEvents ledger row is written.
 */
import assert from "node:assert/strict";
import { register } from "node:module";

process.env.DEVICE_TOKEN_SECRET = "test-secret";
register("./lib/ts-transpile-loader.mjs", import.meta.url);

const { __stub } = await import("./lib/db-stub.mjs");
const { invoke } = await import("../src/lib/backend/runtime.ts");

__stub.reset();
const s = __stub.store;
s.shifts.length = 0;
s.systemEvents = [];
s.shifts.push(
  { _id: "shift-unsealed", _creationTime: 100, userId: "user-1", startedAt: 1000, needsReview: false },
  { _id: "shift-sealed", _creationTime: 101, userId: "user-1", startedAt: 2000, needsReview: false, sealed: true },
  { _id: "shift-other", _creationTime: 102, userId: "other-user", startedAt: 3000, needsReview: false },
);

await invoke({ module: "shifts", fn: "markDerivationFailed" }, { userId: "user-1", detail: "boom: ENOTCONN" }, null, /* fromServer */ true);

const unsealed = s.shifts.find((r) => r._id === "shift-unsealed");
const sealed = s.shifts.find((r) => r._id === "shift-sealed");
const other = s.shifts.find((r) => r._id === "shift-other");
assert.equal(unsealed.needsReview, true, "unsealed shift must be flagged");
assert.equal(unsealed.reviewReason, "derivation_failed");
assert.equal(sealed.needsReview, false, "sealed shift must not be touched");
assert.equal(other.needsReview, false, "other user's shift must not be touched");

assert.equal(s.systemEvents.length, 1, "exactly one ledger row");
assert.equal(s.systemEvents[0].kind, "derivation_failed");
assert.equal(s.systemEvents[0].userId, "user-1");
assert.equal(s.systemEvents[0].detail, "boom: ENOTCONN");

// Idempotent: a second failure marker must not double-stamp or double-log the shift flag.
await invoke({ module: "shifts", fn: "markDerivationFailed" }, { userId: "user-1", detail: "again" }, null, true);
assert.equal(s.systemEvents.length, 2, "each failure appends one ledger row");
assert.equal(s.shifts.find((r) => r._id === "shift-unsealed").reviewReason, "derivation_failed");

console.log("derivation-failure ledger OK: unsealed stamped, sealed/other untouched, systemEvents row written, idempotent re-mark");
