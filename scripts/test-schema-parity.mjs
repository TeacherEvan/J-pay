#!/usr/bin/env node
/**
 * Parity and consistency gate between Convex schema and Supabase Postgres migration.
 * Asserts:
 *  1. Every table defined in convex/schema.ts exists in supabase/migrations/0001_init.sql
 *  2. Every table defined in convex/schema.ts exists in INDEX_FIELDS (src/lib/backend/db.ts)
 *  3. jpay_id_registry view in 0001_init.sql includes all tables
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const schemaContent = readFileSync(resolve(root, "convex/schema.ts"), "utf8");
const initSqlContent = readFileSync(resolve(root, "supabase/migrations/0001_init.sql"), "utf8");
const dbContent = readFileSync(resolve(root, "src/lib/backend/db.ts"), "utf8");

// 1. Extract tables from convex/schema.ts
const schemaTableRegex = /^\s*(\w+):\s*defineTable\(/gm;
const schemaTables = new Set();
let match;
while ((match = schemaTableRegex.exec(schemaContent)) !== null) {
  schemaTables.add(match[1]);
}

if (schemaTables.size === 0) {
  console.error("FAIL: No tables discovered in convex/schema.ts");
  process.exit(1);
}

// 2. Extract tables from 0001_init.sql
const sqlTableRegex = /create table if not exists public\.(?:\"(\w+)\"|(\w+))/gi;
const sqlTables = new Set();
while ((match = sqlTableRegex.exec(initSqlContent)) !== null) {
  sqlTables.add(match[1] || match[2]);
}

// 3. Extract tables from INDEX_FIELDS in src/lib/backend/db.ts
const indexFieldsBlock = dbContent.match(/const INDEX_FIELDS: Record<string, Record<string, string\[\]>> = \{([\s\S]*?)\n\};/);
if (!indexFieldsBlock) {
  console.error("FAIL: Could not locate INDEX_FIELDS in src/lib/backend/db.ts");
  process.exit(1);
}
const dbTableRegex = /^\s*(\w+): \{/gm;
const dbTables = new Set();
while ((match = dbTableRegex.exec(indexFieldsBlock[1])) !== null) {
  dbTables.add(match[1]);
}

// 4. Extract tables from jpay_id_registry view in 0001_init.sql
const registryRegex = /'([a-zA-Z0-9_]+)' as tbl/g;
const registryTables = new Set();
while ((match = registryRegex.exec(initSqlContent)) !== null) {
  registryTables.add(match[1]);
}

let hasErrors = false;

// Check convex -> sql
for (const table of schemaTables) {
  if (!sqlTables.has(table)) {
    console.error(`FAIL: Table '${table}' in convex/schema.ts missing in supabase/migrations/0001_init.sql`);
    hasErrors = true;
  }
  if (!dbTables.has(table)) {
    console.error(`FAIL: Table '${table}' in convex/schema.ts missing in INDEX_FIELDS (src/lib/backend/db.ts)`);
    hasErrors = true;
  }
  if (!registryTables.has(table)) {
    console.error(`FAIL: Table '${table}' in convex/schema.ts missing in jpay_id_registry view (supabase/migrations/0001_init.sql)`);
    hasErrors = true;
  }
}

if (hasErrors) {
  process.exit(1);
}

console.log(`✔ Schema Parity: All ${schemaTables.size} tables verified across Convex, Supabase SQL, and DB adapter.`);
