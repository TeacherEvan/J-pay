-- 0022_pay_periods.sql — statutory pay-period locking schema and contract (DRAFT, owner applies)
--
-- Statutory accounting cut-off / audit trail requirement (SARS BCEA / LPA):
-- Once a pay period is marked 'locked' or 'paid', punches, shifts, and overrides
-- within that ISO week must not be silently mutated.
--
-- Apply ORDER: after 0021. Purely additive. Idempotent (re-running is a no-op).
-- Do NOT run via `supabase db push` — SQL editor or MCP apply_migration only.
--
-- pay_periods is Postgres INFRASTRUCTURE, not app data: no TRD §6 table, no Convex schema
-- entry, not in jpay_id_registry; it joins the schema-parity gate's INFRA_TABLES allowlist.

create table if not exists public.pay_periods (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organisations(id),
  iso_week          text not null,
  status            text not null default 'open' check (status in ('open', 'locked', 'paid')),
  locked_at         timestamptz,
  locked_by         uuid references public.users(id),
  snapshot_checksum text,
  created_at        timestamptz not null default now(),
  unique (org_id, iso_week)
);

create index if not exists pay_periods_org_iso_week_idx
  on public.pay_periods (org_id, iso_week);

alter table public.pay_periods enable row level security;

-- Default deny RLS: no public/anon access
revoke all on table public.pay_periods from public, anon, authenticated;
grant all on table public.pay_periods to service_role;

notify pgrst, 'reload schema';
