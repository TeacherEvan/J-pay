/**
 * The scheduler that feeds shift derivation is the money path's fuse: it must
 * retry transient failure and surface permanent failure, never swallow it.
 * Tests withScheduledRetry's contract directly (offline; stubbed DB not needed).
 */
import assert from "node:assert/strict";

const { withScheduledRetry } = await import("../src/lib/backend/runtime.ts");

let calls = 0;
const first = await withScheduledRetry(async () => { calls += 1; return "ok"; });
assert.deepEqual([first.ok, first.value, calls], [true, "ok", 1]);

calls = 0;
const second = await withScheduledRetry(async () => {
  calls += 1;
  if (calls === 1) throw new Error("transient ENOTCONN");
  return "recovered";
});
assert.deepEqual([second.ok, second.value, calls], [true, "recovered", 2]);

calls = 0;
const boom = new Error("permanent failure");
const third = await withScheduledRetry(async () => { calls += 1; throw boom; });
assert.equal(third.ok, false);
assert.equal(third.error, boom, "original error object must be preserved");
assert.equal(calls, 2, "bounded to 2 attempts");

console.log("scheduler retry OK: 1-attempt success, 1-retry recovery, bounded failure with original error");
