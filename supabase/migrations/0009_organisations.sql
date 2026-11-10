-- 0009_organisations.sql — organisations table + org scoping
--
-- Introduces public.organisations. Every existing user and site is backfilled
-- into a single organisation ("Default organisation") so incrementally
-- migrated deployments behave like fresh installs. Managers messaging is
-- scoped to the caller's org; sites are created under an org.
--
-- Apply after 0008. Purely additive; no rows deleted. Idempotent.

create table if not exists public.organisations (
  "_id"                   uuid primary key default gen_random_uuid(),
  "_creationTime"         bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "name"                  text not null,
  "archivedAt"            bigint,
  "createdBy"             uuid references public.users("_id") on delete set null
);

alter table public.users
  add column if not exists "orgId" uuid references public.organisations("_id") on delete set null;

alter table public.sites
  add column if not exists "orgId" uuid references public.organisations("_id") on delete set null;

create index if not exists users_org_idx on public.users ("orgId");
create index if not exists sites_org_idx on public.sites ("orgId");

-- Backfill: one default org for everything that exists today.
do $$
declare
  default_org uuid;
begin
  select "_id" into default_org from public.organisations order by "_creationTime" limit 1;
  if default_org is null then
    insert into public.organisations ("name") values ('Default organisation') returning "_id" into default_org;
  end if;
  update public.users set "orgId" = default_org where "orgId" is null;
  update public.sites set "orgId" = default_org where "orgId" is null;
end $$;

alter table public.organisations enable row level security;

-- Registry view refresh (must include every table) + PostgREST schema reload.
create or replace view public.jpay_id_registry as
  select "_id"::text as id, 'users' as tbl from public.users
  union all
  select "_id"::text as id, 'organisations' as tbl from public.organisations
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
