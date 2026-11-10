/**
 * Security gate: the browser-facing invoke() must refuse every internal
 * function and every internal-only override.
 *
 * Regression for the 2026-11-10 surgical audit P0: `handler.isPublic === false`
 * is never true for internal functions (they carry `isInternal: true`, with
 * `isPublic` absent), so the old gate refused NOTHING and all 30 internal
 * handlers were callable by an anonymous browser. This test enumerates the
 * full internal census and asserts deny-by-default.
 *
 * Runs fully offline: the DB and Supabase admin client are stubbed
 * (scripts/lib/db-stub.mjs, scripts/lib/ts-transpile-loader.mjs).
 *
 * Census source: `npx`-equivalent enumeration of the registry, 2026-11-10
 * (120 registered functions; 30 internal; 3 additionally deny-listed by
 * INTERNAL_ONLY_OVERRIDES; 27 reachable from an anonymous browser pre-fix).
 * If the registry grows, re-derive INTERNAL_KEYS from describeFunctions()
 * inspection of convex/*.ts exports and extend this list.
 */
import assert from "node:assert/strict";

const INTERNAL_KEYS = [
  "demo/index:_resolveDemoReviewer", "demo/index:ensurePersonaSiteAssignments", "demo/index:purgeStaleReviewers",
  "demo:_resolveDemoReviewer", "demo:ensurePersonaSiteAssignments", "demo:purgeStaleReviewers", "demo:seedAll",
  "logs:createLogAs", "logs:purgeExpiredCoords", "logs:purgeExpiredCoordsBatch",
  "messages:purgeExpiredMessages",
  "payroll_data:logsForExport",
  "push:pushToUser",
  "push_subs:recordSubscriptionError", "push_subs:removeSubscription", "push_subs:resetSubscriptionErrors", "push_subs:subscriptionsFor",
  "shifts:deriveForUser",
  "users:archiveStaleMasterTemps", "users:archiveUserBreakGlass", "users:archiveUserInternal",
  "users:bootstrapFirstModerator", "users:clearForceChange", "users:createMasterTempUser",
  "users:forceChangeOn", "users:markPasswordChanged", "users:resetPasswordBreakGlass",
  "users_queries:getByEmail", "users_queries:getById", "users_queries:listByRole",
];
const DENY_LISTED = new Set([
  "users:bootstrapFirstModerator", "users:createMasterTempUser", "users:resetPasswordBreakGlass",
]);

const { invoke, describeFunctions } = await import("../src/lib/backend/runtime.ts");

const registry = describeFunctions();
assert.ok(registry.length >= 110, `expected >=110 registered functions, got ${registry.length}`);
console.log(`registry census: ${registry.length} functions`);

let failures = 0;
for (const key of INTERNAL_KEYS) {
  try {
    const [module, fn] = key.split(":");
    await invoke({ module, fn }, {}, null, /* fromServer */ false);
    console.error(`FAIL  browser invoked internal ${key}`);
    failures += 1;
  } catch (error) {
    const code = error?.data ?? error?.message ?? String(error);
    if (!String(code).startsWith("UNKNOWN_FUNCTION")) {
      console.error(`FAIL  internal ${key} reachable (threw ${code}, not UNKNOWN_FUNCTION)`);
      failures += 1;
    }
  }
}
if (failures > 0) {
  console.error(`\n${failures}/${INTERNAL_KEYS.length} internal functions are browser-reachable`);
  process.exit(1);
}

// Server-context calls must still reach internal functions (wrong gate = broken scheduler).
for (const key of INTERNAL_KEYS) {
  if (DENY_LISTED.has(key)) continue; // overrides deny-list is for browser only; server path unchanged
  try {
    const [module, fn] = key.split(":");
    await invoke({ module, fn }, {}, null, /* fromServer */ true);
  } catch (error) {
    const code = String(error?.data ?? error?.message ?? error);
    assert.ok(!code.startsWith("UNKNOWN_FUNCTION"), `server path must not refuse ${key} (got ${code})`);
  }
}

// A genuinely public function stays reachable (null identity returns null, no throw).
const me = await invoke({ module: "users_queries", fn: "me" }, {}, null, false);
assert.equal(me, null, "users_queries:me with anonymous identity must return null");

console.log(`invoke gate OK: ${INTERNAL_KEYS.length} internal functions refused from the browser`);
