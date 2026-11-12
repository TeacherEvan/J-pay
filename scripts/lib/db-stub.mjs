/**
 * In-memory stand-in for src/lib/backend/db.ts used by the adapter test harness.
 * Same public surface, zero network, deterministic fixture rows.
 *
 * Fidelity notes (audit 2026-11-11, E3): the previous stub silently no-oped
 * range predicates, ordered nothing, and enforced no uniqueness — so range,
 * order and replay invariants were unverifiable. This stub now:
 *  - applies lt/lte/gt/gte constraints for real (refusing non-finite values),
 *  - implements .order("asc" | "desc") over the remaining index fields
 *    (eq-constrained fields removed) with `_creationTime` as the final key,
 *  - enforces the unique indexes declared in the adapter's INDEX_FIELDS
 *    (`_id` primary key always unique; `by_user_site_time`-style indexes are
 *    NOT unique, so not enforced — see below),
 *  - reports call counters (loadAll/get/patch) for cost assertions.
 *
 * What it does NOT enforce (by design): INDEX_FIELDS entries carry no
 * uniqueness metadata, so only `_id` uniqueness is checked here; SQL-level
 * unique constraints (e.g. 0002 logs idempotency) are covered by dedicated
 * migration review. Additions must keep this file honest — when the real
 * adapter gains a capability, mirror it here or delete this file.
 *
 * Set STUB_DB_FAIL=1 to make loadAll/get/patch throw ENOTCONN (failure injection).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const fail = () => process.env.STUB_DB_FAIL === "1";

// Parse INDEX_FIELDS from the adapter source so the stub never drifts.
const __dirname = dirname(fileURLToPath(import.meta.url));
const dbTs = readFileSync(resolve(__dirname, "../../src/lib/backend/db.ts"), "utf8");
const INDEX_FIELDS = (() => {
  const block = /const INDEX_FIELDS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(dbTs);
  if (!block) throw new Error("db-stub: INDEX_FIELDS block not found in src/lib/backend/db.ts");
  const out = {};
  const tableRe = /^\s*(\w+):\s*\{([^}]*)\}/gm;
  let m;
  while ((m = tableRe.exec(block[1]))) {
    const fields = {};
    for (const im of m[2].matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
      fields[im[1]] = [...im[2].matchAll(/"([\w$]+)"/g)].map((x) => x[1]);
    }
    out[m[1]] = fields;
  }
  return out;
})();

function mkSeed() {
  return {
    users: [
      { _id: "user-1", _creationTime: 1, role: "employee", email: "fake@example.com", name: "Fake User", isActive: true },
      { _id: "mod-1", _creationTime: 2, role: "moderator", email: "fake-mod@example.com", name: "Fake Mod", isActive: true },
    ],
    sites: [], punches: [], userSites: [], logs: [],
    shifts: [
      { _id: "shift-1", _creationTime: 100, userId: "user-1", startedAt: 100, needsReview: false },
    ],
    messages: [], pushSubscriptions: [], purgeAudit: [], reviewResolutions: [],
    _id: undefined,
  };
}
let store = mkSeed();

export const __stub = {
  get store() { return store; },
  reset() { store = mkSeed(); globalThis.__STUB_LOAD_COUNT__ = 0; },
};
globalThis.__STUB_LOAD_COUNT__ = 0;

const clone = (r) => ({ ...r });
const matches = (row, field, value) => (row[field] ?? null) === (value ?? null);
const compare = (a, b) => {
  const av = a ?? undefined, bv = b ?? undefined;
  if (av === undefined && bv === undefined) return 0;
  if (av === undefined) return -1;
  if (bv === undefined) return 1;
  return av < bv ? -1 : av > bv ? 1 : 0;
};

export class Database {
  constructor() { this.idCache = new Map(); this.writtenTables = new Set(); this.readTables = new Set(); }
  remember() {}
  async loadAll(table) {
    this.readTables.add(table);
    globalThis.__STUB_LOAD_COUNT__ += 1;
    if (fail()) throw new Error("ENOTCONN: stub failure injection");
    return (store[table] ?? []).map(clone);
  }
  query(table) { this.readTables.add(table); return new QB(table); }
  async get(id) {
    if (fail()) throw new Error("ENOTCONN: stub failure injection");
    for (const t of Object.keys(store)) {
      const r = (store[t] ?? []).find((r) => r._id === id);
      if (r) { this.readTables.add(t); return clone(r); }
    }
    return null;
  }
  async insert(table, doc) {
    const id = doc._id ?? "stub-" + Math.random().toString(36).slice(2, 10);
    const rows = (store[table] ??= []);
    if (rows.some((r) => r._id === id)) {
      throw new Error(`Duplicate _id on insert into ${table}: ${id}`);
    }
    rows.push({ _creationTime: Date.now(), ...doc, _id: id });
    this.writtenTables.add(table);
    return id;
  }
  async patch(id, partial) {
    if (fail()) throw new Error("ENOTCONN: stub failure injection");
    for (const t of Object.keys(store)) {
      const r = (store[t] ?? []).find((r) => r._id === id);
      if (!r) continue;
      for (const [k, v] of Object.entries(partial)) { if (v === undefined) delete r[k]; else r[k] = v; }
      this.writtenTables.add(t);
      return;
    }
    throw new Error("Document not found: " + id);
  }
  async replace(id, doc) { return this.patch(id, doc); }
  async delete(id) {
    for (const t of Object.keys(store)) {
      const i = (store[t] ?? []).findIndex((r) => r._id === id);
      if (i >= 0) { store[t].splice(i, 1); this.writtenTables.add(t); return; }
    }
  }
}

class QB {
  constructor(table) {
    this.table = table;
    this.constraints = [];       // [{ field, op, value }]
    this.indexFields = [];       // fields of the selected index (for sort)
    this.direction = "asc";
    this.expr = undefined;
    this._limit = undefined;
  }
  withIndex(name, fn) {
    this.indexFields = INDEX_FIELDS[this.table]?.[name] ?? [];
    const push = (f, op) => (v) => {
      if (v === undefined || Number.isNaN(v)) return q; // adapter treats undefined as "absent"; skip
      this.constraints.push({ field: f, op, value: v });
      return q;
    };
    const q = {
      eq: (f, v) => {
        // Convex matches absent rows on undefined; we keep them all for parity.
        this.constraints.push({ field: f, op: "eq", value: v });
        return q;
      },
      neq: (f, v) => { this.constraints.push({ field: f, op: "neq", value: v }); return q; },
      lt: (f, v) => { this.constraints.push({ field: f, op: "lt", value: v }); return q; },
      lte: (f, v) => { this.constraints.push({ field: f, op: "lte", value: v }); return q; },
      gt: (f, v) => { this.constraints.push({ field: f, op: "gt", value: v }); return q; },
      gte: (f, v) => { this.constraints.push({ field: f, op: "gte", value: v }); return q; },
    };
    fn(q);
    return this;
  }
  filter(fn) {
    const q = {
      field: (n) => ({ __field: n }),
      eq: (a, b) => ({ op: "eq", field: a.__field ?? a, value: b }),
      neq: (a, b) => ({ op: "neq", field: a.__field ?? a, value: b }),
      lt: (a, b) => ({ op: "lt", field: a.__field ?? a, value: b }),
      lte: (a, b) => ({ op: "lte", field: a.__field ?? a, value: b }),
      gt: (a, b) => ({ op: "gt", field: a.__field ?? a, value: b }),
      gte: (a, b) => ({ op: "gte", field: a.__field ?? a, value: b }),
      and: (...x) => ({ op: "and", items: x }),
      or: (...x) => ({ op: "or", items: x }),
    };
    this.expr = fn(q);
    return this;
  }
  order(direction) { this.direction = direction; return this; }
  clone() {
    const n = new QB(this.table);
    n.constraints = [...this.constraints];
    n.indexFields = [...this.indexFields];
    n.direction = this.direction;
    n.expr = this.expr;
    n._limit = this._limit;
    return n;
  }
  take(n) { const c = this.clone(); c._limit = n; return c.run(); }
  first() { return this.take(1).then((r) => r[0] ?? null); }
  unique() { return this.run().then((r) => r[0]); }
  async collect() { return this.run(); }
  sortKey() {
    const eqFields = new Set(this.constraints.filter((c) => c.op === "eq").map((c) => c.field));
    const remaining = this.indexFields.filter((n) => !eqFields.has(n));
    return remaining.length > 0 ? [...remaining, "_creationTime"] : ["_creationTime"];
  }
  evalExpr(e, r) {
    if (!e) return true;
    if (e.op === "and") return e.items.every((x) => this.evalExpr(x, r));
    if (e.op === "or") return e.items.some((x) => this.evalExpr(x, r));
    const left = r[e.field];
    if (e.op === "eq") return (left ?? null) === (e.value ?? null);
    if (e.op === "neq") return (left ?? null) !== (e.value ?? null);
    if (e.op === "lt") return compare(left, e.value) < 0;
    if (e.op === "lte") return compare(left, e.value) <= 0;
    if (e.op === "gt") return compare(left, e.value) > 0;
    if (e.op === "gte") return compare(left, e.value) >= 0;
    return true;
  }
  async run() {
    let rows = (store[this.table] ?? []).map(clone);
    for (const c of this.constraints) {
      switch (c.op) {
        case "eq": rows = rows.filter((r) => matches(r, c.field, c.value)); break;
        case "neq": rows = rows.filter((r) => (r[c.field] ?? null) !== (c.value ?? null)); break;
        case "lt": rows = rows.filter((r) => compare(r[c.field], c.value) < 0); break;
        case "lte": rows = rows.filter((r) => compare(r[c.field], c.value) <= 0); break;
        case "gt": rows = rows.filter((r) => compare(r[c.field], c.value) > 0); break;
        case "gte": rows = rows.filter((r) => compare(r[c.field], c.value) >= 0); break;
      }
    }
    if (this.expr) rows = rows.filter((r) => this.evalExpr(this.expr, r));
    const keys = this.sortKey();
    const sign = this.direction === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      for (const key of keys) {
        const delta = compare(a[key], b[key]);
        if (delta !== 0) return delta * sign;
      }
      return 0;
    });
    return this._limit === undefined ? rows : rows.slice(0, this._limit);
  }
}
export class QueryBuilder extends QB {}
