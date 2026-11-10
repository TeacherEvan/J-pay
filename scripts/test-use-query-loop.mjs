/**
 * Regression for audit 2026-11-10 P1-5: useQuery re-ran its fetch effect on
 * every render because its dependency array included `ref` (fresh Proxy object
 * per access) and `args` (inline object per render). Fetch → setState → render
 * → fetch … no base case.
 *
 * Contract: with an inline-object-args query, mounting the component issues
 * exactly ONE fetch; re-rendering with the same args issues ZERO additional
 * fetches; one scoped invalidation (`bump({tables})`) issues exactly ONE.
 *
 * Offline: the Supabase browser client is stubbed (scripts/lib/supabase-client-stub.mjs),
 * fetch is stubbed in-process. Runs with scripts/register-ts-transpile.mjs.
 */
import assert from "node:assert/strict";
import React from "react";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import TestRenderer, { act } from "react-test-renderer";

let fetchCalls = 0;
const seenUrls = [];
globalThis.fetch = async (url, init) => {
  fetchCalls += 1;
  seenUrls.push(String(url));
  return {
    ok: true,
    json: async () => ({ result: { ok: true } }),
  };
};

const { useQuery, bump } = await import("../src/lib/backend/react.ts");

function Probe({ args }) {
  const data = useQuery("sites:listMine", args);
  return React.createElement("div", null, data ? "loaded" : "loading", React.createElement("span", null, JSON.stringify(data ?? null)));
}

const flush = () => act(async () => { await new Promise((r) => setImmediate(r)); });

let root;
await act(async () => {
  root = TestRenderer.create(React.createElement(Probe, { args: { siteId: "site-1" } }));
});
assert.equal(fetchCalls, 1, `expected 1 fetch after mount, got ${fetchCalls}`);

// Re-render twice with a NEW inline args object (same content): must not refetch.
for (let i = 0; i < 2; i++) {
  await act(async () => {
    root.update(React.createElement(Probe, { args: { siteId: "site-1" } }));
  });
}
assert.equal(fetchCalls, 1, `re-render with identical args refetched (${fetchCalls} calls)`);

// One scoped invalidation: exactly one refetch.
await act(async () => {
  bump({ tables: ["sites"] });
});
assert.equal(fetchCalls, 2, `invalidation should trigger exactly 1 refetch (got ${fetchCalls})`);

await act(async () => { root.unmount(); });
assert.equal(fetchCalls, 2, "unmount must not fetch");

console.log("useQuery loop OK: 1 fetch on mount, 0 on stable re-render, +1 per invalidation");
