import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * Convex-compatible database facade backed by Supabase Postgres.
 *
 * The app's business logic lives in `convex/*.ts` and was written against
 * Convex's `ctx.db`. Rather than rewrite ~2 500 lines of payroll, shift and
 * audit logic, this adapter re-implements the slice of the Convex database API
 * those modules actually use:
 *
 *   ctx.db.query(t).withIndex(i, q => q.eq(...)).filter(q => ...).order("desc").collect()/first()/take()
 *   ctx.db.get(id) / insert(t, doc) / patch(id, partial) / replace(id, doc) / delete(id)
 *
 * Fidelity notes:
 * - Rows are loaded per query and filtered/sorted in JS, so the semantics match
 *   Convex exactly (including `q.eq(field, undefined)` matching absent fields).
 *   Tables here are small; push the predicates into SQL when they grow.
 * - Postgres NULL is normalised to `undefined`, because Convex treats the two
 *   the same and the business logic relies on it.
 * - `_id` is a uuid and carries no table name, so `db.get(id)` needs to know
 *   which table holds it: the per-request id cache is filled by every row this
 *   adapter has already seen, with `public.jpay_id_registry` as fallback.
 */

type RawRow = Record<string, unknown>;

export type Doc = RawRow & { _id: string; _creationTime: number };

const PAGE_SIZE = 1000;

/** Mirrors the `.index(...)` declarations in convex/schema.ts. */
const INDEX_FIELDS: Record<string, Record<string, string[]>> = {
  users: { email: ["email"], by_role: ["role"], by_active: ["isActive"] },
  sites: {},
  punches: { by_user_site_time: ["userId", "siteId"] },
  userSites: { by_user: ["userId"], by_site: ["siteId"] },
  logs: {
    by_user_time: ["userId"],
    by_status: ["status"],
    by_site_time: ["siteId"],
    by_user_skew: ["userId", "clockSkewMs"],
    by_user_idem: ["userId", "idempotencyKey"],
  },
  shifts: {
    by_user_start: ["userId", "startedAt"],
    by_started: ["startedAt"],
    by_active: ["endedAt"],
    by_needs_review: ["needsReview"],
  },
  messages: {
    by_recipient_read: ["recipientId", "isRead"],
    by_modqueue_unread: ["modQueue", "isRead"],
    by_sender: ["senderId"],
  },
  pushSubscriptions: { by_user: ["userId"] },
  purgeAudit: { by_purged_at: ["purgedAt"] },
  reviewResolutions: { by_user_key: ["userId", "shiftKey"] },
  demoSessions: { by_reviewer: ["reviewerId"], by_persona: ["personaEmail"] },
};

/* ------------------------------------------------------------------ types -- */

type FieldOperand = { __field: string };
type Operand = FieldOperand | { __literal: unknown };

type Expr =
  | { op: "and" | "or"; items: Expr[] }
  | { op: "eq" | "neq" | "lt" | "lte" | "gt" | "gte"; left: Operand; right: Operand };

function field(name: string): Operand {
  return { __field: name };
}

function isOperand(value: unknown): value is FieldOperand {
  return typeof value === "object" && value !== null && "__field" in (value as object);
}

function resolve(operand: Operand, doc: RawRow): unknown {
  if (isOperand(operand)) return doc[operand.__field];
  if (operand && typeof operand === "object" && "__literal" in operand) {
    return (operand as { __literal: unknown }).__literal;
  }
  return operand;
}

function compare(a: unknown, b: unknown): number {
  const aMissing = a === undefined || a === null;
  const bMissing = b === undefined || b === null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1; // absent sorts last, like Convex
  if (bMissing) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

function evaluate(expr: Expr | undefined, doc: RawRow): boolean {
  if (!expr) return true;
  switch (expr.op) {
    case "and":
      return expr.items.every((item) => evaluate(item, doc));
    case "or":
      return expr.items.some((item) => evaluate(item, doc));
    default: {
      const left = resolve(expr.left, doc);
      const right = resolve(expr.right, doc);
      switch (expr.op) {
        case "eq":
          return (left ?? null) === (right ?? null);
        case "neq":
          return (left ?? null) !== (right ?? null);
        case "lt":
          return compare(left, right) < 0;
        case "lte":
          return compare(left, right) <= 0;
        case "gt":
          return compare(left, right) > 0;
        case "gte":
          return compare(left, right) >= 0;
      }
    }
  }
}

type Op = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";
type Constraint = { field: string; op: Op; value: unknown };

/**
 * The `q` passed to `.withIndex(name, (q) => q.eq("field", value))`.
 * Convex indexes support range scans (q.gte / q.lt …), and kpi.ts uses them.
 */
function indexBuilder(sink: Constraint[]): Record<Op, (fieldName: string, value: unknown) => unknown> {
  const push = (op: Op) => (fieldName: string, value: unknown) => {
    sink.push({ field: fieldName, op, value });
    return indexBuilder(sink);
  };
  return {
    eq: push("eq"),
    neq: push("neq"),
    lt: push("lt"),
    lte: push("lte"),
    gt: push("gt"),
    gte: push("gte"),
  };
}

/** The `q` passed to `.filter((q) => q.and(q.eq(q.field("x"), 1), ...))`. */
function filterBuilder() {
  const make = (left: Operand | string, right?: unknown, op?: string): Operand | Expr => {
    if (op) return { op: op as Expr["op"], left: isOperand(left) ? left : { __literal: left }, right: isOperand(right) ? right : { __literal: right } } as Expr;
    if (typeof left === "string") return { __field: left };
    return left;
  };
  return {
    field: (name: string): Operand => ({ __field: name }),
    eq: (a: Operand | string, b: unknown) => make(a, b, "eq") as Expr,
    neq: (a: Operand | string, b: unknown) => make(a, b, "neq") as Expr,
    lt: (a: Operand | string, b: unknown) => make(a, b, "lt") as Expr,
    lte: (a: Operand | string, b: unknown) => make(a, b, "lte") as Expr,
    gt: (a: Operand | string, b: unknown) => make(a, b, "gt") as Expr,
    gte: (a: Operand | string, b: unknown) => make(a, b, "gte") as Expr,
    and: (...items: Expr[]): Expr => ({ op: "and", items }),
    or: (...items: Expr[]): Expr => ({ op: "or", items }),
  };
}

/* -------------------------------------------------------------- data layer -- */

/** One pooled client and one id cache per server process, shared by every ctx. */
let sharedClient: ReturnType<typeof createSupabaseAdminClient> | null = null;
const sharedIdCache = new Map<string, string>();

function adminClient() {
  if (!sharedClient) sharedClient = createSupabaseAdminClient();
  return sharedClient;
}

export class Database {
  private client = adminClient();

  /** uuid -> table, filled as rows pass through this adapter. */
  private idCache = sharedIdCache;

  remember(table: string, rows: RawRow[]): void {
    for (const row of rows) {
      const id = row._id;
      if (typeof id === "string" && !this.idCache.has(id)) this.idCache.set(id, table);
    }
  }

  private normalise(table: string, row: RawRow): Doc {
    const out: RawRow = {};
    for (const [key, value] of Object.entries(row)) {
      if (value === null) continue; // Convex: absent field, not null
      out[key] = value;
    }
    out._id = String(row._id);
    out._creationTime = Number(row._creationTime ?? 0);
    this.idCache.set(out._id as string, table);
    return out as Doc;
  }

  async loadAll(table: string): Promise<Doc[]> {
    const rows: RawRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await this.client
        .from(table)
        .select("*")
        .order("_creationTime", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`${table}: ${error.message}`);
      rows.push(...((data ?? []) as RawRow[]));
      if (!data || data.length < PAGE_SIZE) break;
    }
    const docs = rows.map((row) => this.normalise(table, row));
    this.remember(table, rows);
    return docs;
  }

  query(table: string): QueryBuilder {
    return new QueryBuilder(this, table);
  }

  /** Resolve the table that owns a uuid (cache first, registry view second). */
  private async tableOf(id: string): Promise<string | null> {
    const cached = this.idCache.get(id);
    if (cached) return cached;
    const { data, error } = await this.client
      .from("jpay_id_registry")
      .select("tbl")
      .eq("id", id)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`id registry: ${error.message}`);
    const tbl = (data as { tbl?: string } | null)?.tbl ?? null;
    if (tbl) this.idCache.set(id, tbl);
    return tbl;
  }

  async get<T = Doc>(id: string): Promise<T | null> {
    if (!id) return null;
    const table = await this.tableOf(id);
    if (!table) return null;
    const { data, error } = await this.client
      .from(table)
      .select("*")
      .eq("_id", id)
      .maybeSingle();
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data) return null;
    return this.normalise(table, data as RawRow) as T;
  }

  async insert(table: string, doc: RawRow): Promise<string> {
    const payload: RawRow = { ...doc };
    if (payload._id === undefined) delete payload._id;
    if (payload._creationTime === undefined) payload._creationTime = Date.now();
    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) delete payload[key];
    }
    const { data, error } = await this.client
      .from(table)
      .insert(payload)
      .select("_id")
      .single();
    if (error) throw new Error(`${table} insert: ${error.message}`);
    const id = String((data as { _id: string })._id);
    this.idCache.set(id, table);
    return id;
  }

  async patch(id: string, partial: RawRow): Promise<void> {
    const table = await this.tableOf(id);
    if (!table) throw new Error(`Document not found: ${id}`);
    const payload: RawRow = {};
    for (const [key, value] of Object.entries(partial)) {
      payload[key] = value === undefined ? null : value; // Convex undefined removes
    }
    if (Object.keys(payload).length === 0) return;
    const { data, error } = await this.client
      .from(table)
      .update(payload)
      .eq("_id", id)
      .select("_id");
    if (error) throw new Error(`${table} patch: ${error.message}`);
    if (!data || data.length === 0) throw new Error(`Document not found: ${id}`);
  }

  async replace(id: string, doc: RawRow): Promise<void> {
    const table = await this.tableOf(id);
    if (!table) throw new Error(`Document not found: ${id}`);
    const existing = await this.get(id);
    if (!existing) throw new Error(`Document not found: ${id}`);
    const payload: RawRow = {};
    const keys = new Set([...Object.keys(existing), ...Object.keys(doc)]);
    for (const key of keys) {
      if (key === "_id" || key === "_creationTime") continue;
      payload[key] = doc[key] === undefined ? null : doc[key];
    }
    const { error } = await this.client.from(table).update(payload).eq("_id", id);
    if (error) throw new Error(`${table} replace: ${error.message}`);
  }

  async delete(id: string): Promise<void> {
    const table = await this.tableOf(id);
    if (!table) return;
    const { error } = await this.client.from(table).delete().eq("_id", id);
    if (error) throw new Error(`${table} delete: ${error.message}`);
    this.idCache.delete(id);
  }
}

export class QueryBuilder {
  private constraints: Constraint[] = [];
  private predicate?: Expr;
  private indexFields: string[] = [];
  private direction: "asc" | "desc" = "asc";
  private limit?: number;

  constructor(private db: Database, private table: string) {}

  private clone(): QueryBuilder {
    const next = new QueryBuilder(this.db, this.table);
    next.constraints = [...this.constraints];
    next.predicate = this.predicate;
    next.indexFields = [...this.indexFields];
    next.direction = this.direction;
    next.limit = this.limit;
    return next;
  }

  withIndex(name: string, fn: (q: ReturnType<typeof indexBuilder>) => unknown): QueryBuilder {
    const sink: Constraint[] = [];
    fn(indexBuilder(sink));
    const next = this.clone();
    next.constraints = [...this.constraints, ...sink];
    next.indexFields = INDEX_FIELDS[this.table]?.[name] ?? [];
    return next;
  }

  filter(fn: (q: ReturnType<typeof filterBuilder>) => Expr): QueryBuilder {
    const next = this.clone();
    const expr = fn(filterBuilder());
    next.predicate = this.predicate ? { op: "and", items: [this.predicate, expr] } : expr;
    return next;
  }

  order(direction: "asc" | "desc"): QueryBuilder {
    const next = this.clone();
    next.direction = direction;
    return next;
  }

  private sortKey(): string[] {
    const constrained = new Set(
      this.constraints.filter((c) => c.op === "eq").map((c) => c.field)
    );
    const remaining = this.indexFields.filter((name) => !constrained.has(name));
    return remaining.length > 0 ? [...remaining, "_creationTime"] : ["_creationTime"];
  }

  private async run(): Promise<Doc[]> {
    let rows = await this.db.loadAll(this.table);
    for (const constraint of this.constraints) {
      rows = rows.filter((row) => {
        const left = row[constraint.field];
        const right = constraint.value;
        switch (constraint.op) {
          case "eq":
            return (left ?? null) === (right ?? null);
          case "neq":
            return (left ?? null) !== (right ?? null);
          case "lt":
            return compare(left, right) < 0;
          case "lte":
            return compare(left, right) <= 0;
          case "gt":
            return compare(left, right) > 0;
          case "gte":
            return compare(left, right) >= 0;
        }
      });
    }
    if (this.predicate) rows = rows.filter((row) => evaluate(this.predicate, row));
    const keys = this.sortKey();
    const sign = this.direction === "desc" ? -1 : 1;
    rows.sort((a, b) => {
      for (const key of keys) {
        const delta = compare(a[key], b[key]);
        if (delta !== 0) return delta * sign;
      }
      return 0;
    });
    return this.limit === undefined ? rows : rows.slice(0, this.limit);
  }

  async collect(): Promise<Doc[]> {
    return this.run();
  }

  async take(n: number): Promise<Doc[]> {
    const next = this.clone();
    next.limit = n;
    return next.run();
  }

  async first(): Promise<Doc | null> {
    const rows = await this.take(1);
    return rows[0] ?? null;
  }

  async unique(): Promise<Doc> {
    const rows = await this.run();
    if (rows.length !== 1) {
      throw new Error(`Expected exactly one document in ${this.table}, found ${rows.length}`);
    }
    return rows[0];
  }

  async paginate(opts: { numItems: number; cursor?: string | null }): Promise<{
    page: Doc[];
    isDone: boolean;
    continueCursor: string;
  }> {
    const rows = await this.run();
    const start = opts.cursor ? Number(opts.cursor) || 0 : 0;
    const page = rows.slice(start, start + opts.numItems);
    const next = start + page.length;
    return {
      page,
      isDone: next >= rows.length,
      continueCursor: next >= rows.length ? "" : String(next),
    };
  }
}
