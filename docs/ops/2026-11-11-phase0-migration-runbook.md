# Phase 0 Runbook — Apply migrations (owner-executed, SQL-editor only)

**Date:** 2026-11-11 (updated 2026-11-11-11 — migration quarantine) · **Audience:** whoever runs Phase 0 from the plan (`plans/2026-11-11-implementation-plan.md`) · **Status of code:** all remediation commits are green build+test.

> This runbook is documentation, not authorization. No agent session executes these steps. Never use `supabase db push` — migration files are not named to match applied history and two of them (archived) would break production if applied mechanically.

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

`0002_logs_idempotency_unique.sql` → `0004_manager_role.sql` → `0005_manager_sites.sql` → `0006_travel_tracking.sql` → `0007_shift_overrides.sql` → `0009_organisations.sql` → `0010_travel_open_leg_unique.sql` → `0011_system_events.sql` → `0012_manager_sites_archive.sql` → `0013_rate_limit_buckets.sql` → `0014_registry_hardening.sql` → `0015_shifts_unique_user_started.sql`

**New drafts (2026-11-11, not yet applied):**

- `0016_rate_limit_fn_lockdown.sql` — locks `jpay_rate_limit_hit` to `service_role` (PUBLIC EXECUTE revoked; pinned `search_path`). Optional hardening; app runs without it via the 0013 grant.
- `0017_drop_duplicate_idem_index.sql` — drops redundant non-unique `logs_user_idem_idx`; guarded by a uniqueness pre-flight on `logs_user_idem_uniq`.

**Quarantined files — do NOT apply:**

- `archive/0003_retention_crons.OWNER_ONLY.sql` — retention crons. Requires pg_cron + pg_net enabled and hand-replaced `__SITE_URL__` / `__CRON_SECRET__`. The app runs fine without them. Only the owner, via SQL editor, after step 1 is done and verified. Never `db push`.
- `archive/0008_refresh_registry.DO_NOT_APPLY.sql` — dead. Superseded by `0011_system_events.sql` (whose registry union includes `organisations` + `systemEvents`). Applying 0008 on a 0011-era install silently drops both from the registry and breaks `ctx.db.get(<org/systemEvent id>)`. Kept for history only.
- `0001_init.sql` is the fresh-install baseline and is ALREADY applied in production (hand-run). Do not re-apply; see registry section of the audit report.

`0015_shifts_unique_user_started.sql` enforces a unique index on `shifts("userId","startedAt")` — its embedded pre-flight aborts with a readable error if duplicates exist; resolve by hand, then re-run.

Before `0002`: run the duplicate-logs diagnostic embedded in the file header (it prints offending rows). Any duplicates must be resolved by a human decision — do not let the unique index creation fail mid-session half-applied.

## 2. Post-apply verification (all must pass)

```sql
-- a. These must NOT exist as tables here — pg_cron is OPTIONAL; skip if you are not applying 0003.
--    select 'cron schema must be empty or owner-applied' as note;
-- b. New tables exist and RLS is enabled
select relname, relrowsecurity from pg_class
 where relname in ('organisations','travelSegments','shiftOverrides','managerSites','systemEvents','jpay_rate_limits');
-- c. id registry is current and HARDENED (after 0014)
select relname, relrowsecurity, reloptions from pg_class where relname = 'jpay_id_registry';
--   expect relrowsecurity = false (views cannot have RLS) AND reloptions containing security_invoker=on
-- d. Shared rate limiter live (0013)
select public.jpay_rate_limit_hit('verify:selftest', 60000, 1);
--   first call returns false (1 hit ≤ limit), second returns true (2 > 1). Pass p_limit=0 to force-block. Delete the test bucket afterwards:
--   delete from public.jpay_rate_limits where bucket = 'verify:selftest';
-- e. Registry is not publicly readable (after 0014): as anon,
--      GET https://<project-ref>.supabase.co/rest/v1/jpay_id_registry?select=id,tbl
--      → HTTP 200 with 0 rows (or 401/403) — NEVER 48 rows.
```

Then, against the deployed app: **`GET /api/health/db` must return `{ ok: true }`** with a real table count (probe lists `systemEvents` and `jpay_rate_limits` after the 2026-11-11-11 code change). A 503 lists exactly which table is missing.

## 3. Functional round-trip (one pass per role, ~15 min)

1. Employee: punch in → shift re-derives (check `shifts` row appears/updates).
2. Check-in card: travel-tracking chip visible after consent; revoke in-app → manager pin clears; leg flagged `consent_revoked`.
3. Moderator console: organisations list renders with site/user counts (exercises `listOrgs` + `by_org` indexes).
4. Manager console: crew visible on map for managed sites only; demote in-app → `managerSites` row archived, audit row written.
5. Moderator override: end-of-shift override on an unsealed shift → payroll re-derives, `needsReview` cleared.
6. `POST /api/backend/call` anonymous → 401/403 as appropriate; `GET` without smoke key in prod → 403.

## 4. Failure handling

- **`supabase db push`**: forbidden for this repo — migration names never matched applied history, and two archived files (`0003` / `0008`) would break production if applied mechanically. Apply files one at a time in the SQL editor.
- **Migration fails midway:** stop. Idempotent files can be re-run once the failing statement is fixed by a human. Never edit an applied migration in place — ship `0014_*.sql` (registry hardening) or a new `00NN_*.sql`.
- **`/api/health/db` 503 after apply:** re-check step 2(c) (`jpay_id_registry`); stale registry is the classic cause of PGRST 404s on new tables.
- **Derivation storm after deploy:** watch `systemEvents` (`kind = 'derivation_failed'`). Non-zero rows = do not proceed to wider rollout; capture the `detail` column.
- **Rollback:** there is no automatic down-migration by design. Worst case: restore the pre-flight backup. The app tolerates missing new tables only via `/api/health/db` detection — it does not self-heal.

## 5. Close-out

- Update `plans/2026-11-11-implementation-plan.md` Phase 0 rows to ✅ with evidence (counts/timestamps, no secrets).
- Re-run `@surgical-audit` on the deployed SHA; record the final `S_health`.
- Owner decision needed on `/privacy` (counsel) before any external rollout — see plan Phase 0.6.
