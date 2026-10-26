import assert from "node:assert/strict";
import test from "node:test";
import { outboxAll } from "../src/lib/outbox.ts";

/**
 * Minimal IndexedDB stub. It does not emulate storage; it counts
 * transactions so the test can assert that the outbox reads its keys and
 * its entries from ONE transaction (a split read can mis-pair them).
 */
function installStub(entries, keys) {
  const state = { txCount: 0 };

  const makeRequest = (result) => {
    const req = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  };

  const db = {
    transaction() {
      state.txCount += 1;
      const tx = {
        error: null,
        oncomplete: null,
        onerror: null,
        objectStore: () => store,
      };
      queueMicrotask(() => tx.oncomplete?.());
      return tx;
    },
    close() {},
  };

  const store = {
    getAll: () => makeRequest(entries),
    getAllKeys: () => makeRequest(keys),
  };

  globalThis.indexedDB = { open: () => makeRequest(db) };
  return state;
}

test("outboxAll reads keys and entries in a single transaction", async () => {
  const entry = { siteId: "s1", status: "arrived" };
  const state = installStub([entry], [7]);

  const rows = await outboxAll();

  assert.deepEqual(rows, [{ key: 7, entry }]);
  assert.equal(
    state.txCount,
    1,
    `outboxAll opened ${state.txCount} transactions; a split read can pair a key with the wrong entry and delete the wrong queued punch`
  );
});

test("outbox drop regex: DEVICE_TOKEN does not match drop regex", () => {
  const dropRegex = /WEAK_GPS|SITE_NOT|INACTIVE|FORBIDDEN/;
  assert.equal(dropRegex.test("DEVICE_TOKEN_INVALID"), false);
  assert.equal(dropRegex.test("DEVICE_TOKEN_SECRET_NOT_SET"), false);
  assert.equal(dropRegex.test("WEAK_GPS_SIGNAL"), true);
  assert.equal(dropRegex.test("SITE_NOT_FOUND"), true);
});
