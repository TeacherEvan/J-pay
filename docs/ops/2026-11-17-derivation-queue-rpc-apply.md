# Production applies 2026-11-17 — audit remediation (`dlwlbvhyrvyftpjruqdq`)

Owner instruction (2026-11-17, verbatim): *"PROCEED FOLLOWING RECOMMENDATIONS"* — taken as the
authorisation for the two pending additive migrations below, and nothing else. The other MCP
project (`bgehvopytfaidlfprzlo`) is a different app and was never touched.

## 1. Migrations applied (via MCP `apply_migration`, one file at a time)

| Version | Name | Effect verified (all checks below ran 2026-11-17) |
|---|---|---|
| 0020 | `0020_logs_client_reported_time_index` | `logs_user_client_reported_time_idx` present on `public.logs ("userId","clientReportedTime")` (`pg_indexes`). Recorded as `0020` in `supabase_migrations.schema_migrations`. |
| 0021 | `0021_derivation_queue` | `has_function_privilege`: anon = false, authenticated = false, service_role = true. `derivation_queue` exists with RLS enabled; partial unique `derivation_queue_one_pending_per_user` (`WHERE status='pending'`); `derivation_queue_status_time_idx`. Function `jpay_commit_punch` SECURITY DEFINER with `search_path = public, pg_catalog`. Recorded as `0021`. |

**History hygiene:** both recorded with local numeric prefixes (not timestamps), matching the
0011–0018 convention. `supabase db push` was not used; no `archive/` file was applied.

**Rolled-back end-to-end probe** (full `BEGIN … ROLLBACK`): `jpay_commit_punch` inserted a punch
row for a real employee+site and a `derivation_queue` row (`pending`, attempts 0) — proof that
argument types, the advisory lock, the conflict arbiter and the enqueue all execute against the
live schema. `ROLLBACK` discarded everything; post-check `logs_selfcheck_rows = 0`,
`derivation_queue` count = 0. No production data was written or kept.

**Not applied:** `0019_users_is_qa` (owner drafts/applies — reserved slot), any `archive/` file.

## 2. What was intentionally NOT done

| Item | Why |
|---|---|
| Application redeploy / Vercel push | No push or commit was authorised. **Production still serves the pre-audit build** — neither the RPC (0021) nor the horizon pushdown (0020) is used by the running app until the owner deploys the working tree. Both migrations are additive and harmless to the old code. |
| `derivation-sweep` schedule | Creating a pg_cron/pg_net schedule is entangled with the F4 retention decision (owner). An external scheduler POSTing `?job=derivation-sweep` with the `CRON_SECRET` bearer works identically and requires no new extensions. Until a schedule exists, the sweeper is dormant; derivation continues on the unchanged inline path (scheduler retry + `derivation_failed` ledger). |
| F3 (`0019`, deactivating `@jpay.local` prod identities, phantom-shift close) | Owner-only tasks; not attempted. |
| F4 (retention: enable `pg_cron`+`pg_net` vs. document "retention not enforced") | Owner decision; not attempted. |
| `.agents/` / `.claude/` skills dedup, Moderator-vault refactor | Deliberately deferred (see `docs/plans/audit-2026-11-17-head-disposition.md`). |

## 3. State after this runbook

- Production schema: everything idempotent and additive; old app code unaffected.
- New code in the working tree (uncommitted): RPC-first punch path with legacy fallback,
  `derivation-sweep` internal handler + cron job entry (dormant until scheduled), structured
  payload guard on `/api/backend/call`, Serwist `/api/*` NetworkOnly prepended, shared
  punch-sync mutex, stale-query generation guard + regression tests.
- Gates: `npm test` 34/34, `npm run verify` 37/37 stages including schema parity, invoke gate
  (+`shifts:sweepDerivationQueue`), `tsc --noEmit`, function-refs check.
- To finish activation: owner commits/pushes the working tree (deploy) AND puts
  `derivation-sweep` on a schedule. Until then, the production crash-net is armed at the DB
  layer but has no scheduled driver — the pre-existing inline derivation path is the safety net.

## 4. Rollback notes (owner call, not automatic)

```sql
-- if 0021 must be withdrawn:
drop function if exists public.jpay_commit_punch(uuid, uuid, bigint, bigint, text, double precision, double precision, double precision, boolean, integer, text, text, boolean);
drop table if exists public.derivation_queue;
-- if 0020 must be withdrawn (derivation simply falls back to the _creationTime index):
drop index if exists public.logs_user_client_reported_time_idx;
```
Removing the deployed code path first is not required — the RPC is only called by the new
`convex/logs.ts` (RPC-first with legacy fallback); reverting the app to the previous build
makes 0021's objects simply unused.
