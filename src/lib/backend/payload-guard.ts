/**
 * Untrusted-input guard for POST /api/backend/call.
 *
 * TypeScript types vanish at the network boundary: JSON.parse happily produces
 * objects that satisfy no schema the handlers expect, and pathological payloads
 * (deep nesting, giant strings, Infinity via `1e+400`, `__proto__` keys) reach
 * the PostgREST adapter and surface as opaque 22P02 cast errors or worse.
 * Everything the route forwards into `invoke()` is checked here first.
 *
 * This is a *reject* filter, not a coercion layer: anything outside the shapes
 * the backend legitimately accepts is refused with a stable reason string the
 * client can surface. Additive guarantees only — valid payloads are untouched.
 */

const MAX_DEPTH = 12;
const MAX_KEYS_PER_OBJECT = 1_000;
const MAX_ARRAY_LENGTH = 10_000;
const MAX_STRING_LENGTH = 10_000;
const MAX_TOTAL_NODES = 50_000;

export type PayloadCheck = { ok: true } | { ok: false; reason: string };

export function checkBackendPayload(value: unknown): PayloadCheck {
  return walk(value, 0, { nodes: 0 });
}

function walk(value: unknown, depth: number, budget: { nodes: number }): PayloadCheck {
  budget.nodes += 1;
  if (budget.nodes > MAX_TOTAL_NODES) return { ok: false, reason: "PAYLOAD_TOO_LARGE" };
  if (depth > MAX_DEPTH) return { ok: false, reason: "PAYLOAD_TOO_DEEP" };

  if (value === null) return { ok: true };

  const t = typeof value;

  if (t === "boolean" || t === "undefined") return { ok: true };
  if (t === "number") {
    // JSON.parse("1e+400") === Infinity — Postgres numeric casts would 22P02.
    return Number.isFinite(value as number) ? { ok: true } : { ok: false, reason: "NON_FINITE_NUMBER" };
  }
  if (t === "string") {
    return (value as string).length <= MAX_STRING_LENGTH
      ? { ok: true }
      : { ok: false, reason: "STRING_TOO_LONG" };
  }
  if (t !== "object") return { ok: false, reason: "UNEXPECTED_TYPE" };

  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_LENGTH) return { ok: false, reason: "ARRAY_TOO_LONG" };
    for (const item of value) {
      const c = walk(item, depth + 1, budget);
      if (!c.ok) return c;
    }
    return { ok: true };
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return { ok: false, reason: "BAD_PROTOTYPE" };
  }

  let keys = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") {
      return { ok: false, reason: "FORBIDDEN_KEY" };
    }
    keys += 1;
    if (keys > MAX_KEYS_PER_OBJECT) return { ok: false, reason: "TOO_MANY_KEYS" };
    const c = walk(v, depth + 1, budget);
    if (!c.ok) return c;
  }
  return { ok: true };
}
