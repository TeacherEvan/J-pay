# J-Pay — Remediation Plan (2026-11-11, post full-board audit)

| Metadata | Value |
| :--- | :--- |
| **Date** | 2026-11-11 |
| **Audit** | `docs/audits/surgical-audit-2026-11-11-full.md` (HEAD `6182072` + uncommitted manager work; **S_health ≈ 45 / 100 — HIGH**, `N_P0 = 1`, `N_P1 = 7`, `N_P2 = 30`, `N_P3 = 24`) |
| **Scope** | Everything the audit found, ordered by what must be safe before the next payroll run and before any wider rollout. |
| **Ownership model** | Phase 0 = agent + owner (migration apply is owner-only). Phases 1–3 = agent sessions with gates after every phase. |
| **Honest status** | The in-flight manager feature was written without an audit and without a UI consumer. It is **not production-safe**. This plan fixes it **before** wiring it — or deletes it. |

> **Reading order is fixed:** Phase 0 → Phase 1 → Phase 2 → Phase 3. Do not start Phase 1 until Phase 0's P0 is closed and re-probed. Do not widen rollout, change the money path, or enable demo admits in any production deployment until Phase 1 is green.

---

## Phase progress log (authoritative)

| Session | Date | Phase | Items | Result |
| :--- | :--- | :--- | :--- | :--- |
| S1 | 2026-11-11 | Phase 0 (0.1–0.4 partial, 0.5–0.6 partial) | Registry hardening migration `0014` drafted (owner applies); `0003`/`0008` quarantined to `archive/`; README/TRD/runbook updated; build gate = `npm run verify && next build --webpack`; build-artefact test skips (not fails) when `sw.js` absent; `/api/health/db` probes `systemEvents` + `jpay_rate_limits` | ✅ agent-side; **owner must apply 0014** |
| S2 | 2026-11-11 | Phase 1 | 1.1 clock-skew split (client Date-header calibration); 1.2 ISO-week payroll selector (option d); 1.3–1.4 fail-closed org guards (manager.ts, sites.ts, 5 new harness cases); 1.5 money/destructive-action error surfaces (payroll panel, messages panel); 1.6 PAYROLL_STRATEGY/RATE validation; 1.7 deferred (window still viewer-anchored; server-side window deferred) | ✅ committed `ed2d9a1` |
| S5 | 2026-11-11 | Pre-push adversarial review of the S4 batch (owner authorised push; review first) | **MAJOR found and fixed:** the S4 travel-window horizon was written as a `.filter()` predicate — the adapter evaluates `.filter()` in JS AFTER the rows cross the wire (`src/lib/backend/db.ts`), so the 'bounded' read was actually the user's entire log history, while the pre-S4 code had a SQL `LIMIT 5`. The in-code comment claiming a PostgREST pushdown was FALSE. Fixed: the horizon is now an INDEX range constraint (`q.eq("userId", …).gte("_creationTime", …)`) → pushed as SQL WHERE and served by `logs_user_time_idx`; selection stays by work time. Guards: `scripts/test-travel-window-bounds.mjs` (new gate stage, fails on the pre-fix form) + adapter pushdown assertions in `test-db-adapter.mjs`. **Money disclosure:** the new integer-cent pipeline rounds each earning component separately, the old one rounded each line's component SUM once — measured over 3.24 M single-day + 1.5 M weekly cases: max divergence R0.01/line, R0.04/week; the new path never paid LESS in the swept set; old float totals could show artifacts (575.6999999999999). Now documented in TRD §6.2 rule 4. **TRD drift fixed:** §7 still described the old previous-fix lookup (5 newest by insertion order) → rewritten; TRD §6.2 Payroll Money Rules added; consistency gate M1 updated to the new lookup spec (still fails when the spec is removed — verified). Also verified: F17 anchor messages fail readably on a mutated copy (no traceback); D3 `refToKey` = `module:fn` (no collisions); D4 anchor = `deriveSegments` open segment (lunch keeps the segment open → elapsed includes the break, consistent with payroll); B14 pairing marks consumed `in`s; B11 tie-break by `_id` | ✅ verify 24/24 + build green |
| S4 | 2026-11-11 | Phase 2 residuals (parallel agents, reviewed) | B8 lunch-clamp needsReview flag; B10 exact BigInt-cent rounding (`test-payroll-rounding.mjs`, gate stage); B11 ms-tie `_id` tie-break; B12 `sideMissionDurationMinutes` in dupe detector; B13 work-time travel window (48h PostgREST-pushdown horizon, `src/lib/travel-window.ts`); B14 punch `in` consumed-at-most-once (`src/lib/punch-pairing.ts`); D3 stable mutation/action identity; D4 ShiftTimer open-segment anchor via deriveSegments; D10 ticking manager clock; D20 export guard; P3-D20 revoke-timer cleanup; D25 midnight re-anchor; D16 `useFocusTrap` extraction + onClose ref; D17 ForcedPasswordChange reuses FocusTrapModal; D18 aria-controls active-tab only; P3-D22 44px iOS dismiss; D24 stale-stealable outbox flush lock; F17 consistency-gate anchor messages; F11/F16 drafted as `0016`/`0017` (owner-apply); fresh-clone dress rehearsal green on HEAD | ✅ commits d17981a…e42ec35, verify 23 stages + build green |
| S3 | 2026-11-11 | Phase 2 (partial) | 2.1 `deploy_prod.py` retired → `scripts/archive/`; new `docs/ops/deploy.md`; 2.2 four-way field-level parity gate (all 4 audit mutations M1/M2/M7/TRD-drift now exit 1; TRD §6 + ERD synced to schema reality — punches, demoSessions, payStrategy/locale et al.); 2.3 gate runner `scripts/run-gate.mjs` (all stages run; `npm test` = 18 stages, no `&&` abort), Playwright suite + orphan re-implementation suites archived/deleted, strict `db-stub` (range/order/sort/unique `_id`); 2.4 done in S1 (health probe); 2.5 security headers (CSP-Report-Only + frame-ancestors 'none' + XFO DENY + nosniff + Referrer-Policy + geolocation); 2.7 `deriveForUser` upsert-in-place + `0015_shifts_unique_user_started.sql` (owner-apply, guarded pre-flight) + `test-derivation-idempotent.mjs`; 2.10 env-example to live set, `generate-jwt-keys.mjs` deleted, bootstrap consolidation, `.gitignore .env*` override removed, `engines.node>=20`, inert `allowScripts` removed; UI batch: D12 (non-blocking `swRegistration` race + 4s timeout), D13 (static noise tile), D19 (guarded storage, `safe-storage.ts`), D23; **D2 applied to money/message/review paths via new `useQueryResult` + shared `<QueryError>`** | ✅ committed; **2.6 pending owner decision (see below)** |

**Still outstanding for rollout decisions:** 1.7 (server-side site-TZ window), **2.6 — the manager feature `attestShift`/`crewTimesheets` is unapproved and must be fixed or deleted before any push to `main`** (it is unwired in the UI; its verdict has no consumer; it was committed in `ed2d9a1` merged with the audit fixes; `function-refs.ts` still carries your uncommitted +2 type refs). Phase 2 residuals: D3 (Proxy identity churn), D4 (shift-timer anchor), D5 (site-TZ threading), D10 (live travel timer), P2-B8 (flat lunch deduction clamps at 0, unflagged), P2-B10..B14, P2-D16..D25 leftovers, P2-F11 (`jpay_rate_limit_hit` PUBLIC EXECUTE), P2-B9 (UK WTR straight-time policy — **owner decision + cited source**), D15/**privacy policy (DRAFT linked from consent gate — launch blocker)**. Phase 3 (fresh-clone dress rehearsal + re-audit) partially done (scratch tree runs all stages; full rehearsal pending). The **owner-apply of `0014` and `0015`**, the push/deploy, and the privacy-policy blocker remain owner-only.

> **Commits ahead of origin:** audit/plans (e6f4c1d, 94fafe5) + Phase 0 (harness test fix etc.) and Phase 1 (`ed2d9a1`) are local. **Nothing has been pushed; pushing to `main` deploys via Vercel Git integration.** `src/lib/backend/function-refs.ts` remains the owner's uncommitted in-flight file.

## 0. What changed and why this plan exists

Prior cycles fixed the broken pieces and scored the **delta**. This audit scored the **whole tree** and found that the new layer — manager authorization, org scoping, and the payroll window — is where the dangerous defects now live:

1. **A live unauthenticated data exposure** that survived three full audits (`jpay_id_registry`, P0-F1).
2. **The new org guards fail open** exactly in the default configuration (every moderator provisioned post-0009) — and the promotion inheritance path never checks the org at all (C1/C2).
3. **The payroll maths under-pays statutory overtime** on 6 of 7 window anchors (B1), and a merely slow device clock silently zeroes shifts (B2).
4. **The documented install path and the local test gate are broken in ways that hide security failures** (F2 `db push`, F5 no build gate, E1 the `&&`-chain abort).
5. **The uncommitted manager feature** (`attestShift`/`crewTimesheets`) is unwired, unscoped-by-default, and records a verdict nothing consumes.

None of this invalidates prior work — the trust-boundary gate, dedupe, write-set invalidation, outbox, and Leaflet work all verified correct this cycle and are **do not touch** territory.

---

## Phase 0 — Containment (ship before anything else)

| # | Step | Owner | Proof |
| :--- | :--- | :--- | :--- |
| 0.1 | **Close P0-F1:** create `0014_registry_hardening.sql` (see audit R1 — `revoke all` on the view; `security_invoker = on`; drop `anon/authenticated` default privileges; `notify pgrst`). Owner applies via SQL editor. **Never via `db push`** (see 0.4). | Owner + agent drafts | anon REST `GET …/rest/v1/jpay_id_registry` → **0 rows**; Supabase advisor returns no `security_definer_view` ERROR; `docs/ops/` records applied version |
| 0.2 | **Regression test for 0.1** — assert in `npm test` (or `test:smoke`) that: (a) no view in `public` has `anon` SELECT/USAGE grant, (b) `reloptions` includes `security_invoker=on` for every view, (c) `pg_default_acl` carries no `anon` for tables/sequences/functions | Agent | Test red on pre-0014 snapshot, green after apply |
| 0.3 | **Make the build the gate (F5):** `package.json` → `"build": "npm run verify && next build --webpack"`. Do NOT add a `prebuild` that duplicates this. Verify `npm run verify` reaches `tsc --noEmit` on a fresh clone (no `public/sw.js`) | Agent | Fresh-clone `npm ci && npm run verify` → **all stages execute**, exit 0; Vercel build fails on any test failure |
| 0.4 | **Quarantine the two destructive migration files** (must land before any operator could run them): move `0008_refresh_registry.sql` → `supabase/migrations/archive/` (header: `DO NOT APPLY — superseded by 0011`); parameterise `0003_retention_crons.sql` (`__SITE_URL__` → `current_setting('app.cron_url')` or rename `.OWNER_ONLY.sql`); fix `docs/ops/2026-11-11-phase0-migration-runbook.md` ordering + "expect 4 rows" line; state in `README.md` that migrations are owner-applied SQL, **never** `db push` | Agent | Grep shows no file that breaks production if applied; runbook matches applied reality |
| 0.5 | **P1-D1 (bricked check-in):** single-`try` restructure (R3) + guarded `localStorage` + `DEVICE_ALREADY_ACTIVE` message branch; regression test with `localStorage.setItem` mocked to throw → button returns to operational | Agent | Test red pre-fix, green post; `data-loading=false` asserted |
| 0.6 | Record `0014` as **not** auto-applied by CI — deployment docs updated; `AGENTS.md` unchanged | Agent | docs commit |

**Phase 0 exit:** `npm run verify` green on a fresh clone; the anon-registry probe closed; the quarantined migrations cannot hurt anyone; the bricked-button path is fixed; **the manager feature is NOT wired** (it is fixed in Phase 1).

---

## Phase 1 — Money & Tenancy Correctness (before the next payroll run)

| # | Step | Files | Proof |
| :--- | :--- | :--- | :--- |
| 1.1 | **P1-B2 — split device-offset from offline-replay** (audit R4): measure `deviceSkewMs = now - clientReportedTime` on **live** punches (`now - queuedAt ≤ LIVE_TOLERANCE_MS`); persist per device; `replayMs = now - queuedAt`; `isOfflineReplay = replayMs > REPLAY_REVIEW_MS`. Rewrite the two tests that encode the defect (`test-shift-engine.mjs:291-299`, `:237-249`). **MVTH-C failing-first.** | `src/lib/shift-engine.ts:44-68`, `convex/logs.ts:83` | Slow-clock test red pre-fix; a device 6 min slow no longer flags; genuine replays still flagged |
| 1.2 | **P1-B1 — ISO-week-safe payroll window**: in `convex/payroll.ts:28-34`, widen the shift query to complete ISO weeks touching the requested window; compute on the widened set; slice back for display. Alternatively align the panel period selector to Mon–Sun weeks (choose with owner — cheaper). Add invariant: `ordinaryMinutesPerWeek ≤ 2700` per ISO week + hard throw on `INCOMPLETE_WEEK`. **MVTH-B failing-first** (`{2026-11-05..2026-11-11}` day set → 540 OT minutes) | `convex/payroll.ts:28-34,36-68`, `src/app/payroll.tsx:34-52` | Test red pre-fix; BCEA 6-of-7 window anchors all yield identical weekly OT |
| 1.3 | **P1-C1 — org guard in `promoteToManager` site inheritance**: skip inherited sites whose `orgId` ≠ target's org (audit §R3 context, audit C1 fix). Add **site-boundary org guards** in `assignEmployee`/`setEmployeeSites` (defense-in-depth — the missing guard is what C1 exploits). **MVTH-D failing-first** | `convex/manager.ts:420-435`, `convex/sites.ts:102-183` | Test red pre-fix; org-A employee assigned to org-B site can no longer be promoted into org-B management scope |
| 1.4 | **P1-C2 — fail-closed org guards**: `(manager.orgId ?? null) !== (site.orgId ?? null) → throw`; same for actor/target. Fix the `test-manager-authz.mjs` fixture gap — the default moderator has **no** `orgId`; add that case and assert refusal. Note cross-org false-positive (org-scoped actor + unscoped target) and choose deliberate behaviour | `convex/manager.ts:317-319,379-382`, `scripts/test-manager-authz.mjs` | Fixture asserts `CROSS_ORG_PROMOTION_FORBIDDEN` on the default-moderator path |
| 1.5 | **P2-D14 / P2-D8 — make money and destructive mutations loud**: `setPayStrategy`, `recomputeEmployeeShifts`, `resolveShift` and moderator `sendToModerators`/`Broadcast`/`Reply` wrapped in `try/catch` + `errMsg(e)` + per-row busy state; optimistic UI never displays an unsaved strategy | `src/app/payroll.tsx`, `src/app/messages.tsx` | Fault-injected refetch is visible in UI; no silent divergence between displayed and stored strategy |
| 1.6 | **P2-B4/B5 — boot-time config validation**: unknown `PAYROLL_STRATEGY` throws `INVALID_PAYROLL_STRATEGY`; `PAYROLL_DEFAULT_RATE` missing/0/negative throws `RATE_NOT_CONFIGURED` (every strategy); assert in `scripts/smoke-supabase.mjs` | `convex/payroll.ts`, `scripts/smoke-supabase.mjs` | Smoke gates fail loudly on misconfig |
| 1.7 | **P2-B6/B7 — server-side window and timezone fallback**: accept `fromDay`/`toDay` strings + site timezone, compute UTC bounds server-side; fallback = `jpayConfig.defaultTimezone`, never the "oldest assignment"; widen scope for multi-timezone forks | `convex/payroll.ts:36-68`, `payroll.tsx` | Window/timezone cross-matrix unit test |

**Phase 1 exit:** fresh `npm run verify` green; payroll run for a straddling window matches ISO-week computation exactly; the cross-org promotion path is closed and proven by a previously-red test; slow devices stop being zeroed.

**Score impact after Phase 0+1:** removes ~74 `D_raw` (F1, P1s, E1/F5 partially) → **S ≈ 64** (HIGH) — treat as the floor, not the goal.

---

## Phase 2 — Gate Honesty & Deploy Integrity (before widening rollout)

| # | Step | Proof |
| :--- | :--- | :--- |
| 2.1 | **Retire `scripts/deploy_prod.py`** — archive or delete (no live references; dead Convex leg; `.env`/`.env.local` staging copy; hard-coded master project). Note in `docs/ops/deploy.md`: real path = push→Vercel Git; `/api/health/db` is the post-deploy probe; the health probe must be checked before declaring a deploy good | grep shows zero references; `git log --follow` shows retirement commit |
| 2.2 | **P2-F4 — rebuild schema-parity as field-level 4-way gate** (`~80 LOC`): parse `j-pay.md §6` ∪ `convex/schema.ts` ∪ **all** migrations ∪ `INDEX_FIELDS`; bidirectional; `INFRA_TABLES` allowlist for `jpay_rate_limits`; fix doc overclaims (`j-pay.md:28-30`, ADR-004 Consequences, `docs/index.md:3`); **mutation suite** (the 3 mutations that passed today must now fail) | The 3 mutation experiments from audit R2 now exit 1 |
| 2.3 | **E1–E3 — gate runner rebuilt:** aggregate all stages (no `&&` abort); `test-next-build-artifacts` → `test:build` or skip-if-absent; Playwright either wired into `verify` or deleted (**76 dead tests**); rewrite the 4 orphan suites to import shipped code (`travel-engine` 50 vs shipped 200 km/h!); fix `db-stub.mjs` (range ops, `order()`, unique keys, call counters); enforce archive-not-delete in `test-manager-authz`; derive `test-invoke-gate`'s internalcensus from the registry | Fresh clone: every suite runs; `npm test` output lists all 16 stages |
| 2.4 | **Health probe completion (F9):** add `systemEvents` + `jpay_rate_limits` to `REQUIRED_TABLES`; return real `pg_class` count; keep 503-with-names behaviour | Probe on a broken-schema staging deploy returns 503 listing the exact missing tables |
| 2.5 | **Security headers (F8):** `headers()` in `next.config.ts` — CSP `default-src 'self'; …` (start **Report-Only**, enumerate Leaflet/Supabase/Serwist sources), `frame-ancestors 'none'`, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self)` | Headers present live; moderator console `X-Frame-Options: DENY` |
| 2.6 | **The manager feature — fix or delete** (C3 row-type discriminator `tableOf()`→`tbl==='shifts'`; C4 state preconditions `SHIFT_NOT_CLOSED`/`PAYROLL_SEALED`/`SHIFT_ALREADY_ATTESTED` or supersede; C5 hoist ledger read + `["kind","at"]` index migration; C6 wire attestation through `reviewResolutions` **or** reframe as advisory + no UI claims; C7 enforce/surface demotion orphans; C8 attestation history) | C3–C8 tests green; a manager cannot attest a non-shift row; `crewTimesheets` cost is O(1) per row |
| 2.7 | **P2-B3 — shift derivation idempotent:** `unique index (…)` on `shifts("userId","startedAt")` in a new migration (`0015_*.sql`, owner-apply); replace delete+insert with upsert; serialize derivations per user (`pg_advisory_xact_lock(hashtext(user_id))`); concurrency test through the harness | Concurrent derivations produce exactly one row |
| 2.8 | **UI honesty batch:** D2 (`useQueryResult` error surface + every consumer shows real error/retry), D3 (stable namespace caching), D4 (shift-start anchor), D5 (site-TZ window/labels + `format.ts` `timeZone` param), D10 (live clock for open legs), D12 (`getRegistration()`), D13 (static noise texture or drop `canvas-dithered`), D19 (guarded localStorage reads), D23 (paginator inputs memoized) | New component tests + manual smoke on a seeded dev instance |
| 2.9 | **P2-D14/B10-adjacent:** exclude (decide) the UK straight-time "overtime" label/rate question — needs owner decision + cited source, not a code edit | Policy decision recorded in docs |
| 2.10 | **Docs & env truth:** rewrite `.env.example` to the live set (drop `NEXT_PUBLIC_CONVEX_URL`/`JWT_PRIVATE_KEY`/`CONVEX_DEPLOY_KEY`; add `CRON_SECRET`, `SMOKE_TEST_KEY`, `DEMO_MODE`, `PAYROLL_STRATEGY`); delete `generate-jwt-keys.mjs`; reconcile `.gitignore` `.env*`; add `"engines": {"node": ">=20"}`; `legal` privacy policy decision (owner+counsel) — until published, the consent gate must not link to a self-described DRAFT | Doc-truth table from audit F-Truth shows 0 contradictions |

**Phase 2 exit:** any failing test fails the Vercel build; `supabase db push` can no longer damage production; the manager feature is either honest or gone.

**Score impact:** closes the bulk of P2 → **S ≥ 80** with Phase 0+1 held.

---

## Phase 3 — Verify, Re-Audit, Close

1. **Re-probe everything from the audit:** anon registry → 0 rows; health/db → ok:true with real counts; deny-by-default 404 sweep (34 internal handlers); privacy state (counsel or noindex).
2. **Fresh-clone dress rehearsal:** `npm ci && npm run verify && npm run build` — confirm every gate executes and passes; deploy preview; probe `/api/health/db` on the preview.
3. **Production round-trips** (one per role): employee punch → derived shift → payroll calculator agrees with the engine's view; consent revoke → travel legs close with `consent_revoked`; moderator console loads; manager map lists crew (no cross-org sites).
4. **Re-audit** with the same skill; expect **S ≥ 85, N_P0 = 0, N_P1 = 0**. Record the score in `plans/2026-11-11-remediation-plan.md` and `j-pay.md` §11.
5. **Decide the fate of the in-flight manager work** (fix-unwired in 2.6, or revert) — do not leave it as a unwired code path on `main`.

---

## Explicitly out of scope / do not touch

- The single-door `/api/backend/call` architecture, the `isPublic !== true` gate, the dedupe/min-`_creationTime` rule, write-set invalidation, `TRD §6` as the contract, archive-not-delete, and the Serwist/offline path implementation.
- **No `db push`, ever**, and no auto-apply of migrations from any session.
- No push to `main` without explicit owner ask (it *is* the deploy path).
- The demo feature stays code-gated (`DEMO_MODE` off in prod) and may never default-on.
- UK payroll policy stays as-is until the owner rules on straight-time (2.9).
- `S_health` is not a launch verdict; the privacy-policy blocker stands until counsel publishes.

## Suggested session breakdown

| Session | Scope | Exit gate |
| :--- | :--- | :--- |
| S1 | Phase 0.1–0.4 + docs commit | fresh-clone verify green; anon registry 0 rows |
| S2 | Phase 0.5 + Phase 1.1–1.2 | core-hours money tests red→green |
| S3 | Phase 1.3–1.7 | cross-org tests red→green; verify green |
| S4 | Phase 2.1–2.3 | fresh-clone run lists all suites |
| S5 | Phase 2.4–2.7 | build gate fails on any test failure; manager feature honest |
| S6 | Phase 2.8–2.10 | full UI smoke; doc-truth clean |
| S7 | Phase 3 | re-audit ≥85 |
