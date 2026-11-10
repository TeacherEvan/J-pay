/**
 * The cron route is only as good as its job map: every name must resolve to a
 * handler that actually EXISTS in the backend registry and is internal (never
 * browser-callable). Offline — registry enumerated via the transpile loader.
 */
import assert from "node:assert/strict";
import { CRON_JOBS, cronJobRef } from "../src/lib/cron-jobs.ts";

const { describeFunctions } = await import("../src/lib/backend/runtime.ts");
const registered = new Set(describeFunctions().map((f) => f.key));

assert.equal(Object.keys(CRON_JOBS).length, 4, "expected exactly 4 retention jobs");
for (const [job, ref] of Object.entries(CRON_JOBS)) {
  const key = `${ref.module}:${ref.fn}`;
  assert.ok(registered.has(key), `job ${job} maps to unregistered handler ${key}`);
}
assert.ok(cronJobRef("purge-expired-coordinates"), "known job resolves");
assert.equal(cronJobRef("rm -rf /"), null, "unknown job rejected");
assert.equal(cronJobRef(""), null, "empty job rejected");

console.log("cron jobs OK: 4 jobs, all mapped to registered internal handlers");
