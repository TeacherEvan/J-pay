/**
 * P2-B13 regression guard — the impossible-travel read must stay BOUNDED.
 *
 * The travel window selects the previous fix by WORK time (clientReportedTime)
 * inside a read horizon. Two properties have to hold at once:
 *
 *   1. the horizon must be expressed as an INDEX RANGE CONSTRAINT, so the
 *      adapter pushes it into PostgREST as SQL WHERE (bounded read, served by
 *      logs_user_time_idx). A `.filter()` predicate is evaluated in JS AFTER
 *      every row of the user's history has crossed the wire — the unbounded
 *      read this guard exists to prevent (src/lib/backend/db.ts);
 *   2. the SELECTION is still by work time, not insertion order.
 *
 * Property 1 is a structural property of the call sites (the adapter's
 * pushdown behaviour itself is covered by scripts/test-db-adapter.mjs), so
 * this gate pins the three call sites to the index-constraint form. Property 2
 * is covered by the trailingWorkTimeWindow unit test in test-shift-engine.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const CALL_SITES = [
  { file: "convex/logs.ts", label: "createLog" },
  { file: "convex/logs.ts", label: "createLogAs" },
  { file: "convex/punches.ts", label: "recordPunch" },
];

for (const site of CALL_SITES) {
  const src = read(site.file);

  // 1. The horizon must be an index range constraint (pushdown), not a filter.
  assert.ok(
    /withIndex\(\s*"by_user_time",\s*\(q\)\s*=>\s*\n?\s*q\.eq\("userId",[^)]*\)\.gte\("_creationTime",\s*Date\.now\(\)\s*-\s*TRAVEL_WINDOW_MS\)\s*\n?\s*\)/.test(src),
    `${site.file} (${site.label}): the travel window must be an index range constraint ` +
      `q.eq("userId", …).gte("_creationTime", Date.now() - TRAVEL_WINDOW_MS) inside withIndex("by_user_time", …)`
  );

  // 2. The old JS-side horizon form must be gone (it silently reads everything).
  assert.ok(
    !/filter\(\(q\)\s*=>\s*q\.gte\(q\.field\("clientReportedTime"\)/.test(src),
    `${site.file} (${site.label}): a .filter() horizon is evaluated in JS after the whole ` +
      `user history crossed the wire — use an index range constraint instead`
  );

  // 3. The selection must still be by work time.
  assert.ok(
    /trailingWorkTimeWindow\(/.test(src),
    `${site.file} (${site.label}): the previous fix must be selected by work time (trailingWorkTimeWindow)`
  );
}

// The horizon constant is shared, not re-declared per call site.
const travelWindow = read("src/lib/travel-window.ts");
assert.ok(
  /export const TRAVEL_WINDOW_MS = 48 \* 60 \* 60 \* 1000;/.test(travelWindow),
  "src/lib/travel-window.ts must export the shared TRAVEL_WINDOW_MS horizon"
);

console.log(
  "✔ travel window bounds: horizon pushed as an index range constraint (3 call sites), selection by work time"
);
