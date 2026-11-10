-- 0006_travel_tracking.sql — on-shift travel tracking (owner 2026-11-10)
--
-- Consent-gated, on-shift, off-site-only travel legs. The employee app posts
-- fixes to travel.recordFix, which verifies the device token and decides
-- server-side whether the employee is inside an assigned geofence (fix
-- dropped / leg closed) or travelling (fix appended). Raw route samples
-- (pathSamples) are anonymised after retentionDays via the coordinates purge
-- job (chained from purgeExpiredCoords); aggregate distance/duration are kept
-- for payroll evidence. Travel time is NOT added to pay — the shift span
-- already contains it (shifts pay as normal hours).
--
-- Requires 0005_manager_sites.sql (no hard dependency, but apply in order).
-- NOT APPLIED by any agent session. Apply via the Supabase dashboard / CLI.

alter table public.users
  add column if not exists "travelConsentAt" bigint;

create table if not exists public."travelSegments" (
  "_id"            uuid primary key default gen_random_uuid(),
  "_creationTime"  bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "userId"         uuid not null references public.users("_id") on delete cascade,
  "fromSiteId"     uuid references public.sites("_id") on delete set null,
  "toSiteId"       uuid references public.sites("_id") on delete set null,
  "departedAt"     bigint not null,
  "arrivedAt"      bigint,
  "distanceMeters" double precision not null default 0,
  "maxSpeedMps"    double precision,
  "pathSamples"    jsonb not null default '[]'::jsonb,
  "lastFixKey"     text,
  "needsReview"    boolean not null default false,
  "reviewReason"   text
);
create index if not exists travel_segments_user_departed_idx on public."travelSegments" ("userId", "departedAt" desc);
create index if not exists travel_segments_departed_idx on public."travelSegments" ("departedAt" desc);

alter table public."travelSegments" enable row level security;

-- RLS stays default-deny: no policies. All access flows through the service
-- role via POST /api/backend/call, same as every other table.
