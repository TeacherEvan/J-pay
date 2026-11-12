-- 0018_remove_demo_mode.sql — remove the anonymous-preview feature from the schema
-- (owner directive 2026-11-12: "completely REMOVE DEMO MODE")
--
-- THE FEATURE. The codebase carried an opt-in anonymous preview: a `DEMO_MODE=1`
-- gate, an Anonymous auth provider, throwaway `isAnonymous` employees, a
-- `demoSessions` table binding reviewers to personas, and the
-- `logs.createdByDemoReviewerId` provenance column. The owner ordered it out
-- entirely — code, schema and documentation.
--
-- THIS FILE removes the schema residue:
--   a) recreates `public.jpay_id_registry` WITHOUT the `demoSessions` branch
--      (the view unions every table, so the table cannot be dropped while the
--      view still selects from it),
--   b) drops `public.demoSessions`,
--   c) drops `public.users.isAnonymous`,
--   d) drops `public.logs.createdByDemoReviewerId`.
--
-- SECURITY INVOKER IS LOAD-BEARING. 0014 set `security_invoker = on` on the
-- registry view so it evaluates the base tables' RLS as the caller; a plain
-- `create or replace view` RESETS that option and would silently re-open the
-- P0 anon read of the whole id registry. The `with (security_invoker = on)`
-- clause below is therefore mandatory, not decorative.
--
-- Apply ORDER: after 0017. Purely destructive and idempotent (no data worth
-- keeping is touched: the table holds preview sessions, the columns hold
-- preview-only provenance).
-- Do NOT run via `supabase db push` — SQL editor or the owner-authorised MCP
-- `apply_migration` (see AGENTS.md rule 9; afterwards reset the recorded
-- version to '0018' so the Supabase Preview check resolves it).
--
-- PRE-FLIGHT (informational):
--   select count(*) from public."demoSessions";
--   select count(*) from public.logs where "createdByDemoReviewerId" is not null;
--   select count(*) from public.users where "isAnonymous" is true;
--
-- VERIFY AFTER APPLYING:
--   -- 1. the registry view still refuses the browser roles (P0 stays closed):
--   select has_table_privilege('anon', 'public.jpay_id_registry', 'select');  -- expect false
--   select reloptions::text from pg_class c
--    join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'public' and c.relname = 'jpay_id_registry';         -- expect {security_invoker=on}
--   -- 2. the removed objects are gone:
--   select count(*) from information_schema.tables
--    where table_schema = 'public' and table_name = 'demoSessions';          -- expect 0
--   select count(*) from information_schema.columns
--    where table_schema = 'public'
--      and (table_name, column_name) in (('users','isAnonymous'),
--                                         ('logs','createdByDemoReviewerId'));  -- expect 0

-- (a) recreate the registry view without the demoSessions branch, keeping the
--     security_invoker option that 0014 installed.
create or replace view public.jpay_id_registry with (security_invoker = on) as
  select "_id"::text as id, 'users' as tbl from public.users
  union all
  select "_id"::text as id, 'organisations' as tbl from public.organisations
  union all
  select "_id"::text as id, 'systemEvents' as tbl from public."systemEvents"
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
  select "_id"::text as id, 'managerSites' as tbl from public."managerSites"
  union all
  select "_id"::text as id, 'travelSegments' as tbl from public."travelSegments"
  union all
  select "_id"::text as id, 'shiftOverrides' as tbl from public."shiftOverrides";

-- The view must keep the browser roles shut out after the replacement.
revoke all on public.jpay_id_registry from anon, authenticated;

-- (b) the preview-session table
drop table if exists public."demoSessions";

-- (c) the throwaway-reviewer flag on users
alter table public.users drop column if exists "isAnonymous";

-- (d) the preview-only provenance column on logs
alter table public.logs drop column if exists "createdByDemoReviewerId";

notify pgrst, 'reload schema';
