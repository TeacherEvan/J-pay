/**
 * In-memory stand-in for src/lib/backend/db.ts used by the adapter test harness.
 * Same public surface, zero network, deterministic fixture row.
 * Set STUB_DB_FAIL=1 to make loadAll/get/patch throw ENOTCONN (failure injection).
 */
const fail = () => process.env.STUB_DB_FAIL === "1";

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
    messages: [], pushSubscriptions: [], purgeAudit: [], reviewResolutions: [], demoSessions: [],
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
    (store[table] ??= []).push({ _creationTime: Date.now(), ...doc, _id: id });
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
  constructor(table) { this.table = table; this.pred = []; this.expr = undefined; this._limit = undefined; }
  withIndex(_name, fn) {
    const q = {
      eq: (f, v) => { this.pred.push([f, v]); return q; },
      neq: () => q, lt: () => q, lte: () => q, gt: () => q, gte: () => q,
    };
    fn(q);
    return this;
  }
  filter(fn) {
    const q = {
      field: (n) => ({ __field: n }),
      eq: (a, b) => ({ op: "eq", field: a.__field ?? a, value: b }),
      neq: () => undefined, lt: () => undefined, lte: () => undefined, gt: () => undefined, gte: () => undefined,
      and: (...x) => x[0], or: (...x) => x[0],
    };
    this.expr = fn(q);
    return this;
  }
  order() { return this; }
  clone() { const n = new QB(this.table); n.pred = [...this.pred]; n.expr = this.expr; n._limit = this._limit; return n; }
  take(n) { const c = this.clone(); c._limit = n; return c.run(); }
  first() { return this.take(1).then((r) => r[0] ?? null); }
  unique() { return this.run().then((r) => r[0]); }
  async collect() { return this.run(); }
  async run() {
    let rows = (store[this.table] ?? []).map(clone);
    for (const [f, v] of this.pred) rows = rows.filter((r) => matches(r, f, v));
    if (this.expr?.op === "eq" && this.expr.field) rows = rows.filter((r) => matches(r, this.expr.field, this.expr.value));
    return this._limit === undefined ? rows : rows.slice(0, this._limit);
  }
}
export class QueryBuilder extends QB {}
