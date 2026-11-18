/**
 * Payload guard regression — POST /api/backend/call must reject unsafe JSON
 * before it reaches the PostgREST adapter (audit 2026-11-17, P1: untyped JSON
 * payload deserialization; NaN/Infinity/oversized strings/deep nesting/__proto__
 * could bypass compile-time types and surface as 22P02 or corrupt handler args).
 *
 * Valid payloads must pass untouched.
 */
import assert from "node:assert/strict";

import { checkBackendPayload } from "../src/lib/backend/payload-guard.ts";

const ok = (v) => assert.equal(checkBackendPayload(v).ok, true, JSON.stringify(v) ?? "ok");
const bad = (v, reason) => {
  const r = checkBackendPayload(v);
  assert.equal(r.ok, false, "expected rejection");
  if (!r.ok) assert.equal(r.reason, reason);
};

// Valid: ordinary args are untouched.
ok({ userId: "abc123", days: 7, nested: { a: [1, 2, 3], b: null, c: true } });
ok({ coords: [-26.2041, 28.0473], label: "s".repeat(10_000) });
ok([]);
ok(null);
ok(42);
ok({ ref: "users:me" });

// Non-finite numbers: JSON.parse("1e+400") === Infinity.
bad(Infinity, "NON_FINITE_NUMBER");
bad(-Infinity, "NON_FINITE_NUMBER");
bad(NaN, "NON_FINITE_NUMBER");
bad({ n: 1e400 }, "NON_FINITE_NUMBER");

// Oversized strings / arrays / objects.
bad("x".repeat(10_001), "STRING_TOO_LONG");
bad(new Array(10_001).fill(0), "ARRAY_TOO_LONG");
bad(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`k${i}`, i])), "TOO_MANY_KEYS");

// Depth attack.
let deep = "leaf";
for (let i = 0; i < 40; i++) deep = { d: deep };
bad(deep, "PAYLOAD_TOO_DEEP");

// Prototype pollution keys.
bad(JSON.parse('{"__proto__": {"polluted": true}}'), "FORBIDDEN_KEY");
bad({ constructor: 1 }, "FORBIDDEN_KEY");
bad({ nested: { prototype: 2 } }, "FORBIDDEN_KEY");

// Non-plain values (functions/classes never arise from JSON.parse, but the
// guard is also exported for other callers).
bad(() => 1, "UNEXPECTED_TYPE");
class Widget {}
bad(new Widget(), "BAD_PROTOTYPE");

console.log("payload guard: all assertions passed");
