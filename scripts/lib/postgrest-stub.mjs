/**
 * Recording in-memory PostgREST stub for the db-adapter test. Mimics the slice
 * of the supabase-js fluent API that src/lib/backend/db.ts uses, applies the
 * operations to fixture rows, and records every call into __pg.calls so tests
 * can PROVE which predicates were pushed into SQL vs left to JS.
 */
const clone = (r) => ({ ...r });
const calls = [];
let store = {};

export const __pg = {
  calls,
  seed(table, rows) { store[table] = rows.map(clone); },
  seedRegistry(rows) { store["jpay_id_registry"] = rows.map(clone); },
  reset() { store = {}; calls.length = 0; },
};

const cmp = (a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);

class StubQuery {
  constructor(table) { this.table = table; this.ops = []; this._single = undefined; calls.push({ table, method: "from" }); }
  select(cols) { calls.push({ table: this.table, method: "select", cols }); return this; }
  pushFilter(method, col, val) {
    calls.push({ table: this.table, method, col, val: val === undefined ? null : val });
    this.ops.push((rows) => rows.filter((r) => {
      const v = r[col];
      if (val === null || val === undefined) {
        if (method === "eq") return v == null;
        if (method === "neq") return v != null;
        return false;
      }
      if (method === "neq") return v == null || v !== val; // SQL: NULL survives != (loose reading kept for JS parity on residual path only)
      if (v == null) return false; // SQL: comparisons against NULL are UNKNOWN -> row excluded
      const d = cmp(v, val);
      switch (method) {
        case "eq": return d === 0;
        case "lt": return d < 0;
        case "lte": return d <= 0;
        case "gt": return d > 0;
        case "gte": return d >= 0;
        default: throw new Error("unknown op " + method);
      }
    }));
    return this;
  }
  eq(col, val) { return this.pushFilter("eq", col, val); }
  is(col, val) {
    calls.push({ table: this.table, method: "is", col, val });
    this.ops.push((rows) => rows.filter((r) =>
      val === null || val === undefined ? r[col] == null : r[col] === val));
    return this;
  }
  neq(col, val) { return this.pushFilter("neq", col, val); }
  lt(col, val) { return this.pushFilter("lt", col, val); }
  lte(col, val) { return this.pushFilter("lte", col, val); }
  gt(col, val) { return this.pushFilter("gt", col, val); }
  gte(col, val) { return this.pushFilter("gte", col, val); }
  order(col, opts = {}) {
    const asc = opts.ascending !== false;
    calls.push({ table: this.table, method: "order", col, ascending: asc });
    this.ops.push((rows) => [...rows].sort((a, b) => {
      const av = a[col], bv = b[col];
      const aMissing = av == null, bMissing = bv == null;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;   // NULLS LAST
      if (bMissing) return -1;
      return asc ? cmp(av, bv) : -cmp(av, bv);
    }));
    return this;
  }
  limit(n) { calls.push({ table: this.table, method: "limit", n }); this.ops.push((rows) => rows.slice(0, n)); return this; }
  range(from, to) { calls.push({ table: this.table, method: "range", from, to }); this.ops.push((rows) => rows.slice(from, to + 1)); return this; }
  maybeSingle() { this._single = "maybe"; calls.push({ table: this.table, method: "maybeSingle" }); return this; }
  single() { this._single = "single"; calls.push({ table: this.table, method: "single" }); return this; }
  insert(payload) {
    calls.push({ table: this.table, method: "insert", payload });
    const row = { _id: payload._id ?? "pg-stub-" + Math.random().toString(36).slice(2, 10), _creationTime: Date.now(), ...payload };
    (store[this.table] ??= []).push(clone(row));
    this._inserted = row;
    this.ops.push(() => [clone(row)]);
    return this;
  }
  update(payload) { calls.push({ table: this.table, method: "update", payload }); this._updatePayload = payload; this.ops.push((rows) => { for (const src of store[this.table] ?? []) { /* applied in then via eq filter */ } return rows; }); return this; }
  delete() { calls.push({ table: this.table, method: "delete" }); return this; }
  then(resolve) {
    let rows = (store[this.table] ?? []).map(clone);
    for (const op of this.ops) rows = op(rows);
    // apply pending update to table rows matched by eq ops
    if (this._updatePayload) {
      const matches = rows; // already filtered by eq ops
      for (const target of store[this.table] ?? []) {
        if (matches.some((m) => m._id === target._id)) Object.assign(target, this._updatePayload);
      }
    }
    const out = this._single === "maybe" ? (rows[0] ?? null)
      : this._single === "single" ? (rows[0] ?? null)
      : rows;
    resolve({ data: out, error: null });
  }
}

export function createSupabaseAdminClient() {
  return { from: (table) => new StubQuery(table) };
}
export function hasSupabaseAdminKey() { return true; }
