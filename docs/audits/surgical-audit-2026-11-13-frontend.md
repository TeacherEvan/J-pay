# Surgical Audit Report: J-Pay — Frontend (Next.js / React / PWA), post-`f9df247`

| Audit Metadata | Specification |
| :--- | :--- |
| **Audit Date** | 2026-11-13 (same day as `surgical-audit-2026-11-13.md`, different scope) |
| **Audited Scope** | `src/app/**`, `src/components/console/**`, `src/lib/{react.ts→`backend/react.ts`, outbox, safe-storage, use-user-locale, format, csv, errors}` — **54 implementation files, ≈7,200 effective LOC** (5,670 LOC preflight `src/app` + 621 LOC `src/components` + ≈900 LOC client-side `lib` layers) |
| **Tech Stack & Runtime** | Next.js 16.3.3 (`--webpack`) · React 19.1 · Supabase JS · `@serwist/next` PWA · Leaflet 1.9 · Tailwind 4 · TypeScript 5.9 strict |
| **Audited Commit / Tree** | `f9df247` at audit time; the tree moved to **`2cc52b0`** ("chore(j-pay): surgical pruning") mid-session. Verified the full delta (`git diff f9df247 2cc52b0 -- src/`): 11 files, 13 insertions / 63 deletions — export de-linking, removal of dead CSS (`.btn-surgical-cyan`, `.status-pip-*`, `.pulse-soft`) and two dead `function-refs.ts` entries. **No behaviour changed; no finding in this report is invalidated.** Figures quoted against the old tree (e.g. "46 hardcoded colour literals", globals line counts) shift by <5 lines |
| **Pre/Post Audit SHA-256 (`src`)** | `e1abe9f154f0c216bc07b868ece3ad9defec9a55c497dcca033b976fca1929da` / **VERIFIED ZERO MUTATION** (same digest re-run after the swarm completed; re-checked post-report) |
| **Method** | Surgical-orchestration swarm (Job 1 check-in surface, Job 2 moderator console, Job 4 client-platform layer, all 3 returned and code-verified by this orchestrator) + an **orchestrator-executed partial Job 3** (payroll/auth/layout/manager/messaging surfaces) because both subagent retries hit the provider's free-quota limit and the code-reviewer verifier died on a model outage — see §8. Findings below that were not executed-reproduced were verified by manual code read with quoted lines; the highest-risk P1s were re-opened and re-read here |
| **Deterministic Health Score** | **`36 / 100`** (`D_raw = 148`, `P_test = 8.7` @ `M_kill = 42%`, `N_P0 = 0`, `N_P1 = 10`, `N_P2 = 18`, `N_P3 = 14`, `LOC_eff = 7,200`) |
| **Vibe-Debt Risk Level** | **CRITICAL (formula band)** — driven by ten P1 findings outside the crash/data-loss category, **not** any P0. Do not read this as "the app is broken"; read it as "ten money/trust/UX integrity failures are one regression away from being live". The score saturates when nothing client-side has a truthful test harness |

---

## 1. Executive Architecture & Vibe-Debt Triage

The frontend is the one layer of J-Pay where correctness is never enforced. The single-door backend (`/api/backend/call`, deny-by-default server gate, service-role only) is genuinely solid, but the browser reimplements trust decisions: the **check-in card derives "am I on shift?" from `logs[0]`** (CREATED order) instead of work-time order, so an offline punch synced after a live checkout flips the UI back to "on shift" with the checkout button re-armed. **Three separate write paths in the revamped moderator console survive an org switch**, so a moderator sitting inside org B can rewrite org A's site assignments — or, money-affecting, end org A's shift at the wrong instant with the wrong payroll re-derivation. **Every read path in the console is server-scoped to the org (clean), but every audit filter is applied client-side over a 50-row newest-first window**, so geofence violations and per-employee history silently disappear. **The payroll panel builds its ISO-week window in the browser's timezone while the server buckets in the site's timezone** — the previously reported F2 is *still present* and still under-pays night-shift workers. **The client transport has no timeout**, so a never-settling request pins the in-flight dedup map forever: the button stays "Checking in…", the spinner stays up, `retry()` is a no-op for that key. Finally, **the honest query hook (`useQueryResult`) exists, is already wired in payroll and messages, and yet 29 of 35 read call sites still use the lying `useQuery`**, so an outage renders a fully-staffed org as "off shift" and the KPI banner as an endless skeleton with no error surface, no retry affordance.

| Severity Tier | Count | Deduction | Primary Failure Domains |
| :--- | :--- | :--- | :--- |
| **P0 — Critical** | **0** | — | *(none verified; client never holds the money, the server gate holds)* |
| **P1 — High** | **10** | `−80` | MT1 transport timeout · 1.2 phase derivation · 2.1 cross-org assign write · 2.2 drawer stale form · 2.3 shift-override stale openId · 2.4 audit 50-row truncation · 2.5 browser-tz corrected end · 4.1 29 lying `useQuery` sites · 4.2 generation-blind dedup · F2 payroll week window |
| **P2 — Medium** | **18** | `−54` | travel indicator ref-stale · consent revoke keeps route history · non-secure-origin idempotency crash · offline-enqueue punch loss · outbox infinite retry/`void flush()` · chips keyboard trap · device-clock throttle · KPI≠roster · swallowed `undefined` errors · duplicate DOM id / broken tablist · LocaleCell uncontrolled · O(members×limit) audit fetch · unconfirmed archive · fail-open org filter · `clearUserFilter` never clears · internal handler type surface · `text-[9/11px]` a11y gate blind spots · SW never takes over / scroll-trap map / popup-freeze redraw |
| **P3 — Low** | **14** | `−14` | stale `locationError` · circular import · hydration desync · raw server text in banner · map rebuild churn · `panTo` override · internal `FunctionRef` aliases · 9 px text · no light scheme/safe-area · private `_popup` · hex drift vs tokens · RateCell silent NaN |

### High-Risk File Telemetry Hotspots (this scope)
| File Path | Eff. LOC | CC / Depth | Silent Catches | Primary Vibe-Debt Signature |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/payroll.tsx` | 475 | 1 / 6 (metric under-reads control flow) | 0 | Browser-tz money window · ISO/Ortho split between panel and server · unkeyed effect re-anchor |
| `src/components/console/live-crew-map.tsx` | 333 | 19 / 6 | 0 | Private-API popup guard freezes redraw · full teardown/rebuild every 45 s |
| `src/app/check-in-card.tsx` | 375 | 23 / 6 | 0 | God component: shift engine + GPS watch + consent + submit + timeline |
| `src/app/check-in/live-submit.tsx` | 249 | 14 / 6 | 2 | F1 fixed but transport latch survives · unvalidated outbox replay |
| `src/app/moderator/employee-drawer.tsx` | 219 | 1 / 5 | 0 | Override form state survives subject change (cross-org money write) |
| `src/app/moderator/audit-view.tsx` | 223 | 1 / 4 | 0 | Client-side filter over server-truncated 50-row window |
| `src/lib/backend/react.ts` | 468 | 20 / 4 | 0 | Two query hooks with opposite error contracts; dedup not generation-aware |
| `src/app/moderator/side? (assign/managers/shift-overrides)` | 3 × ~150 | 4–17 / 5 | 0 | Panel-local state outlives the org context it renders inside |

---

## 2. The 10-Principal-Engineer Deep Audit

> Lens-by-lens explicitly called out. Where a lens does not materially apply to *this* scope it is marked N/A with the reason — no lens was silently skipped. Every P1 was re-read in the current tree by this orchestrator (see §8).

### Lens 1 — Systems Architect (Topology, Coupling & State Machines)
**[P1-2.1] Cross-org write via panel-local state surviving an org switch** — `src/app/moderator/assign-panel.tsx:21-22,70-87`, `src/app/moderator/managers-panel.tsx:28-30,134-150`, `src/app/moderator/shift-overrides-panel.tsx:39-41`
- **Root cause:** `OrgProvider.setOrgId` resets only its shared context (`org-context.tsx:69-80` — clears `focusUserId`, `userFilter`); the panels own `useState` that is never reset and the components are never keyed (`page.tsx:130,161`), so React preserves state across the org change.
- **Trigger:** Org A → assign employee E to site S → switch to org B → press **Save assignments** → `setEmployeeSites({userId: E_A, siteIds: [S_A]})`. The server boundary check `orgBoundaryOk(orgA, orgA)` (`convex/sites.ts:147`) passes — the ids are internally consistent, so the write is legitimate *into org A while the console displays org B and reports "Saved"*. `eraseOrgUI` does not run. Identical for `setManagerSites` and `promoteToManager` (`convex/manager.ts:326,390`).
- **Fix:** `key={orgId ?? 'none'}` on the org-scoped content wrapper, `EmployeeDrawer`, and the panels in `src/app/moderator/page.tsx`; plus `useEffect(() => reset(), [orgId])` inside each panel as defence in depth.

**[P1-2.2] Drawer's shift-override form replays into a different employee / org** — `src/app/moderator/employee-drawer.tsx:40-45,159-200`, `src/app/moderator/page.tsx:161`
- **Root cause:** `endOpen/endWhen/endReason` live in the drawer; the drawer returns `null` (unmount) only when `focusUserId === null` but keeps state when `focusEmployee` changes; the Save button is gated only on `!endWhen || endReason.trim().length < 10`.
- **Trigger:** Org A → open X → **End this shift (override)** → type ≥10-char reason → close drawer → switch to org B → open Y (active shift). The form is already expanded, pre-filled with X's end-time and X's reason; **Save override** calls `endShift` with Y's shiftId and X's payload → org B's payroll is re-derived off a bogus end-time (`convex/moderator.ts:261`).
- **Fix:** reset `endOpen/endWhen/endReason/note` in `useEffect(..., [focusUserId])` in the drawer and/or remount it by key; never pre-fill `endReason` across subjects.

**[P1-2.3] Shift-override panel keeps org A's shift id open against org B** — `src/app/moderator/shift-overrides-panel.tsx:39-40,90,111-135`, `src/app/moderator/page.tsx:144-151`
- **Root cause:** panel instance not remounted, `openId` not reset; `endShiftOverride` (`convex/moderator.ts:234-264`) validates moderator role, sealed and QA but **has no org check**.
- **Trigger:** Org A → expand "Override end" on shift S → type reason → switch to org B → **Save override** → the server accepts it (no org-boundary check), inserts an org-A `shiftOverrides` row and re-derives org A's payroll, all from the org-B console.
- **Fix:** reset `openId/when/reason` on `[orgId]`; key the panel on `orgId`; **and** resolve the shift's owner org inside `endShiftOverride` and reject on mismatch (defense in depth).

**[P2-1.11] `check-in-card ⇄ ShiftTimer` circular import + 3 dead imports** — `src/app/check-in/ShiftTimer.tsx:3`, `src/app/check-in-card.tsx:7-9,27`
- **Root cause / Trigger:** `formatMinutesShort` crosses the import cycle; render-time-only consumption today. Dead: `OutboxEntry`, `useOutbox`, `errMsg`.
- **Fix:** move `formatMinutesShort` to `src/lib/format.ts`; delete dead imports.

**[P1-2.4] Server-side audit truncation renders violations invisible** — `src/app/moderator/page.tsx:37` (`limit: 50`), `src/app/moderator/audit-view.tsx:35-49,84`, `convex/moderator.ts:25-41`
- **Root cause:** `auditRecentLogs` takes `limit` per org member, merges and slices to `limit`; the client then filters that window (`audit-view.tsx:40-44`) and paginates it, header still says "Audit log · 7 days".
- **Trigger:** 400 log rows / 7 days; the only geofence violation is at row 120. Moderator clicks the `geofence` chip → **0 rows**. Second trigger: employee Z has a full day of check-ins; the drawer's **Audit →** sets `userFilter` → the newest-50 org-wide window contains none of Z's rows → empty log for a heavy day.
- **Fix:** push `userId`, `flag`, `offset` into `auditRecentLogs` (it already accepts `orgId` + `limit`) and request the filtered page; or at minimum render "newest 50 of the last 7 days" + the true count.

### Lens 2 — Frame-Budget & Performance Engineer
**[P2-2.1] KPI "Active on site" counts open shifts, roster counts geofence" — `src/app/moderator/kpi-banner.tsx:9-26`, `src/app/moderator/live-view.tsx:38`, `convex/kpi.ts:52`** — definition mismatch, banner contradicts the roster beneath it.
**[P2-2.2] `useQuery` folds errors into `data:undefined` → every employee renders "off shift" when the live query fails** — `src/lib/backend/react.ts:350-373`; consumer sites: `src/app/moderator/live-view.tsx:27,93`, `kpi-banner.tsx:9-19` (permanent pulsing `aria-hidden` skeleton), `src/app/page.tsx:36,107-119` ("Loading…" forever), `src/app/manager/page.tsx:43-72` (same), `check-in-card.tsx:53,54,72`, `ShiftTimer.tsx:21,39`, `manager-map.tsx:10-11`, `messages-panel.tsx:19-20`, `managers-panel.tsx:22`, `org-panel.tsx:17`, `shift-overrides-panel.tsx:35`, `notifications.tsx:29`, `use-user-locale.ts:15` — **29 call sites** vs 6 `useQueryResult` sites (`messages.tsx:18-19`, `payroll.tsx:113,122,131,427`). A failure is indistinguishable from an empty org; retry is absent.
- **Trigger:** Any non-2xx on `POST /api/backend/call` for `moderator.activeShifts` (500 from a DB error). The banner skeleton pulses forever, the roster chips every employee "off shift", no error is announced.
- **Fix:** migrate all 29 sites to `useQueryResult` + reuse `<QueryError>`; delete `useQuery` entirely.

**[P2-2.5] O(members × limit) audit fetch on every 45 s tick** — `convex/moderator.ts:32-41` (one indexed query per member, then slice), plus `kpi.summary`/`activeShifts` unbounded finds.
**[P2-redraw] Map rebuilt from scratch each refresh** — `src/components/console/live-crew-map.tsx:175-321` (≈120 SVG objects per tick), plus `mapRef.current.panTo` overrides the operator's pan (`:308`).
**[P3-gesture] Map is a scroll trap** — Leaflet sets `touch-action:none`; `live-crew-map.tsx:158`. `scrollWheelZoom` still on.

### Lens 3 — Mathematical, Physics & Algorithmic Engineer
**[P1-F2] Payroll panel builds its ISO week in the BROWSER timezone, server buckets in the SITE timezone (still present)** — `src/app/payroll.tsx:61-85` (`new Date()` local midnight; `getDay()` Monday anchor; `fromMs`/`toMs`) vs `convex/payroll.ts:51-74` (site `timezone` via `localDayKey(startedAt, siteTz)`) with period boundaries keyed off the site's ISO week.
- **Root cause:** Two clocks decide "which week is this." The panel's week begins at *browser-local* midnight; the worker's shift on the Monday is persisted with a `startedAt` whose site-day key lies in a *different* week.
- **Deterministic trigger:** worker in Africa/Johannesburg, browser in a different IANA zone (travel laptop, a container, or a cross-border crew). The ISO-week anchor differs by `±(tz - siteTz)` hours; the first worked day of the week is **selected in one window and bucketed in the other** — the day either vanishes from the panel or is paid twice across consecutive panel weeks.
- **Fix:** accept `fromDay`/`toDay` **strings** computed server-side in the site's timezone (widen the shift query to the ISO weeks touching them, compute, then slice for display). ISO recursion already exists via `localDayKey`.

**[P2-voice] LocaleCell silently no-ops on NaN** — `src/app/moderator/action-cells.tsx:87-103` (`if (… && Number.isNaN(n)) return;`); **RateCell NaN swallow (same class)**.
**[P3-9px / 11px a11y floor defeated by 9 px text** — see Lens 9.
**[P2-revision?] `getDay` ISO anchor bug checked** — `(d.getDay() + 6) % 7 === 0` selects Sunday-not-Monday as a week boundary and pushes `weekOffset` by full weeks; correct for ISO weeks, but combined with the browser/site tz drift it is the concrete trigger above.

### Lens 4 — Concurrency, Async & Determinism Engineer
**[P1-MT1 / JOB4-P1-3] The client transport never times out and cannot settle** — `src/lib/backend/react.ts:148-155` (bare `fetch`, no `AbortSignal`, no timeout), pinned at `Promise<unknown>` awaited forever at `src/app/check-in/live-submit.tsx:171`
- **Root cause:** Browser fetch has no wall-clock limit; a connection that is accepted but never answered never settles, so the `finally` at `144-149`/`213-230` never runs; `inFlightQueries` keeps the key forever (`review`: `existing = inFlightQueries.get(cacheKey)` unconditionally returns the pending promise), making `useQueryResult.retry()` a no-op for that key.
- **Trigger:** captive portal / half-open mobile connection / stalled proxy. The check-in button stays `disabled` forever (the F1 symptom) or a console panel skeletons forever.
- **Fix:** `signal: AbortSignal.timeout(15_000)` in `callBackend`, map abort → `BackendError("TIMEOUT")`, evict the dedup entry on settle, and add a watchdog clear in `checkIn()`. Extend `scripts/test-checkin-busy-latch.mjs` with a never-resolving-stub case.

**[P1-4.2] In-flight dedup is generation-blind** — `src/lib/backend/react.ts:139-144,185-190`
- **Root cause:** The dedup map returns the *existing* promise for a key regardless of when a newer invalidation fired; nothing stamps a generation/version on the entry, so an invalidation triggered by a mutation that lands mid-flight is satisfied by the pre-mutation promise.
- **Trigger:** `mutation commits at T` while same-key query started at `T−Δ`, `Δ < RTT`. The bump from the mutation's `write-set` → tick → effect re-runs → `callBackend` returns the **pre-mutation** promise. No new request is ever issued for that key for at least one further RTT/invalidation; payroll/messages have no periodic bump at all → indefinite stale view.
- **Fix:** stamp each entry with the invalidation version; if `callBackend` is invoked with a newer version, bypass dedup and issue a fresh request.

**[P2-4.3] Failed refetch discards the last good data (no SWR)** — `src/lib/backend/react.ts:270-280` (`data: undefined` on error); `retry()` also never clears the old error — `:287-293`.

**[P2-site-map] Superseded geocode response wins** — `src/app/site-map-picker.tsx:102-112` (no latest-request id / no `AbortController`; unvalidated `data as Hit[]`).

### Lens 5 — Memory & Resource Lifecycle Engineer
**[P2-consent] Revoking travel consent stops collection but never deletes collected route history** — `src/app/check-in-card.tsx:298-305` (`setConsent({consent:false})`) → `convex/travel.ts:42-68` clears `travelConsentAt` + closes segments `needsReview`, but `pathSamples` and aggregates survive for `retentionDays = 90` and remain visible to managers. The button copy reads "Pause tracking … this shift" but the server performs an irrevocable shift-wide revocation.
- **Fix:** on revoke, purge the user's open `travelSegments` (`pathSamples: []`, zeroed aggregates) in the same mutation; rename the control and add confirm.

**[P2-idle?40s] `TodayStrip`/`ShiftTimer` re-render 1 Hz forever** — `src/app/check-in/ShiftTimer.tsx:80-84` (no phase gate).
**[P3?] 45 s redraw layer rebuild** — covered in Lens 2.

### Lens 6 — Security & Trust-Boundary Engineer
**Client never holds the money verdict** — pay/hours/geofence are server-owned; the console sends IDs only (verified across `deactivateEmployee`, `setUserLocale`, `setHourlyOverride`, `setEmployeeSites`, `promoteToManager`, `endShiftOverride`). **Negative evidence is clean.**
**[P2-4.7] The client bundle nonetheless advertises internal handlers** — `src/lib/backend/api.ts:30` (`export const internal: any = makeNamespace()`) and `src/lib/backend/function-refs.ts` types `logs:createLogAs`, `shifts:deriveForUser|markDerivationFailed`, `users:resetPasswordBreakGlass`, etc. into the browser. **The server deny-by-default gate holds** (`src/lib/backend/runtime.ts:313-317,479-491`) and is proven by `scripts/test-invoke-gate.mjs` — so no behaviour is exploitable today. This is a **type-surface lie**, costing DX + shipping bytes every release, and removing the last red line for a future hand-rolled client call.
**[P2-rate] `FUNCTION_ERROR` passthrough renders raw server text in the UI banner** — `src/app/api/backend/call/route.ts` (probed at HEAD: `{ error: code, message: error.message }` for *all* paths), `src/lib/errors.ts:13-23` (falls through to raw message), rendered verbatim by `<QueryError>` — leaks schema/DB detail (e.g. `"shifts: relation ... does not exist"`).
**[P2-2.odo? no] Auth UI posture is acceptable:** the `/login` route is a redirect stub, not a rival auth UI; the **master break-glass provider** (`SignIn` tries `password` then `master` with the same field as `secret`, `src/app/sign-in.tsx:17-26`) is the documented BOOTSTRAP_KEY-gated recovery path — verified, not a defect, keep it out of the type harvest.
**[P3-locale-uncontrolled] LocaleCell / RateCell fire invisibly** (action-cells) — see Lens 3.
**[P2-archive] Org archive is a single unconfirmed click** — `org-panel.tsx:106-124`, unlike the two-step confirm pattern used by `DeactivateButton`.

### Lens 7 — Reliability, Fault Tolerance & Chaos Engineer
**[P2-2.h] The outbox cannot see corruption** — `src/app/check-in/live-submit.tsx:64-84` (`flushOne` casts `entry.siteId as Id<'sites'>` with **zero shape validation**) + `src/app/use-outbox.ts:41` (the PERMANENT regex classifies only known strings; a validator mismatch → "skipped" → infinite retry every 15 s) + `:65-69` (`flush()` has **no `catch`**, invoked as `void flush()` at `:76,84,86` → unhandled rejection) + `refresh()` coerces every failure to `0 queued` (`:27-29`).
- **Trigger:** store a corrupt entry in IndexedDB (devtools or an old app version) → the punch *never* drains and the UI lies about the queue size; a blocked IndexedDB logs a silent unhandled rejection.
**[P2-Enqueue.]** `enqueue` is unguarded at `live-submit.tsx:166,196` — an IndexedDB failure loses the punch outright while the user sees a raw JS message ("indexedDB is not defined").
**[P2-latch? no]** `locationError` never clears — `check-in-card.tsx:165-173` — one tunnel GPS drop leaves a permanent "tracking paused" banner while fixes are flowing again.
**[P1-MT1]** see Lens 4 (a *never-settling* request is also an *unbounded retry*).

### Lens 8 — Type Systems, Schema & Contract Engineer
**[P3-any-default] `useQuery`/`useQueryResult` default to `T = any`** — `src/lib/backend/react.ts:199,217,297`; every call site hand-casts (`as CrewRow[]`, `as OrgRow[]`, `as never`) so the compiler is blind to server shape drift.
**[P3-AudiLogRow userId missing]** — `src/app/moderator/types.ts:17-32` (`AuditLogRow` omits `userId`) yet the filter depends on it — `audit-view.tsx:39,47` casts `(l as { userId?: string }).userId`. A server rename compiles clean and empties the filter silently.
**[P2-x? types file not wired]** `types.ts` says "Shared moderator-console row types (kill the any-soup)" — the casts below prove the war is not won.
**Positive evidence:** `useQueryResult<PayrollResult>` with typed `PayrollResult` in `payroll.tsx:113` and `useQueryResult<any[]>` in `messages.tsx` show the correct pattern — it just isn't the default.

### Lens 9 — Platform, Viewport & Portability Engineer
**[P2-a11y-9px] App renders metadata text at 9–11 px and the gate misses it** — `scripts/test-a11y-statics.mjs:6,27` (walks **only `src/app`**, forbids `text-[10px]`/`text-[11px]` but **not `text-[9px]`**), while `src/components/console/query-error.tsx:21` renders `text-[11px]` and `src/app/manager/page.tsx:246` renders `text-[9px]`.
**[P3-safe-area] No `viewport-fit: cover` + no `env(safe-area-inset-*)` anywhere** — `src/app/layout.tsx:15-20`; `appleWebApp.statusBarStyle: "black-translucent"` in a notch phone cuts the header/tab bar.
**[P3-light] No `prefers-color-scheme` branch** — `globals.css` is dark-only with 23 tokens and **46 hardcoded colour literals outside the token layer** (e.g. `globals.css:145,155,165,175,312-313`).
**[P2-contrast? live-crew-map hex drift]** `SITE_COLOR = "#22d3ee"`, `TRAVEL_COLOR = "#fbbf24"` ≠ tokens `--cyan` (oklch(0.76 0.170 215)) / `--hivis` (oklch(0.82 0.190 75)) — the legend swatches desync from the marks.
**Good:** `prefers-reduced-motion` and coarse-pointer tap-target rules exist (`globals.css:342-352,474-491`).

### Lens 10 — Cognitive Load & AI-Context Maintainability Engineer
**[P2-2.e] 5 duplicate `useState` org-selection states in 4 panels** — assign/managers/shift-overrides/drawer all keep their own selections; the one place that says "we are in org B" cannot reach them.
**[P2-1.11]** circular import cycle again.
**[P3?] Payroll effect re-anchor `dayKey` missing from deps, documented via eslint-disable** — `payroll.tsx:67-83`.

**Explicitly N/A:** Lens 3 on PWA/manifest (no numeric logic); Lens 2 on frame budget for CSS-driven panels (verified no per-frame allocations in `requestAnimationFrame`/`useEffect(render)`; the 1 Hz timer is correctly confined to `ShiftTimer`).

---

## 3. Existing Test Suite Comparison & Mutation Truth Table

- **Frontend-scope test ratio:** **0 / 54** browser-facing modules receive a real behavioural test. The strongest client-adjacent tests (`test-use-query-loop`, `test-react-adapter-dedup-worker`, `test-checkin-busy-latch`) cover `src/lib/backend/react.ts` and **one** component (`LiveSubmit`) — and nothing about the moderator console, payroll window, or the map.
- **Estimated Mutation Kill Score ($M_{kill}$): 42%** — basis recorded below.

| Implementation Module | Critical Functions / Branches | Paired Test File | Pathologies Detected | Mutants Killed (M1-M4) | High-Priority Missing Assertions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `src/app/check-in-card.tsx` | `phaseOf(logs[0])`, consent/revoke, watch lifecycle | `NONE` | Untested | 0/4 | phase after offline replay lands last; revoke purge; locationError cleared |
| `src/app/check-in/live-submit.tsx` | `checkIn()`/`runCheckIn()`, `flushOne` | `scripts/test-checkin-busy-latch.mjs` | Mock-Mirror on consent (copy in test); tautological geo cases | 1/4 → JOB1-P1-1 unreachable | never-settling createLog; enqueue failure; corrupt IndexedDB |
| `src/app/check-in/types.ts` | `phaseOf` | `NONE` | Untested-function (heavier than any lint) | 0/4 | table test per `Status` |
| `src/app/check-in/ShiftTimer.tsx` | interval cleanup, anchor math | `NONE` | — | 0/4 | tick fires; cleanup on unmount; elapsed formatting |
| `src/app/moderator/*` | assign/managers/overrides/drawer/org-context | `scripts/test-org-isolation.mjs`(server-side only) | Client untested | 0/4 | org-switch kills panel selection; cross-org write refused |
| `src/app/payroll.tsx` | ISO-week anchor, `weeks` selector | `scripts/test-payroll-rounding.mjs` (engine) | Engine tested; **panel untested** | 1/4 | fromMs/toMs vs site tz; week boundary off-by-one |
| `src/lib/backend/react.ts` | dedup, bus, `useQueryResult.retry` | `scripts/test-use-query-loop.mjs`, `test-react-adapter-dedup*.mjs`, `test-write-set` | Strong on loop; **none on hook error contract, dedup generation, retry** | 2/4 | retry clears error; dedup bypasses on newer version |
| `src/app/use-outbox.ts` | flush lock, PERMANENT regex | `scripts/test-outbox.mjs` | **Mock-Mirror** (mirrors the regex in the test) | 1/4 | infinite-retry on validator mismatch; `void flush()` unhandled rejection |
| `src/components/console/live-crew-map.tsx` | redraw, popup freeze | `NONE` (e2e existence-only) | Existence-Only | 0/4 | popup-open redraw suppression; layer teardown count |
| `src/app/globals.css` | tokens vs literals | `NONE` | — | 0/4 | build/parse + assert token count; assert hex-literal cap |
| `src/app/site-map-picker.tsx` | stale-geocode race | `NONE` | — | 0/4 | latest-request-id assertion |

### Basis for $M_{kill}=42\%$
- Assertions named in a negative/boundary signal (`toThrow`, `not.toBe`, `toBeNull`, `NaN`, `invalid`): 3 test files carry it (`test-punch-mutation`, `test-outbox`, `test-checkin-busy-latch` — strong), 2 are pure tautologies on literals (`test-geo.mjs` accuracy-gate lines 29-40 assert `51 > 50` on integers).
- `vi.mock` equivalents: **0** — the suite avoids mocks almost entirely (a strength) but compensates with **copied-in-test reimplementations** (`test-consent-revoke.mjs` defines its own `currentSetConsent`/`fixedSetConsent`, asserts against the copy, and is **not registered in `scripts/run-gate.mjs` — it never runs**).
- `test-a11y-statics.mjs` checks **spelling** of aria attributes, not behaviour (JOB1-P2-8 passes it).

### Why existing tests missed the discovered defects
- **[P1-MT1]** `test-checkin-busy-latch.mjs` stubs `createLog` with a settling promise; it never asserts the promise never settles.
- **[P1-1.2]** No test drives `logs[0]` through a device-replayed offline queue — the fixture seeds a pre-ordered array, so `[created desc]` order is never exercised.
- **[P1-2.1/2.2/2.3]** No test mounts an org switch; `test-org-isolation.mjs` exercises the *server* but the leak is entirely client-local state that the server cannot see.
- **[P1-F2]** Tests cover the engine's week (`test-payroll-rounding`), never the panel's; the panel's `getDay()` arithmetic is untested.
- **[P1-4.1]** `test-use-query-loop.mjs` asserts fetch *counts*, not the error contract — the hook returns a copy of `undefined` on failure and both are indistinguishable downstream.

### Minimal Viable Test Harness (MVTH) Specifications
1. **`LiveSubmit.checkIn()`** — table-driven: `{createLogStatus: "ok"|"throw DEVICE_TOKEN_INVALID"|"never-settle"}` × assert `busy === false` on *all* settling paths + `attempts` on the `never-settle` case via a fake timer.
2. **`CheckInCard` phase logic** — ordering table: `[arrived(08:00 live), checkpoint(12:00 queued offline synced 18:00), day finish(17:00 live)]` → assert `phaseOf(orderByWorkTime(logs)) === "off"` and primary label is `Check in`; the inverse ordering → `"on"`.
3. **Org-switch remount boundary** — react-test-renderer: mount provider, set `orgA`, set organisation label, assert each panel's DOM key changed; assert stale `userId` cleared.
4. **`useQueryResult.retry`** — assert `error === null` after `retry()` before the promise settles; assert a fresh request is issued for the same key (counter on a stubbed `fetch`).
5. **Map redraw** — jsdom Leaflet stub or canvas paint count: open a popup, wait 45 s, assert the map rebuilt at least once *or* the open popup's content moved.

---

## 4. Surgical Refactoring Blueprints (Zero-Mutation Drafts)

### R1 — Give the transport a deadline, elicit honest errors (P1-MT1)
**Target Scope:** `src/lib/backend/react.ts:148-155`, `src/app/use-outbox.ts:65-69`
**Engineering ROI:** removes the never-settling latch (F1-class) *and* the fake-`retry()` UX trap; 15 s worst-case latency for any failure.
```ts
// react.ts  (before)
const response = await fetch("/api/backend/call", { method: "POST", headers, body, ... });

// after
const ctrl = AbortSignal.timeout(15_000);
const response = await fetch("/api/backend/call", { method: "POST", signal: ctrl, ... });
// if (ctrl.aborted) → thrown AbortError → BackendError("TIMEOUT")
```
```ts
// use-outbox.ts  flush() — before: no catch; after:
export async function flush() {
  try { … } catch (e) { setLastError(e) } finally { … }
}
```

### R2 — Let the test suite see the ISO week it pays (P1-F2)
**Target Scope:** `src/app/payroll.tsx:55-90`, `convex/payroll.ts:47-75`
**Engineering ROI:** one boundary rule instead of two clocks; closes the previously measured R1 350 / week under-payment without adding an index.
```tsx
// before: const fromMs = <browser-local ISO-week anchor>;
// after: const fromDay = isoWeekMondayLocal(siteTz)   // string computed server-side
//        args: { userId, fromDay, toDay }               // server widens + slices
```

### R3 — Boundary the org (P1-2.1/2.2/2.3)
**Target Scope:** `src/app/moderator/page.tsx:130,144-151,161`
```tsx
const key = orgId ?? "__none__";
<div key={key} className="…">
  <EmployeeDrawer key={`${key}-drawer`} … />
  <AccessView /> <AuditView key={`${key}-audit`} /> …
</div>
```

### R4 — One read hook, one error contract (P1-4.1)
**Target Scope:** `src/lib/backend/react.ts:297-374` — **delete `useQuery`**, migrate the 29 sites. The compiler will find them all (the default is `any` only for the hook; the call sites type-check through).

---

## 5. Phased Execution Roadmap & Scoped Agent Prompts

**Phase 1 — Money & Trust Containment (P1)** — 910 min, highest ROI first.
1. **MT1** transport deadline + timeout error surface (R1). Add `test-livesubmit-timeout` stub case.
2. **F2** window moved server-side, site timezone (R2). Add a panel-level table test keyed off `localDayKey`.
3. **2.1/2.2/2.3** remount boundary (R3) — one line per panel, three commits.
4. **4.1** 29 call sites → `useQueryResult` (compiler-guided).

**Phase 2 — Honest Failure Surfaces (P2 subset)** — error `undefined` elimination; consent-revoke purge; outbox validation + bounded retry; LocaleCell controlled; `check-in-card` travel-mode indicator & `locationError`.
**Phase 3 — De-vibing & Test Floor** — wire `test-consent-revoke.mjs` into `run-gate.mjs`; a11y gate walks `src/components` and catches 9 px; add the MVTH table to `scripts/`; de-dupe the `useQuery` / `useQueryResult` exports; mark `types.ts` as the contract.

### Copy-Paste Surgical Prompts for Coding Agents
> **Prompt [MT1-1]:** "Edit only `src/lib/backend/react.ts` (`callBackend`). Add `signal: AbortSignal.timeout(15_000)` and an abort→`BackendError('TIMEOUT', …)` branch; on abort, evict the `inFlightQueries` entry before re-throwing. Add `scripts/test-t-timeout.mjs` asserting `fetch` is called with an abort signal and `errMsg` maps TIMEOUT to a user string. Do not alter any other file or the un-bundled test gates; run `npm test`."

> **Prompt [2.1-1]:** "In `src/app/moderator/page.tsx` add `key={orgId ?? 'none'}` to (a) the content wrapper, (b) `EmployeeDrawer`, (c) `ShiftOverridePanel`'s parent element, and reset each panel's local state in `useEffect(...,[orgId])`. In `employee-drawer.tsx` reset `endOpen/endWhen/endReason/note` on `[focusUserId]`. Add a focus-aware test that asserts panels remount on org change. Do not touch server files."

---

## 6. Verification Evidence (this audit)

| Command | Result |
| :--- | :--- |
| `python3 /tmp/opencode/audit/preflight_telemetry.py src` (patched prune set) | exit 0 — digest `e1abe9f154f0c216bc07b868ece3ad9defec9a55c497dcca033b976fca1929da` |
| `git status --porcelain` (before audit) | clean |
| `sed -n 144,155p src/lib/backend/react.ts` | no timeout / no `AbortSignal` — confirmed |
| `sed -n 150,168p convex/logs.ts` + `grep by_user_time convex/schema.ts` | `order('desc')` walks `_creationTime` — confirmed |
| `sed -n 33,50p src/app/moderator/audit-view.tsx` + `grep limit convex/moderator.ts` | `.take(limit=50)` per query then merge/slice — confirmed |
| `sed -n 55,85p src/app/payroll.tsx` + `sed -n 1,75p convex/payroll.ts` | browser `getDay()` ISO anchor vs server `localDayKey(siteTz)` — F2 confirmed present |
| `sed -n 144,230p src/app/check-in/live-submit.tsx` | single-`finally` F1 fix genuinely present; **transport latch survives** |
| `git rev-parse HEAD` | `f9df2475f354cdbff488828a535b2e4e5b199b55` at audit time; then `2cc52b0` (verified cosmetic-only delta) |

---

## 7. Operational Honesty — what this audit could NOT do (read before trusting the numbers)

1. **The Job 3 swarm lane (payroll/auth/manager/messages/layout) was executed by the orchestrator, not a subagent**, because both retries hit the provider's free-usage limit after the initial run terminated with no text; the code-reviewer verifier could not run at all (`anthropic/claude-sonnet-4-6: Model unavailable`). Findings for that lane are single-analyst and were re-read on disk, **not** double-checked by an independent agent.
2. **Zero live probes were run.** The skill mandates a browser probe for rendered/visual audits; no visual complaint was requested and none was executed — no claim in this report is measured from a running app.
3. **No test was executed** for this audit; $M_{kill}=42\%$ is a source-read estimate with its basis recorded in §3.
4. **Verification method for subagent claims:** the 3 completed jobs (check-in / moderator console / platform) were returned as full structured JSON and subsequently **re-opened file-by-line for the cited P1/P2 anchor lines**; the remaining P2/P3 findings were accepted from the swarm only when the quotes inside the report matched the tree. Where a claim was overstated relative to its evidence it was rescoped (dedup generation-blindness held but was tightened in Lens 4).
5. **Checks not run:** `check_consistency.py` / `check_diagrams.py` are docs-of-record gates, not code gates — intentionally not run as part of the verdict. No `npm test` or `tsc` was executed; the audit is read-only and stops at source.

---

## 8. Remediation Log (same day, after `dbd7a63`)

Two P1 classes were remediated red-first, one concern per commit. Remaining P1s are NOT fixed.

| Fix | Commit | State before → after | Verification |
| :--- | :--- | :--- | :--- |
| **MT1 — client transport had no timeout; never-settling request pinned the button + dedup map forever** | `1e4e094` (+`c595d45` for the `flush()` companion) | `fetch("/api/backend/call", …)` with no signal → `AbortSignal.timeout(__test_transport.timeoutMs /* 15 s */)`; abort → `BackendError("TIMEOUT")`; dedup entry evicted on settle; `errMsg` maps TIMEOUT to user copy; `useOutbox.flush()` no longer escapes as an unhandled rejection | New `scripts/test-transport-timeout-worker.mjs` (3 cases: signal passed, never-settling rejects with TIMEOUT, timed-out key evicted & retried). `npm test` 25/25 · `npm run verify` 29/29 |
| **F2 — payroll panel derived its ISO week in the browser zone; site-tz bucketing dropped/edged days** | `57ab0c2` | `fromMs/toMs` in the panel (browser-local Monday anchor) → `weeks/weekOffset/anchorMs` intent args; server computes ISO weeks **in the site's timezone** via new `src/lib/iso-week.ts::siteWeekRange` (end-at-current-week semantics); result carries `period{fromMs,toMs,fromDay,toDay,timezone}`; `ShiftTimer` "Today" strip → "This week"; `exportLogsCsv` bound to the server period's `fromMs/toMs`; `test-org-isolation`/`smoke-supabase`/`docs/E2E-FEATURE-MAP.md` migrated | New `scripts/test-iso-week.mjs` (9 table cases: UTC, SAST incl. behind-site zone at 05:00Z, NY DST transition, 2-week/4-week blocks ending at the current week, block-backed step). `npm test` 25/25 · `npm run verify` 29/29 |

**Remaining open items from this audit (NOT done):** P1-2.1/2.2/2.3 (org-desk remount boundary), P1-4.1 (29-site `useQueryResult` migration), P1-4.2 (dedup generation), P1-2.4 (server-side audit filters), P1-2.5 (browser-tz corrected-end), plus the full P2/P3 backlog. `exportLogsCsv` still accepts a raw `fromMs/toMs` window from the caller — it now receives the server-owned period, but the contract itself is unchanged (documented residual gap, same week-semantics class).

---

## 9. Zero-Mutation Verification

- `git status --porcelain` before this report: **clean**.
- After the full read phase the same command returned **clean** again (no source modified).
- `preflight_telemetry.py` re-run on `src` after the read phase returned the **same digest** (`e1abe9f154f0c216bc07b...`), i.e. zero byte change.
- Only files created by this audit are `/tmp/opencode/audit/*` and this Markdown report. No repository source, config or test file was edited.
