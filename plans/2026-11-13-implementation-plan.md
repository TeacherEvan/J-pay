# J-Pay — Implementation Plan (2026-11-13, post demo-removal re-audit)

| Metadata | Value |
| :--- | :--- |
| **Date** | 2026-11-13 |
| **Audit** | `docs/audits/surgical-audit-2026-11-13.md` (HEAD `c040da9`; re-verified at `5011169` — see the report's §7) `S_health = 72 / 100 — MODERATE`, `N_P0 = 0`, `N_P1 = 4`, `N_P2 = 12`, `N_P3 = 9` |
| **Scope** | The four P1s the audit found, then the P2/P3 structural debt. Ordered by what must be safe before the next payroll run. |
| **Ownership model** | Phase 1 = agent-executable code + owner-only DDL/ops steps. Phases 2–3 = agent sessions with gates after every phase. |
| **Honest status** | The demo-removal cycle (`c71f6f1`) was executed well and closed the last residue of the P0. The money path was **not** re-opened, and one previously-reported P1 (the check-in latch) was carried as "fixed" in the remediation plan without ever being fixed. |

> **Reading order is fixed:** Phase 1 → 2 → 3. Do not start Phase 2 until Phase 1 is green. Do not widen rollout or change the money path in production until Phase 1 ships and the owner has decided F4's route.

---

## Phase progress log (authoritative)

| Session | Date | Phase | Items | Result |
| :--- | :--- | :--- | :--- | :--- |
| — | 2026-11-13 | Audit | Full 10-lens re-audit of HEAD `c040da9`; executable probes for F1/F2/F3; live read-only verification of prod | ✅ report at `docs/audits/surgical-audit-2026-11-13.md`; `S_health = 72` |
| R2 | 2026-11-13 | Verify | Independent re-verification of every live claim + payroll fuzz + RLS/grant matrix + live negative controls. Found and corrected 4 errors in the audit (QA census 6→14, leaks 2→3, "0 rows"→4 QA shifts, P2-11 timing claim). Shipped **1.1 (F1)** and **1.2 (F3a)** with red→green tests. | ✅ 4 corrections recorded in audit §7; `npm run verify` green; `N_P1 = 2` (F2, F4) |

---

## 0. What this plan exists to fix

The 2026-11-11 cycle left four money/trust paths open or unre-examined after the demo removal:

1. **F1 (P1)** — the check-in button latches `busy=true` forever when device-token acquisition fails. Proven by a rendered-component probe: the employee cannot clock on, so the shift is never logged and never paid. The remediation plan listed this as Phase 0.5; the restructure was never applied.
2. **F2 (P1)** — the payroll panel's week window is built in the **browser's** timezone while the days are bucketed in the **site's**. A night-shift worker's first site-day falls out of the panel: **R1,350/week** measured. The prior "ISO-week aligned" fix closed only the browser-side half.
3. **F3 (P1)** — the QA-account filter's prefix list no longer matches the addresses the repo's own scripts create; **3 of 14 live production QA identities** (one of them a moderator) pass it into the moderator roster, KPI headcount and broadcast targets.
4. **F4 (P1)** — the documented 90-day retention job cannot run (`pg_cron`/`pg_net` absent, no Vercel Cron), while the privacy page promises raw route data is deleted after the retention window.

Nothing here invalidates prior work — the trust boundary, the deny-by-default gate, the org guards, the integer-cent payroll pipeline and the whole 24-stage gate suite are verified correct.

---

## Phase 1 — Containment (the four P1s)

| # | Step | Files | Proof | Owner |
| :--- | :--- | :--- | :--- | :--- |
| 1.1 | ✅ **F1 done** — `checkIn()` split into `runCheckIn()` (work) + `checkIn()` (guard, `busy`, single `finally`). The reset now lives at exactly one site, so no early return — including the device-token failure — can latch the button. | `src/app/check-in/live-submit.tsx` | `scripts/test-checkin-busy-latch.mjs` (real component, `issueMyDeviceToken` → `DEVICE_ALREADY_ACTIVE` then success): **red before** (`data-loading === true` after the failure), green after; also proves a second tap reaches `createLog` | Agent |
| 1.2 | ✅ **F3a done** — `isQaAccount` now treats `@jpay.local` as a reserved test-only domain (structural marker) and keeps the legacy local-part shapes for anything outside it. | `convex/access.ts` | `scripts/test-qa-account-filter.mjs` — **red before** on 10 shapes (`e2e-all-`, `e2e-test`, `qa.employee.`, bare `e2e`, uppercase), green after; 7 real addresses (incl. `e2ebusiness@` and `qatar.office@`) stay unfiltered | Agent |
| 1.3 | **F3b** — draft `supabase/migrations/0019_users_is_qa.sql`: add `users.isQa boolean`, backfill `email LIKE '%@jpay.local'`, RLS on, no grants. | new migration | **Owner applies** (SQL editor or MCP `apply_migration` under a fresh owner instruction; afterwards fix the recorded version to `0019`). Verify `select count(*) from public.users where "isQa"` | Owner |
| 1.4 | **F3c** — deactivate/archive the **14** live QA accounts **and** their `auth.users` identities (**2 are moderators**: `e2e.breakglass.tmp@jpay.local`, `e2e-test@jpay.local`), then close the **4 unsealed phantom shifts** the 2026-11-12 e2e run left (`endedAt IS NULL`, all four owned by `e2e.mwdu*` accounts). | prod DB | `select email, role from public.users where email like '%@jpay.local'` → 0 active rows; `select count(*) from public.shifts where "endedAt" is null` → 0; `auth.users` shows no QA identity | Owner |
| 1.5 | **F2** — server-side site-TZ window (audit R2): the client sends `fromDay`/`toDay`; the server widens to complete ISO weeks **in site time**, computes, then slices for display. Timezone = the shift's own, falling back to `jpayConfig.defaultTimezone` — never the employee's oldest assignment. | `convex/payroll.ts`, `src/app/payroll.tsx` | `scripts/test-payroll-window.mjs`: site `Africa/Johannesburg`, 7×540 min over `2026-11-09..15`, rate 100, `bcea` → `ordinary 2700 / overtime 540 / sunday 540 / pay 7650`, **and** panel == whole-week. **Red before** | Agent |
| 1.6 | **F4** — owner decision, two routes: **(a)** enable `pg_cron` + `pg_net`, apply the already-reviewed `archive/0003_retention_crons.OWNER_ONLY.sql` with the placeholders replaced by hand, set the same `CRON_SECRET` in Vercel env, verify `cron.job` shows 3 rows; **or (b)** change the privacy page and TRD §9 to state that retention is **not yet enforced** and remove the deletion promise. | prod dashboard, `src/app/privacy/page.tsx`, `j-pay.md` | (a) `select jobname, schedule from cron.job` → 3 rows, each dry-run returns 200; **or** (b) the privacy page no longer promises deletion and the TRD is marked "not enforced" | Owner |
| 1.7 | **F4b** — write the `purgeAudit` row the purge handler owes (the TRD promises it; the code omits it). | `convex/logs.ts`, `convex/travel.ts` | a purge batch writes one `purgeAudit` row (kind, count, cutoff) | Agent |

**Phase 1 exit:** `npm run verify` green (24/24) · MVTH-A/B/C green · no active `@jpay.local` account in prod · F4 resolved *either* by a scheduled job *or* by an honest privacy page.

**Score impact:** removing the four P1s takes `D_raw` from 77 → 45 → **`S ≈ 81` (MODERATE→LOW band)**. Phase 2 lifts it further.

---

## Phase 2 — Hardening & honesty (P2)

| # | Step | Files | Proof |
| :--- | :--- | :--- | :--- |
| 2.1 | **One cron registry.** `src/lib/cron-jobs.ts` becomes the single source of truth; `convex/crons.ts` (inert Convex `cronJobs()` API) is archived; the TRD names the mechanism that is actually deployed. | `src/lib/cron-jobs.ts`, `convex/crons.ts`, `j-pay.md` | `grep -rn "crons.cron" convex/` → 0; the docs name a real mechanism |
| 2.2 | **Push the derivation horizon into the index constraint** (mirror of the travel-window fix: `.filter()` is a post-wire JS predicate). | `convex/shifts.ts:56-60` | `scripts/test-db-adapter.mjs` gains a pushdown assertion — a `.filter()` form fails it |
| 2.3 | **`createLogAs`:** delete it, or wire it properly — moderator identity derived from `ctx.auth` (never an argument), device-token-shaped evidence per TRD §5.1, an attestation row payroll consumes, and it stays out of the client type surface until wired. | `convex/logs.ts`, `src/lib/backend/function-refs.ts` | `grep createLogAs` → definition only, **or** a test proves the attestation path end to end |
| 2.4 | **Type surface:** delete the `internal: any` export; make `useQuery` delegate to `useQueryResult` and require an error surface at every consumer (the two hooks today differ only in honesty). | `src/lib/backend/api.ts`, `src/lib/backend/react.ts`, consumers | `grep -rn "from .*backend/api" src/app | grep internal` → 0; every query consumer renders an error state |
| 2.5 | **Cron route hardening:** the secret comparison is **already** constant-time (`isSmokeKeyValid` → `timingSafeEqual`, verified 2026-11-13) — add only the shared-store limiter (reuse `rateLimitedShared`) if the owner wants flood control on a high-entropy bearer. | `src/app/api/internal/cron/route.ts` | unit test: wrong secret rejected; a flood is limited |
| 2.6 | **Single source of truth for the weekly caps:** fold `weeklyCapMinutes` into the strategies (it currently duplicates literals) and delete `formatDate`; wire or archive `setManagerSites`; write `purgeAudit` rows. | `src/lib/payroll-strategies.ts`, `src/lib/format.ts`, `convex/manager.ts` | the dead-export sweep drops by ≥6 true positives; each cap constant appears once |
| 2.7 | **P3 batch:** `module.registerHooks()` (kill the DEP0205 noise), remove the nonexistent `../auth.js` import from `convex/_generated/api.d.ts`, prune `public/sw.js` from the scanner, fix the docs drift (TRD R9/§9, `.env.example`, the ops runbook), remove the `as never` casts. | as listed | `npm run verify` + both consistency gates green; no doc claims a mechanism that is not deployed |
| 2.8 | **Revoke the over-broad grants.** Six tables grant full DML **including TRUNCATE** to `anon` and `authenticated` (`jpay_rate_limits`, `managerSites`, `organisations`, `shiftOverrides`, `systemEvents`, `travelSegments`). RLS with zero policies saves it today; one future policy turns it into an incident, and TRUNCATE is not mediated by RLS. Revoke all, then grant per policy. | new migration (owner-applied) | `information_schema.role_table_grants` shows no `anon`/`authenticated` row for those tables |

**Phase 2 exit:** `S ≥ 85`; the registry is authoritative; the money path has one clock and one cap source.

---

## Phase 3 — Verify, re-audit, close

1. **Fresh-clone dress rehearsal:** `npm ci && npm run verify && npm run build` — every stage executes and passes (the artifact test needs `public/sw.js`).
2. **Production round-trips (one per role):** employee punch → derived shift → payroll agrees with the engine → **the panel shows all seven site days of the week**; moderator roster shows no QA account; a broadcast reaches no QA account; the retention job runs (if route (a)).
3. **Deploy verification:** a `200` from `/api/health/db` is not proof — confirm the deployed bundle is the audited commit (hash the served entry bundle; compare against the local build), and check the served `/demo` still 404s and the headers are present.
4. **Re-audit** with the same skill; expect `S ≥ 85`, `N_P0 = 0`, `N_P1 = 0`. Record the score in this file and in `j-pay.md` §11.
5. **Decide the fate of the unwired surfaces** (`createLogAs`, `setManagerSites`) — fix or delete; do not leave them as unwired code paths on `main`.

---

## Explicitly out of scope / do not touch

- The single-door `/api/backend/call` architecture, the `isPublic !== true` gate, the dedupe / min-`_creationTime` rule, write-set invalidation, archive-not-delete, and the Serwist offline path.
- **No `supabase db push`, ever**; no migration applied by an agent without a fresh, explicit owner instruction in that session.
- No push to `main` without an explicit owner ask (it *is* the deploy path).
- The demo-removal commit `c71f6f1` and migration `0018` — applied, verified, correct.
- `S_health` is not a launch verdict; the privacy/retention honesty question (F4b/1.6) stands until the owner rules.

---

## Suggested session breakdown

| Session | Scope | Exit gate |
| :--- | :--- | :--- |
| S1 | Phase 1.1 + 1.2 (F1, F3a) with MVTH-A and MVTH-C | both tests red→green; `npm run verify` green |
| S2 | Phase 1.5 (F2) with MVTH-B | straddling week shows all site days; OT minutes restored |
| S3 | Owner session: 1.3, 1.4, 1.6 (migrations, QA cleanup, retention route) | `isQa` live; 0 active QA accounts; `cron.job` verified **or** privacy page corrected |
| S4 | Phase 2.1–2.4 (registry, horizon pushdown, attestation, type surface) | fresh-clone verify green; `createLogAs` fixed or gone |
| S5 | Phase 2.5–2.7 (cron route, single cap source, P3 batch) | verify green; dead-export sweep drops; docs name real mechanisms |
| S6 | Phase 3 | re-audit ≥ 85, `N_P1 = 0` |
