-- 0008_refresh_registry.DO_NOT_APPLY.sql — archived, never to be run.
-- (audit 2026-11-11, finding P1-F2 — quarantined 2026-11-11.)
--
-- WHY: `supabase db push` (or a careful operator following an outdated runbook) walks this
-- directory in filename order and would apply this file against production, whose registry
-- already carries organisations + systemEvents via 0011. This file's union omits both, so
-- applying it would DROP those two members from `jpay_id_registry`, and every
-- `ctx.db.get(<org/systemEvent id>)` would start returning "Document not found". The file's
-- own header already forbade re-application after 0011 — the filename now enforces it.
-- For incremental installs, run `0011_system_events.sql` instead. This file is kept only as
-- history; do not recreate the view with its contents.
--
-- 0008_refresh_registry.sql — make incremental deployments self-contained
--
-- 0005/0006/0007 created the new tables but never refreshed the
-- jpay_id_registry view nor notified PostgREST. Existing installs that only
-- ran the incremental files end up with cache-miss lookups on the new tables
-- (Document not found) and PGRST schema-cache 404s. This refresh is
-- idempotent and safe to run on either install path (fresh installs got
-- everything inline from 0001).
--
-- Apply after 0007. Purely additive; no data touched.
--
-- WARNING (2026-11-11): superseded by 0011_system_events.sql, whose registry
-- union additionally includes organisations and systemEvents. Do NOT apply
-- this file AFTER 0011 — it would drop those two from the view. It is kept
-- for historical/fork parity only. Also note: on installs whose registry
-- view has id typed uuid (pre-2026-11-11 production), create-or-replace
-- fails; drop+recreate instead (see 0009_organisations.sql).

create or replace view public.jpay_id_registry as
  select "_id"::text as id, 'users' as tbl from public.users
  union all
  select "_id"::text as id, 'sites' as tbl from public.sites
  union all
  select "_id"::text as id, 'punches' as tbl from public.punches
  union all
  select "_id"::text as id, 'userSites' as tbl from public."userSites"
  union all
  select "_id"::text as id, 'logs' as tbl from public.logs
  union all
  select "_id"::text as id, 'shifts' as tbl from public.shifts
  union all
  select "_id"::text as id, 'messages' as tbl from public.messages
  union all
  select "_id"::text as id, 'pushSubscriptions' as tbl from public."pushSubscriptions"
  union all
  select "_id"::text as id, 'purgeAudit' as tbl from public."purgeAudit"
  union all
  select "_id"::text as id, 'reviewResolutions' as tbl from public."reviewResolutions"
  union all
  select "_id"::text as id, 'demoSessions' as tbl from public."demoSessions"
  union all
  select "_id"::text as id, 'managerSites' as tbl from public."managerSites"
  union all
  select "_id"::text as id, 'travelSegments' as tbl from public."travelSegments"
  union all
  select "_id"::text as id, 'shiftOverrides' as tbl from public."shiftOverrides";

notify pgrst, 'reload schema';
