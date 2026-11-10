-- 0007_shift_overrides.sql — moderator end-of-shift override (owner 2026-11-10)
--
-- When an employee forgets to log off (or logs an exit at the wrong time), a
-- moderator sets a corrected endedAt with a mandatory reason. The override is
-- INPUT TO SHIFT DERIVATION (deriveSegments applies the latest override per
-- shift start) — it is not a one-off row edit, so it survives re-derivation
-- after any later log. Payroll is derived live from shifts (calcForEmployee),
-- so the corrected minutes are reflected immediately everywhere.
--
-- Sealed shifts (resolveShift = payroll-finalized) REFUSE overrides.
-- previousEndedAt/previousTotalMinutes preserve the before-state for audit;
-- the full history is the set of rows for this (userId, shiftKey).
--
-- NOT APPLIED by any agent session. Apply via the Supabase dashboard / CLI.
-- Requires nothing beyond 0001/0006 (table is additive).

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

alter table public."shiftOverrides" enable row level security;

-- RLS stays default-deny: no policies. All access flows through the service
-- role via POST /api/backend/call, same as every other table.
