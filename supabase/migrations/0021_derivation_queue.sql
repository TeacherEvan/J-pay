-- 0021_derivation_queue.sql — atomic punch commit + derivation crash-net (DRAFT, owner applies)
--
-- The defect this closes (audit 2026-11-17, P0 "atomicity across PostgREST round-trips"):
-- createLog commits the log row and then derives shifts as a SEPARATE round trip. If the
-- serverless container dies between the two, the punch evidence exists but the shift is
-- never derived and nothing re-drives it (the inline scheduler retry dies with the process).
-- The audit's proposed shape (insert log + upsert a shift row in one transaction) does not
-- match this codebase: shifts are REBUILT from the full log horizon by deriveForUser, not
-- patched row-at-a-time, so there is no single shift row to upsert atomically.
--
-- Correct shape — the outbox/queue pattern inside Postgres:
--   1. jpay_commit_punch() writes the log AND queues a derivation request in ONE transaction,
--      serialized per-user by a transaction-scoped advisory lock (also closes the same race
--      class as the client punch-sync mutex, for concurrent devices/tabs).
--   2. The Next layer calls it first and falls back to the legacy two-phase path when the
--      function/table does not exist yet (this migration not applied). Both paths are
--      idempotent via logs_user_idem_uniq (0002), so the fallback degrades safely.
--   3. POST /api/internal/cron?job=derivation-sweep (every minute, owner-configured schedule)
--      invokes shifts:sweepDerivationQueue, which re-drives deriveForUser for any pending
--      request older than 2 s and marks done/failed (attempts >= 5 → 'failed' + systemEvents row).
--      This is the re-drive that survives a hard crash. pg_cron/pg_net remain owner-only; an
--      external scheduler hitting the cron route works identically.
--
-- Apply ORDER: after 0020. Purely additive. Idempotent (re-running is a no-op).
-- Do NOT run via `supabase db push` — SQL editor or MCP apply_migration only. This file was
-- drafted by an agent session on 2026-11-17 and is NOT applied by that session.
--
-- derivation_queue is Postgres INFRASTRURE, not app data: no TRD §6 table, no Convex schema
-- entry, not in jpay_id_registry; it joins the schema-parity gate's INFRA_TABLES allowlist.
--
-- SELF-CHECK (after apply; every row must report the expected value):
--   -- 1) Function exists with the lockdown applied:
--   select has_function_privilege('anon',          'public.jpay_commit_punch(uuid,uuid,bigint,bigint,text,double precision,double precision,double precision,boolean,integer,text,text,boolean)', 'execute') as anon_exec,
--          has_function_privilege('authenticated', 'public.jpay_commit_punch(uuid,uuid,bigint,bigint,text,double precision,double precision,double precision,boolean,integer,text,text,boolean)', 'execute') as authenticated_exec,
--          has_function_privilege('service_role',  'public.jpay_commit_punch(uuid,uuid,bigint,bigint,text,double precision,double precision,double precision,boolean,integer,text,text,boolean)', 'execute') as service_role_exec;
--   -- expect: false, false, true
--   -- 2) Partial unique index coalesces pending requests:
--   select indexdef from pg_indexes where schemaname='public' and indexname='derivation_queue_one_pending_per_user';
--   -- expect: ... UNIQUE ... WHERE ((status = 'pending'::text))
--   -- 3) End-to-end (in a transaction you roll back):
--   -- begin; select public.jpay_commit_punch('<user>','<site>', 1789000000000, 0, 'arrived', -26.2, 28.04, 10, true, null, 'self-check', 'selfcheck-' || now()::text, null);
--   -- select status, attempts from public.derivation_queue where "userId" = '<user>';  -- expect: pending, 0
--   -- rollback;

create table if not exists public.derivation_queue (
  "_id"           uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "userId"        uuid not null references public.users("_id") on delete cascade,
  "status"        text not null default 'pending' check ("status" in ('pending','processing','done','failed')),
  "attempts"      integer not null default 0,
  "lastError"     text,
  "requestedAt"   timestamptz not null default now(),
  "updatedAt"     timestamptz not null default now()
);

-- At most one PENDING request per user: derivation re-scans the full horizon, so
-- queued duplicates are pure waste. Coalescing is what makes enqueue cheap enough
-- to run on every punch.
create unique index if not exists derivation_queue_one_pending_per_user
  on public.derivation_queue ("userId") where "status" = 'pending';
create index if not exists derivation_queue_status_time_idx
  on public.derivation_queue ("status", "requestedAt");

alter table public.derivation_queue enable row level security;
revoke all on table public.derivation_queue from public, anon, authenticated;
grant all on table public.derivation_queue to service_role;

create or replace function public.jpay_commit_punch(
  p_user_id uuid,
  p_site_id uuid,
  p_client_reported_time bigint,
  p_clock_skew_ms bigint,
  p_status text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_meters double precision,
  p_is_within_geofence boolean,
  p_side_mission_duration_minutes integer,
  p_device_metadata text,
  p_idempotency_key text,
  p_impossible_travel_flag boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_log_id uuid;
  v_inserted boolean := false;
begin
  -- Serialize this user's punch commits for the duration of the transaction.
  -- The browser-side punch-sync mutex orders the app's own paths; this closes
  -- the same window for concurrent devices or tabs replaying the outbox.
  perform pg_advisory_xact_lock(hashtextextended('jpay_punch' || p_user_id::text, 0));

  insert into public.logs (
    "userId", "siteId", "clientReportedTime", "clockSkewMs", "status",
    "latitude", "longitude", "accuracyMeters", "isWithinGeofence",
    "sideMissionDurationMinutes", "deviceMetadata", "idempotencyKey",
    "impossibleTravelFlag"
  ) values (
    p_user_id, p_site_id, p_client_reported_time, p_clock_skew_ms, p_status,
    p_latitude, p_longitude, p_accuracy_meters, p_is_within_geofence,
    p_side_mission_duration_minutes, p_device_metadata, p_idempotency_key,
    p_impossible_travel_flag
  )
  on conflict ("userId", "idempotencyKey") do nothing
  returning "_id" into v_log_id;

  if v_log_id is not null then
    v_inserted := true;
  else
    -- Concurrent twin won the race; report the existing row instead of erroring.
    select "_id" into v_log_id
      from public.logs
     where "userId" = p_user_id and "idempotencyKey" = p_idempotency_key;
  end if;

  -- Coalesced derivation request — at most one pending row per user.
  insert into public.derivation_queue ("userId")
  values (p_user_id)
  on conflict ("userId") where "status" = 'pending' do nothing;

  return jsonb_build_object('log_id', v_log_id, 'inserted', v_inserted);
end;
$$;

revoke all on function public.jpay_commit_punch(uuid, uuid, bigint, bigint, text, double precision, double precision, double precision, boolean, integer, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.jpay_commit_punch(uuid, uuid, bigint, bigint, text, double precision, double precision, double precision, boolean, integer, text, text, boolean)
  to service_role;

notify pgrst, 'reload schema';
