#!/usr/bin/env node
/**
 * Structural gate for migration 0021_derivation_queue.sql.
 *
 * The migration is owner-applied and cannot be exercised by the unit suites,
 * so this pins the invariants that make it safe:
 *   1. single transaction atomicity (log insert + derivation enqueue in one
 *      function, advisory xact lock first),
 *   2. idempotency (ON CONFLICT on the 0002 unique key; coalesced pending
 *      queue via the partial unique index),
 *   3. lockdown (SECURITY DEFINER, pinned search_path, EXECUTE revoked from
 *      public/anon/authenticated, granted to service_role only, RLS on the
 *      queue table),
 *   4. schema-reload notify.
 *
 * Fails loudly if any invariant is edited away — re-apply review at that point.
 */
import { readFileSync } from "node:fs";

const file = "supabase/migrations/0021_derivation_queue.sql";
const sql = readFileSync(file, "utf8");

const required = [
  ["queue table", /create table if not exists public\.derivation_queue/i],
  ["one pending per user (partial unique)", /create unique index if not exists derivation_queue_one_pending_per_user\s+on public\.derivation_queue \("userId"\) where "status" = 'pending'/i],
  ["sweep index", /create index if not exists derivation_queue_status_time_idx/i],
  ["RLS on queue", /alter table public\.derivation_queue enable row level security/i],
  ["queue lockdown", /revoke all on table public\.derivation_queue from public, anon, authenticated/i],
  ["queue service_role grant", /grant all on table public\.derivation_queue to service_role/i],
  ["SECURITY DEFINER", /security definer/i],
  ["pinned search_path", /set search_path = public, pg_catalog/i],
  ["advisory xact lock", /pg_advisory_xact_lock\(hashtextextended\(/i],
  ["idempotent log insert", /on conflict \("userId", ?"idempotencyKey"\) do nothing/i],
  ["coalesced enqueue", /on conflict \("userId"\) where "status" = 'pending' do nothing/i],
  ["log insert returns id", /returning "_id" into v_log_id/i],
  ["function lockdown", /revoke all on function public\.jpay_commit_punch\(/i],
  ["service_role execute", /grant execute on function public\.jpay_commit_punch\(/i],
  ["schema reload notify", /notify pgrst, 'reload schema';/i],
];

const missing = required.filter(([, re]) => !re.test(sql)).map(([label]) => label);
if (missing.length > 0) {
  console.error(`FAIL: ${file} is missing invariants:\n  - ${missing.join("\n  - ")}`);
  process.exit(1);
}

// The two INSERT paths (RPC + legacy JS fallback) must write the same columns
// of the logs table — anywhere they diverge, idempotency keys or the payroll
// horizon quietly fork. Pinned here until 0021 is applied everywhere and the
// legacy path is retired.
const rpcCols = sql.match(/insert into public\.logs \(([^)]+)\)/i);
if (!rpcCols) {
  console.error("FAIL: could not locate the logs INSERT inside jpay_commit_punch");
  process.exit(1);
}
for (const col of ["userId", "idempotencyKey", "impossibleTravelFlag", "clientReportedTime"]) {
  if (!new RegExp(`"${col}"`).test(rpcCols[1])) {
    console.error(`FAIL: logs INSERT inside jpay_commit_punch is missing column ${col}`);
    process.exit(1);
  }
}

console.log("derivation queue migration OK: atomicity, idempotency and lockdown invariants hold");
