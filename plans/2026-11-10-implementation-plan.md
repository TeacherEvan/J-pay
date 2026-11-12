# J-Pay — Implementation Plan (2026-11-10, post surgical re-audit)

| Metadata | Value |
| :--- | :--- |
| **Date** | 2026-11-10 |
| **Audit prior art** | `docs/audits/surgical-audit-2026-11-10.md` (audited `2ace827`; Phases 1–3 largely delivered & deployed: P0-1 gate, P1-1 PostgREST pushdown + LRU, P1-2 unique index SQL, P1-3 scheduler retry+log line, P1-4 cron route + `0003`, P1-5 useQuery deps, login-bounce + `kpi:summary` fixes, ADR-004 + README/TRD/AGENTS sync) |
| **Re-audit scope** | Full tree at HEAD `2a3c9ed` (`src/`, `convex/`, `supabase/migrations/`, `scripts/`, config) — 128 scanned files, **14,150 effective LOC**; includes the ~5,600 lines added *after* the audit (travel/GPS tracking, manager role, shift overrides, zero-scroll console) |
| **Method** | Preflight telemetry (pruned copy; digest `dcd3b53d…` pre/post — **zero source mutation**), 10-lens static review (two parallel audit passes, findings spot-verified in-tree before inclusion), `npm run verify` → PASS, `dead_export_sweep` (candidates only), **live anonymous probe** (headless Chromium via repo Playwright against a dev server on :3137; chrome-devtools MCP unavailable — "Target closed"). |
| **Score** | **S_health ≈ 53 / 100 — HIGH** (`D_raw = 150`: 12×P1, 12×P2, 18×P3; `P_test ≈ 6.8` at `M_kill ≈ 55%`; `N_P0 = 0`) |
| **What this is** | The executable plan. The audit report is the evidence; this file is the work order. |

> **Reading order for an agent:** Phase 0 first, always. Do not start Phase 1 until Phase 0's migration apply is confirmed — two of the P1s (B5-class) are deploy-ordering failures, not code defects.

---

## 0. What changed since the last audit — and why it matters

The re-audit's central lesson: **the fixed layer held; the new layer did not.** The `isPublic !== true` gate is intact; no refetch loops; unmount cleanup is correct; zero XSS in `src/app`; popups/maps remove themselves properly; manager authz is genuinely scoped to assigned sites; `pathSamples` never reach a client raw; GDPR purge chains correctly. All of that is real and verified.

What was added after the audit (`06a915d`→`2a3c9ed`): on-shift GPS travel tracking (`convex/travel.ts`, `supabase/migrations/0006/0007`, `src/app/*/manager-map.tsx`), a manager role with live crew visibility (`convex/manager.ts`, `0004/0005`), and moderator end-of-shift overrides feeding payroll derivation (`convex/moderator.ts`, `convex/shifts.ts`, `0007`). None of it has been through an audit, and two classes of defect dominate:

1. **Silent-wrong-answer defects** — SQL limits are pushed *before* residual JS filtering, so eligible rows silently vanish (B1); an out-of-order replayed GPS fix double-counts distance and flags "impossible travel" (B4).
2. **Consent/privacy honesty defects** — consent revocation does not stop tracking server-side (B2), there is no revoke path or standing "you are tracked" indicator in the UI at all (U1/U6), and the employee has no way to tell fixes are even flowing (U2).

Because travel tracking is payroll-adjacent, consent-sensitive, and brand-new, it is the highest-priority remediation surface in this plan.

---

## 1. Verified findings (spot-checked in-tree, not taken from the audit pass on faith)

### P1 — fix in Phases 1–2

| ID | Defect | Coordinates | Mechanism (verified) |
| :--- | :--- | :--- | :--- |
| **B1** | SQL `LIMIT` applied **before** residual JS `neq`/predicate filter → silent under-fill | `src/lib/backend/db.ts:433` (SQL `limit`), `:460-466` (legacy path slices correctly), `:476-484` (`finish()` filters after), `:490-507` (`take`/`first`/`unique`) | Pushed constraints + limit execute in Postgres; `neq` and `.filter()` predicates run in JS on the already-truncated window. Rows filtered out in JS are never backfilled ⇒ `moderatorInbox` drops non-archived messages behind archived ones; `overridableShifts` yields an empty list when the newest 60 are all `sealed`; `unique()` can throw on exactly one matching row. |
| **B2** | Consent revocation does not close open travel legs | `convex/travel.ts:43-50` (`setConsent`), `:105-110` (`consent_required` early return writes nothing), `:90-105` (open-leg flagging only on the no-open-shift path) | `setConsent(false)` clears only `users.travelConsentAt`. The open `travelSegments` row keeps `arrivedAt = undefined` forever; `manager:managedActiveShifts` keeps pinning the live map to the last sample for the rest of the shift. Revocation is not effective server-side. |
| **B3** | Double-insert race: first off-site fix opens **two** permanent travel legs | `convex/travel.ts:158-178` (insert after read), no uniqueness constraint in `0006_travel_tracking.sql` | Read-then-insert with no `UNIQUE … WHERE "arrivedAt" IS NULL`. Outbox double-fire / cross-device retry within one round-trip ⇒ duplicate open legs; `.find()` in the manager map picks an arbitrary one; one leg never arrives. |
| **B4** | Out-of-order/replayed fix corrupts distance and flags impossible travel | `convex/travel.ts:180-235` | Idempotency is a single slot (`openSegment.lastFixKey`); `t < last.t` yields negative `legMs` ⇒ `legSeconds = max(1, …)` ⇒ huge `speedMps` ⇒ `impossible_travel`, and `distanceMeters` accumulates the same leg twice. |
| **B5** | Deploy-ordering: new tables read unguarded on the **payroll** path | `convex/shifts.ts:62-65` (`shiftOverrides` read inside `deriveForUser`), `src/lib/backend/runtime.ts:150-157` (`withScheduledRetry` → `console.error` only). All of `0003`–`0007` carry "NOT APPLIED by any agent session" | App deployed before migrations ⇒ every punch throws inside derivation ⇒ re-derivation never runs ⇒ shifts stop deriving ⇒ payroll silently stale. Operator-confirmed apply order, or a table-exists probe, is mandatory. |
| **B6** | `session-bootstrap` has no rate limiting — master-secret guessing | `src/app/api/auth/session-bootstrap/route.ts:105-136` (master path gated only by weak shared secret; `constantTimeEqual` ≠ brute-force protection) | No per-IP/global bucket anywhere — unlimited master attempts from the open internet. |
| **U1** | Check-in double-submit: busy flag set **after** `await`, per-call random idempotency key | `src/app/check-in-card.tsx:476-487` | Two taps in one event-loop window both pass the `disabled={busy}` gate; distinct keys defeat server dedup ⇒ duplicate logs. |
| **U2** | Travel watch failure is silent — consented user believes they are tracked; nobody learns fixes aren't flowing | `src/app/check-in-card.tsx:176` (`watchPosition(send, () => {})`), gate `:142` | Empty error callback; no UI indicator anywhere; OS-denied permission = zero fixes, zero signal. |
| **U3** | Leaflet `import()` has no `.catch()` — blank map forever on chunk-load failure | `src/app/moderator/active-shifts-map.tsx:75`, `src/app/manager/manager-map.tsx:93`, `src/app/moderator/geofence-modal.tsx:86`, `src/app/site-map-picker.tsx:34` | `.then()` without `.catch()`; `L` stays null; container renders an empty panel with no message. |
| **U4** | Leaflet map created inside a `display:none` container — never measures, stays grey | `src/app/site-map-picker.tsx:43-61` × `src/app/moderator/page.tsx:300-305` (hidden below `md:`) | `L.map` at mount on 0×0 box; `invalidateSize()` never called on pane switch ⇒ geofence picker blank on mobile. |
| **U5** | Outbox head-of-line blocking — one permanently-failing entry stalls the queue | `src/app/use-outbox.ts:31-45` | `break` on first non-`WEAK_GPS|SITE_NOT|INACTIVE|FORBIDDEN` rejection (e.g. `PAYROLL_SEALED`, 500-with-message) retries forever; later valid entries starve. |
| **U6** | No consent revoke path, no standing "tracking ON" indicator | `src/app/page.tsx:49,148` (only ever sends `{consent: true}`), `src/app/check-in-card.tsx:137-184` (no on/off UI; comment at `:232` admits it) | Server exposes `travel.setConsent` but the UI never calls it with `false`; employee cannot withdraw or even see status. This is the one capability an employee trusts the app with and cannot verify. |

### Carried from the 2026-11-10 audit (still open, in the plan)

- **C1 (P1, R3-full):** derivation failure never surfaced to the row — `needsReview: "derivation_failed"` on the closed shift + `systemEvents` write (last audit's Phase-1 item 5; only the retry+log half landed in `cb54a41`). Needs the integration lane.
- **C2 (P1):** punch+derivation write-set in one Postgres `rpc` (or `serializable` discipline) for `recordPunch`/`createLog` + `deriveForUser`; double-tap regression test.
- **C3 (P2):** `npm audit --omit=dev` — `@serwist/build`/`@serwist/webpack-plugin` chain → `minimatch`/`glob`/`zod` advisories. Review and bump.
- **C4 (P2):** e2e never runs anywhere — `gates.yml` runs only `npm test`; `tests-layout/*.mjs` and Playwright e2e are unexecuted; `canary.yml` exists but is label-gated and dead without `VERCEL_TOKEN`. Add a nightly e2e lane or delete the probes.
- **C5 (P2, backlog):** `check-in-card.tsx` decomposition (four stalled plans `plans/2026-09-04…09-09-*.md`; extraction target `useCheckInController`).
- **C6 (P3, verified):** root-level `alias-prod.png`/`branch-7min.png` duplicate `docs/ops/screenshots/`; `.agents/skills` vs `.claude/skills` near-duplicate tree (out of code scope; housekeeping).
- **C7 (P3):** dead `punch` route reachable by URL but linked nowhere, diverged design (no outbox/idempotency), `force-dynamic` on a client page, km-vs-m unit mismatch. Delete or route through the outbox.
- **C8 (P3):** `paginate()` still an array-offset cursor; `db.ts` `eq` null-semantics; `idCache` now LRU-capped (done in `ea1fc4c`); `!= null` sentinel in `resolveIdentity`; `api.ts` still `any`-proxy (no `FunctionRef` union).

### Live anonymous probe (:3137, headless Chromium, after the audit pass)

| Result | Evidence |
| :--- | :--- |
| `/`, `/login`, `/privacy`, `/punch` all serve 200 (or redirect) | anonymous shell renders; no console errors or page errors on `/`, `/login`, `/privacy` |
| `/punch` renders "Please sign in first" anonymously | confirms the orphan `/punch` route is live to any URL visitor (see C7) |
| **No hydration warnings observed** on anonymous pages (React 19) | U11's hydration mismatch is code-real but not console-visible anonymously — verify on an authed session before/after fix |
| **`/privacy` is a published DRAFT placeholder** | Source comment (`src/app/privacy/page.tsx:1-4`) says the final policy awaits counsel; the page is linked from the consent gate of a GPS-tracking employer app. **Launch-blocking compliance item, not a code defect** — added to Phase 0 as 0.6 |

> Authed-role probes (moderator console, manager map, tracking chip, double-tap) were **not** run — no test credentials were available in this environment, and no production action was taken. Phases S4+ keep their Playwright/double-click gates for exactly this reason.

### P2 — new, from the post-audit surface

| ID | Defect | Coordinates |
| :--- | :--- | :--- |
| **B7** | Manager role grants/revokes (`setManagerSites`, `promoteToManager`, `demoteManager`) write **no audit row**; demotion deletes `managerSites` outright — a rogue moderator can grant live-GPS visibility and erase the evidence | `convex/manager.ts:261-344` |
| **B8** | Hot paths re-introduce full-table `collect()`: `managedActiveShifts` (all `userSites`), per-crew `travelSegments` collect, `recentForCrew`, `myCrew` | `convex/manager.ts:80,108-111,179`; `convex/travel.ts:323,346-368` |
| **B9** | Incremental migrations never update `jpay_id_registry` view nor `NOTIFY pgrst` → cache-evicted id lookups on new tables throw → PGRST 404s on the new tables (existing installs only; `0001_init.sql` was edited in place for fresh installs) | `0004/0005/0006/0007` (all four) |
| **B10** | Every GPS fix (~15 s) invalidates six tables: `travel:recordFix → [travelSegments,logs,shifts,userSites,sites,users]` | `src/lib/backend/react.ts:75` |
| **U7** | `/punch` is a fork of check-in design: no outbox, no client idempotency, unreachable from the app, km/m mismatch (see C7 — decide or delete) | `src/app/punch/page.tsx:76-130` |
| **U8** | Silenced mutation failures on destructive buttons: moderator deactivate / rate / locale / reset-device catch-alls | `src/app/moderator/page.tsx:963,986,1028,1040-1057` |
| **U9** | "Zero-scroll" enforced by `overflow: hidden` — short viewports clip the bottom window entirely | `src/app/manager/page.tsx:89,121-124`; `src/app/moderator/page.tsx:76`; `src/components/console/window.tsx`; `globals.css:268-278` |
| **U10** | 45 s auto-refresh redraws destroy any open Leaflet popup (moderator + manager) | `active-shifts-map.tsx:115-118`; `manager-map.tsx:133-136` |
| **U11** | `EnableNotifications`: hydration mismatch (`useState(Notification.permission)`), no disable path, permanent "on" with no live subscription | `src/app/notifications.tsx:10-50` |
| **U12** | A11y debt: tablist without keyboard semantics (`console-tabs.tsx:45-70`); three of four modal types lack focus trap/Escape/scroll lock (`page.tsx:230,279,329`); flash-of-ungated-content (`page.tsx:41,44,53`); 40 px confirm targets | `src/components/console/console-tabs.tsx`; `src/app/page.tsx`; `geofence-modal.tsx` (correct pattern to copy) |
| **U13** | God file persists: `moderator/page.tsx` 1,057 LOC, 12 components, `any`-soup (`CrewView({employees: any[]})`, `as never`, `usePagination<any>`); duplicated ~85 %-identical map engines (`active-shifts-map.tsx` / `manager-map.tsx`) | `src/app/moderator/page.tsx`; both map files |
| **U14** | 1 Hz `setNow` re-renders the whole check-in card (timeline + all) instead of the timer readout | `src/app/check-in-card.tsx:88` |

### P3 — polish (batch into one commit series)

`Date.now()` in render (`manager/page.tsx:134`) · `--amber` token doesn't exist, use `--hivis` (`moderator/page.tsx:884`, `manager/page.tsx:152`) · locale `aria-label` exposes raw ids to AT (`moderator/page.tsx:204`) · 44 px targets on card-path confirm buttons · `use-pagination.ts:20` raw `setPage` (clamp inside) · `ShiftTimer` freezes "today" at mount, label lies (`check-in/ShiftTimer.tsx:22-26`) · 36 h window · `TodayStrip` null-until-first-query CLS · payroll `fromMs/toMs` memoized at open (`payroll.tsx:36`) · premature `revokeObjectURL` (`payroll.tsx:65`) · `window.__JPAY_LAST_EMPLOYEE_EMAIL` dead write (`moderator/page.tsx:479`) · dead `role === "manager"` branch in `promotable` (`:610-634`) · loading vs empty "(0)" states (`:119,141`) · `shiftOverrides` no `unique(userId, shiftKey)` (0007) · `hasOverride` string match brittleness (`moderator.ts:224`) · `maybeCurrentUserId(ctx as never)` (`manager.ts:221`) · lunch-time open leg → spurious `gps_gap` (`travel.ts:113-121`) · snooze is per-device localStorage (`page.tsx:44`) · `.eq(col, null)` lesson: adapter stub taught a falsehood — "eq(null) must never reach SQL" now enforced by `test-db-adapter.mjs`, keep it · `describeFunctions()` inventory exposure in non-prod (intentional — document).

---

## 2. Phased execution plan

Conventions: every phase lands as its own green commit series; **regression test first (red), fix second (green)**, per the surgical-implementation gate. Order within a phase is the order of risk reduction. Run `npm run verify` before each commit.

### Phase 0 — Owner/ops actions (cannot be done from this machine; blocking Phases 1–2)

| Step | Action | Proof |
| :--- | :--- | :--- |
| 0.1 | Apply `0002_logs_idempotency_unique.sql` (after the pre-flight duplicate diagnostic), then `0003_retention_crons.sql`, `0004`, `0005`, `0006`, `0007` **in numeric order** | `select jobname, schedule from cron.job;` (4 rows); `\d "travelSegments"` shows the new table; parity gate green |
| 0.2 | Set `CRON_SECRET` (Vercel env) and force one retention run via `POST /api/internal/cron?job=purge-expired-coordinates` → `{ok:true}`; confirm one structured line per other job | pg_cron history / response body |
| 0.3 | Set `SMOKE_TEST_KEY` (fail-closed 403 otherwise — acceptable) | prod `GET /api/backend/call` → 403 |
| 0.4 | Deploy **after** 0.1–0.3 — build does not carry migrations. Redeploy `main` once, then one round-trip per role against prod | Vercel deployment `success`; one punch → shift re-derives; manager console shows crew |
| 0.5 | Apply the **B3 partial-unique index** in the same window as `0006` (add to it or ship `0008_travel_open_leg_unique.sql`): `CREATE UNIQUE INDEX travel_segments_one_open ON public."travelSegments" ("userId") WHERE "arrivedAt" IS NULL;` | insert conflict on double-open |
| 0.6 | **Launch gate, not code:** `/privacy` serves a counsel-pending DRAFT placeholder linked from the consent gate of a location-tracking app. Publish the real policy (POPIA/GDPR review) before any external rollout; until then, every consent ack given in the app rests on an unpublished policy | counsel sign-off on a published policy; page no longer says DRAFT |

### Phase 1 — Containment: silent-wrong-answer and consent defects (backend)

1. **B1 — Stop pushing `limit` below residual filters.** If `this.predicate !== undefined || constraints.some(c => c.op === 'neq')` and `this.limit !== undefined`: skip SQL `.limit()`, slice in `finish()` *after* JS filtering (keep the OOM anti-pattern bounded: `take(n)` for unfiltered scans still caps at `n` when no predicate/neq remains). Add an adapter MVTH case: 100 push-matching rows, predicate rejects 3 of the newest ⇒ `take(100)` returns 100 older rows, not 97. **Also fix `first()`/`unique()`** — they inherit the same under-fill (`take(1)` + JS filter ⇒ `null` for an existing row; `unique()` throws on 0). Cite `EXPLAIN` for the `moderatorInbox` query before/after.
2. **B2 — Make consent revocation effective.** `setConsent(false)`: patch all open legs → `{ arrivedAt: Date.now(), needsReview: true, reviewReason: "consent_revoked" }`. Mirror the flag in the `consent_required` branch of `recordFix` (return stays `consent_required`, but flag the leg once). Test: consent on → off-site fix opens leg → revoke → manager view shows leg closed, `needsReview` set.
3. **B4 — Reject out-of-order fixes.** `if (last && t <= last.t) return { status: "duplicate" }`; compute `speedMps` only when `legMs > 0`; distance accrues only for `t > last.t`. Extend to a bounded recent-key ring if replay volume warrants (start with the `t <= last.t` guard + test). Test vectors: `[fix5, fix4]` flush order; replay of exact last fix; `legMs = 0` boundary.
4. **B3 — Belt-and-braces on the open leg** (0.5 index + insert-conflict-as-duplicate handling in `recordFix`).
5. **B5 — Fail loud on missing new tables.** `deriveForUser`: wrap the `shiftOverrides` read in try/catch → on error, return the user's previous shifts unchanged but set `needsReview: "override_table_missing"` on new rows? No — **do not mask**. Instead: order Phase 0 first (hard), and add a startup-style health probe route `/api/health/db` that asserts `0003–0007` tables exist (select 1 from each, 503 listing the missing ones). The derivation path itself stays unguarded — a hard error with the health check is better than a silent wrong answer.
6. **B6 — Rate-limit `session-bootstrap`.** Postgres or in-memory token bucket: 10/hour/IP master. Add `failedPasswordAttempts`/lockout for master if not present. Test: 11th master attempt in an hour → 429.
7. **C1 — R3-full.** Await `deriveForUser` inline on the punch path; on throw, stamp the closed shift `needsReview: true, reviewReason: "derivation_failed"` **and** write `systemEvents{kind:"derivation_failed", userId, at}` — never rethrow (the punch is valid evidence). Add the integration-lane test (MVTH #3 below) that forces a derivation throw and asserts the flag.

### Phase 2 — UI containment: silent failure and consent honesty

8. **U1 — Fix the check-in race.** `setBusy(true)` as the first statement of the handler (before `getToken`); `useRef` in-flight guard as belt-and-braces; **reuse an intent-scoped idempotency key** — one key per check-in attempt flow, not `crypto.randomUUID()` per tap. Playwright/double-click probe: exactly one log row.
9. **U6 + U2 — Tracking honesty, the employee's view of GPS.**
   - Standing chip on the check-in card when `phase==="on" && consentAt`: “Travel tracking ON — pause anytime” linking to a revoke toggle calling `travel.setConsent({consent:false})`.
   - `watchPosition` gets a real `onError`: first failure shows a dismissible inline badge “Location blocked — fixes not flowing”; after revocation, `clearWatch` is called and the chip flips OFF.
   - Server already supports revoke (B2 makes it real); this is purely client + the B2 server change.
10. **U3 — `.catch()` on all four Leaflet dynamic imports** + render “Map unavailable — check connection” in the container. One shared `loadLeaflet()` helper with cached promise (also fixes duplicate-load).
11. **U4 — Don’t mount the map in `display:none`.** Gate the picker on `task === "site" || isDesktop` (media-query hook or unmount-on-switch), or `invalidateSize()` in an effect keyed on pane visibility. Verify with a 768 px resize probe.
12. **U5 — Outbox: stop head-of-line blocking.** Classify the server rejection with actual error codes (not substring-of-message): drop-and-log `PAYROLL_SEALED|ENDED_*|WEAK_GPS|…`, continue to the next entry; keep a hard cap (e.g. 20) with a visible “queued N, oldest needs review” affordance. Test with a stubbed rejecting server.
13. **U7/C7 — Delete or outbox-ify `/punch`.** Recommendation: **delete the route** (unreachable, forked design, no outbox) unless the owner has an external link to it — if kept, route it through `useOutbox` with a client idempotency key and fix the km/m unit. Decide with owner input.

### Phase 3 — Concurrency & money-path hardening (carried)

14. **C2 — One write-set for punch+derivation** in `rpc` (`record_punch(...)` Postgres function doing insert-log + unique-key conflict swallow + return) or `serializable` discipline around `logs:createLog` → `deriveForUser`; prove the double-tap case in the integration lane; document the `unique(userId, idempotencyKey)` constraint as the belt already in production (`f8554e2`).
15. **B7 — Audit trail for manager power.** Every `setManagerSites`/`promoteToManager`/`demoteManager` writes an audit row `{actorId, action, targetUserId, before, after, at}` into an `adminAudit` table (or reuse the review-resolution shape) **before** the mutation commits; demotion archives `managerSites` rows instead of deleting. Test: promote → demote → audit trail shows both with before/after.
16. **C2b/C8 — `shiftOverrides` uniqueness.** `CREATE UNIQUE INDEX shift_overrides_unique ON public."shiftOverrides" ("userId", "shiftKey", "createdAt")` is wrong (history wanted); instead enforce latest-wins explicitly and add `unique(userId, shiftKey, endedAt)` only if duplicates prove harmful — otherwise document. Lower priority.

### Phase 4 — Structural: shrink the blast radius (P2)

17. **B8 + B10 — Kill the residual `collect()`/`bump` over-broadening.** Narrow `travel:recordFix → ["travelSegments"]`; replace crew `collect()`s with per-managed-site `by_site` probes (managed set is small); range-cap leg queries via `by_departed` with a cutoff. `EXPLAIN` evidence in the PR.
18. **B9 — Make incremental migrations self-contained.** Append `create or replace view public.jpay_id_registry as … union all select …` for `travelSegments`/`shiftOverrides`/`managerSites` + `NOTIFY pgrst, 'reload schema';` to `0005/0006/0007` (or ship `0008`). Fresh installs unaffected; existing installs recover cache-miss lookups and drop PGRST 404s.
19. **U8 — One `runAction` helper** (busy + try/catch + `setMsg(errMsg(e))`) applied to every destructive/stateful button; retire the `.catch(() => {})` pattern. No behavior change besides visible errors + no unhandled rejections.
20. **U9 — Zero-scroll escape hatch.** Below a breakpoint, stacked tab containers get `overflow-y: auto` (container queries or `md:` gate); keep `overflow-hidden` only on `md+`. Verify 390×667 and 568×320.
21. **U10 — Popup-preserving map refresh.** Diff markers by row id instead of `clearLayers()`, or skip redraw while `map._popup` is open. One shared `LiveCrewMap` component for moderator + manager (**U13**), killing the 85 % duplication and the double invalidation bump.
22. **U11 — Notifications rewrite.** Tri-state `useState` initialized `"unknown"` + effect (no hydration mismatch); disable toggle; reflect actual subscription state; `.catch` on `navigator.serviceWorker.ready`.
23. **U12 — A11y batch.** Roving-tabindex tablist with `aria-controls`/`labelledby` (one shared `ConsoleTabs`); extract `FocusTrapModal` (copy `geofence-modal.tsx`) for the three ungated modals in `page.tsx` + Escape + body scroll lock; tri-state initializers kill the flash-of-ungated-content; 44 px confirm targets.
24. **U13 — Decompose `moderator/page.tsx`** (1,057 → per-tab `*Panel.tsx` siblings; `ModeratorEmployee`/`AuditLogRow` types; delete `any`/`as never`), and **C5** (`check-in-card.tsx` → `useCheckInController`). Two separate sessions; behavior-preserving; e2e before/after.
25. **U14 — Scope the 1 Hz tick** to the timer readout (child state or subscription), not the card root.
26. **C8 — `api.ts` type-safety:** generate a string-literal `FunctionRef` union from the registry at build time; kill `any` on `api.*`; fold in `paginate()` decide-or-delete and the `!= null` sentinel.

### Phase 5 — Backlog, advisories, and proof

27. **C3 — `npm audit`**: bump or override the `@serwist` → `minimatch`/`glob`/`zod` advisory chain; re-run `npm run build` + smoke. If only dev-scope, document and defer explicitly.
28. **C4 — CI reality:** either add a nightly e2e lane (Playwright against a preview deploy) and a `tests-layout` smoke, or delete the unexecuted probes. Decide; do not leave zombie gates.
29. **C6 — Housekeeping** (separate chore commit): root PNGs → `docs/ops/screenshots/` or delete; `.agents` vs `.claude` skills tree reconciliation (owner call — do not mass-delete).
30. **P3 batch** — one commit series, zero behavior change: the P3 table §1. Includes `ShiftTimer` mount-frozen label fix, `--amber`→`--hivis`, locale aria-label, `use-pagination` clamp, payroll window recompute, `revokeObjectURL` deferral, dead `__JPAY_LAST_EMPLOYEE_EMAIL`, `promotable` dead branch, (0)-vs-loading guards, `eat`/`.eq(null)` invariant note.
31. **Deploy-verify like the previous phases did:** after the last commit, prod `GET /api/backend/call` → 403; one punch → re-derived shift; manager sees crew (post-0.4); travel consent → disclaimer ack → off-site exit → manager pin moves → revoke in app → pin clears and leg flags `consent_revoked`. Screenshot evidence in the PR/notes file.
32. **Re-audit at close:** re-run preflight + this plan's verification checklist; expected `S_health ≥ 70` with `N_P1 = 0`. Update the score in this file.

---

## 3. MVTH additions (Minimal Viable Test Harness)

1. **Adapter predicate-under-limit** (`test-db-adapter.mjs` extension): with 100 push-matching rows and a predicate rejecting 3 of the newest, `take(100)` returns **100 older** rows; `first()` with the same predicate returns the oldest matching row, not `null`; `unique()` on one matching row returns it, not a throw.
2. **Consent-revoke integration** (stub or Playwright): consent → off-site fix → `setConsent(false)` → assert leg `arrivedAt` set, `needsReview`, `reviewReason: "consent_revoked"`; and a consent-revoked user's subsequent `recordFix` creates **no** sample.
3. **Out-of-order fix table test** (pure): `[t=5000, t=4000]`, replay of last fix, `legMs=0`, `t <= last.t` → `{status:"duplicate"}`, distance additive only forward.
4. **Derivation-failure surfacing**: stub `deriveForUser` to throw; assert closed shift carries `needsReview: true, reviewReason: "derivation_failed"` and a `systemEvents` row exists.
5. **Session-bootstrap bucket**: 11th master attempt → 429 (use fake timers or a low cap in test env).
6. **Check-in double-tap**: Playwright — double-click `checkin-submit` on the device-activation path; assert exactly one `logs` row (stub or count query).
7. **Outbox head-of-line**: stub first entry to reject `PAYROLL_SEALED`; assert entries 2..n still flush and the rejected entry is dropped with a visible notice.

## 4. Explicit non-goals / do-not-touch

- Do not redesign payroll, shift grammar, or the outbox architecture — they are sound and tested; this plan only fixes the listed defects.
- Do not re-open ADR-004, the docs sync, or the P0 gate — verified intact.
- Do not apply migrations or set env vars from an agent session — Phase 0 is the owner's, by design (migrations carry no rollback).
- Do not mass-delete `.agents`/`.claude` or e2e probes without owner instruction.
- No push without explicit owner ask; `main` stays local until Phase 0.4 clears.

## 5. Suggested session breakdown

| Session | Scope | Exit gate |
| :--- | :--- | :--- |
| S1 | Phase 0 checklist walkthrough (owner) + B1 + MVTH#1 | under-fill tests red→green; `npm run verify` |
| S2 | B2 + B4 + B3 + MVTH#2/#3 | consent + replay tests green |
| S3 | B5 health probe + B6 bucket + C1 + MVTH#4/#5 | verify green; prod probe route documented |
| S4 | U1 + U2 + U6 + MVTH#6 (consent UX + tracking chip) | Playwright double-tap green |
| S5 | U3 + U4 + U5 + MVTH#7 | maps render on error; outbox unblocked |
| S6 | C2 + B7 + B9 + B8/B10 | EXPLAIN diffed; audit rows visible |
| S7 | Phase 4 structural (U8–U14) in 2–3 commits | e2e before/after parity |
| S8 | Phase 5 backlog + P3 batch + redeploy + re-audit | `S_health ≥ 70`, `N_P1 = 0` |

**Score note:** with everything in Phases 1–3 landed (`N_P1 = 0`, `N_P2 ≈ 4` residual, `N_P3 ≈ 10`), `D_raw ≈ 22`, `S ≈ 88` — LOW. Each deferred P1 keeps the rating in HIGH, regardless of how green `npm test` looks.

---

*Files referenced as evidence: `docs/audits/surgical-audit-2026-11-10.md` (prior audit), `src/lib/backend/db.ts`, `convex/travel.ts`, `convex/shifts.ts`, `convex/manager.ts`, `convex/moderator.ts`, `src/app/check-in-card.tsx`, `src/app/use-outbox.ts`, `src/app/page.tsx`, `src/app/notifications.tsx`, `src/app/privacy/page.tsx`, `src/app/api/auth/session-bootstrap/route.ts`, `supabase/migrations/0004–0007`, `src/lib/backend/react.ts:75`, `.github/workflows/gates.yml`. All listed P1/P2 coordinates were spot-verified in-tree. Zero source files were modified by the audit pass; this plan is the only new artifact. The live probe ran headless Chromium against a dev server on :3137 (subsequently stopped); the chrome-devtools MCP reported "Target closed" and was not usable; no authed-role probe was performed (no test credentials available) and no production interaction occurred.*
