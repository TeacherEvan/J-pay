/**
 * P2-B13 mirror — the shift derivation horizon must stay BOUNDED.
 *
 * The derivation selects logs by WORK time (clientReportedTime) inside a horizon
 * based on the latest sealed shift. Two properties have to hold at once:
 *
 *   1. the horizon must be expressed as an INDEX RANGE CONSTRAINT, so the
 *      adapter pushes it into PostgREST as SQL WHERE (bounded read, served by
 *      logs_user_client_reported_time_idx). A `.filter()` predicate is evaluated
 *      in JS AFTER every row of the user's history has crossed the wire — the
 *      unbounded read this guard exists to prevent (src/lib/backend/db.ts).
 *   2. the logs are still ordered by work time for the engine.
 *
 * Property 1 is a structural property of the call site (the adapter's
 * pushdown behaviour itself is covered by scripts/test-db-adapter.mjs), so
 * this gate pins the call site to the index-constraint form.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const src = read("convex/shifts.ts");

// 1. The horizon must use the new index (pushdown), not a filter.
// The cast to `any` is a workaround for historical generated types; the schema and INDEX_FIELDS are updated.
assert.ok(
  /withIndex\(\s*"by_user_client_reported_time"/.test(src),
  `convex/shifts.ts (deriveForUser): must use by_user_client_reported_time index`
);
assert.ok(
  /gte\("clientReportedTime",\s*horizonCutoff\)/.test(src),
  `convex/shifts.ts (deriveForUser): must push clientReportedTime >= horizonCutoff constraint`
);

// 2. The old JS-side horizon form must be gone (it silently reads everything).
assert.ok(
  !/filter\(\(q\)\s*=>\s*q\.gte\(q\.field\("clientReportedTime"\)/.test(src),
  `convex/shifts.ts (deriveForUser): a .filter() horizon is evaluated in JS after the whole ` +
    `user history crossed the wire — use an index range constraint instead`
);

// 3. The logs must be ordered by work time (clientReportedTime) for the engine.
assert.ok(
  /\.order\("asc"\)/.test(src),
  `convex/shifts.ts (deriveForUser): logs must be ordered ascending by clientReportedTime for the engine`
);

// 4. The fallback (no sealed shift) must still use by_user_time (with cast).
assert.ok(
  /withIndex\(\s*"by_user_time"/.test(src),
  `convex/shifts.ts (deriveForUser): fallback when no sealed shift must use by_user_time index`
);

console.log(
  "✔ derivation horizon bounds: horizon pushed as index range constraint on by_user_client_reported_time, ordered by work time"
);