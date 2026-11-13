/**
 * MT1 regression (audit 2026-11-13, interdisciplinary P1): the client transport
 * had no timeout/abort. A POST /api/backend/call that is accepted but never
 * answered never settles, so `checkIn()`'s single `finally` (live-submit.tsx)
 * never runs and the in-flight dedup map pins the key forever — the check-in
 * button stays disabled and `retry()` is a no-op.
 *
 * Runs against the REAL src/lib/backend/react.ts (type-stripped, like the
 * adapter dedup suite). The never-settling fetch is simulated with a stub
 * that only rejects on the AbortSignal the transport must pass.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  __test_invalidationBus,
  __test_queryCache,
  __test_transport,
  callBackend,
} from "../src/lib/backend/react.ts";

describe("Client transport deadline", () => {
  beforeEach(() => {
    __test_queryCache.clear();
    __test_invalidationBus.reset();
    __test_transport.timeoutMs = 50;
  });

  it("passes an AbortSignal to fetch", async () => {
    let seenSignal;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => {
      seenSignal = options?.signal;
      return {
        ok: true,
        headers: { get: () => null },
        json: async () => ({ result: { ok: true } }),
      };
    };
    try {
      const r = await callBackend({ module: "users_queries", fn: "me" }, {});
      assert.deepStrictEqual(r, { ok: true });
      assert.ok(
        seenSignal instanceof AbortSignal,
        "fetch must receive an AbortSignal (audit MT1)",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("never-settling response rejects with TIMEOUT instead of hanging forever", { timeout: 2000 }, async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        const sig = options?.signal;
        if (sig) {
          sig.addEventListener("abort", () =>
            reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
          );
        }
        // With no deadline the promise never settles — the bug under test.
      });
    try {
      await assert.rejects(
        callBackend({ module: "users_queries", fn: "me" }, { test: 1 }),
        (err) => {
          assert.strictEqual(err.code, "TIMEOUT", "never-settling request must surface as TIMEOUT");
          return true;
        },
      );
      assert.strictEqual(
        __test_queryCache.size(),
        0,
        "timed-out key must be evicted so retry() dispatches a new request",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("evicts the timed-out key so a subsequent call retries", { timeout: 2000 }, async () => {
    let callCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (_url, options) => {
      callCount += 1;
      return new Promise((_resolve, reject) => {
        const sig = options?.signal;
        if (sig) {
          sig.addEventListener("abort", () =>
            reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })),
          );
        }
      });
    };
    try {
      const ref = { module: "users_queries", fn: "me" };
      await assert.rejects(() => callBackend(ref, {}), (err) => err.code === "TIMEOUT");
      await assert.rejects(() => callBackend(ref, {}), (err) => err.code === "TIMEOUT");
      assert.strictEqual(callCount, 2, "retry() must reach the network, not the dead promise");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
