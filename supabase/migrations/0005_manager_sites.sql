-- 0005_manager_sites.sql — manager → site assignments (owner 2026-11-10)
--
-- A manager is scoped to the sites in this table; their "crew" is derived —
-- every non-archived employee/manager assigned (via userSites) to one of the
-- manager's sites. No explicit employee↔manager rows (owner decision).
--
-- NOT APPLIED by any agent session. Apply via the Supabase dashboard / CLI.
-- Requires 0004_manager_role.sql first (managers must be allowed in users.role).

create table if not exists public."managerSites" (
  "_id"           uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "managerId"     uuid not null references public.users("_id") on delete cascade,
  "siteId"        uuid not null references public.sites("_id") on delete cascade,
  unique ("managerId", "siteId")
);
create index if not exists manager_sites_manager_idx on public."managerSites" ("managerId");
create index if not exists manager_sites_site_idx on public."managerSites" ("siteId");

alter table public."managerSites" enable row level security;

-- RLS stays default-deny: no policies. All access flows through the service
-- role via POST /api/backend/call, same as every other table.
