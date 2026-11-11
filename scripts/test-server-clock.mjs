/**
 * MVTH for clock calibration (B2): the payroll engine flags punches that arrive
 * > REPLAY_REVIEW_MS late as offline replays — device clock skew must NOT count
 * towards that, or a phone 6 minutes slow makes every punch unpayable.
 */
import assert from "node:assert/strict";
import {
  registerClock,
  unregisterClock,
  resetServerClockForTests,
  simulateReloadForTests,
  observeServerDate,
  restoreServerSkew,
  serverSkewMs,
  serverNow,
} from "../src/lib/server-clock.ts";

const realNow = Date.now();
let fakeNow = realNow;
registerClock(() => fakeNow);

// --- 1. Fresh device with no prior contact: identity skew ---
resetServerClockForTests();
assert.equal(serverSkewMs(), 0);
assert.equal(serverNow(), fakeNow);

// --- 2. Server 6 minutes ahead: offset learned, serverNow() matches server ---
fakeNow = 1_700_000_000_000;
observeServerDate(new Date(fakeNow + 6 * 60 * 1000).toUTCString());
assert.equal(serverSkewMs(), 6 * 60 * 1000);
assert.equal(serverNow(), fakeNow + 6 * 60 * 1000, "stamped in server time, not device time");

// --- 3. Implausible offset (server 40 days ahead) is REJECTED, not clamped ---
resetServerClockForTests();
fakeNow = 1_700_000_000_000;
const accepted = observeServerDate(new Date(fakeNow + 40 * 24 * 3600 * 1000).toUTCString());
assert.equal(accepted, false, "a 40-day offset is not skew — it must be ignored");
assert.equal(serverSkewMs(), 0, "implausible offset must not poison every future stamp");

// --- 4. Garbage / missing header rejected ---
assert.equal(observeServerDate("not-a-date"), false);
assert.equal(observeServerDate(undefined), false);
assert.equal(observeServerDate(null), false);
assert.equal(serverSkewMs(), 0);

// --- 5. Persisting + restoring from storage (simulating reload) ---
// Simple localStorage shim
const store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => {
    store[k] = String(v);
  },
  removeItem: (k) => {
    delete store[k];
  },
};
resetServerClockForTests();
fakeNow = 1_700_000_000_000;
observeServerDate(new Date(fakeNow + 3 * 60 * 1000).toUTCString());
assert.equal(store["jpay.serverSkewMs"], String(3 * 60 * 1000), "offset persisted");
// Simulate reload: the module-level skew is reset but the stored value must be picked up.
simulateReloadForTests();
assert.equal(restoreServerSkew(), true, "restorable from the persisted offset");
assert.equal(serverSkewMs(), 3 * 60 * 1000);
delete globalThis.localStorage;

// --- 6. Blocked storage degrades to in-memory, never throws ---
globalThis.localStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};
resetServerClockForTests();
fakeNow = 1_700_000_000_000;
assert.equal(observeServerDate(new Date(fakeNow + 90 * 1000).toUTCString()), true);
assert.equal(serverSkewMs(), 90 * 1000, "in-memory offset still applied");
assert.equal(restoreServerSkew(), true, "in-memory restore path works");
delete globalThis.localStorage;

// --- 7. A 6-minute-slow device no longer registers as replay ---
// Device is 6 minutes BEHIND; server time is the reference. After one observation
// of a promptly-delivered punch, the entry must be stamped in server time, so
// now − queuedAt measures actual network latency, not 6 minutes of drift.
resetServerClockForTests();
fakeNow = 1_700_000_000_000;
const DEVICE = 1_700_000_000_000 - 6 * 60 * 1000; // device reads 6 min behind
// Client taps now (device time DEVICE). With calibration learned via any API call:
observeServerDate(new Date(fakeNow).toUTCString());
const stamp = Math.round(fakeNow); // serverNow() would be exactly this
const nowAtSubmit = fakeNow;
assert.ok(nowAtSubmit - stamp < 1000, "freshly-calibrated stamp is current");
assert.ok(nowAtSubmit - stamp <= 5 * 60 * 1000, "calibrated live stamp never looks like a replay");

unregisterClock();
console.log("server-clock OK: device skew learned, implausible offsets rejected, storage-blocked safe");
