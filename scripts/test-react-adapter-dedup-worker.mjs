import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  __test_invalidationBus,
  __test_queryCache,
  callBackend,
} from "../src/lib/backend/react.ts";

describe("React Adapter Query Deduplication & Scoped Invalidation", () => {
  beforeEach(() => {
    __test_queryCache.clear();
    __test_invalidationBus.reset();
  });

  describe("In-flight Promise Deduplication", () => {
    it("concurrent calls for same query key share the same in-flight promise", async () => {
      let callCount = 0;
      let resolveBackend;
      const backendPromise = new Promise((resolve) => {
        resolveBackend = resolve;
      });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        callCount++;
        await backendPromise;
        return {
          ok: true,
          json: async () => ({ result: { count: callCount } }),
        };
      };

      try {
        const ref = { module: "users_queries", fn: "me" };
        const args = { test: 1 };

        // Fire 3 concurrent calls
        const p1 = callBackend(ref, args);
        const p2 = callBackend(ref, args);
        const p3 = callBackend(ref, args);

        // Immediate assertion: all 3 share identical promise reference
        assert.strictEqual(p1, p2, "p1 and p2 must be the exact same promise instance");
        assert.strictEqual(p2, p3, "p2 and p3 must be the exact same promise instance");

        assert.strictEqual(__test_queryCache.size(), 1, "In-flight cache should hold 1 entry");

        resolveBackend();
        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        assert.strictEqual(callCount, 1, "Only one fetch should be dispatched for identical concurrent queries");
        assert.deepStrictEqual(r1, { count: 1 });
        assert.deepStrictEqual(r2, { count: 1 });
        assert.deepStrictEqual(r3, { count: 1 });

        // Cache must be cleared on resolution
        assert.strictEqual(__test_queryCache.size(), 0, "In-flight cache should be empty after resolution");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("different queries or args do not share promises", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async (_url, options) => {
        callCount++;
        const body = JSON.parse(options.body);
        return {
          ok: true,
          json: async () => ({ result: { ref: body.ref, args: body.args } }),
        };
      };

      try {
        const refA = { module: "users_queries", fn: "me" };
        const refB = { module: "users_queries", fn: "listEmployees" };

        const pA = callBackend(refA, { id: 1 });
        const pB = callBackend(refB, { id: 2 });

        assert.notStrictEqual(pA, pB, "Different queries must not share promise instances");

        const [rA, rB] = await Promise.all([pA, pB]);

        assert.strictEqual(callCount, 2, "Distinct queries must dispatch distinct fetches");
        assert.strictEqual(rA.ref, "users_queries:me");
        assert.strictEqual(rB.ref, "users_queries:listEmployees");
        assert.strictEqual(__test_queryCache.size(), 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("clears from map on error so subsequent requests can retry", async () => {
      let callCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        callCount++;
        return {
          ok: false,
          json: async () => ({ error: "SERVER_ERROR", message: "fail" }),
        };
      };

      try {
        const ref = { module: "test", fn: "err" };
        const p1 = callBackend(ref, {});
        await assert.rejects(p1, (err) => {
          assert.strictEqual(err.code, "SERVER_ERROR");
          return true;
        });
        assert.strictEqual(__test_queryCache.size(), 0, "Failed query must be evicted from cache");

        // Next call should attempt again
        const p2 = callBackend(ref, {});
        await assert.rejects(p2, (err) => {
          assert.strictEqual(err.code, "SERVER_ERROR");
          return true;
        });
        assert.strictEqual(callCount, 2, "Subsequent call must retry rather than return cached rejected promise");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("Table / Scope-Aware Invalidation", () => {
    it("selectively notifies listeners registered for specific affected tables", () => {
      const bus = __test_invalidationBus;
      let logsFired = 0;
      let messagesFired = 0;
      let wildcardFired = 0;

      const unsubLogs = bus.subscribe(["logs"], () => logsFired++);
      const unsubMessages = bus.subscribe(["messages"], () => messagesFired++);
      const unsubAll = bus.subscribe(null, () => wildcardFired++);

      // Server-reported write-set: only overlapping subscribers fire
      bus.bump({ tables: ["punches", "logs", "shifts"] });

      assert.strictEqual(logsFired, 1, "logs subscriber should fire for punches/logs/shifts write-set");
      assert.strictEqual(messagesFired, 0, "messages subscriber should NOT fire for logs write-set");
      assert.strictEqual(wildcardFired, 1, "wildcard subscriber should always fire");

      // Bare mutationName carries no table information → notify all (safe default)
      bus.bump({ mutationName: "messages:replyToEmployee" });

      assert.strictEqual(logsFired, 2, "logs subscriber fires on uninformative bump");
      assert.strictEqual(messagesFired, 1, "messages subscriber fires on uninformative bump");
      assert.strictEqual(wildcardFired, 2, "wildcard subscriber should always fire");

      unsubLogs();
      unsubMessages();
      unsubAll();
    });

    it("falls back to wildcard emission for unknown mutations or explicit tables", () => {
      const bus = __test_invalidationBus;
      let logsFired = 0;
      let messagesFired = 0;

      bus.subscribe(["logs"], () => logsFired++);
      bus.subscribe(["messages"], () => messagesFired++);

      // Unknown mutation should trigger all subscribers safely
      bus.bump({ mutationName: "unknown:customAction" });
      assert.strictEqual(logsFired, 1);
      assert.strictEqual(messagesFired, 1);

      // Explicit table invalidation
      bus.bump({ tables: ["messages"] });
      assert.strictEqual(logsFired, 1);
      assert.strictEqual(messagesFired, 2);
    });

    it("no longer ships a hand-maintained table map — server reports write-sets", () => {
      const bus = /** @type {Record<string, unknown>} */ (__test_invalidationBus);
      assert.equal(bus.getTablesForQuery, undefined, "getTablesForQuery must be deleted");
      assert.equal(bus.getTablesForMutation, undefined, "getTablesForMutation must be deleted");
    });
  });
});
