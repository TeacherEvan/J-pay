/**
 * Punch sync lock regression — automatic outbox replays and manual check-ins
 * must be serialized through the same mutex.
 *
 * Audit 2026-11-17 (P0): the outbox had its own module-global flush gate but
 * live-submit ran independently; a background replay of queued (earlier)
 * punches could interleave with a fresh manual punch mid-flight. Both paths
 * now funnel through withPunchSyncLock (src/lib/punch-sync.ts).
 *
 * Verifies:
 *  1. Two overlapping callers never run CONCURRENTLY (second starts after the
 *     first resolves).
 *  2. Ordering is FIFO-ish (call order == execution start order).
 *  3. A rejected fn releases the lock; the next caller still runs.
 */
import assert from "node:assert/strict";

import { withPunchSyncLock } from "../src/lib/punch-sync.ts";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const events = [];

const a = withPunchSyncLock(async () => {
  events.push("a:start");
  await sleep(40);
  events.push("a:end");
  return "A";
});
const b = withPunchSyncLock(async () => {
  events.push("b:start");
  await sleep(10);
  events.push("b:end");
  return "B";
});

const [ra, rb] = await Promise.all([a, b]);
assert.equal(ra, "A");
assert.equal(rb, "B");
assert.deepEqual(events, ["a:start", "a:end", "b:start", "b:end"], "b must wait for a to finish");

// Rejection releases the lock.
const failing = withPunchSyncLock(async () => {
  throw new Error("boom");
});
await assert.rejects(failing, /boom/);
const after = await withPunchSyncLock(async () => "recovered");
assert.equal(after, "recovered", "lock must be released after a rejected fn");

console.log("✔ punch sync lock: serialized, FIFO, rejection releases");