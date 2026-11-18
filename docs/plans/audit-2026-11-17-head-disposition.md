# Audit 2026-11-17 — per-finding disposition at current HEAD

Source: `docs/plans/Audit following best practices.txt` (922 lines, two halves pasted
together — v1 "Vibe-Debt Risk: High" and v2 "Critical"; self-scores drift 72 → 68 → 62).
This file is the **authoritative disposition ledger**: it annotates the audit against HEAD
instead of re-scoring. Nothing here authorises new architecture — owner gates in
`plans/2026-11-13-implementation-plan.md` still apply (0019 reserved for `users_is_qa`).

## Concurrency & offline (P0 v1 §3 / v2 §6 / v1 Refactor 2 / v2 Prompt 1)

| Finding | Disposition |
|---|---|
| Outbox replay vs live check-in race (`use-outbox.ts` vs `live-submit.tsx`) | **Fixed.** Shared promise-chain mutex `src/lib/punch-sync.ts` (`withPunchSyncLock`) wraps both paths. Test `scripts/test-punch-sync-lock.mjs` (gate stage added). |
| Slow in-flight query overwrites post-mutation state (`react.ts`) | **Fixed.** `useQuery`/`useQueryResult` capture `genAtStart = version`; on resolve, `version !== genAtStart` discards the payload and re-issues (nonce). Regression test `scripts/test-query-generation-guard.mjs` + worker (gate stage added). Note: this uses the existing monotonic `version`/`bump()` epoch, which already serves exactly the "mutation epoch" role the audit proposes — no parallel counter introduced. |
| Stale React cache after mutation (in-flight dedup gen) | Already correct before this session (`inFlightQueries[].gen === version` check); kept, covered by `test-react-adapter-dedup`. |
| Atomic punch+shift PostgreSQL RPC (`0019_atomic_punch_rpc.sql`) | **Applied to production 2026-11-17 (migration 0021) + wired; sweeper scheduling pending owner action.** The audit's blueprint (upsert one shift row) does not match this codebase — shifts are rebuilt from the log horizon by `deriveForUser`, idempotent upsert-in-place, so there is no single shift row to lock. The landed shape is the outbox pattern in Postgres instead: `jpay_commit_punch()` (advisory xact lock per user → idempotent log insert → coalesced `derivation_queue` enqueue in ONE transaction), and a cron sweeper `shifts:sweepDerivationQueue` (`POST /api/internal/cron?job=derivation-sweep`) that re-drives `deriveForUser` for pending rows older than 2 s and parks them `failed` (attempts ≥ 5, `systemEvents` row) — the re-drive that survives a hard crash, which the inline scheduler retry cannot. `createLog` calls the RPC first; on ANY RPC failure it falls back to the legacy two-phase insert (both paths idempotent via `logs_user_idem_uniq`). Sweeper is dormant until a schedule POSTs the job; returns `{ skipped: true }` if the queue table is ever absent. Files: `supabase/migrations/0021_derivation_queue.sql`, `src/lib/backend/db.ts` (`Database.rpc` + RPC_WRITES telemetry), `convex/logs.ts`, `convex/shifts.ts`, `src/lib/cron-jobs.ts`, `scripts/test-derivation-queue.mjs`, `scripts/test-punch-rpc-fallback.mjs` (handler-level RPC/fallback contract), gate stages added. `function-refs.ts` regenerated. |
| Cross-Midnight / ISO-week payroll boundary | **Already mitigated** — `iso-week.ts` site-timezone ISO ranges + F2 fix; suite passes. |

## Multi-tenant isolation (P0 v1 §5 / v1 §1 / v2 Blueprint 1 / v2 Prompt 2)

| Finding | Disposition |
|---|---|
| Mandatory composite `(id, org_id)` enforcement in `db.ts` | **Declined.** Would break tenant-global tables (`organisations`, `systemEvents`, `jpay_rate_limits`) and shadows the tested per-handler org guards. Cross-org direct-ID handling is enforced in handlers and verified by `test-org-isolation.mjs` lines 217–237 (`resolveShift`/`setHourlyOverride`/`recomputeEmployeeShifts` → `FORBIDDEN`). If the owner wants defense-in-depth at the adapter layer, that is a spec, not a patch. |
| Direct-ID mutation fuzzing across moderator/shifts mutations | Partially present (above) — see same file. A full matrix is possible but adds test-only code with no new information; reopen on owner request. |
| Rate-limit bucket bypass via proxy headers (`session-bootstrap`, cron) | **Fixed.** `clientIp()` prefers `x-real-ip`, else rightmost `X-Forwarded-For`, scheme-prefixed buckets; shared-store limiter on `/api/internal/cron` (10/min/job via `jpay_rate_limit_hit`, in-memory fallback, 429) with `scripts/test-cron-rate-limit.mjs`. `session-bootstrap` already had the shared limiter (5/h/IP master) — only the IP parsing needed the fix. Tested. |

## Security / trust boundary (P0 v1 §5 / v2 §3 / P1 v1 §7 / v1 §11)

| Finding | Disposition |
|---|---|
| Untyped JSON payload deserialization → 22P02 / cast crashes | **Fixed.** `src/lib/backend/payload-guard.ts` rejects NaN/Infinity, depth > 12, strings > 10 000 chars, arrays > 10 000, > 1 000 keys/object, `__proto__`/`constructor`/`prototype` keys, non-plain objects; 256 KB content-length cap before `request.json()`; ref and args both checked. Test `scripts/test-payload-guard.mjs` (gate stage added). |
| Service worker caches authenticated API GETs (Serwist `defaultCache` NetworkFirst, 24h) | **Fixed.** `/api/*` `NetworkOnly()` matcher prepended before `...defaultCache` in `src/app/sw.ts`; rule verified first in built `public/sw.js`. |
| CSV formula injection (`csv.ts`) | **Already mitigated** — `sanitizeCell` prefixes `= + - @ \t \r` (also `\n`-prefixed) with `'`; quoted-escape correct. `test-csv.mjs` covers the exact vectors the audit lists. |
| smoke-key bypass | **Already mitigated** — `timingSafeEqual`, fail-closed in production (403 either way). |
| Clock-skew in geofence/travel verification | **Already mitigated** — `server-clock.ts` calibration from `Date` header (safelisted) + `travel-window.ts` skew correction; negative tests in `server-clock` suite. |
| 150 m GPS accuracy clamp / 45 m/s velocity ceiling | **Declined** — contradicts TRD hard cap (50 m + moderator override) and TRD §7 velocity semantics; needs owner sign-off. |

## Financial / statutory (v2 §2 / v2 Prompt 3)

| Finding | Disposition |
|---|---|
| Floating-point payroll math | **Already mitigated** — `payroll-strategies.ts` uses exact rational arithmetic → integer cents, half-away-from-zero on the true rational (P2-B10). |
| Double-entry payroll ledger, pay-run locks, retroactive-rate mutation | **Owner spec required.** Test exists? No — and building the ledger is a migration + process change (who locks, who reopens, jurisdiction differences). Not a drive-by. The audit's proposed `0019_payroll_ledger_and_locks.sql` also collides with the reserved 0019 slot (`users_is_qa` is 0019). |
| Exact-rational minute allocation for 45h cap | Already minutes-integer; covered by payroll rounding suite. |

## Repository / DX (P2/P3)

| Finding | Disposition |
|---|---|
| `.agents/skills` vs `.claude/skills` duplication | **Verified:** byte-identical except `.agents` carries one extra (`supabase-server`); ~800 KB total. Tooling surface, not a production risk. Leaving deletion/symlink to the owner. |
| Custom ESM loaders / in-memory PostgREST stubs mask SQL semantics | Accepted design trade-off; schema parity gate (TRD §6 ↔ schema.ts ↔ migrations ↔ INDEX_FIELDS ↔ registry view) is the cross-check. Not replacing the stub with a live DB in unit tests. |
| Migration numbering gaps (0003/0008 archived) | **Declined as "fix"** — gap is historical; renaming applied migrations breaks recorded history. |
| Moderator drawer God-component / 18 sub-views | Not attempted; performance/UX refactor, out of audit-fix scope. |

## Status snapshot

- `npm test` → 33/33 PASS; `npm run verify` → ALL 37 STAGES PASS (incl. new payload-guard, query-generation-guard, migration-0021 invariant stages, function-refs check, tsc, schema parity).
- Production build (`next build --webpack`) green; `public/sw.js` confirmed carrying the `/api/*` NetworkOnly rule ahead of `defaultCache`.
- Migrations **0020** (logs clientReportedTime index) and **0021** (atomic punch commit + derivation queue) were **applied to production (`dlwlbvhyrvyftpjruqdq`) on 2026-11-17 via MCP `apply_migration`** under owner instruction, recorded as `0020`/`0021` in `supabase_migrations.schema_migrations`. 0021 self-check passed: anon/authenticated EXECUTE revoked, service_role EXECUTE yes, partial unique index present, RLS on, rolled-back end-to-end probe inserted a punch + queued derivation (queue row visible pre-rollback; 0 rows after). 0019 reserved for `users_is_qa` (owner).
- **The app is not yet deployed with the new code** — committing/pushing was not authorized, so production still runs the pre-audit build (0021's RPC is simply unused until the next deploy; it is additive and harmless either way).
- Remaining owner step: schedule `derivation-sweep` (pg_cron/pg_net is an owner decision — or an external scheduler POSTing `?job=derivation-sweep` with the `CRON_SECRET` bearer). Until then the sweeper is dormant; the inline derivation path (with retry + `derivation_failed` ledger) is unchanged.
- Untracked/modified files are **not committed**. No push.
