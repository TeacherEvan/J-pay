-- 0011_system_events.sql — server-side operational incident log
--
-- C1 (2026-11-10): when scheduled shift derivation fails after all retries,
-- the failure used to be a console.error only. Punch evidence stays valid,
-- but the shift never derives and payroll silently stalls. The runtime now
-- stamps the user's unsealed shifts needsReview=true (derivation_failed)
-- and records one systemEvents row per failure. This table is that ledger.
--
-- Apply after 0010. Purely additive. Idempotent.

create table if not exists public."systemEvents" (
  "_id"                   uuid primary key default gen_random_uuid(),
  "_creationTime"         bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "kind"                  text not null,
  "userId"                uuid references public.users("_id") on delete set null,
  "at"                    bigint not null,
  "detail"                text
);
create index if not exists system_events_kind_idx on public."systemEvents" ("kind");

alter table public."systemEvents" enable row level security;

create or replace view public.jpay_id_registry as
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
  select "_id"::text as id, 'demoSessions' as tbl from public."demoSessions"
  union all
  select "_id"::text as id, 'managerSites' as tbl from public."managerSites"
  union all
  select "_id"::text as id, 'travelSegments' as tbl from public."travelSegments"
  union all
  select "_id"::text as id, 'shiftOverrides' as tbl from public."shiftOverrides";

notify pgrst, 'reload schema';
