-- 0001_init.sql — J-Pay schema on Supabase Postgres
--
-- Mirrors convex/schema.ts (the contract) with Convex-compatible column names:
--   _id            uuid primary key      (replaces Convex's opaque Id)
--   _creationTime  bigint milliseconds   (replaces Convex's _creationTime)
--
-- Convex optional fields are NULL-able here; the data layer converts NULL to
-- undefined so `q.eq(field, undefined)` keeps Convex semantics.
--
-- SECURITY: every table gets RLS enabled with NO policies -> default-deny for
-- anon/authenticated. The browser's publishable key can reach nothing. The app
-- talks through /api/backend, which uses the service role and enforces the
-- role rules that convex/access.ts enforced (moderator vs employee).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- users -----
create table if not exists public.users (
  "_id"                     uuid primary key default gen_random_uuid()
                            references auth.users(id) on delete cascade,
  "_creationTime"           bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "name"                    text,
  "email"                   text,
  "emailVerificationTime"   bigint,
  "image"                   text,
  "isAnonymous"             boolean,
  "isMasterTemp"            boolean,
  "role"                    text not null check ("role" in ('moderator', 'employee', 'manager')),
  "isActive"                boolean not null default true,
  "passwordChangedAt"       bigint,
  "deviceId"                text,
  "archivedAt"              bigint,
  "hourlyRateOverride"      double precision,
  "pushSubscriptionTokens"  text[],
  "payStrategy"             text check ("payStrategy" in ('flat','bcea','dailyOvertime','flsa','wtr_uk')),
  "locale"                  text,
  "orgId"                   uuid references public.organisations("_id") on delete set null
);
create index if not exists users_email_idx on public.users ("email");
create index if not exists users_role_idx on public.users ("role");
create index if not exists users_active_idx on public.users ("isActive");
create index if not exists users_org_idx on public.users ("orgId");
-- master-temp rows reuse the operator's email for audit, so uniqueness is partial
create unique index if not exists users_real_email_uniq
  on public.users ("email") where "isMasterTemp" is not true;

-- ---------------------------------------------------------------- sites -----
create table if not exists public.organisations (
  "_id"                   uuid primary key default gen_random_uuid(),
  "_creationTime"         bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "name"                  text not null,
  "archivedAt"            bigint,
  "createdBy"             uuid references public.users("_id") on delete set null
);

create table if not exists public.sites (
  "_id"                   uuid primary key default gen_random_uuid(),
  "_creationTime"         bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "name"                  text not null,
  "latitude"              double precision not null,
  "longitude"             double precision not null,
  "geofenceRadiusMeters"  double precision not null,
  "timezone"              text not null,
  "archivedAt"            bigint,
  "createdBy"             uuid references public.users("_id") on delete set null,
  "updatedAt"             bigint,
  "updatedBy"             uuid references public.users("_id") on delete set null,
  "orgId"                 uuid references public.organisations("_id") on delete set null
);

create index if not exists sites_org_idx on public.sites ("orgId");

-- -------------------------------------------------------------- punches -----
create table if not exists public.punches (
  "_id"           uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "userId"        uuid not null references public.users("_id") on delete cascade,
  "siteId"        uuid not null references public.sites("_id") on delete cascade,
  "type"          text not null check ("type" in ('in', 'out')),
  "lat"           double precision not null,
  "lng"           double precision not null,
  "geoPassed"     boolean not null,
  "ts"            bigint not null
);
create index if not exists punches_user_site_time_idx on public.punches ("userId", "siteId");
create index if not exists punches_ts_idx on public.punches ("ts" desc);

-- ------------------------------------------------------------- userSites ----
create table if not exists public."userSites" (
  "_id"           uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "userId"        uuid not null references public.users("_id") on delete cascade,
  "siteId"        uuid not null references public.sites("_id") on delete cascade
);
create index if not exists user_sites_user_idx on public."userSites" ("userId");
create index if not exists user_sites_site_idx on public."userSites" ("siteId");

-- ---------------------------------------------------------------- logs ------
create table if not exists public.logs (
  "_id"                          uuid primary key default gen_random_uuid(),
  "_creationTime"                bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "userId"                       uuid not null references public.users("_id") on delete cascade,
  "siteId"                       uuid not null references public.sites("_id") on delete cascade,
  "clientReportedTime"           bigint not null,
  "clockSkewMs"                  bigint,
  "status"                       text not null check ("status" in
                                   ('arrived','checkpoint','lunch','feeling sick',
                                    'day finish','job finish','quick side mission')),
  "latitude"                     double precision not null,
  "longitude"                    double precision not null,
  "accuracyMeters"               double precision not null,
  "isWithinGeofence"             boolean not null,
  "sideMissionDurationMinutes"   integer check ("sideMissionDurationMinutes" in (15,30,45,60,120)),
  "deviceMetadata"               text not null,
  "ipAddress"                    text,
  "idempotencyKey"               text not null,
  "isModeratorOverride"          boolean,
  "impossibleTravelFlag"         boolean,
  "createdByDemoReviewerId"      uuid references public.users("_id") on delete set null
);
create index if not exists logs_user_time_idx on public.logs ("userId", "_creationTime" desc);
create index if not exists logs_status_idx on public.logs ("status");
create index if not exists logs_site_time_idx on public.logs ("siteId", "_creationTime" desc);
create index if not exists logs_user_skew_idx on public.logs ("userId", "clockSkewMs");
create index if not exists logs_user_idem_idx on public.logs ("userId", "idempotencyKey");
create index if not exists logs_client_time_idx on public.logs ("clientReportedTime" desc);

-- -------------------------------------------------------------- shifts ------
create table if not exists public.shifts (
  "_id"           uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "userId"        uuid not null references public.users("_id") on delete cascade,
  "startedAt"     bigint not null,
  "endedAt"       bigint,
  "totalMinutes"  integer,
  "needsReview"   boolean not null default false,
  "reviewReason"  text,
  "timezone"      text,
  "sealed"        boolean
);
create index if not exists shifts_user_start_idx on public.shifts ("userId", "startedAt");
create index if not exists shifts_started_idx on public.shifts ("startedAt");
create index if not exists shifts_active_idx on public.shifts ("endedAt");
create index if not exists shifts_needs_review_idx on public.shifts ("needsReview");

-- ------------------------------------------------------------ messages ------
create table if not exists public.messages (
  "_id"            uuid primary key default gen_random_uuid(),
  "_creationTime"  bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "senderId"       uuid not null references public.users("_id") on delete cascade,
  "recipientId"    uuid references public.users("_id") on delete cascade,
  "modQueue"       boolean not null default false,
  "content"        text not null,
  "isRead"         boolean not null default false,
  "archivedAt"     bigint,
  "retentionDays"  integer
);
create index if not exists messages_recipient_read_idx on public.messages ("recipientId", "isRead");
create index if not exists messages_modqueue_unread_idx on public.messages ("modQueue", "isRead");
create index if not exists messages_sender_idx on public.messages ("senderId");

-- ---------------------------------------------------- pushSubscriptions -----
create table if not exists public."pushSubscriptions" (
  "_id"                  uuid primary key default gen_random_uuid(),
  "_creationTime"        bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "userId"               uuid not null references public.users("_id") on delete cascade,
  "endpoint"             text not null,
  "keysP256dh"           text not null,
  "keysAuth"             text not null,
  "lastErrorAt"          bigint,
  "consecutiveErrors"    integer
);
create index if not exists push_subs_user_idx on public."pushSubscriptions" ("userId");

-- ----------------------------------------------------------- purgeAudit -----
create table if not exists public."purgeAudit" (
  "_id"           uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "purgedAt"      bigint not null,
  "purgedCount"   integer not null,
  "kind"          text not null check ("kind" in ('coordinates','messages','masterTemps'))
);
create index if not exists purge_audit_purged_at_idx on public."purgeAudit" ("purgedAt");

-- ---------------------------------------------------- reviewResolutions -----
create table if not exists public."reviewResolutions" (
  "_id"              uuid primary key default gen_random_uuid(),
  "_creationTime"    bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "userId"           uuid not null references public.users("_id") on delete cascade,
  "shiftKey"         text not null,
  "resolvedAt"       bigint not null,
  "byModeratorId"    uuid not null references public.users("_id") on delete cascade
);
create index if not exists review_resolutions_user_key_idx on public."reviewResolutions" ("userId", "shiftKey");

-- --------------------------------------------------------- demoSessions -----
create table if not exists public."demoSessions" (
  "_id"            uuid primary key default gen_random_uuid(),
  "_creationTime"  bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "reviewerId"     uuid not null references public.users("_id") on delete cascade,
  "personaEmail"   text not null,
  "mode"           text not null check ("mode" in ('employee','moderator','full')),
  "createdAt"      bigint not null,
  "updatedAt"      bigint not null
);
create index if not exists demo_sessions_reviewer_idx on public."demoSessions" ("reviewerId");
create index if not exists demo_sessions_persona_idx on public."demoSessions" ("personaEmail");

-- ---------------------------------------------------------- managerSites -----
create table if not exists public."managerSites" (
  "_id"           uuid primary key default gen_random_uuid(),
  "_creationTime" bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "managerId"     uuid not null references public.users("_id") on delete cascade,
  "siteId"        uuid not null references public.sites("_id") on delete cascade,
  unique ("managerId", "siteId")
);
create index if not exists manager_sites_manager_idx on public."managerSites" ("managerId");
create index if not exists manager_sites_site_idx on public."managerSites" ("siteId");

-- --------------------------------------------------------- travelSegments ---
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

-- --------------------------------------------------------- shiftOverrides ---
create table if not exists public."shiftOverrides" (
  "_id"                   uuid primary key default gen_random_uuid(),
  "_creationTime"         bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  "userId"                uuid not null references public.users("_id") on delete cascade,
  "shiftKey"              text not null,
  "endedAt"               bigint not null,
  "reason"                text not null check (char_length(reason) >= 10),
  "byModeratorId"         uuid not null references public.users("_id") on delete restrict,
  "previousEndedAt"       bigint,
  "previousTotalMinutes"  double precision
);
create index if not exists shift_overrides_user_key_idx on public."shiftOverrides" ("userId", "shiftKey");

-- --------------------------------------------------- jpay_id_registry view --
-- Polyfill for untyped uuid lookup across tables (used by Database.tableOf)
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

-- ------------------------------------------------------------ lockdown ------
alter table public.users                enable row level security;
alter table public.organisations        enable row level security;
alter table public.sites                enable row level security;
alter table public.punches              enable row level security;
alter table public."userSites"          enable row level security;
alter table public.logs                 enable row level security;
alter table public.shifts               enable row level security;
alter table public.messages             enable row level security;
alter table public."pushSubscriptions"  enable row level security;
alter table public."purgeAudit"         enable row level security;
alter table public."reviewResolutions"  enable row level security;
alter table public."demoSessions"       enable row level security;
alter table public."managerSites"       enable row level security;
alter table public."travelSegments"     enable row level security;
alter table public."shiftOverrides"     enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- make PostgREST pick up the new tables immediately
notify pgrst, 'reload schema';
