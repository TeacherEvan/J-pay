/**
 * P2-5 acceptance — the backend reports each invocation's write-set and
 * read-set so clients can invalidate precisely (no client-side table map).
 * Exercises the real invoke() path with the in-memory stub.
 */
import assert from "node:assert/strict";
import { register } from "node:module";

process.env.DEVICE_TOKEN_SECRET = "test-secret";
register("./lib/ts-transpile-loader.mjs", import.meta.url);

const { __stub } = await import("./lib/db-stub.mjs");
const { invoke } = await import("../src/lib/backend/runtime.ts");

__stub.reset();
const asUser = (id) => ({ subject: id, email: `${id}@x`, name: id });

// Mutation: users:setMyLocale patches the caller's users row.
const meta = {};
await invoke({ module: "users", fn: "setMyLocale" }, { locale: "en" }, asUser("user-1"), false, meta);
assert.deepEqual(meta.tablesWritten, ["users"], "write-set: users");
assert.ok(meta.tablesRead.includes("users"), "read-set includes users");

// Query: reads but writes nothing.
const qmeta = {};
await invoke({ module: "users_queries", fn: "me" }, {}, asUser("user-1"), false, qmeta);
assert.deepEqual(qmeta.tablesWritten, [], "query writes nothing");
assert.ok(qmeta.tablesRead.includes("users"), "query read-set includes users");

console.log("write-set telemetry OK: mutation reports [users] written, query reports reads without writes");
