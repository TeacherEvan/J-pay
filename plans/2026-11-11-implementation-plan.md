# J-Pay — Implementation Plan (2026-11-11, post-remediation re-audit)

| Metadata | Value |
| :--- | :--- |
| **Date** | 2026-11-11 |
| **Audit** | `docs/audits/surgical-audit-2026-11-11.md` (HEAD `4aebd6b`, clean tree, `npm run verify` PASS) |
| **Prior plan** | `plans/2026-11-10-implementation-plan.md` — **executed ~85%**: B1–B10 (except residual), U1–U14, C1, C2, C4–C8 landed; **C3 (serwist advisories) NOT resolved**, **P2-5 (invalidation maps) never landed** |
| **Score** | `S_health ≈ 78 / 100` — MODERATE; `N_P0 = 0`, `N_P1 = 2` |
| **What this is** | The residual work order. Most of the previous plan is done; what remains is operational honesty + two correctness residuals. |

> **Reading order:** Phase 0 first — nothing in Phases 1–3 is verifiable until migrations are applied and `/api/health/db` is green on the target environment.

> **Correction (second pass, 2026-11-11):** the claim that the 2026-11-10 plan was "~95% executed" was wrong. Verified in-tree during the re-check: (a) **C3 is not done** — `npm audit --omit=dev` still reports **6 vulnerabilities (2 moderate, 4 high)** in the `@serwist/*` → `glob`/`minimatch`/`zod` chain; `d601d76` bumped other packages but the serwist chain remains and requires the breaking `@serwist/next@8.4.4` move or an override; (b) **P2-5 (invalidation maps) was never fixed** — `src/lib/backend/react.ts:56` (`MUTATION_TABLE_MAP`) and `:123` (`QUERY_TABLE_MAP`) are still the hand-maintained source of truth for refetch invalidation; the server-reported write-set replacement never landed. (c) Mutation-test basis is weaker than quoted: only **4 of 36** test files carry any negative/boundary signal (`toThrow`/`not.toBe`/`toBeNull`/`NaN`/`invalid`).

---

## 0. Phase 0 — Owner/ops (blocking; cannot be done from an agent session)

| Step | Action | Proof |
| :--- | :--- | :--- |
| 0.1 | Backup, then apply `0002`→`0012` **in numeric order** (now includes `0008` registry refresh, `0009` organisations, `0010` open-leg unique, `0011` system_events, `0012` manager_sites archive) | `\d public.organisations` exists; `select jobname from cron.job;` → 4 rows; parity gate green |
| 0.2 | After 0.1: `GET /api/health/db` on the deploy → `{ ok: true }` listing all probed tables | 200 with all-present; 503 names missing ones |
| 0.3 | Verify the **incremental** path on a throwaway copy of the prod dump (or staging): apply only `0008`–`0012` on a DB that already has `0001`–`0007`; confirm no PGRST 404 on `organisations`/`systemEvents` lookups | smoke `scripts/smoke-supabase.mjs` green; id lookups succeed |
| 0.4 | Set/confirm env: `CRON_SECRET`, `SMOKE_TEST_KEY`, `DEMO_MODE` decision, VAPID | prod responses match policy (403/200 as intended) |
| 0.5 | **Privacy policy (launch gate):** `/privacy` still serves the DRAFT placeholder linked from the GPS consent gate. Publish counsel-reviewed policy (POPIA/GDPR) before any external rollout | page no longer says DRAFT |

## 1. Phase 1 — Correctness residuals (backend, one commit series)

1. **Close B1 for real — window loop, not oversize.** Replace the `limit*2+50` window in `src/lib/backend/db.ts` (`run()`, residual-filter branch) with the fetch-until-exhausted loop from Refactor R1 in the audit report (window ≥ max(2×limit, 100), `range()` paging, slice to `limit`). Add MVTH#1 (150 matching / 120 rejected / `take(60)` → 60 older rows). Regression test must fail pre-fix — verify by reverting the loop and watching it go red.
2. **MVTH#2 — prove `systemEvents` fires.** Force `deriveForUser` to throw in the harness; assert closed shift flagged `derivation_failed` + exactly one ledger row. If it doesn't fire, fix `503afa1`'s path — do not weaken the test.
3. **MVTH#3 — `listOrgs` counts.** Two orgs + archived site/user; assert counts exclude archived.

## 2. Phase 2 — Hardening (P2)

4. **Rate limiting with teeth — DONE (2fd7f0b).** Move the `session-bootstrap` bucket to a shared store (Postgres atomic upsert with window counter, or Vercel KV/Upstash). Keep the in-memory path as a fallback when the store is unreachable; document which is active in the route. Test: two simulated "instances" (two Map stores) still trip the shared cap.
5. **`listOrgs` without full-table collects — DONE (2fd7f0b, indexed by_org).** — SQL view `org_counts` or `rpc`; JS fallback retained. Include `EXPLAIN` before/after in the commit message.
6. **`paginate()` — RESOLVED: deleted (grep-verified absent from db.ts).** No callers exist; either implement keyset on `_creationTime` or delete the method. Recommend delete.
7. **Unrun gates reality check.** Nightly e2e lane exists (`175475f`) but self-skips without CI secrets. Owner: seed secrets or accept and document; do not leave zombie workflows.
8. **C3 (reopened) — RESOLVED (2fd7f0b): overrides; npm audit --omit=dev = 0; build verified.** resolve the `@serwist/*` advisory chain — either the breaking `@serwist/next@8.4.4` bump (build + smoke verify) or a scoped `overrides` for `glob`/`minimatch`/`zod` with rationale in the commit message. `npm audit --omit=dev` must print 0 (or the remainder explicitly documented as unfixable-without-major-bump).
9. **P2-5 (reopened) — RESOLVED (accb9eb): server-reported write-set/read-set; maps deleted; test-write-set.mjs wired.** replace `MUTATION_TABLE_MAP`/`QUERY_TABLE_MAP` with server-reported write-sets from `/api/backend/call`; delete both maps; add the refetch regression test.

## 3. Phase 3 — Verify, re-audit, close

8. Apply 0.1–0.5 on staging/prod; run one full role round-trip each (employee punch → re-derived shift; moderator console loads org tree; manager map shows crew; revoke consent in-app → pin clears + leg flagged `consent_revoked`).
9. **Re-audit** (`@surgical-audit`) at close: expected `S_health ≥ 85`, `N_P1 = 0`. Update `plans/2026-11-10-implementation-plan.md` score note and mark residual items done or explicitly deferred.
10. **Explicitly deferred (do not silently expand scope):** `convex/demo/index.ts` demo-module size (env-gated; revisit if demo becomes public); root PNG housekeeping C6 remainder; `.agents` vs `.claude` reconciliation (owner call).

## 4. Do-not-touch

- Do not re-open ADR-004, the `isPublic !== true` gate, the shift engine, or the outbox architecture.
- Do not apply migrations from an agent session; Phase 0 is the owner's.
- No push without explicit owner ask.

## 5. Suggested session breakdown

| Session | Scope | Exit gate |
| :--- | :--- | :--- |
| S1 (owner) | Phase 0 checklist | health probe green |
| S2 | Phase 1 (items 1–3) | MVTH red→green; `npm run verify` |
| S3 | Phase 2 (items 4–9) | shared-bucket test green; EXPLAIN posted; `npm audit --omit=dev` clean or documented; maps deleted |
| S4 | Phase 3 (items 8–10) | re-audit `S_health ≥ 85` |

---

## Phase 0 execution record (2026-11-11, owner-authorized)

Applied to production Supabase project `dlwlbvhyrvyftpjruqdq` (ref; name "J-pay") by the owner-authorized agent session, in order: `0002` (unique index; pre-checked duplicate-free, 16 logs), `0009` (**+ inline `jpay_id_registry` drop/rebuild — the existing view had `id` uuid, blocking `create or replace`; repo file updated to match**), `0010`, `0011`, `0012`, `0013`. `0008` was **not applied** — superseded by 0011's superset union (header warning added to the repo file). `0003` (retention crons) **not applied** — needs `pg_cron` + `pg_net` enabled by the owner and a canonical site URL + `CRON_SECRET`; until then the four retention jobs do not run.

Post-apply verification: `organisations`/`systemEvents`/`jpay_rate_limits` present with RLS on; backfill created 1 default org linked to 6 users / 3 sites; `logs_user_idem_uniq` + `travel_segments_one_open` indexes present; `jpay_rate_limit_hit` self-test first-call `false`, second-call `true` (limit=1) and test bucket deleted; registry view reports 48 rows.

**Deploy:** Vercel Git integration is live — pushes to `main` deploy automatically. `37ac344` deployed 2026-11-11T05:44:29Z, state `success` (GitHub deployment record `7702790027`, environment Production). Live verification on `https://j-pay.vercel.app`: `/api/health/db` → `{"ok":true,"tables":16}`; anonymous POST `users_queries:me` → `{"result":null,"tables":[],"reads":[]}` (safe null, no data); anonymous POST `logs:createLogAs` → `UNKNOWN_FUNCTION` (deny-by-default holds); `GET /api/backend/call` → 403 (smoke-key fail-closed); unknown function → 404.

**Still open:** (1) `0003` + CRON_SECRET + cron dry-run; (2) `/privacy` counsel policy; (3) `npm ci` on a networked machine; (4) authed post-deploy round-trip (punch → re-derive; consent revoke → `consent_revoked`) needs moderator/employee credentials; (5) deliberate `DEMO_MODE` audit of the production env.
