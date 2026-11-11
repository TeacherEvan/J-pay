# Surgical Audit Report: J-Pay — Full-Board Audit (uncommitted manager-feature cycle)

| Audit Metadata | Specification |
| :--- | :--- |
| **Audit Date** | 2026-11-11 |
| **Audited Scope** | `src/`, `convex/`, `supabase/migrations/`, `scripts/`, `tests/`, `.github/`, config, docs — **148 files scanned, 15,348 effective LOC** |
| **Tech Stack & Runtime** | Next.js 16.3.3 (`--webpack`) · React 19 · Supabase (Postgres+Auth) authoritative backend via `src/lib/backend/*` adapter executing the `convex/*.ts` bodies in Node (no Convex deployment — ADR-004) · Serwist PWA · TypeScript 5.9 strict · Leaflet |
| **Audited Commit / Tree** | `6182072` (`main`) **with uncommitted in-flight changes**: `convex/manager.ts` (+219: `crewTimesheets`, `attestShift`, cross-org guards, site inheritance on promotion, mid-shift promotion lock, orphan-site detection), `scripts/test-manager-authz.mjs` (+141), `src/lib/backend/function-refs.ts` (+2). These had **never been audited** before this cycle. |
| **Pre/Post Audit SHA-256** | `a3faae9aa90e1172` (pruned copy; unchanged mid-audit → **VERIFIED ZERO MUTATION**; the 3 dirty files are pre-existing and were not touched by the audit) |
| **Verification** | Scratch-tree `npm test` → **exit 0** (2 pre-build artefact failures excluded — pre-build ordering, not a regression) · `npx tsc --noEmit` → clean · `check_consistency.py` → PASS · `check_diagrams.py` → PASS · `gen-function-refs.mjs --check` → up to date · `npm audit --omit=dev` → **0 vulnerabilities** · live production probes (health/db, anonymous API calls, privacy page, registry REST) |
| **Deterministic Health Score** | **`~45 / 100`** (`D_raw = 188`, `P_test = 7.4` @ `M_kill = 51%`, `N_P0 = 1`, `N_P1 = 7`, `N_P2 = 30`, `N_P3 = 24`, `LOC_eff = 15,348`)
| **Vibe-Debt Risk Level** | **HIGH** (`40 ≤ S < 65` band, and `N_P0 = 1`)
| **Score sensitivity** | Honest regrading moves the number by ±8: regrade F1 P0→P1 → S≈55; remediate Phase 0+1 (F1/P1s gone, `D_raw` −74) → **S≈64**; remediate Phase 2 as well → **S≥80**. The score describes today's tree, not the fixes' trajectory. |
| **Method** | 5 parallel principal-engineer deep-audit batches (money engine, trust boundary, frontend, test suite, ops/migrations/deploy) + preflight telemetry + dead-export sweep + live read-only probes against production (`j-pay.vercel.app`) and the production Postgres (read-only). **Batch A (backend adapter) did not complete** (tooling usage limit) — its scope was covered in-tree instead (see Lens 1/2/6). Findings below were **spot-verified in-tree by this audit** wherever they change deployment or payroll semantics; where a defect rests on reproduced runtime behaviour it is marked accordingly. |

> **Correction to prior 2026-11-11 audits' framing.** Earlier reports scored `S_health ≈ 78` (`244106c`) and `≈ 87` (`6182072`) on *delta* review. This pass scored the **whole tree**, including newly-in-flight code and the org-guard layer those passes did not probe. The score dropped because the failures found are in the **new** layer and in previously-underevaluated money math — not because prior fixes regressed. All prior verified-correct items remain verified correct (see §Verified-Correct).

---

## 1. Executive Architecture & Vibe-Debt Triage

The trust boundary (`/api/backend/call` + `isPublic !== true` deny-by-default) is **structurally sound** — an exhaustive 146-handler sweep confirms all 34 internal handlers refuse the browser path, and the production deny-by-default holds live. But the new manager-authorization layer written *since* the last audit bypasses its own org guard in the default configuration, and **the Supabase registry view is anonymously readable through one HTTP GET** — a leak that survived every prior full audit. The money path has two independently-executed defects that both make payroll wrong in ways no gate catches: statutory overtime is silently erased when the payroll window straddles an ISO week, and a merely slow device clock flags **every** punch as an offline replay so the shift never pays. None of this is caught by `npm test` (see §3 — the suite's `M_kill` is 51% and the trust-boundary gates abort before running on a fresh clone).

| Severity Tier | Count | Deduction | Primary Failure Domains |
| :--- | :--- | :--- | :--- |
| **P0 — Critical** | **1** | −18 | `jpay_id_registry` anon-readable (view, no RLS, full grants) via publishable key (F1) |
| **P1 — High** | **7** | −56 | BCEA partial-week OT erasure (B1) · offline-replay false-flag R0-pay (B2) · cross-org site inheritance on promotion (C1) · org guards disabled when `orgId` absent (C2) · check-in button permanently bricked on token failure (D1) · `supabase db push` path is destructive (F2) · **no automated gate between merge and prod** (F5) |
| **P2 — Medium** | **30** | −90 | See §2 — payroll hardening, attestation verdict orphans, adapter paging/window, test-suite integrity, deploy/schema-doc truth, UI correctness |
| **P3 — Low** | **24** | −24 | UK WTR straight-time, fractional-cent rounding, unwired manager UI, PWA/DX remnants, unenforced db-stub invariants |

**P2 census (all independently verified with coordinates):** A1 `_creationTime`-only paging tiebreaker · B3 `deriveForUser` non-transactional delete+insert, no unique index · B4 `PAYROLL_STRATEGY` cast→silent flat fallback · B5 rate=0/missing `RATE_NOT_CONFIGURED` (clustered with B4) · B6 payroll window anchored to viewer midnight vs site-TZ bucketing · B7 timezone fallback = oldest assignment · B8 flat lunch deduction clamps at 0, unflagged · B10 `roundCents` −R0.01 on exact half-cent products · C3 `attestShift` row-type confusion · C4 no state preconditions / replayable · C5 quadratic ledger collect · C6 attestation unconsumed · C7 orphan demotion detect-only · C8 history invisible · D2 `useQuery` loading-failure collapse · D3 Proxy identity churn → GPS watch + outbox interval re-registration · D4 shift timer anchors to last event not shift start · D5 site-TZ bucket vs browser-TZ window/labels · D8 messages panel discards failures, no tap-guard · D9 geocode out-of-order overwrite · D10 manager "in transit" leg frozen 0 min · D12 SW-ready hang kills notifications · D13 full-viewport `feTurbulence` · D14 money mutations silently discardable · D15 privacy DRAFT linked as legal promise · E1 `npm test` `&&`-chain abort (fresh-clone build-artefact failure silently skips 15 suites incl. invoke-gate/authz) · E2 four orphaned inline-reimplementation test files (incl. stale 50 km/h threshold) + Playwright's 76 tests never execute · E3 db-stub fidelity: range ops filtered-out, `order()` no-op, no uniqueness → range/order/replay/archive-not-delete unenforced · F3 `deploy_prod.py` stale duplicate (dead Convex leg, stages `.env*`, hard-coded master project) · F4 schema-parity gate 4 gaps (3/3 mutations pass) · F8 security headers absent (CSP / X-Frame-Options / Permissions-Policy) — moderator console clickjackable · F9 `/api/health/db` probe missing `systemEvents`, `jpay_rate_limits` — green probe hides a broken deploy

**P3 census:** B9 UK WTR straight-time policy (decision, cited source required) · B11 override selection ties on millisecond `_creationTime` · B12 duplicate-conflict detector ignores `sideMissionDurationMinutes` · B13 impossible-travel detection reads 5 newest *inserts* not 5 newest *work-times* · B14 punch ≤out pairing re-uses consumed `in` · D16 `FocusTrapModal` stale `onClose` closure · D17 `ForcedPasswordChange` no focus trap · D18 inactive tabs' `aria-controls` dangle · D19 unguarded `localStorage` read blanks page · D20 CSV export no guard · D22 iOS dismiss target ≈28px · D23 `usePagination` fresh array literal each render · D24 module-global outbox flush lock · D25 render-time "now" goes stale across midnight · F11 `jpay_rate_limit_hit` PUBLIC EXECUTE + mutable search_path · F13 `.env.example` documents removed Convex runtime · F14 `.gitignore` `.env*` re-ignores `.env.example` · F15 `allowScripts` is not an npm key · F16 `logs_user_idem_idx` duplicates the unique index · F17 `check_consistency.py` crashes on anchor drift · F18 rsync-failure staging leak detail · F19 `generate-jwt-keys.mjs` undeclared `jose` · F20 two competing bootstrap scripts · F21 no `engines` field.

### High-Risk File Telemetry Hotspots
| File Path | Eff. LOC | CC / Depth | Silent Catches | Primary Vibe-Debt Signature |
| :--- | :--- | :--- | :--- | :--- |
| `convex/demo/index.ts` | 677 | low / 4 | 0 | Env-gated demo god-module (9 trigger sites) — soundly scoped |
| `convex/manager.ts` | 535 (in-flight 640) | ~12 / 4 | 1 (attestation JSON) | Airtight logic **except org guards off by default** (P2-C2/P1-C1) · no UI consumer · untested date windows |
| `src/lib/backend/db.ts` | 447 | 33 / 5 | 0 | Residual-filter window loop (fixed) — but offset paging has no `_id` tiebreaker; `.collect()` full scans remain |
| `convex/travel.ts` | 404 | ~12 / 4 | 0 | Money-adjacent GPS; offline-replay flags consume payroll — B2 makes this dangerous |
| `src/app/payroll.tsx` | 223 | low / 4 | 0 | Window math excludes statutory OT; literal `T-24h` arithmetic; empty-payload merge |
| `convex/shifts.ts` | 160 | 12 / 4 | 0 | Non-transactional delete+insert (B3); sealed-shift behaviour correct |
| `src/app/check-in/live-submit.tsx` | 242 | 12 / 4 | 1 | **P1-D1:** token-failure path latches `inflight`/`busy` forever |
| `src/lib/backend/runtime.ts` | 425 | ~15 / 4 | 0 | `OVERRIDES` (provisioning/passwords) — **0 tests**; not browser-callable ✓ |

### Production (verified live, read-only)
- `/api/health/db` → `{"ok":true,"tables":16}` ("16" = the hard-coded `REQUIRED_TABLES.length`, **not** the DB's 17 base tables + 1 view; `systemEvents` and `jpay_rate_limits` are absent from the probe).
- Deny-by-default holds live: `manager:crewTimesheets` / `manager:attestShift` → `404 UNKNOWN_FUNCTION`; `users_queries:me` → `{"result":null}`; `GET /api/backend/call` → `403`.
- **`DEMO_MODE` is off** (`/api` `demo:status` → `{"enabled":false}`).
- Privacy policy is a **DRAFT placeholder**, live at `https://j-pay.vercel.app/privacy`, linked from the GPS consent gate as a legal promise.
- **`jpay_id_registry` returns 48 rows over unauthenticated HTTP** (see P0-F1) — this is the only object the publishable key can reach; all 17 base tables are closed.
- Deployment of HEAD `6182072` is `success` (Vercel Git integration). **No test ran in that deploy** — `gates.yml` was retired 2026-11-10; `e2e-nightly.yml` was created 2026-11-11 and has never executed.

---

## 2. The 10-Principal-Engineer Deep Audit

### Lens 1 — Systems Architect (Topology, Coupling & State Machines)

**Negative evidence first:** the `/api/backend/call` single-door model, the `api.*` client proxy, write-set invalidation (`react.ts:68-97`, server-reported `tables`, wildcard fallback), and archive-not-delete are all coherent. The 146-handler deny-by-default is real (every internal handler returns `UNKNOWN_FUNCTION` on the browser path — exhaustive sweep).

- **[P2-C5] `crewTimesheets` runs a full `systemEvents` collect per shift inside nested loops** — `convex/manager.ts:537-552` (in-flight)
  - **Root cause:** the attestation lookup sits inside `for (const userId of crewUserIds) → for (const shift of userShifts)`; `by_kind_time` indexes `kind` only (`db.ts:37`), so the predicate-matching query returns EVERY attestation row ever written, and `.find()` + `JSON.parse` re-scans it per shift. Cost = `O(crew_users × shifts × total_attestation_rows)`.
  - **Deterministic trigger:** any manager opening a wide `fromMs..toMs` window over a crew with many shifts; `systemEvents` is unbounded (no retention job exists).
  - **Fix spec:** hoist the ledger read OUT of both loops; build `Map<shiftId, attestation>` in one pass; add the `["kind","at"]` index + SQL migration; bound the window. Cache across users.
- **[P2-C6] The attestation verdict is written by `attestShift` (`convex/manager.ts:617`) but consumed by nothing** — `convex/payroll.ts` (pay from `shifts` only), `convex/shifts.ts:deriveForUser` (keys off `reviewResolutions`), the UI reads it only to display.
  - **Fix spec:** either write via `reviewResolutions` (making it take effect on payroll, moderated by state preconditions P2-C4) or reframe as advisory UI-only; do not ship a sign-off that changes nothing.
- **[P2-C7] `demoteManager` orphan-site detection (`convex/manager.ts:466-499`) logs `manager_demoted_orphan_sites` and then proceeds anyway** — no consumer, no enforcement, no UI surfacing.
- **[P2-C8] `crewTimesheets` surfaces only the newest attestation per shift** (`.order("desc")` + `.find()`) — earlier verdicts are invisible; supersession has no audit trail.
- **[P2-A1] `db.ts` window loop (967ed92) is correctly structured but its ordering tiebreaker is `_creationTime` only (no `_id`)** — `db.ts:391-403`. Offset pagination can skip/duplicate rows on equal `_creationTime` under concurrent inserts.
- **N/A — framework-level** — N/A this lens found no circular imports and no God-object payout path beyond the demo module (accepted as env-gated).

### Lens 2 — Frame-Budget & Performance Engineer

- **[P1-B2-related]** see Lens 4 — a latency/timing defect, not allocation.
- **[P2-D13] Every screen carries a full-viewport `feTurbulence` noise filter (`src/app/layout.tsx:27-41` × `globals.css:409-421`) re-rasterised on each paint** — on top of a 1 Hz `ShiftTimer` tick and Leaflet animation loops. No measurable benefit, pure runtime cost on the field-worker Android target.
- **[P2-D10] Manager console "in transit" leg durations are frozen at 0 min** — `manager/page.tsx:49` uses `useState(() => Date.now())` mount-stable clock; legs departed after mount compute `Math.max(0, negative)` = 0 forever.
- **[P2-D21] `dashboard` renders `audit.slice(0,50)` from a 100-row query** and the server filters demo rows AFTER `.take(limit)` (`moderator.ts:16-26`) — silent truncation.
- **Positive evidence:** `1 Hz` tick is correctly confined to `ShiftTimer` (not card root); the 15 s refresh timer reset bug (D3 identity) aside, no per-frame allocations found in hot paths; Leaflet `map.remove()` called in every effect cleanup.
- **Negative evidence:** `useQuery` does no endless fetch→setState→fetch loop (depends on `[key, tick, skip]`, `react.ts:262`); in-flight dedup correct (`react.ts:123-184`); `bump()` is `O(listeners)`.

### Lens 3 — Mathematical, Physics & Algorithmic Engineer

- **[P1-B1] BCEA weekly overtime cap is applied to partial ISO weeks → the same 63 h/week pays R7,650 when the window is Mon..Sun and R7,200 otherwise** — `src/lib/payroll-strategies.ts:94-132` (`computeBcea`: `capLeft` reset per Monday-group over only the days present), compounded by `src/app/payroll.tsx:36-52` (rolling 7/14/28-day window anchored at the viewer's local midnight, never ISO-week aligned; Sunday excluded from the OT cap).
  - **Executed (unmodified `computePay`):** anchor Mon 2026-11-02 → ordinary 2700, OT 540 min, pay R7,650; anchor Tue 2026-11-03 → ordinary 3240 (**54h ordinary — statutorily impossible**), OT 0, pay R7,200. Sundays never consume the cap, exposing the bug on 6 of 7 anchors.
  - **Fix spec:** widen the shift query in `convex/payroll.ts:28-34` to the complete ISO weeks touching the window (`mondayOfWeek` boundaries), compute with the widened day set, slice results to the requested window; OR align the panel's period selector to ISO weeks. Add invariant `ordinaryMinutesPerWeek <= weeklyCapMin` + an `INCOMPLETE_WEEK` guard.
- **[P2-B10] `roundCents` (`Math.round(n*100)/100`) systematically under-rounds exact-decimal half-cent products** — `payroll-strategies.ts:31`. Executed exhaustive sweep over rates R10.00–100.00 × 12 minute values (108,012 combos): **947 divergences, every one exactly −R0.01**. Fix: integer-cent pipeline carried through `finalize`.
- **[P2-B8] Flat 60-minute lunch deduction clamps at 0** — `shift-engine.ts:139-142`; a 45-minute shift ending in lunch phase yields `{totalMinutes: 0, needsReview: false}` — paid nothing, flagged nothing.
- **[P3-B9] UK (WTR) strategy pays hours above the 48h cap at straight time while labelling them "overtime"** — `payroll-strategies.ts:164-195`. Test-suite encodes current behaviour (`test-payroll-strategies.mjs:165-176`): it is deliberate, but the policy claim is unverified against a source. Requires a human/citation decision, not a code edit.
- **[P3-B12] Duplicate idempotency-key conflict detector ignores `sideMissionDurationMinutes`** (money-bearing field) — `shift-engine.ts:87-89`. Currently unreachable (live `logs_user_idem_uniq` present, verified) — contained but should be closed.
- **`localDayKey` / DST handling is sound** (`shift-engine.ts:346-357`, `Intl.DateTimeFormat` with explicit zone; DST transition tested) and `isSunday`/`mondayOfWeek` use `T12:00:00Z` deliberately — positive evidence.

### Lens 4 — Concurrency, Async & Determinism Engineer

- **[P1-B2] A device clock ≥6 minutes BEHIND flags EVERY punch as `offline_replay` — the shift is held and pays R0** — `shift-engine.ts:44-68` (`skewCorrectedTime` trusts client time when `|skew| ≤ 30 s`, but the skew is measured from `queuedAt` taken from the *same* device clock → cancels the device offset), `convex/logs.ts:83`.
  - **Executed:** device −6 min → `skewMs=40 ms`, `isOfflineReplay=true` (−4 min → false — the 5 min `REPLAY_REVIEW_MS` is the cliff). −3 h → also true, **plus** the shift is dated to the wrong wall-clock day (different `localDayKey` → different pay day + wrong weekly-cap group).
  - **Fix spec:** separate device-offset estimation (`now − clientReportedTime` on *live* punches only, persisted per device) from offline-replay detection (`now − queuedAt`); end the conflation of the two concepts in `clockSkewMs`.
- **[P2-B3] `deriveForUser` is a non-transactional delete-then-insert with no unique key** — `convex/shifts.ts:111-158`; runtime has no transaction (`runtime.ts:212-229`) and `public.shifts` has **no unique index** (`0001:151-154`). Two derivations reading the shift set before either writes both insert a row with identical `startedAt` → **duplicate minutes paid twice** (4 shift rows live, 0 duplicates now — latent).
  - **Fix spec:** unique index `shifts_user_start_uniq ("userId","startedAt")` + upsert-keyed derivation + per-user Postgres advisory lock (or `serializable`); note the moderator override targeting `shiftId` is also silently invalidated by delete+insert.
- **[P2-D3] Every `useMutation`/`useAction` result is a NEW function identity on every render** — `api.ts:14-30` (Proxy mints new descriptors per access) → `react.ts:272-297` (`useCallback(fn, [ref])` with an unstable `ref` object). Consequences (all in-tree-verified):
  - `check-in-card.tsx:127-184` — the GPS `watchPosition` effect **tears down and re-registers on every render** (net position starvation; the "ON — on site" promise may never hold).
  - `use-outbox.ts:63-88` — the 15 s refresh `setInterval` and offline/online listeners are destroyed and recreated on every render → offline-queue badge goes stale.
- **[P2-D8] The moderator messages panel awaits mutations with no try/catch and no busy guard** — `messages.tsx:52-58,86-92,122-126`; failures surface as `Uncaught (in promise)` with zero user feedback and no double-submit protection (the manager equivalent does both).
- **[P2-D9] Site-map-picker `geocode` has no request-sequence guard** — `site-map-picker.tsx:95-113`: a slower earlier response overwrites the newer search results; wrong-site coordinate selection possible.

### Lens 5 — Memory & Resource Lifecycle Engineer

- **[P2-D12] `navigator.serviceWorker.ready` never settles when no SW controls the page** — `notifications.tsx:31,57`: the notifications control renders permanently disabled/grey in dev mode (Serwist disabled) and in any blocked-SW production scenario. `getRegistration()` (resolves, possibly undefined) fixes it.
- **Leaflet teardown is correct** in every map effect (`map.remove()` in cleanups) — positive evidence; in-place popups correctly preserved across refreshes (`live-crew-map.tsx:166-171`).
- **Outbound watch cleanup is correct** (`clearWatch` in the travel effect cleanup) — failure is in identity (P2-D3), not cleanup.
- **Authoring:** blob URLs (`URL.revokeObjectURL`) — `payroll.tsx:78` revokes after 10 s but the timer is never cleared on unmount (P3-D20). Other revocations sound.

### Lens 6 — Security & Trust-Boundary Engineer

- **[P0-F1] `public.jpay_id_registry` is readable by the unauthenticated browser** — verified end-to-end with the publishable key (`GET /rest/v1/jpay_id_registry?select=id,tbl` → **HTTP 200, 48 rows**: `users:6 (auth.users UUIDs), organisations:1, sites:3, userSites:5, logs:16, shifts:4, messages:8, reviewResolutions:2, managerSites:3`).
  - **Root cause (compound, both reproduced against production):** (1) `0001_init.sql:317-318`'s `revoke all from anon, authenticated` is one-shot and there is **no `ALTER DEFAULT PRIVILEGES`** (live `pg_default_acl` confirms anon+authenticated get `arwdDxtm` on every newly-created table), saved only by RLS default-deny on base tables; (2) `0009_organisations.sql:46-47` dropped+recreated the view without `security_invoker` — views bypass RLS, so it carries full grants and runs as owner (postgres). Supabase's own advisor returns **ERROR `security_definer_view`**.
  - **Impact:** identifier disclosure only (UUIDs, table names, row counts, object-graph) — no payroll amounts/names/emails/GPS. It breaks the project's stated invariant verbatim (`0001_init.sql:11` "The browser's publishable key can reach nothing."). **Not a write path** (`UNION ALL` view).
  - **Fix spec (one migration):** `0014_registry_hardening.sql` → `revoke all on public.jpay_id_registry from anon, authenticated;` + `alter view public.jpay_id_registry set (security_invoker = on);` + `alter default privileges in schema public revoke all on tables/sequences/functions from anon, authenticated;` (stop the bleeding for every future object). Apply and re-probe — expect 0 rows / non-200.
- **[P1-C1] `promoteToManager` site inheritance silently grants cross-org manager scope** — `convex/manager.ts:402-435`: copies target's `userSites` into `managerSites` with **no org check** (the guard 20 lines above compares actor-org vs target-org, never the site's org).
  - **Prerequisites verified:** `assignEmployee`/`setEmployeeSites` (`sites.ts:102-183`) apply **no org check** — a moderator can assign an org-A employee to an org-B site; the promotion then hands that org-B site to the newly-promoted manager.
  - **Reproduced exploit** (Batch C, executing through the real `invoke()`): org-A moderator promotes org-A employee assigned to org-B site → `managerSites` = `[org-A site, org-B site]` → `crewTimesheets` returns org-B crew shifts; `attestShift` writes org-B shift verdicts. **Truly cross-tenant** read (crew shift times/needsReview) and **cross-tenant write** (shift attestation) with zero indication to the moderator.
  - **Fix spec:** inside the inheritance loop skip any `site.orgId !== target.orgId`; additionally enforce `site.orgId === user.orgId` in `assignEmployee`/`setEmployeeSites` (defense in depth).
- **[P1-C2] Both new org guards are truthiness tests, so a missing `orgId` disables them — the default state for every moderator provisioned after 0009** — `convex/manager.ts:317-319`, `:379-382` (`if (manager.orgId && …)`).
  - **Verified:** `provisionModerator` creates moderators with **no `orgId`** (`users.ts` insert has no `orgId`; `runtime.ts` override passes none), and the unscoped-employee path is an officially supported "no org selected — account will be unscoped" state (`provision-panel.tsx:28,59`).
  - **Reproduced:** org-less moderator promotes an org-B employee → `CROSS_ORG_PROMOTION_FORBIDDEN` **not** thrown; org-less manager granted org-A site via `setManagerSites` → accepted. The guard works only in the state the test fixture manufactures (which is exactly what `scripts/test-manager-authz.mjs:229-249` does).
  - **Fix spec:** fail closed (`(manager.orgId ?? null) !== (site.orgId ?? null) → throw`) or move the org check to the site boundary; enforce the same for the promotion path.
- **[P2-C3] `attestShift` performs no row-type check — any table's row id is attestable as a "shift"** — `convex/manager.ts:604-628`: `ctx.db.get(shiftId)` returns the row for *any* id (the registry view is global), and the runtime does not run Convex's arg validators (`runtime.ts:496` calls `handler._handler` directly). Reproduced: `travelSegments` leg id and `punches` id both attest ACCEPTED. Fix: explicit table discriminator (`db.ts:261-273` `tableOf()` → assert `tbl === "shifts"`); row-shape check.
- **[P2-C4] `attestShift` has no state preconditions and is replayable** — no check for `endedAt` set (open shifts attest), `sealed` (payroll-final shifts attest — strictly weaker than `moderator.endShiftOverride`'s `PAYROLL_SEALED` refusal), or existing attestation (replay overwrites the read verdict).
- **[P1-F2] `supabase db push` — the documented install path — would apply hazardous migrations to production** — applied history uses names not matching repo filenames (`manager_role` vs `0004` etc.), plus `0003` (pg_cron placeholders `__SITE_URL__`/`__CRON_SECRET__` — fails mid-push, or overwrites live retention jobs with broken placeholders once pg_cron exists) and `0008` (drops `organisations`/`systemEvents` from the registry — the file itself forbids re-application after 0011; production has 0011).
  - **Fix spec:** retire `0008` to `archive/`; parameterise `0003` or rename `.OWNER_ONLY.sql`; record the applied-name mapping in a table; document the real path (dashboard/SQL editor by owner) instead of `db push`; fix runbook ordering.
- **[P1-F5] No automated gate exists between merge and production** — `gates.yml` retired 2026-11-10 (no hosted CI; all 33 workflow runs failed/never ran), `e2e-nightly.yml` self-skips without secrets; Vercel builds run `next build` (typecheck-only) and **never run `npm test`**. Push to `main` = deploy, gated only by the social rule "no push without explicit ask".
- **The `isPublic !== true` gate and the `INTERNAL_ONLY_OVERRIDES` set hold** (verified exhaustively; live production 404s on all 34 internal handlers). `health/db` leaks only table names. `/privacy` linkage is the legal exposure, not a data leak.

### Lens 7 — Reliability, Fault Tolerance & Chaos Engineer

- **[P1-D1] The check-in button is permanently bricked when device-token acquisition fails** — `live-submit.tsx:113-133` (`inflight`/`busy` set true before any await; the token catch `return`s at L132 **bypassing the `finally`** at L209-212 that owns the reset) × `disabled={busy}` at L222.
  - **Deterministic trigger:** storage blocked or quota exhausted (iOS Safari "Block all cookies" → `SecurityError`; private-mode quota → `QuotaExceededError`), or `DEVICE_ALREADY_ACTIVE` from the server. Every subsequent tap returns at L118; the message even tells the user to "reload the page", which reproduces the identical failure. The employee can never start a shift until a moderator intervenes.
  - **Fix spec:** single `try` with a shared `finally`; storage guarded with in-memory fallback; regression test with `setItem` mocked to throw.
- **[P2-B2-related]** a slow clock is indistinguishable from an offline replay — see Lens 4 (this is also a reliability defect: the app manufactures its own failure signal).
- **[P2-D2] `useQuery` collapses "loading" and "failed" into `undefined`** — `react.ts:243-266` stores `state.error` but never returns it; every consumer renders either a permanent spinner or a silent empty state (10+ surfaces enumerated: home identity, moderator/manager consoles, dashboard, payroll panel, site picker, messages…).
- **Docker/CI is effectively absent** (F5) — a broken merge reaches production unimpeded. The app's own local gates pass, but nothing enforces them.
- **Migrations are not transactional** and the adapter has none (`runtime.ts:212-229`) — the derivation double-write (B3), the console sweep failures, and the attestation replay (C4) all stem from this platform property.

### Lens 8 — Type Systems, Schema & Contract Engineer

- **[P2-F4] `scripts/test-schema-parity.mjs` enforces a table-name lint on `0001_init.sql` only — and never reads the TRD** — proven by **3/3 mutation experiments** in a scratch copy (repo untouched):
  - M1 remove column `managerSites.archivedAt` from `0001` → **gate green**; M7 add BOGUS index column `by_bogus: ["notAColumn"]` → **green**; M2 add table `ghostTable` in SQL (reverse) → **green**.
  - One-directional table-name check (`schema.ts → {0001, INDEX_FIELDS}`), 12 of 13 migrations invisible, `jpay_id_registry` checked by loose regex. The TRD §6 block (the stated contract) is **not an input**.
  - **Fix spec (~80 LOC):** 4-way field-level parity (§6 ∪ `schema.ts` ∪ all migrations ∪ `INDEX_FIELDS`), bidirectional table check, explicit `INFRA_TABLES` allowlist (`jpay_rate_limits`), fix the doc overclaims (`j-pay.md:28-30`, ADR-004, `docs/index.md:3`).
- **[P3-F15] `convex/_generated/` is dead and internally inconsistent** — `api.d.ts` imports `../auth.js` (does not exist; `skipLibCheck: true` hides it) and omits `manager`, `organisations`, `travel`. Committed so tsc passes: **but** `src/lib/backend/api.ts:30` exports `internal: any` — the entire internal surface is untyped.
- **[P3-F5/typing] `x.internal` / any escapes** — `react.ts:269` `useMutation<any, any>`; `payroll.tsx:66`/`ShiftTimer.tsx:41` `as never`/untyped casts — tolerated in this codebase but inconsistent with `strict` intent.
- **TypeScript strict passes** (`tsc --noEmit` clean) — the defect here is contract-level, not compiler-level.
- **Contract debt:** TRD §6 is a **strict subset** of `schema.ts`/SQL — missing `punches`, `demoSessions`, and 9 fields (`managerSites.archivedAt` is not even registered in §11 Open Questions), while the docs call §6 "the source of truth".

### Lens 9 — Platform, Viewport & Portability Engineer

- **Clickjackable consoles:** no `X-Frame-Options`/`frame-ancestors` **anywhere** (verified live on `/moderator`, `/manager`, `/`); no CSP, no `X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy` (`geolocation` would be clamped) — **P2**. HSTS is the only header Vercel sets by default.
- **[P3-D22]** iOS install-hint dismiss target ≈28px < 44px (only the iOS path missed the U12 44px batch).
- **Serializer-fixed 24h arithmetic** — `payroll.tsx:42`, `ShiftTimer.tsx:36`, `check-in-card.tsx:213-217` assume all days = 86,400,000 ms — wrong across DST for the `Europe/London` jurisdiction (UK `wtr_uk` is exactly that zone).
- **TZ mismatch (P2-D5):** server buckets pay days in the **site** timezone (`localDayKey` with explicit zone); the client's window/labels/timestamps are the **browser** timezone — payroll figures diverge by who opens the panel, and London-vs-SAST shifts can vanish from the table.
- **Timestamp display:** `format.ts` `formatTime`/`formatDateTime` accept no `timeZone` — UTC-vs-local drift visible to the moderator auditing times.

### Lens 10 — Cognitive Load & AI-Context Maintainability Engineer

- **The in-flight work is unwired and unshipped** — `crewTimesheets`/`attestShift` have no `.tsx` consumer anywhere; `test-manager-authz.mjs` tests them through the stub only. The whole feature is a dead branch at HEAD.
- **The `internal: any` in `api.ts` and `as never` casts** (useMutation/useQuery, ShiftTimer) silently disable the generated-surface checking that `function-refs.ts` was built for.
- **`module.register()` deprecation spam** in every test run (DEP0205) — noisy output masking real failures.
- **`docs` drift:** `.env.example` documents Convex (`NEXT_PUBLIC_CONVEX_URL`, `JWT_PRIVATE_KEY`, `CONVEX_DEPLOY_KEY`, `npx convex env set`) that no longer exists; `README` claims gates that are not enforced; runbook says "expect 4 cron rows" (unpassable). The doc set teaches the wrong system.

### Lens coverage note
All 10 lenses applied. No lens was N/A except the geometry ones in Lens 2 partially (no canvas/arc audit of the Leaflet rendering needed beyond confirmed `.map.remove()` teardown correctness); the `feTurbulence` finding (D13) covers the one genuinely rasterised full-viewport layer.

---

## 3. Existing Test Suite Comparison & Mutation Truth Table

**Basis used for this section** (so the score is falsifiable): 36 test-shaped files on disk (30 wired into `npm test`, 4 unwired pure-logic files, 2 `tests/*.mjs` unwired, 15 Playwright specs + 11 fixtures = **76 tests never executed by anything**). 529 `assert.*` calls across the wired set; **15/36 (42%)** of test files carry a negative/boundary signal; **11/36** use mocks/stubs; **6 × `console.assert`** in `tests/geo-radius.test.mjs` / `test-rate-range-guard.mjs` (these cannot fail a build — verified exit 0 on failure). **Measured M_kill = 51%** (41 of 80 applied mutants killed) on this pass, in line with the prior audit's 55–60% — the suite is not as hollow as it looks, but the untested zones are exactly the money/security gates.

| Implementation Module | Critical Functions / Branches | Paired Test (or NONE) | Pathologies | Mental Mutants M1–M4 (est.) | High-Priority Missing Assertions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `shift-engine.ts` deriveSegments | all rules | `test-shift-engine.mjs` (+fuzz) | good; **non-integral minute uncovered**; config constants unprobed | **17/25 (68%)** | minute quantization; constant sweeps |
| `payroll-strategies.ts` computePay | all strategies | `test-payroll-strategies.mjs` | NaN-rate slip; rate=0 accepted; **R100-only fixture** (exact products, no half-cent case) | **14/17 (82%)** | fractional-cent table; NaN/∞; rate=0; unknown-strategy fall-through |
| `payroll-jurisdictions.ts` | mapping table | `test-payroll-jurisdictions.mjs` | good; wiring gap only | n/a | assert `calcForEmployee` resolves strategy from locale |
| `convex/shifts.ts` **deriveForUser** | horizon, sealed immutability | `test-shift-derivation-bounds.mjs` (re-implements inline — 0 callers) | Happy-path; simulation masquerading as test | **0/9 (0%)** | import the real handler (MVTH below) |
| `convex/manager.ts` in-flight | promote/demote/attest/CrewSheets | `test-manager-authz.mjs` (+141) | **Real invoke-path tests — NOT mock-mirror**; but stub has **no range operators, no `order()`, no type discrimination** | **21/27 (78%)**, all 3 surviving `M1` are stub gaps | sealed/replay attest; range-window; archive-vs-delete invariant; cross-org *unstubbed* (test manufactures the one state where guards work) |
| `src/lib/backend/runtime.ts` OVERRIDES | provision/passwords/reset | NONE | — | **0/8 (0%)** | table-driven guard suite (MVTH-2) |
| `src/lib/outbox.ts` outboxAll | key↔entry pairing | `test-outbox.mjs` | one-entry fixture; inline regex | **1/5 (20%)** | multi-entry fixture; error injection |
| `src/app/check-in/**` | everything | NONE | — | n/a | rendered smoke test |
| `src/app/api/backend/call/route.ts` | resolveIdentity/statusFor | NONE | — | n/a | route-handler cases |
| `src/lib/backend/db.ts` pushdown | R1 window loop | `test-db-adapter.mjs` | excellent contract test | n/a (strong behavioural asserts) | `_id` tiebreaker case |
| `tests/e2e/*.spec.ts` (15 files) | role flows | **never executed** | Playwright dead weight | n/a | wire or delete |

### Why existing tests missed the discovered defects
- **P1-B1 (BCEA partial week):** every table-driven case in `test-payroll-strategies.mjs` feeds a **complete Mon–Fri set**; the partial-week path is absent.
- **P1-B2 (slow clock):** `test-shift-engine.mjs:291-299` *encodes* the defective behaviour as correct (skew measured at enqueue). No fixture varies device clock drift.
- **P1-C1/C2 (org guards):** `test-manager-authz.mjs:229-249` **manufactures exactly the state in which the guards work** (actor with `orgId` vs β-org target) — the default moderator (no `orgId`) is never constructed.
- **P0-F1:** no test probes object grants/RLS/default-privileges (that is a migration-SQL assertion, see plan).
- **Build-artefact abort (§below):** the chain aborted on **every fresh clone** until `public/sw.js` exists; the security gates are skipped in that window. **Confirmed empirically**: inject a failing test in stage 1 → `test-invoke-gate`, `test-manager-authz`, and 11 other suites **never run**; `sw.js` (gitignored) is the trigger.
- **`db-stub.mjs` divergence** (`gte/lte/gt/lt` are no-ops, `order()` no-op, no unique constraints, no cross-table type) makes range/order/type/replay defects **structurally invisible** to the manager suite.

### Minimal Viable Test Harness (MVTH) — priority order
1. **MVTH-A (P0):** `supabase` grant-assertion SQL test — after every migration, assert `relacl`/`reloptions` for views: no `anon` grant, `security_invoker = on`, and `pg_default_acl` revoked; assert `jpay_id_registry` returns 0 rows for `anon`.
2. **MVTH-B (P1):** `computeBcea` with a straddling-week input (`{2026-11-05..2026-11-11}`) asserting 540 OT minutes and `ordinaryMinutesPerWeek ≤ 2700`.
3. **MVTH-C (P1):** slow-device-clock case in `test-shift-engine.mjs` (`clientReportedTime = now − 6 min`, expect no `offline_replay` flag; **test must fail pre-fix**).
4. **MVTH-D (P1):** `promoteToManager` with an org-less moderator and with an org-A employee assigned to an org-B site → expect refusal / non-inheritance. (Red pre-fix.)
5. **MVTH-E (P1-D1):** mock `localStorage.setItem` to throw; assert `data-loading` returns `false` after checkIn. 
6. **MVTH-F (P2):** real-handler `deriveForUser` table cases through `invoke()` (sealed immutability, horizon, resolved-key preservation, override application).
7. **MVTH-G (P2):** `db-stub.mjs` fidelity — implement `gte/lte/gt/lt` predicates and `order()`; re-run manager suite.
8. **MVTH-H (P2):** `npm test` chain aggregator — run all stages, never abort; move `test-next-build-artifacts` to `test:build` or skip-if-absent; wire Playwright or delete it.

---

## 4. Surgical Refactoring Blueprints (Zero-Mutation Drafts)

### R1 — Close the P0: registry view hardening (ships as `0014`)
- **Target:** `supabase/migrations/0014_registry_hardening.sql` (new) — no code change.

```sql
-- 0014_registry_hardening.sql — close the anon-registry exposure (audit 2026-11-11, P0-F1)
revoke all on public.jpay_id_registry from anon, authenticated;
alter view public.jpay_id_registry set (security_invoker = on);
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
notify pgrst, 'reload schema';
```
- **Rx verification:** anonymous REST GET `…/rest/v1/jpay_id_registry` → expect 200 with **0 rows** (security_invoker evaluates base-table RLS as caller — anon sees nothing even if grants are re-added).

### R2 — Promo/scope org inheritance guard (in-flight)
- **Target:** `convex/manager.ts:420-435`

```ts
for (const us of userSiteRows) {
  const site = await ctx.db.get(us.siteId);
  if (!site || site.archivedAt !== undefined) continue;
  if (target.orgId !== undefined && site.orgId !== target.orgId) continue;   // C-1: honor the org boundary
  ...
}
```
- And fail-closed guards (C-2): `(manager.orgId ?? null) !== (site.orgId ?? null) → throw`.

### R3 — Single-try token acquisition (P1-D1)
- **Target:** `src/app/check-in/live-submit.tsx:113-213`

```ts
async function checkIn() {
  if (inflight.current) return;
  inflight.current = true; setBusy(true); setMessage(null);
  try {
    const token = await getToken();   // throws → same catch as the rest
    ...existing body...
  } catch (e) { /* branch on DEVICE_ALREADY_ACTIVE */ }
  finally { inflight.current = false; setBusy(false); }
}
```

### R4 — Skew measurement separation (P1-B2)
```ts
// Live punches: measure server−device offset *now* and persist per device.
const deviceSkewMs = now - clientReportedTime;             // only when (now - queuedAt) ≤ LIVE_TOLERANCE_MS
const replayMs     = now - queuedAt;                       // offline delay, computed on server clock
// isOfflineReplay = replayMs > REPLAY_REVIEW_MS; skewCorrectedTime = clientReportedTime + deviceSkewMs
```

### R5 — De-truncate the schema-parity gate (P2-F4)
- See plan §Phase 2: replace table-name lint with 4-way field-level parity + bidirectional checks + `INFRA_TABLES` allowlist.

## 5. Phased Execution Roadmap & Scoped Agent Prompts

**Phase 0 — Containment (ship before anything else)**
1. **P0-F1**: create & apply `0014_registry_hardening.sql`; re-probe anon registry (expect 0 rows); add R1 regression test asserting `security_invoker` + zero grants post-migration.
2. **P1-F5**: make the build the gate — `"build": "npm run verify && next build --webpack"` (safe: verify needs no build) **or** a `prebuild` hook; keep typecheck as backstop.
3. **P1-D1**: single-try restructure + `localStorage` guard + regression test (client lives in `live-submit.tsx` only).

**Phase 1 — Money & cross-tenant correctness (fix before any new payroll run)**
4. **P1-B2**: skew-vs-replay split (§R4) + test MVTH-C; only then ship.
5. **P1-B1**: widen `convex/payroll.ts` shift window to ISO weeks; add per-week cap invariant + MVTH-B test.
6. **P1-C1**: org check inside inheritance loop (§R2); add `assignEmployee`/`setEmployeeSites` org guards; MVTH-D tests.
7. **P1-C2**: fail-closed org guards; update `test-manager-authz.mjs` fixtures to include **org-less moderator** cases (currently absent).

**Phase 2 — Hardening & honesty of gates**
8. **P1-F2/F3**: retire `scripts/deploy_prod.py` (archive marker); parameterise/rename `0003`, archive `0008`; document owner-applied path; fix runbook (`0008`, 4-row cron expects).
9. **P2-F4**: rebuild schema-parity as field-level 4-way gate; update parity docs/ADR-004/j-pay.md; delete the overclaim in §28-30.
10. **P2-E1**: test-chain aggregator + move build-artefact test out of `npm test`; wire Playwright or delete (76 dead tests); wire the 2 pure-logic orphan files after rewriting to import shipped code; replace the inline-copied contracts with real imports.
11. **P2-C**: fix `attestShift` (row-type discriminator, state preconditions, replay rule) and hoist `crewTimesheets` ledger read (R-hoist); add `["kind","at"]` index migration.
12. **P2**: `deriveForUser` unique index + advisory lock + MVTH-F; `health/db` add `systemEvents`, `jpay_rate_limits` (and return real DB count); `payroll` NaN/rate=0/`PAYROLL_STRATEGY` validation; R4's skew fix; chunks of Lens-4/5/9 (window tiebreaker, `feTurbulence`→static texture, timezone threading).
13. **P3**: UK-WTR policy decision (owner + source); fractional-cent integer pipeline; `internal: any`→typed; dead-file cleanup (`generate-jwt-keys.mjs`, `convex/crons.ts`, `docs/SUPABASE-LINK.md` stale sections, `.env.example` rewrite, `allowScripts` inert, `engines` floor).

### Copy-Paste Surgical Prompts
> **Prompt P0-1 (`0014_registry_hardening.sql`, owner-apply):** "Create new `supabase/migrations/0014_registry_hardening.sql` that (a) revokes all privileges on `public.jpay_id_registry` from `anon, authenticated`, (b) sets the view `security_invoker = on`, (c) revokes default privileges on tables/sequences/functions in `public` from anon and authenticated, (d) ends with `notify pgrst, 'reload schema';`. Do not edit any other migration. Owner applies via SQL editor. Verify: unauthenticated REST select returns 0 rows. Document the applied version in `docs/ops/`."

> **Prompt P1-1 (`convex/manager.ts` lines 420-435):** "Inside the site-inheritance loop of `promoteToManager`, skip every site whose `orgId` differs from the promoted employee's `orgId` (use the target's org, not the actor's). Do not touch other hunks. Add a regression test in `scripts/test-manager-authz.mjs` that promotes an org-A employee assigned to an org-B site and asserts the org-B site is absent from `managerSites`. Run the manager harnesses; confirm the new assertion fails before the code change and passes after."

> **Prompt P1-2 (build gate, `package.json`):** "Change `build` to `npm run verify && next build --webpack`. Confirm `npm run verify` does not require `public/sw.js` to exist. On a fresh clone, `npm run verify` must reach `tsc --noEmit` rather than abort at the artefact test."

---

## Pitfalls observed this cycle
- **An `isPublic` gate that denies by default is necessary but not sufficient — the data door is the registry view, not the handler.** Audit grants and default privileges, not just handler logic.
- **Guard clauses written as `if (x && …)` invert their own intent** — every absent-field case falls through to "allow". Write them as "same value required", never "both must be present and equal, else allow".
- **A test file that manufactures the exact state where the guard works proves nothing about the other state.** Fixtures must cover the unscoped/default account shapes, not just the happy path.
- **JSON-in-`detail` ledgers can't be delta-queried or pruned** without full scans — a `shiftAttestations`-style table with a unique `(shiftId)` key would have removed C4, C5 and C8 in one move.
- **Build-artefact assertions in unit-test chains hide everything downstream of them.** Keep artifact existence tests out of the correctness suite.
- **Verified `200`s mean "the host served something", not that your change deployed** — HEAD `6182072` is live, but no test ran during that deploy.

## Verified-Correct (do not regress)
- `/api/backend/call`: deny-by-default (live 404s on all 34 internal handlers), smoke-key fail-closed (403), single data door; tables-written/reads wired through to client invalidation (with wildcard fallback for older servers).
- `logs_user_idem_uniq` live; one-punch-one-log; server dedupe swallows 23505 → `duplicate: true`; 30s/5-min window idempotent.
- `useQuery` stable key deps; no fetch-loop; in-flight dedup; **server-reported write-set invalidation replaces the maps**.
- Leaflet: dynamic-import guarded + fallback; `map.remove()` cleanup; popup-preserved refresh; 1 Hz tick confined.
- RLS: all 17 base tables default-deny, 0 policies; service_role is the only path.
- Shift engine: order-invariant dedupe (min `_creationTime`, deterministic tie-break), `localDayKey` with explicit zone + DST test, side-mission `min(declared, wallclock)` policy, 2026-08 device-token matrix correct.
- `test-manager-authz.mjs` is a genuine invoke-path authz test (not a mock-mirror) — and its gaps are enumerated.
- `npm audit` = 0; the Serwist override chain resolves at build time only and is API-compatible.
- Demo-mode is enforced by `requireDemoReviewer` (`DEMO_MODE=1` + anonymous + demo-tagged employee persona) and is off in production.
