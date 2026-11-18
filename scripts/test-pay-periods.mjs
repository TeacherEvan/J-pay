#!/usr/bin/env node
/**
 * Structural gate for migration 0022_pay_periods.sql.
 *
 * Verifies the statutory pay-period locking schema and contract invariants:
 *   1. table exists: public.pay_periods
 *   2. primary key and foreign key references (org_id, locked_by)
 *   3. status check constraint ('open', 'locked', 'paid')
 *   4. unique constraint on (org_id, iso_week)
 *   5. index on (org_id, iso_week)
 *   6. RLS enabled (default deny) with privileges revoked from public/anon/authenticated
 *      and granted only to service_role
 *   7. schema reload notify
 *   8. registration in INFRA_TABLES (scripts/test-schema-parity.mjs) and INDEX_FIELDS (src/lib/backend/db.ts)
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const migrationFile = "supabase/migrations/0022_pay_periods.sql";
const sql = readFileSync(resolve(root, migrationFile), "utf8");

const requiredInvariants = [
  ["table exists", /create table if not exists public\.pay_periods/i],
  ["primary key uuid default gen_random_uuid", /id\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/i],
  ["org_id references organisations", /org_id\s+uuid\s+not null\s+references\s+public\.organisations\(id\)/i],
  ["iso_week text not null", /iso_week\s+text\s+not null/i],
  ["status constraint ('open', 'locked', 'paid')", /status\s+text\s+not null\s+default\s+'open'\s+check\s*\(\s*status\s+in\s*\(\s*'open'\s*,\s*'locked'\s*,\s*'paid'\s*\)\s*\)/i],
  ["locked_at timestamptz", /locked_at\s+timestamptz/i],
  ["locked_by references users", /locked_by\s+uuid\s+references\s+public\.users\(id\)/i],
  ["snapshot_checksum text", /snapshot_checksum\s+text/i],
  ["created_at timestamptz default now()", /created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i],
  ["unique constraint on (org_id, iso_week)", /unique\s*\(\s*org_id\s*,\s*iso_week\s*\)/i],
  ["index on (org_id, iso_week)", /create index if not exists pay_periods_org_iso_week_idx\s+on\s+public\.pay_periods\s*\(\s*org_id\s*,\s*iso_week\s*\)/i],
  ["RLS enabled", /alter table public\.pay_periods enable row level security/i],
  ["lockdown: revoke public/anon/authenticated", /revoke all on table public\.pay_periods from public,\s*anon,\s*authenticated/i],
  ["lockdown: grant service_role", /grant all on table public\.pay_periods to service_role/i],
  ["schema reload notify", /notify pgrst,\s*'reload schema'/i],
];

const missing = requiredInvariants.filter(([, re]) => !re.test(sql)).map(([label]) => label);
if (missing.length > 0) {
  console.error(`FAIL: ${migrationFile} is missing required invariants:\n  - ${missing.join("\n  - ")}`);
  process.exit(1);
}

// Verify registration in INFRA_TABLES
const parityScript = readFileSync(resolve(root, "scripts/test-schema-parity.mjs"), "utf8");
if (!/INFRA_TABLES\s*=\s*new Set\(\[[^\]]*"pay_periods"/.test(parityScript)) {
  console.error("FAIL: pay_periods is not registered in INFRA_TABLES in scripts/test-schema-parity.mjs");
  process.exit(1);
}

// Verify registration in INDEX_FIELDS
const dbScript = readFileSync(resolve(root, "src/lib/backend/db.ts"), "utf8");
if (!/pay_periods:\s*\{[^}]*by_org_iso_week:\s*\["org_id",\s*"iso_week"\]/.test(dbScript)) {
  console.error("FAIL: pay_periods is not registered in INDEX_FIELDS in src/lib/backend/db.ts");
  process.exit(1);
}

console.log("pay_periods migration OK: DDL invariants, RLS lockdown, and parity registration hold");
