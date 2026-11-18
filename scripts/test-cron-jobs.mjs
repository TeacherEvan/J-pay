/**
 * The cron route is only as good as its job map: every name must resolve to a
 * handler that actually EXISTS in the backend registry and is internal (never
 * browser-callable). Offline — registry enumerated via the transpile loader.
 *
 * Dedicated tests verify that POST /api/internal/cron?job=derivation-sweep
 * enforces bearer auth, handles query parameters, executes shifts:sweepDerivationQueue,
 * and returns 200 with the execution result.
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
assert.ok(cronJobRef("derivation-sweep"), "derivation sweep resolves");
assert.equal(cronJobRef("rm -rf /"), null, "unknown job rejected");
assert.equal(cronJobRef(""), null, "empty job rejected");

console.log("cron jobs OK: 4 jobs, all mapped to registered internal handlers");

// ---------------- Route invocation contract tests ----------------
const { POST, GET } = await import("../src/app/api/internal/cron/route.ts");
const { __pg } = await import("./lib/postgrest-stub.mjs");
const { __stub } = await import("./lib/db-stub.mjs");

const CRON_SECRET = "test-cron-secret-1234567890abcdef";
process.env.CRON_SECRET = CRON_SECRET;

// 1. Method check: GET returns 405 METHOD_NOT_ALLOWED
{
  const res = await GET();
  assert.equal(res.status, 405, "GET must return 405");
  const data = await res.json();
  assert.equal(data.error, "METHOD_NOT_ALLOWED");
  assert.equal(res.headers.get("allow"), "POST");
}

// 2. Auth check: Missing or invalid bearer returns 401 UNAUTHENTICATED
{
  const resNoAuth = await POST(new Request("http://localhost/api/internal/cron?job=derivation-sweep", {
    method: "POST",
  }));
  assert.equal(resNoAuth.status, 401, "Missing auth must return 401");
  const dataNoAuth = await resNoAuth.json();
  assert.equal(dataNoAuth.error, "UNAUTHENTICATED");

  const resBadAuth = await POST(new Request("http://localhost/api/internal/cron?job=derivation-sweep", {
    method: "POST",
    headers: { authorization: "Bearer invalid-token" },
  }));
  assert.equal(resBadAuth.status, 401, "Invalid bearer must return 401");
  const dataBadAuth = await resBadAuth.json();
  assert.equal(dataBadAuth.error, "UNAUTHENTICATED");
}

// 3. Job validation: Unknown or missing job returns 400 UNKNOWN_JOB
{
  const resUnknown = await POST(new Request("http://localhost/api/internal/cron?job=nonexistent", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  }));
  assert.equal(resUnknown.status, 400, "Unknown job must return 400");
  const dataUnknown = await resUnknown.json();
  assert.equal(dataUnknown.error, "UNKNOWN_JOB");

  const resMissing = await POST(new Request("http://localhost/api/internal/cron", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  }));
  assert.equal(resMissing.status, 400, "Missing job must return 400");
  const dataMissing = await resMissing.json();
  assert.equal(dataMissing.error, "UNKNOWN_JOB");
}

// 4. derivation-sweep execution with empty queue returns 200 with result
{
  __pg.reset();
  __pg.seed("derivation_queue", []);

  const res = await POST(new Request("http://localhost/api/internal/cron?job=derivation-sweep", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  }));
  assert.equal(res.status, 200, "POST derivation-sweep must return 200");
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.job, "derivation-sweep");
  assert.deepEqual(data.result, { swept: 0, failed: 0 });
}

// 5. derivation-sweep execution with pending row executes shifts:sweepDerivationQueue and returns 200 with result
{
  __pg.reset();
  __stub.reset();
  const pastIso = new Date(Date.now() - 10_000).toISOString();
  __pg.seed("derivation_queue", [
    {
      _id: "q-1",
      userId: "user-1",
      attempts: 0,
      status: "pending",
      requestedAt: pastIso,
      updatedAt: pastIso,
    },
  ]);

  const res = await POST(new Request("http://localhost/api/internal/cron?job=derivation-sweep&batchSize=10", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  }));
  assert.equal(res.status, 200, "POST derivation-sweep with pending row must return 200");
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.job, "derivation-sweep");
  assert.deepEqual(data.result, { swept: 1, failed: 0 });

  // Verify derivation_queue table was updated to done
  const updateCalls = __pg.calls.filter((c) => c.table === "derivation_queue" && c.method === "update");
  assert.ok(updateCalls.length >= 2, "must update status to processing then done");
  assert.equal(updateCalls[updateCalls.length - 1].payload.status, "done");
}

// 6. derivation-sweep when migration 0021 is absent returns 200 with skipped: true
{
  __pg.reset();
  __pg.setTableError("derivation_queue", { message: "relation \"derivation_queue\" does not exist (42P01)" });

  const res = await POST(new Request("http://localhost/api/internal/cron?job=derivation-sweep", {
    method: "POST",
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  }));
  assert.equal(res.status, 200, "POST derivation-sweep when table absent must return 200");
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.equal(data.job, "derivation-sweep");
  assert.equal(data.result.skipped, true);
  assert.equal(data.result.swept, 0);
  assert.equal(data.result.failed, 0);
}

console.log("✔ cron endpoint OK: auth, method, unknown job, derivation-sweep 200 with result verified");
