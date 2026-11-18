import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

import React from "react";
import TestRenderer from "react-test-renderer";

/* ------------------------------------------------------------ browser-ish -- */

globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = { ...globalThis.window, visibilityState: "visible" };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = globalThis.localStorage;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { userAgent: "jpay-test", onLine: true },
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/* ------------------------------------------------------------- transport --- */

// Every fetch call registers { body, resolve }. Tests resolve payloads by hand
// so resolution order is fully deterministic.
let deferreds = [];

function installFetchMock() {
  deferreds = [];
  globalThis.fetch = async (_url, opts) => {
    let resolve;
    const gate = new Promise((r) => {
      resolve = r;
    });
    const body = opts?.body ? JSON.parse(opts.body) : null;
    deferreds.push({ body, resolve });
    const payload = await gate;
    return {
      ok: true,
      headers: { get: () => null },
      json: async () => ({ result: payload, reads: [], tables: [] }),
    };
  };
}

const { useQuery, __test_invalidationBus, __test_queryCache } = await import(
  "../src/lib/backend/react.ts"
);

// The adapter graph (supabase/ssr browser client) holds open handles in Node
// that never close on their own; node:test would otherwise idle forever after
// the suite passes. Exit explicitly once the tests are done.
after(() => process.exit(0));

describe("useQuery monotonic generation guard", () => {
  beforeEach(() => {
    __test_invalidationBus.reset();
    __test_queryCache.clear();
    installFetchMock();
  });

  it("a pre-mutation payload resolving post-mutation is discarded, never painted", async () => {
    const painted = [];

    function Probe() {
      const result = useQuery({ module: "users_queries", fn: "me" }, { probe: 1 });
      const s = JSON.stringify(result ?? null);
      painted.push(s);
      return React.createElement("output", null, s);
    }

    let renderer;
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(Probe));
    });
    assert.equal(deferreds.length, 1, "initial query issued once");

    // A mutation commits while the query is in flight.
    await TestRenderer.act(async () => {
      __test_invalidationBus.bump({ tables: ["users"] });
    });
    assert.ok(deferreds.length >= 2, "mutation must trigger a re-issue");

    // The OLD query resolves with pre-mutation data; the guard must drop it.
    await TestRenderer.act(async () => {
      deferreds[0].resolve({ tag: "stale-pre-mutation" });
    });
    // The re-issued query resolves with post-mutation data.
    await TestRenderer.act(async () => {
      deferreds[1].resolve({ tag: "fresh-post-mutation" });
    });

    await TestRenderer.act(async () => {
      renderer.unmount();
    });

    assert.equal(
      painted.some((s) => s.includes("stale-pre-mutation")),
      false,
      `stale payload reached the DOM: ${JSON.stringify(painted)}`
    );
    assert.ok(
      painted.some((s) => s.includes("fresh-post-mutation")),
      `fresh payload never painted: ${JSON.stringify(painted)}`
    );
  });
});
