# Phase 0 Runbook — Apply migrations 0002–0013 & verify (owner-executed)

**Date:** 2026-11-11 · **Audience:** whoever runs Phase 0 from the plan (`plans/2026-11-11-implementation-plan.md`) · **Status of code:** all remediation commits (`967ed92`…`244106c`) are green build+test on pristine exports.

> This runbook is documentation, not authorization. Apply migrations on a **backup or restored dump first**, then production. No agent session should execute these steps.

## 0. Pre-flight (5 min)

```bash
# 1. Snapshot (Supabase SQL editor or psql). Do NOT skip.
#    (Supabase Dashboard → Database → Backups → create, or pg_dump.)
# 2. Confirm current state — none of these exist yet in a 2026-11-10-era database:
select table_name from information_schema.tables
 where table_schema = 'public'
   and table_name in ('organisations','travelSegments','shiftOverrides','managerSites','systemEvents','jpay_rate_limits')
 order by 1;
# Expected: 0 rows (skip rows for tables that already exist — apply is idempotent).
```

## 1. Apply in numeric order

`0002_logs_idempotency_unique.sql` → `0003_retention_crons.sql` → `0004` → `0005` → `0006` → `0007` → `0008_refresh_registry.sql` → `0009_organisations.sql` → `0010_travel_open_leg_unique.sql` → `0011_system_events.sql` → `0012_manager_sites_archive.sql` → `0013_rate_limit_buckets.sql`

Before `0002`: run the duplicate-logs diagnostic embedded in the file header (it prints offending rows). Any duplicates must be resolved by a human decision — do not let the unique index creation fail mid-session half-applied.

## 2. Post-apply verification (all must pass)

```sql
-- a. pg_cron jobs registered by 0003
select jobname, schedule from cron.job order by 1;            -- expect 4 rows
-- b. New tables exist and RLS is enabled
select relname, relrowsecurity from pg_class
 where relname in ('organisations','travelSegments','shiftOverrides','managerSites','systemEvents','jpay_rate_limits');
-- c. id registry is current (0008)
select count(*) from jpay_id_registry;
-- d. Shared rate limiter live (0013)
select public.jpay_rate_limit_hit('verify:selftest', 60000, 1);  -- true once, false on second call? No —
--   first call returns false (hits=1, not > limit=1? limit=1 means 1 allowed → second returns true). Pass p_limit=0 to force-block.
```

Then, against the deployed app: **`GET /api/health/db` must return `{ ok: true }`** (probe added in `41a52c6`). A 503 lists exactly which table is missing.

## 3. Functional round-trip (one pass per role, ~15 min)

1. Employee: punch in → shift re-derives (check `shifts` row appears/updates).
2. Check-in card: travel-tracking chip visible after consent; revoke in-app → manager pin clears; leg flagged `consent_revoked`.
3. Moderator console: organisations list renders with site/user counts (exercises `listOrgs` + `by_org` indexes).
4. Manager console: crew visible on map for managed sites only; demote in-app → `managerSites` row archived, audit row written.
5. Moderator override: end-of-shift override on an unsealed shift → payroll re-derives, `needsReview` cleared.
6. `POST /api/backend/call` anonymous → 401/403 as appropriate; `GET` without smoke key in prod → 403.

## 4. Failure handling

- **Migration fails midway:** stop. Idempotent files can be re-run once the failing statement is fixed by a human. Never edit an applied migration in place — ship `0014_*.sql`.
- **`/api/health/db` 503 after apply:** re-check step 2(c) (`jpay_id_registry`); stale registry is the classic cause of PGRST 404s on new tables.
- **Derivation storm after deploy:** watch `systemEvents` (`kind = 'derivation_failed'`). Non-zero rows = do not proceed to wider rollout; capture the `detail` column.
- **Rollback:** there is no automatic down-migration by design. Worst case: restore the pre-flight backup. The app tolerates missing new tables only via `/api/health/db` detection — it does not self-heal.

## 5. Close-out

- Update `plans/2026-11-11-implementation-plan.md` Phase 0 rows to ✅ with evidence (counts/timestamps, no secrets).
- Re-run `@surgical-audit` on the deployed SHA; record the final `S_health`.
- Owner decision needed on `/privacy` (counsel) before any external rollout — see plan Phase 0.6.
