/**
 * MVTH #1 (core): the db adapter pushes index constraints into PostgREST
 * instead of loading whole tables into memory, and preserves the residual
 * JS-only semantics (neq, .filter predicates). Recording stub proves WHICH
 * predicates reached SQL. Fully offline.
 */
import assert from "node:assert/strict";

const { __pg } = await import("./lib/postgrest-stub.mjs");
const { Database } = await import("../src/lib/backend/db.ts");

__pg.reset();
__pg.seed("logs", [
  { _id: "l1", _creationTime: 100, userId: "A", clientReportedTime: 100, status: "arrived" },
  { _id: "l2", _creationTime: 300, userId: "A", clientReportedTime: 300, status: "day finish" },
  { _id: "l3", _creationTime: 200, userId: "B", clientReportedTime: 200, status: "arrived" },
  { _id: "l4", _creationTime: 400, clientReportedTime: 400, status: "lunch" }, // no userId
]);
__pg.seed("shifts", [
  { _id: "s1", _creationTime: 1, userId: "A", startedAt: 10 }, // needsReview absent == NULL
  { _id: "s2", _creationTime: 2, userId: "A", startedAt: 20, needsReview: false },
]);
const db = new Database();

// --- Test 1: withIndex(eq) + order + take push into SQL; no full-table range scan
__pg.calls.length = 0;
const rows = await db.query("logs").withIndex("by_user_time", (q) => q.eq("userId", "A")).order("desc").take(2);
assert.deepEqual(rows.map((r) => r._id), ["l2", "l1"], "A-rows newest first");
assert.ok(__pg.calls.some((c) => c.method === "eq" && c.col === "userId" && c.val === "A"), "eq must reach SQL");
assert.ok(__pg.calls.some((c) => c.method === "limit" && c.n === 2), "take(2) must reach SQL as LIMIT");
assert.ok(!__pg.calls.some((c) => c.method === "range"), "pushable query must not window-scan the table");

// --- Test 2: eq(absent) maps to IS NULL (s1 found, s2 not)
__pg.calls.length = 0;
const nullShifts = await db.query("shifts").withIndex("by_needs_review", (q) => q.eq("needsReview", undefined)).collect();
assert.deepEqual(nullShifts.map((r) => r._id), ["s1"], "absent field must match is.null");
assert.ok(__pg.calls.some((c) => c.method === "is" && c.col === "needsReview" && c.val === null), "undefined constraint must push as is.null");
assert.ok(!__pg.calls.some((c) => c.method === "eq" && (c.val === null || c.val === undefined)), "eq(null) must never reach SQL (PostgREST casts 'null' and errors)");

// --- Test 3: pushdown + residual JS predicate compose
__pg.calls.length = 0;
const arrived = await db.query("logs").withIndex("by_user_time", (q) => q.eq("userId", "A")).filter((q) => q.eq(q.field("status"), "arrived")).collect();
assert.deepEqual(arrived.map((r) => r._id), ["l1"], "predicate still applies after SQL push");

// --- Test 4: neq-only falls back to full scan (JS) and keeps NULL rows (documented divergence)
__pg.calls.length = 0;
const others = await db.query("logs").filter((q) => q.neq(q.field("userId"), "A")).collect();
assert.deepEqual(others.map((r) => r._id).sort(), ["l3", "l4"], "JS neq keeps NULL-user rows");

// --- Test 5: unique() limits to 2 rows, never scans the table
__pg.calls.length = 0;
const u = await db.query("shifts").withIndex("by_needs_review", (q) => q.eq("needsReview", false)).unique();
assert.equal(u._id, "s2");
assert.ok(__pg.calls.some((c) => c.method === "limit" && c.n === 2), "unique() must LIMIT 2");
await assert.rejects(
  db.query("logs").withIndex("by_user_time", (q) => q.eq("userId", "nobody")).unique(),
  /Expected exactly one document/,
);

// --- Test 6 (B1): predicate filter AFTER SQL LIMIT must not under-fill (limit deferred to JS)
//   Fixture: 100 rows, newest 3 have status="sealed" (predicate rejects them),
//   next 97 have status="open". take(100) must return 97 "open" rows, not 100 truncated to 97 by SQL LIMIT.
__pg.reset();
__pg.seed("logs", Array.from({ length: 100 }, (_, i) => ({
  _id: `l${100 - i}`,
  _creationTime: 100 + i,
  userId: "X",
  status: i >= 97 ? "sealed" : "open",
})));
__pg.calls.length = 0;
const filtered = await db.query("logs").withIndex("by_user_time", (q) => q.eq("userId", "X"))
  .filter((q) => q.eq(q.field("status"), "open"))
  .take(100);
assert.equal(filtered.length, 97, "take(100) with predicate rejecting 3 newest must return 97 older open rows");
assert.ok(!__pg.calls.some((c) => c.method === "limit" && c.n === 100), "SQL LIMIT must not be the exact take(n) when predicate exists; window loop used instead");

// --- Test 7 (B1): first() with predicate must not return null when a matching row exists beyond the first N
// Fixture: l1 (newest, sealed), l2...l10 (older, open). order("desc") + filter(open) + first() must return l2 (newest open).
__pg.reset();
__pg.seed("logs", Array.from({ length: 10 }, (_, i) => ({
  _id: `l${10 - i}`,
  _creationTime: 10 + i,
  userId: "Y",
  status: i === 9 ? "sealed" : "open",
})));
__pg.calls.length = 0;
const firstOpen = await db.query("logs").withIndex("by_user_time", (q) => q.eq("userId", "Y"))
  .filter((q) => q.eq(q.field("status"), "open"))
  .order("desc")
  .first();
assert.equal(firstOpen._id, "l2", "first() with predicate must return the newest open row (l2), not the newest sealed (l1)");
assert.ok(!__pg.calls.some((c) => c.method === "limit" && c.n === 1), "SQL LIMIT must not be 1 for first() with predicate");

// --- Test 8 (B1): unique() with predicate must not throw when exactly one matching row exists but is beyond a filtered-out row
// Fixture: l0 (newer, sealed), l1 (older, open). order desc default => l0 first. unique() with predicate must find l1.
__pg.reset();
__pg.seed("logs", [
  { _id: "l0", _creationTime: 5, userId: "Z", status: "sealed" },
  { _id: "l1", _creationTime: 10, userId: "Z", status: "open" },
]);
__pg.calls.length = 0;
const u2 = await db.query("logs").withIndex("by_user_time", (q) => q.eq("userId", "Z"))
  .filter((q) => q.eq(q.field("status"), "open"))
  .unique();
assert.equal(u2._id, "l1", "unique() with predicate must find the single open row (l1), not throw on 0");
assert.ok(!__pg.calls.some((c) => c.method === "limit" && c.n === 2), "SQL LIMIT must not be 2 for unique() with predicate");

// --- Test 9 (R1): window loop exhausts residual rejections beyond a fixed window
// Fixture: 300 rows matching push filter; the newest 120 are rejected by the predicate.
// take(60) must return 60 rows from the older window (loop pages until 60 post-filter
// rows accumulate), not the ~40 a single oversized window would yield.
__pg.reset();
__pg.seed("logs", Array.from({ length: 300 }, (_, i) => ({
  _id: `w${300 - i}`,
  _creationTime: 1000 + i,
  userId: "W",
  status: i >= 180 ? "sealed" : "open",
})));
__pg.calls.length = 0;
const exhausted = await db.query("logs").withIndex("by_user_time", (q) => q.eq("userId", "W"))
  .filter((q) => q.eq(q.field("status"), "open"))
  .take(60);
assert.equal(exhausted.length, 60, "take(60) must page through windows until 60 post-filter rows accumulate");
assert.ok(__pg.calls.some((c) => c.method === "range"), "residual path must page via range()");

// --- Test 10 (P2-B13): the impossible-travel read horizon must reach SQL.
// The travel window (convex/logs.ts createLog, convex/punches.ts
// recordPunch) bounds its read with an INDEX range constraint. An INDEX
// constraint is pushed into PostgREST as SQL WHERE; a .filter() predicate is
// NOT (it is evaluated in JS after every row of the user's history crossed the
// wire). This test pins both halves so the horizon cannot silently degrade
// into an unbounded read again.
__pg.reset();
__pg.seed("logs", [
  { _id: "old", _creationTime: 1000, userId: "H", clientReportedTime: 1000 },
  { _id: "mid", _creationTime: 9000, userId: "H", clientReportedTime: 9000 },
  { _id: "new", _creationTime: 99000, userId: "H", clientReportedTime: 99000 },
  { _id: "other", _creationTime: 99000, userId: "X", clientReportedTime: 99000 },
]);
__pg.calls.length = 0;
const horizon = 50000;
const inHorizon = await db
  .query("logs")
  .withIndex("by_user_time", (q) => q.eq("userId", "H").gte("_creationTime", horizon))
  .collect();
assert.deepEqual(
  inHorizon.map((r) => r._id).sort(),
  ["new"],
  "only in-horizon rows of that user may be returned"
);
assert.ok(
  __pg.calls.some((c) => c.method === "gte" && c.col === "_creationTime" && c.val === horizon),
  "the read horizon must be pushed into SQL as a gte filter (bounded read)"
);
assert.ok(
  !__pg.calls.some((c) => c.method === "gte" && c.col === "clientReportedTime"),
  "the horizon must be an index range constraint, not a work-time predicate"
);

// A .filter() predicate must NOT reach SQL — this is why the horizon has to be
// an index constraint (P2-B13 regression guard).
__pg.calls.length = 0;
await db
  .query("logs")
  .withIndex("by_user_time", (q) => q.eq("userId", "H"))
  .filter((q) => q.gte(q.field("clientReportedTime"), horizon))
  .collect();
assert.ok(
  !__pg.calls.some((c) => c.method === "gte"),
  "filter() predicates stay in JS — they must not be mistaken for a pushdown"
);

console.log("db adapter pushdown OK: SQL eq/limit pushdown, IS NULL parity, residual JS neq/predicate intact, predicate LIMIT deferral, window-loop exhaustion, index-range horizon pushdown");
