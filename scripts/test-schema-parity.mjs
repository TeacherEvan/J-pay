#!/usr/bin/env node
/**
 * Schema parity gate (audit 2026-11-11, F4): the previous check compared table
 * NAMES only between schema.ts and 0001_init.sql — every structural mutation
 * (dropped columns, renamed types, missing indexes) passed it. This gate is
 * field-level and four-way:
 *
 *   1. TRD §6 (`j-pay.md` data-model block)  ↔  convex/schema.ts  (exact table + field sets)
 *   2. convex/schema.ts                      ↔  union of ALL migrations' CREATE TABLE columns
 *      (normalising the engine columns `_id` / `_creationTime`, which Convex
 *      synthesises and SQL declares explicitly)
 *   3. convex/schema.ts tables               ⊆  INDEX_FIELDS (src/lib/backend/db.ts)
 *   4. every schema table appears in the `jpay_id_registry` view definition
 *      (union of its definition in 0001_init.sql and 0011_system_events.sql)
 *
 * Bidirectional: extra tables in migrations must be on the INFRA allowlist;
 * missing fields/tables anywhere are failures. Exit 1 on any mismatch.
 *
 * Mutation suite lives in scripts/test-schema-parity.mjs itself (--selftest):
 * it re-runs the gate against three deliberately corrupted copies and expects
 * exit 1 for each — those three passed the old gate.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Tables that legitimately exist in migrations + INDEX_FIELDS but are not part
// of the Convex schema / TRD §6 — they are Postgres infrastructure, not app data.
const INFRA_TABLES = new Set(["jpay_rate_limits"]);
// Engine-synthesized columns: present in SQL DDL, absent from defineTable fields.
const ENGINE_COLUMNS = new Set(["_id", "_creationTime"]);

function readSrc(...parts) {
  return readFileSync(resolve(root, ...parts), "utf8");
}

/** Parse `name: defineTable({...})` blocks → Map(table → field[]). */
function parseDefineTables(src) {
  const out = new Map();
  const re = /(\w+):\s*defineTable\(\{/g;
  let m;
  while ((m = re.exec(src))) {
    const [, name] = m;
    // Walk from end of `defineTable({` tracking depth to the matching close.
    let depth = 1;
    let j = m.index + m[0].length;
    const start = m.index + m[0].length;
    while (j < src.length && depth > 0) {
      const c = src[j];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      j++;
    }
    const block = src.slice(start, j - 1);
    out.set(name, topLevelKeys(block));
  }
  return out;
}

/** Top-level keys of an object-literal-ish TS block (depth tracking over {}, (), []).
 *  Line comments are stripped first — a `// ...` tail otherwise glues onto the next
 *  field's key buffer and the key regex never matches. */
function topLevelKeys(block) {
  block = block.replace(/\/\/[^\n]*/g, "");
  const keys = [];
  let depth = 1;
  let cur = "";
  for (const c of block) {
    if (c === "{" || c === "(" || c === "[") { depth++; cur += c; continue; }
    if (c === "}" || c === ")" || c === "]") { depth--; cur += c; continue; }
    if (c === "," && depth === 1) { cur = ""; continue; }
    if (depth === 1) {
      cur += c;
      const km = /^\s*(?:"(\w+)"|(\w+))\s*:/.exec(cur);
      if (km) {
        const key = km[1] ?? km[2];
        if (!keys.includes(key)) keys.push(key);
      }
    }
  }
  return keys;
}

/** Parse all CREATE TABLE blocks in all migration files → Map(table → Set(column)). */
function parseMigrationColumns() {
  const dir = resolve(root, "supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const cols = new Map(); // table -> Set(column) (union across files)
  for (const f of files) {
    const sql = readFileSync(resolve(dir, f), "utf8");
    const createRe = /create table if not exists public\.(?:"(\w+)"|(\w+))\s*\(/gi;
    let m;
    while ((m = createRe.exec(sql))) {
      const table = m[1] ?? m[2];
      let depth = 1;
      let j = m.index + m[0].length;
      const start = m.index + m[0].length;
      while (j < sql.length && depth > 0) {
        const c = sql[j];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        j++;
      }
      const block = sql.slice(start, j - 1);
      if (!cols.has(table)) cols.set(table, new Set());
      const set = cols.get(table);
      for (const line of block.split("\n")) {
        const cm = /^\s*(?:"([\w$]+)"|([A-Za-z_][\w$]*))\s/.exec(line);
        if (!cm) continue;
        const col = cm[1] ?? cm[2];
        // skip constraint / table-level clauses
        if (/^(primary key|foreign key|unique|check|constraint|references)\b/i.test(col)) continue;
        if (["primary", "foreign", "unique", "check", "constraint"].includes(col.toLowerCase())) continue;
        set.add(col);
      }
    }
    // Also fold in `alter table ... add column if not exists "col" ...` so
    // columns introduced by later migrations count as SQL-present.
    for (const m of sql.matchAll(/alter table\s+(?:if exists\s+)?public\.(?:"(\w+)"|(\w+))\s+([\s\S]*?)(?:;|$)/gi)) {
      const table = m[1] ?? m[2];
      if (!cols.has(table)) continue; // only evolve tables we already track
      const colSet = cols.get(table);
      for (const am of m[3].matchAll(/add\s+column(?:\s+if\s+not\s+exists)?\s+"?([A-Za-z_][\w$]*)"?/gi)) {
        colSet.add(am[1]);
      }
    }
  }
  return cols;
}

/** Extract the TRD §6 data-model fenced block. */
function trdSection6() {
  const trd = readSrc("j-pay.md");
  const marker = "## 6. Data Model";
  const start = trd.indexOf(marker);
  if (start === -1) throw new Error("j-pay.md: '## 6. Data Model' not found");
  const rest = trd.slice(start);
  const blockMatch = /```ts\n([\s\S]*?)```/.exec(rest);
  if (!blockMatch) throw new Error("j-pay.md §6: no ```ts fenced block found");
  return blockMatch[1];
}

/** Extract the union of tables named in the jpay_id_registry view definitions. */
function registryTables() {
  const tables = new Set();
  for (const f of ["0001_init.sql", "0011_system_events.sql"]) {
    try {
      const sql = readSrc("supabase/migrations", f);
      for (const m of sql.matchAll(/'([A-Za-z0-9_]+)' as tbl/g)) tables.add(m[1]);
    } catch {
      /* file absent on this snapshot — union from what exists */
    }
  }
  return tables;
}

const errors = [];
const fail = (msg) => errors.push(msg);

// ---- parse the four sources ------------------------------------------
const schema = parseDefineTables(readSrc("convex/schema.ts"));
const trd = parseDefineTables(trdSection6());
const migrationCols = parseMigrationColumns();
const regTables = registryTables();

if (schema.size === 0) fail("convex/schema.ts: no defineTable blocks parsed (parser broken?)");
if (trd.size === 0) fail("j-pay.md §6: no defineTable blocks parsed (fence moved?)");

// ---- 1. TRD §6 ↔ schema.ts: exact table sets -------------------------
for (const t of trd.keys()) if (!schema.has(t)) fail(`TRD §6 table '${t}' missing in convex/schema.ts`);
for (const t of schema.keys()) if (!trd.has(t)) fail(`convex/schema.ts table '${t}' missing in TRD §6`);

// ---- 2. TRD §6 ↔ schema.ts: exact field sets per table ---------------
for (const [t, trdFields] of trd) {
  const sFields = schema.get(t);
  if (!sFields) continue; // already reported
  const a = new Set(trdFields), b = new Set(sFields);
  const onlyTrd = [...a].filter((f) => !b.has(f));
  const onlySchema = [...b].filter((f) => !a.has(f));
  if (onlyTrd.length) fail(`table '${t}': fields in TRD §6 but not schema.ts: ${onlyTrd.join(", ")}`);
  if (onlySchema.length) fail(`table '${t}': fields in schema.ts but not TRD §6: ${onlySchema.join(", ")}`);
}

// ---- 3. schema.ts ↔ migrations: columns per table -------------------
const allMigrationTables = new Set(migrationCols.keys());
for (const [t, sFields] of schema) {
  if (!allMigrationTables.has(t)) {
    fail(`schema.ts table '${t}' has no CREATE TABLE in any migration`);
    continue;
  }
  const sqlCols = new Set([...migrationCols.get(t), ...ENGINE_COLUMNS]);
  const onlySql = [...sqlCols].filter((c) => !sFields.includes(c) && !ENGINE_COLUMNS.has(c));
  const onlySchema = sFields.filter((f) => !sqlCols.has(f));
  if (onlySql.length) fail(`table '${t}': columns in SQL but not schema.ts: ${onlySql.join(", ")}`);
  if (onlySchema.length) fail(`table '${t}': columns in schema.ts but not SQL: ${onlySchema.join(", ")}`);
}
// INFRA allowlist: migration-only tables are fine only if allowlisted.
for (const t of allMigrationTables) {
  if (!schema.has(t) && !trd.has(t) && !INFRA_TABLES.has(t)) {
    fail(`migration-only table '${t}' is not in schema.ts/TRD §6 and not on the INFRA allowlist`);
  }
}

// ---- 4. INDEX_FIELDS: table coverage + every index column is a real field
{
  const db = readSrc("src/lib/backend/db.ts");
  const block = /const INDEX_FIELDS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(db);
  if (!block) fail("src/lib/backend/db.ts: INDEX_FIELDS block not found");
  else {
    // Split the body into top-level table stanzas, tracking brace depth so
    // multi-line entries (e.g. logs) are handled.
    const stanzas = [];
    let depth = 0, cur = "", table = null;
    for (const line of block[1].split("\n")) {
      if (depth === 0) {
        const tm = /^\s*(\w+):\s*\{/.exec(line);
        if (tm) {
          table = tm[1];
          depth = 1;
          // process remainder of this line too (single-line stanzas)
          const rest = line.slice(line.indexOf("{") + 1);
          cur = "";
          for (const c of rest) { if (c === "{") depth++; else if (c === "}") depth--; }
          cur += rest;
          if (depth === 0) { stanzas.push([table, cur]); table = null; }
        }
        continue;
      }
      for (const c of line) { if (c === "{") depth++; else if (c === "}") depth--; }
      cur += "\n" + line;
      if (depth === 0) { stanzas.push([table, cur]); table = null; }
    }
    const seen = new Set();
    for (const [t, body] of stanzas) {
      seen.add(t);
      const fields = schema.get(t);
      if (!fields && !INFRA_TABLES.has(t)) {
        fail(`INDEX_FIELDS table '${t}' not in schema.ts`);
        continue;
      }
      for (const im of body.matchAll(/\[([^\]]*)\]/g)) {
        for (const fm of im[1].matchAll(/"([\w$]+)"/g)) {
          if (fields && !fields.includes(fm[1])) {
            fail(`INDEX_FIELDS table '${t}': index references unknown field '${fm[1]}'`);
          }
        }
      }
    }
    for (const t of schema.keys()) {
      if (!seen.has(t)) fail(`schema.ts table '${t}' missing in INDEX_FIELDS (src/lib/backend/db.ts)`);
    }
  }
}

// ---- 5. registry view covers every schema table -----------------------
for (const t of schema.keys()) {
  if (!regTables.has(t)) fail(`schema.ts table '${t}' missing from jpay_id_registry view definitions`);
}

// ---- report ------------------------------------------------------------
if (errors.length) {
  console.error(`FAIL Schema Parity: ${errors.length} problem(s)`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(`✔ Schema Parity: ${schema.size} tables, ${[...schema.values()].reduce((n, f) => n + f.length, 0)} fields — TRD §6 ↔ schema.ts ↔ migrations ↔ INDEX_FIELDS ↔ registry view`);
