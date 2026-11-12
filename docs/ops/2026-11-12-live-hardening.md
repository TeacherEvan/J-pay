# Live hardening runbook — 2026-11-12 (production `dlwlbvhyrvyftpjruqdq`)

Owner instruction (2026-11-12): *"if disabling is best practices then proceed. No data on
the live server is important, if wiping everything so implementation can proceed then do
so. But DO NOT let current existing data added by users STAGNATE OR SUPPRESS INNOVATION."*

This file records what was executed against the production project, how it was
verified, and what was deliberately **not** done. Read it before touching production
again — the previous state (what was deleted, what was kept) is only recorded here.

## 0. Scope and method

| | |
|---|---|
| Project | `dlwlbvhyrvyftpjruqdq` (`jpay-supabase` MCP). The other MCP project (`bgehvopytfaidlfprzlo`) is a **different** app and was never touched. |
| Authority | Owner instruction, 2026-11-12 (see above). Explicit for: disable the integration if best practice, wipe the live data, apply what implementation needs. |
| Method | Supabase MCP (`apply_migration` / `execute_sql`) + PostgREST with the service-role key for bulk deletes. **No `supabase db push`** (still forbidden). |
| Backup | `/tmp/opencode/jpay-backup-2026-11-12/` — all 17 public tables + `auth.users` as JSON, mode 600, **outside the repo** (contains PII + credential hashes). Local machine only; not uploaded anywhere. |
| Pre-flight | DB health checked first: 9 backends, **no** long-running queries, **no** ungranted locks, 12 MB, blks_hit ≈ 99.9 %. The "DatabaseTimeout" behind the failing Supabase Preview check was therefore **platform-side, not ours**. |

## 1. Migrations applied (previously blocked on the owner)

Applied with `apply_migration`, so each one is **recorded in the remote migration
history** under its local file name (the SQL editor does not record history):

| Version | Name | Effect verified |
|---|---|---|
| 20261112144450 | `0014_registry_hardening` | `revoke all on public.jpay_id_registry from anon, authenticated`; `security_invoker = on`; `alter default privileges` (tables/sequences/functions) revoked from anon+authenticated → no future object inherits the browser grants. |
| 20261112144455 | `0015_shifts_unique_user_started` | Unique index `shifts_user_started_unique` on `("userId","startedAt")` present and `indisunique = true`; its embedded duplicate pre-flight ran against the (now empty) shifts table. |
| 20261112144501 | `0016_rate_limit_fn_lockdown` | `jpay_rate_limit_hit` ACL is now `{postgres=X/postgres,service_role=X/postgres}` — PUBLIC/anon/authenticated EXECUTE gone; `search_path = public, pg_catalog` pinned. |
| 20261112144521 | `0017_drop_duplicate_idem_index` | `logs_user_idem_idx` dropped; `logs_user_idem_uniq` (unique) kept — the dedupe path still has its constraint. |

All four are idempotent and guarded by pre-flight checks, so a re-run is a no-op.

## 2. The P0 is closed (evidence, anon = publishable key)

| Probe | Before | After |
|---|---|---|
| `GET /rest/v1/jpay_id_registry?select=id,tbl` | **59 rows** (uids + table names) | `42501 permission denied for view jpay_id_registry` |
| `GET /rest/v1/{logs,shifts,users,sites}` | RLS deny | `42501` (unchanged) |
| `POST /rest/v1/rpc/jpay_rate_limit_hit` | callable by anon | `42501 permission denied for function` |

Service-role path unaffected (this is what the app uses):
`GET /rest/v1/jpay_id_registry` → rows ✓ (the adapter's uuid→table resolution in
`db.get()` depends on it) · `POST /rest/v1/rpc/jpay_rate_limit_hit` → `false` ✓ ·
live `GET /api/health/db` → `{"ok":true,"tables":18}` ✓.

## 3. Data wipe — what was removed, what was kept

**Removed** (all event/working data — test residue from the audit, the e2e suite and
manual poking; nothing here is payroll truth, since `logs` are the source of truth and
the derived `shifts` cache is rebuildable):

`logs`, `shifts`, `punches`, `travelSegments`, `messages`, `shiftOverrides`,
`reviewResolutions`, `purgeAudit`, `pushSubscriptions`, `demoSessions`, `systemEvents`,
`jpay_rate_limits` → **0 rows each**.

**Churn removed** (this is the "don't let existing data stagnate" half):
* 7 **orphaned organisations** (`PiTBULL`, `ADT`, `Brinant`, `SpringClean`, `DirtyLaundry`,
  `Fortress finding`, `Sandé`) — 0 users, 0 sites each, in a **single-org** deployment
  (ADR-004 fork model). They only added cross-org noise to the org-scoped queries and
  the fail-closed org guards. Only `Default organisation` (the org all 6 users belong to)
  survives.
* the `Test` site (1150 m geofence) and its 2 assignments — the other 2 sites (`Moms`,
  `mUNIKLANI`) are the real ones.
* 4 **QA auth accounts** `qa.employee.*@jpay.local` — e2e-suite leftovers with known
  credentials and **no** `public.users` row. Anyone could have signed in as them.

**Kept on purpose** (nobody is stranded, the app stays usable):
6 `public.users` rows + 6 `auth.users` identities (2 moderators, 2 managers, 2 archived
employees — all 6 map 1:1, all still able to sign in), 1 organisation, 2 sites,
4 user↔site assignments, 2 manager↔site assignments.

Net effect: **no user loses access**, all working data is gone, and the schema is free
of churn that would constrain the org-scoped design.

## 4. Rollback

The backup at `/tmp/opencode/jpay-backup-2026-11-12/` can restore any deleted table
(PostgREST `POST` of the JSON rows). The four migrations are reversible by hand
(re-grant on the view, drop `shifts_user_started_unique`, re-grant EXECUTE on
`jpay_rate_limit_hit`, re-create `logs_user_idem_idx`) — none of them destroys data.

## 5. The Supabase Preview check

Last failure (commit `6a2337b`): `failed to read project config: unexpected status 544:
DatabaseTimeout — The connection to the database timed out`. That is a **Supabase
platform** error, not migration drift — the project's own DB was healthy throughout.

After the migrations above were applied, the check failed again with a *real* reason:
`Remote migration versions not found in local migrations directory.` Cause: the Supabase
integration resolves each **remote** `schema_migrations` row against a **local** file by
the version prefix in the filename. Our files use `0004_manager_role.sql` (version
`0004`), while the rows recorded by `apply_migration` carried Supabase's timestamps
(`20261110145415`) and, for the four older ones, names without the numeric prefix.

### 5.1 Reconciliation (2026-11-12) — the check is green and meaningful again

`supabase_migrations.schema_migrations` was rewritten to the repo's own naming
convention (one transaction):

| Remote version (before) | Remote name (before) | → version | → name |
|---|---|---|---|
| 20261110145415 | `manager_role` | `0004` | `0004_manager_role` |
| 20261110145423 | `manager_sites` | `0005` | `0005_manager_sites` |
| 20261110145432 | `travel_tracking` | `0006` | `0006_travel_tracking` |
| 20261110145440 | `shift_overrides` | `0007` | `0007_shift_overrides` |
| 20261111054742 … 20261112144521 | `0002…`, `0009…` – `0017…` | same numeric prefix | same name |
| *(missing)* | *(never recorded — applied by hand)* | `0001` | `0001_init` |

After this, **every local migration file resolves to a recorded remote version, and
every remote version resolves to a local file** — there is nothing left for the
integration to "push", which also removes the standing footgun of `0001_init.sql`
(the fresh-install baseline) being treated as pending on production.

Two side benefits that also fell out of the check being satisfied: the integration
does **not** read `supabase/migrations/archive/` (the `0003` / `0008` owner-only files
stayed invisible — confirmed by the check reporting no pending migrations), and the
preview branch remains a genuine "does our migration set still apply to a fresh DB"
rehearsal — the one thing we cannot do locally.

### 5.2 Required follow-up after every MCP apply

`apply_migration` records a **timestamp** version, which would re-introduce the drift
above. After applying a migration that way, run one statement to restore the
convention (the local numeric prefix):

```sql
update supabase_migrations.schema_migrations
   set version = '00NN', name = '00NN_name'
 where name = '00NN_name';
```

### 5.3 If the check ever needs to go away

The GitHub App cannot be disconnected with a user token (GitHub requires an App token
for installation management), and no Supabase MCP tool exposes the integration
settings. The remaining route is the Supabase dashboard → Project Settings →
Integrations → GitHub → remove this repository (or disable preview branches). Until
then, **the gate of record is `npm run verify` + the live `/api/health/db` probe**
(`docs/ops/deploy.md`), not this check.

## 6. Residuals after this work (advisors, 2026-11-12)

* `auth_leaked_password_protection [WARN]` — **leaked-password protection is OFF** for the project's
  Auth service. It is an Auth-service flag (no `auth.*` GUC, no `auth.config` row), so it is **not**
  reachable from SQL, the CLI or the MCP — it is one checkbox in the Supabase dashboard:
  *Authentication → Sign In / Providers → "Enable leaked password protection"*. Worth turning on:
  it rejects a password that appears in a public breach at sign-up/password-change.
* `rls_enabled_no_policy [INFO] x17` — **by design**. The browser roles have no policies on purpose:
  deny-by-default RLS, with the service role as the only data door (`POST /api/backend/call`).
  The `security_definer_view` lint that flagged `jpay_id_registry` is **gone** — that was the P0.
* `unindexed_foreign_keys [INFO] x10` and `unused_index [INFO] x12` — informational on tables this
  small; would only matter at real volume. Not addressed here (each needs a migration + owner apply).
