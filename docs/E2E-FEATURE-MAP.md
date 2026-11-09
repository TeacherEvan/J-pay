# J-Pay End-to-End Test Plan — Feature Surface Map

**Date:** 2026-08-25
**Scope:** Complete user-facing feature surface at `/home/leandi-duplessis/github/workspaces/J-pay`
**Method:** READ-ONLY enumeration of every interactive UI element, route, and reachable Convex function. No files were modified.
**Audience:** Author of the next-generation e2e test plan. The existing `scripts/e2e-full.mjs` is the baseline; this document maps what is *already covered* and what is the *gap*.

---

## 0. Routes discovered

| Route | File | Auth | Role |
|---|---|---|---|
| `/` | `src/app/page.tsx:49` | anon OR authed | employee (default) / moderator (link) |
| `/change-password` (route) | (not present as standalone — the password UI is mounted inside the home page) | authed | any |
| `/messages` (route) | (not present — `MessagesPanel` is mounted inline on home and on `/moderator`) | authed | any |
| `/notifications` (route) | (not present — `EnableNotifications` is mounted inline in home header) | authed | employee |
| `/moderator` | `src/app/moderator/page.tsx:17` | authed | moderator only |
| `/payroll` (route) | (not present — `PayrollPanel` mounted inside `/moderator`) | authed | moderator |
| `/site-map-picker` (route) | (not present — `SiteMapPicker` is mounted inside the SitePanel inside `/moderator`) | authed | moderator |
| `/demo` | `src/app/demo/page.tsx:50` | anonymous (Convex) | demo reviewer (plays as persona) |
| `/demo/persona` | `src/app/demo/persona/page.tsx:37` | anonymous | demo reviewer |
| `/demo/about` | `src/app/demo/about/page.tsx:5` | anonymous | demo reviewer |
| `/~offline` | `src/app/~offline/page.tsx:1` | any (SW fallback) | any |
| `/sign-in` (route) | (not present — `SignIn` component is rendered inline on home when unauthed) | anon | n/a |

> Convex Auth flow: sign-in form lives in `src/app/sign-in.tsx:9`, mounted by `src/app/page.tsx:79` when `!isAuthenticated`. There is no dedicated `/sign-in` URL — the home page *is* the sign-in page for anonymous visitors.

---

## 1. Convex public surface (api.*)

Only files exporting `query` / `mutation` / `action` with no `internal` prefix.

| Module | Export | Kind | Args (short) | Called from React at |
|---|---|---|---|---|
| `convex/access.ts` | — | helpers only (`currentUserId`, `requireModerator`, `requireDemoReviewer`, …) — not public | — | — |
| `convex/auth.ts` | re-exports `auth, signIn, signOut, store, isAuthenticated` (from `@convex-dev/auth`) | library | — | `src/app/sign-in.tsx:10`, `src/app/page.tsx:52`, `src/app/demo/layout.tsx:15` |
| `convex/changePassword.ts` | — | type-only helpers | — | — |
| `convex/crons.ts` | (cron definitions only — not callable from UI) | — | — | — |
| `convex/demo.ts` | `status` | query | — | `src/app/sign-in.tsx:11` |
| `convex/demo.ts` | `seedDemoData` | action | — | `src/app/moderator/kpi-banner.tsx:10` |
| `convex/demo.ts` | `bindReviewer` | mutation | `{ personaEmail }` | (not wired to UI; legacy) |
| `convex/demo.ts` | `getBinding` | query | — | `src/app/demo/layout.tsx:13`, `src/app/demo/page.tsx:51`, `src/app/demo/persona/page.tsx:38` |
| `convex/demo.ts` | `boundPersonaLogs` | query | — | `src/app/demo/layout.tsx:14`, `src/app/demo/page.tsx:288` |
| `convex/demo.ts` | `boundPersonaShifts` | query | — | (not called from UI) |
| `convex/demo.ts` | `boundPersonaPayroll` | query | — | `src/app/demo/page.tsx:53` |
| `convex/demo.ts` | `demoAudit` | query | `{ limit? }` | `src/app/demo/page.tsx:55` |
| `convex/demo.ts` | `demoNeedsReview` | query | — | `src/app/demo/page.tsx:54` |
| `convex/demo.ts` | `demoKpis` | query | — | `src/app/demo/page.tsx:52` |
| `convex/demo.ts` | `demoEmployeeRoster` | query | — | `src/app/demo/page.tsx:56` |
| `convex/demo.ts` | `checkInAsPersona` | action | (see schema) | `src/app/demo/page.tsx:287` |
| `convex/demo.ts` | `switchPersona` | mutation | `{ personaEmail }` | `src/app/demo/persona/page.tsx:39` |
| `convex/demo.ts` | `demoExportLogsCsv` | action | `{ fromMs, toMs }` | `src/app/demo/page.tsx:417` |
| `convex/demo.ts` | `demoModeratorInbox` | query | — | `src/app/demo/page.tsx:58` |
| `convex/demo.ts` | `demoReplyToEmployee` | mutation | `{ recipientId, content }` | (not wired to UI) |
| `convex/demo.ts` | `demoMarkQueueItemRead` | mutation | `{ messageId }` | `src/app/demo/page.tsx:249` |
| `convex/demo.ts` | `demoResolveShift` | mutation | `{ shiftId }` | `src/app/demo/page.tsx:142` |
| `convex/demo.ts` | `demoRecomputeEmployeeShifts` | mutation | `{ userId }` | `src/app/demo/page.tsx:143` |
| `convex/demo.ts` | `_resolveDemoReviewer` | internalQuery — not public | — | — |
| `convex/demo.ts` | `purgeStaleReviewers` | internalMutation — not public | — | — |
| `convex/demo_seed.ts` | `seedAll` | internalMutation — not public | — | — |
| `convex/demo_sites.ts` | — | constants only | — | — |
| `convex/deviceTokens.ts` | — | helpers only | — | — |
| `convex/geo.ts` | — | helper only | — | — |
| `convex/http.ts` | (HTTP routes only — not callable as api.*) | — | — | — |
| `convex/kpi.ts` | `summary` | query | — | `src/app/moderator/kpi-banner.tsx:9` |
| `convex/logs.ts` | `createLog` | mutation | (see schema) | `src/app/page.tsx:186` |
| `convex/logs.ts` | `listMine` | query | — | `src/app/page.tsx:189` |
| `convex/logs.ts` | `createLogAs` | internalMutation — not public | — | — |
| `convex/logs.ts` | `purgeExpiredCoords` | internalMutation — not public | — | — |
| `convex/messages.ts` | `sendToModerators` | mutation | `{ content }` | `src/app/messages.tsx:14` |
| `convex/messages.ts` | `moderatorInbox` | query | — | `src/app/messages.tsx:11` |
| `convex/messages.ts` | `markQueueItemRead` | mutation | `{ messageId }` | `src/app/messages.tsx:18` |
| `convex/messages.ts` | `myInbox` | query | — | `src/app/messages.tsx:9` |
| `convex/messages.ts` | `replyToEmployee` | mutation | `{ recipientId, content }` | `src/app/messages.tsx:15` |
| `convex/messages.ts` | `broadcast` | mutation | `{ content }` | `src/app/messages.tsx:16` |
| `convex/messages.ts` | `markThreadRead` | mutation | — | `src/app/messages.tsx:17` |
| `convex/moderator.ts` | `auditRecentLogs` | query | `{ limit? }` | `src/app/moderator/page.tsx:21` |
| `convex/moderator.ts` | `auditNeedsReview` | query | — | `src/app/moderator/page.tsx:23`, `src/app/payroll.tsx:166` |
| `convex/moderator.ts` | `listEmployeesWithAssignments` | query | — | `src/app/moderator/page.tsx:19` |
| `convex/moderator.ts` | `listAllSites` | query | — | `src/app/moderator/page.tsx:20` |
| `convex/moderator.ts` | `resolveShift` | mutation | `{ shiftId }` | `src/app/payroll.tsx:167` |
| `convex/moderator.ts` | `recomputeEmployeeShifts` | mutation | `{ userId }` | `src/app/payroll.tsx:168` |
| `convex/moderator.ts` | `setHourlyOverride` | mutation | `{ userId, rate? }` | `src/app/moderator/page.tsx:429` |
| `convex/payroll.ts` | `calcForEmployee` | query | `{ userId, fromMs, toMs }` | `src/app/payroll.tsx:34` |
| `convex/payroll.ts` | `setPayStrategy` | mutation | `{ userId, strategy }` | `src/app/payroll.tsx:40` |
| `convex/payroll.ts` | `listSupportedStrategies` | query | — | `src/app/payroll.tsx:37` |
| `convex/payroll.ts` | `exportLogsCsv` | action | `{ userId, fromMs, toMs }` | `src/app/payroll.tsx:41` |
| `convex/payroll_data.ts` | `logsForExport` | internalQuery — not public | — | — |
| `convex/push.ts` | `pushToUser` | internalAction — not public | — | — |
| `convex/push_subs.ts` | `publicVapidKey` | query | — | `src/app/notifications.tsx:8` |
| `convex/push_subs.ts` | `saveSubscription` | mutation | `{ endpoint, keysP256dh, keysAuth }` | `src/app/notifications.tsx:9` |
| `convex/push_subs.ts` | `subscriptionsFor` | internalQuery — not public | — | — |
| `convex/push_subs.ts` | `removeSubscription` | internalMutation — not public | — | — |
| `convex/schema.ts` | — | schema only | — | — |
| `convex/shifts.ts` | `deriveForUser` | internalMutation — not public | — | — |
| `convex/sites.ts` | `listMine` | query | — | `src/app/page.tsx:188` |
| `convex/sites.ts` | `createSite` | mutation | (see schema) | `src/app/moderator/page.tsx:264` |
| `convex/sites.ts` | `assignEmployee` | mutation | `{ userId, siteId }` | `src/app/moderator/page.tsx:343` |
| `convex/sites.ts` | `unassignEmployee` | mutation | `{ userId, siteId }` | `src/app/moderator/page.tsx:344` |
| `convex/users.ts` | `provisionEmployee` | action | `{ name, email }` | `src/app/moderator/page.tsx:191` |
| `convex/users.ts` | `bootstrapFirstModerator` | internalAction — not public | — | — |
| `convex/users.ts` | `provisionModerator` | action | `{ name, email, key? }` | `src/app/moderator/page.tsx:192` |
| `convex/users.ts` | `resetPasswordBreakGlass` | internalAction — not public | — | — |
| `convex/users.ts` | `forceChangeOn` | internalMutation — not public | — | — |
| `convex/users.ts` | `clearForceChange` | internalMutation — not public | — | — |
| `convex/users.ts` | `archiveUserBreakGlass` | internalAction — not public | — | — |
| `convex/users.ts` | `markPasswordChanged` | internalMutation — not public | — | — |
| `convex/users.ts` | `archiveUserInternal` | internalMutation — not public | — | — |
| `convex/users.ts` | `changeMyPassword` | action | `{ currentSecret, newSecret }` | `src/app/change-password.tsx:16` |
| `convex/users.ts` | `deactivateEmployee` | mutation | `{ userId }` | `src/app/moderator/page.tsx:407` |
| `convex/users.ts` | `resetDeviceToken` | mutation | `{ userId }` | `src/app/moderator/page.tsx:466` |
| `convex/users.ts` | `issueMyDeviceToken` | mutation | — | `src/app/page.tsx:187` |
| `convex/users_queries.ts` | `me` | query | — | `src/app/page.tsx:51`, `src/app/moderator/page.tsx:18`, `src/app/demo/layout.tsx:12` |
| `convex/users_queries.ts` | `getById` / `getByEmail` / `listByRole` | internal — not public | — | — |

---

## 2. Existing data-testids (the harvest)

All `data-testid` values currently in the source (from `grep` over `src/`):

| testid | Where | Purpose |
|---|---|---|
| `demo-page` | `src/app/demo/page.tsx:61` | root of `/demo` |
| `demo-kpi-banner` | `src/app/demo/page.tsx:64` | KPI section wrapper |
| `demo-persona-header` | `src/app/demo/page.tsx:87` | persona name + email card |
| `demo-persona-name` | `src/app/demo/layout.tsx:48` | persona name in header nav |
| `kpi-card` | `src/app/demo/page.tsx:96` | one KPI tile (×4) |
| `demo-payroll` | `src/app/demo/page.tsx:106` | payroll section wrapper |
| `payroll-day-row` | `src/app/demo/page.tsx:122` | one per-day row in payroll table |
| `payroll-total-row` | `src/app/demo/page.tsx:128` | totals row |
| `demo-needs-review` | `src/app/demo/page.tsx:146` | review queue section |
| `needs-review-row` | `src/app/demo/page.tsx:156` | one review queue row |
| `demo-audit-log` | `src/app/demo/page.tsx:196` | audit log section |
| `audit-log-row` | `src/app/demo/page.tsx:214` | one audit row |
| `demo-messages` | `src/app/demo/page.tsx:251` | messages section |
| `message-row` | `src/app/demo/page.tsx:261` | one message row |
| `demo-checkin` | `src/app/demo/page.tsx:343` | check-in panel |
| `demo-checkin-button` | `src/app/demo/page.tsx:393` | the "CHECK IN as persona" button |
| `demo-checkin-message` | `src/app/demo/page.tsx:397` | result message line |
| `demo-export` | `src/app/demo/page.tsx:444` | export section |
| `demo-about` | `src/app/demo/about/page.tsx:8` | about page root |
| `persona-switcher` | `src/app/demo/persona/page.tsx:57` | persona page root |
| `persona-row` | `src/app/demo/persona/page.tsx:80` | one persona card |
| `persona-play-button` | `src/app/demo/persona/page.tsx:92` | per-card "Play as" button |

**Coverage:** Every testid is in the `/demo/*` pages. **Zero** testids exist in the employee home, the moderator console, payroll, the geofence modal, the offline page, or the sign-in form. New e2e work must add testids in those areas.

---

## 3. Existing e2e coverage (`scripts/e2e-full.mjs`)

| Step | What it drives | File:line |
|---|---|---|
| port-collision sentinel | loads `/` and confirms "J-Pay" | `scripts/e2e-full.mjs:103-116` |
| demo preview selectable at login | clicks "Enter demo preview" | `scripts/e2e-full.mjs:122-127` |
| demo session → employee panel | waits for `CHECK IN` | `scripts/e2e-full.mjs:128-129` |
| demo role = employee | text check | `scripts/e2e-full.mjs:130` |
| demo reviewer has sites | text check | `scripts/e2e-full.mjs:131` |
| forced password skipped for reviewer | text check | `scripts/e2e-full.mjs:132` |
| demo check-in writes real log | clicks `CHECK IN` | `scripts/e2e-full.mjs:135-142` |
| demo sign out returns to login | clicks `Sign out` | `scripts/e2e-full.mjs:144-146` |
| moderator sign-in + consent | fills creds, accepts consent | `scripts/e2e-full.mjs:151-152` |
| console loads | visits `/moderator` | `scripts/e2e-full.mjs:154-156` |
| KPI cards render | queries `[aria-label='Key metrics'] .text-2xl` | `scripts/e2e-full.mjs:158-161` |
| geofence modal renders Leaflet | clicks `map` button | `scripts/e2e-full.mjs:163-167` |
| resolve review item | clicks `Resolve` | `scripts/e2e-full.mjs:169-170` |
| payroll panel present | text check | `scripts/e2e-full.mjs:172` |
| provision employee returns ID code | fills name+email, clicks `Create account + ID code` | `scripts/e2e-full.mjs:174-184` |
| employee assigned to site | tagged select trick + click `Assign` | `scripts/e2e-full.mjs:187-229` |
| forced password modal appears | text check after sign-in | `scripts/e2e-full.mjs:233-234` |
| password set → employee home | fills three fields, clicks `Update password` | `scripts/e2e-full.mjs:237-249` |
| geofence verdict | clicks `CHECK IN` (employee) | `scripts/e2e-full.mjs:264` |
| check-in accepted | text check | `scripts/e2e-full.mjs:266-270` |
| offline finish queued | offline emulation + click `CHECK IN` (status: `day finish`) | `scripts/e2e-full.mjs:274-281` |
| online replay settled | fires `online` event | `scripts/e2e-full.mjs:283-299` |

`scripts/e2e-demo.mjs` and `scripts/e2e-demo-rich.mjs` cover the `/demo/*` pages using the testid list above.

---

# A. Authentication

| # | Feature | Route | React file:line | Convex call | Pre-conditions | Visible state | testid | e2e-full.mjs line |
|---|---|---|---|---|---|---|---|---|
| A1 | Sign in (employee / moderator, password provider) | `/` (SignIn panel) | `src/app/sign-in.tsx:17-42` | `@convex-dev/auth` `signIn("password", formData)` (in `sign-in.tsx:23`) — flows into `auth.createOrUpdateUser` in `convex/auth.ts:31-96` | anon, valid email + secret | re-renders to employee home (`page.tsx:79`) or `ForcedPasswordChange` overlay (page.tsx:88) | NEEDS data-testid (form is found by `[name=email]` and `[type=password]`) | partial — e2e-full.mjs:90-99 covers mod sign-in; employee sign-in covered in `:233` |
| A2 | Activate account (first-time flow toggles to "signUp" step) | `/` | `src/app/sign-in.tsx:34-37`, toggle at `:42-48` | same as A1 + `createOrUpdateUser` reads role from profile (auth.ts:87-94) | anon, has invite code | same as A1; new "name" input appears | NEEDS data-testid (currently no testid on name input) | not covered (signUp branch never exercised) |
| A3 | Demo preview entry (anonymous) | `/` → `/demo` | `src/app/sign-in.tsx:56-74` | `@convex-dev/auth` `signIn("anonymous", {})` (`:62`); seeds `demoSessions` in `auth.ts:67-73` | `api.demo.status.enabled === true` | navigates to `/demo` and renders persona console | NEEDS data-testid on the button (text "Enter demo preview" is matched in e2e-full.mjs:124) | yes — e2e-full.mjs:118-146 |
| A4 | Sign out (header) | `/` | `src/app/page.tsx:115-120` | `@convex-dev/auth` `signOut()` (`:116`) | authed, any role | reloads page, lands on SignIn | NEEDS data-testid (matched by text "Sign out" in e2e-full.mjs:144) | yes — e2e-full.mjs:144-146 |
| A5 | Sign out (moderator header) | `/moderator` | `src/app/moderator/page.tsx:47-49` (link to `/`) — but logout itself only on home header | (same as A4) | moderator | link to "employee view" | NEEDS data-testid | not covered |
| A6 | Sign out (demo console header) | `/demo` | `src/app/demo/layout.tsx:57-63` | `@convex-dev/auth` `signOut()` (`:59`) | demo anonymous session | returns to `/` | NEEDS data-testid | not covered (e2e-demo.mjs:101 clicks "Sign out" from /) |
| A7 | Auto sign-out when authed but no user doc | `/` | `src/app/page.tsx:53-57` | `signOut()` (`:55`) | authed, `me === null` | page reload, lands on SignIn | no testid | not covered |
| A8 | Force-change-password modal (blocking overlay) | `/` | `src/app/change-password.tsx:81-118` mounted at `src/app/page.tsx:88-90` | `api.users.changeMyPassword` (`:16`) → `convex/users.ts:192-226` | authed, `passwordChangedAt === undefined` | full-screen dialog (z-100); on success → 1.2s reload (`:89-91`) | NEEDS data-testid on the dialog; "Set your own password" is matched in e2e-full.mjs:234 | yes — e2e-full.mjs:233-249 |
| A9 | Voluntary change password (inline `<details>` expander) | `/` | `src/app/change-password.tsx:68-79` (mount) and `:15-66` (form) | `api.users.changeMyPassword` (`:16`) | authed, employee | inline form, status message in `role="status"` | NEEDS data-testid (matched by placeholders in e2e-full.mjs:238-241) | partial — covered only in forced flow |
| A10 | Change password (moderator header) | `/moderator` | `src/app/moderator/page.tsx:50` mounts `ChangePassword` (same component as A9) | `api.users.changeMyPassword` | moderator | inline form | NEEDS data-testid | not covered |
| A11 | Mismatched new-password confirmation error | `/` | `src/app/change-password.tsx:26-29` (client check) | (none — fails locally) | n/a | inline error "New passwords do not match." (`:27`) | NEEDS data-testid | not covered |
| A12 | Invalid current password error | `/` | `src/app/change-password.tsx:33-44` | `api.users.changeMyPassword` throws `INVALID_CURRENT_PASSWORD` (via `changePassword.ts:11`) | n/a | inline `errMsg(e)` | NEEDS data-testid | not covered |
| A13 | Loading state while auth is hydrating | `/` | `src/app/page.tsx:73-75` | n/a | n/a | "Loading…" text | NEEDS data-testid | not covered |
| A14 | "Moderator access only" guard | `/moderator` | `src/app/moderator/page.tsx:31-40` | `api.users_queries.me` (`:18`) | signed in as non-moderator | full-page "Moderator access only." + back link | NEEDS data-testid | not covered |

---

# B. Employee features (home `/`)

| # | Feature | Route | React file:line | Convex call | Pre-conditions | Visible state | testid | e2e-full.mjs line |
|---|---|---|---|---|---|---|---|---|
| B1 | Employee role chip in header | `/` | `src/app/page.tsx:112-114` | n/a (reads `me.role` from `:51`) | authed employee | small uppercase pill | NEEDS data-testid (matched in e2e-full.mjs:130 as /EMPLOYEE/i) | yes — e2e-full.mjs:130 |
| B2 | Site picker (single site = simple select) | `/` | `src/app/page.tsx:335-349` | `api.sites.listMine` (`:188`) | authed, assigned to ≥1 site | dropdown of site names | NEEDS data-testid on `<select>` | partial — site is auto-picked if one (`:264`); e2e-full.mjs:251 dumps all options |
| B3 | Status pill radiogroup (ArrowLeft/Right/Home/End keys) | `/` | `src/app/page.tsx:350-384` | n/a (local state) | n/a | pill group of 7 statuses; focus management | NEEDS data-testid (currently clicked by text in e2e-full.mjs:275) | partial — only "day finish" status is exercised in e2e-full.mjs:275 |
| B4 | Side-mission duration select (only when status === "quick side mission") | `/` | `src/app/page.tsx:385-400` | n/a | n/a | dropdown of 15/30/45/60/120 min | NEEDS data-testid | not covered |
| B5 | CHECK IN button — happy path (geofence ok) | `/` | `src/app/page.tsx:401-407` | `api.logs.createLog` (`:213-230`, `:293-304`) | employee, geolocation granted, accuracy ≤ 50 m, assigned to site | success message "Logged <status>." (`:305`) and a new row in "Recent" (`:422-431`) | NEEDS data-testid on the button and the result line | yes — e2e-full.mjs:135-142, 257-270 |
| B6 | CHECK IN while offline → outbox enqueue | `/` | `src/app/page.tsx:287-291` → `useOutbox` `enqueue` (`src/app/use-outbox.ts:52-59`) → writes to IndexedDB | `api.logs.createLog` invoked from `flushOne` on replay | offline (`navigator.onLine === false`) | "Offline — check-in queued (N pending)." (`:289`), amber pill "N check-ins queued offline" + "Sync now" (`:410-417`) | NEEDS data-testid on the queued-pill block | yes — e2e-full.mjs:274-281 |
| B7 | Auto-replay outbox on `online` event | `/` | `src/app/use-outbox.ts:64-73` (listeners) | `api.logs.createLog` via `flushOne` | reconnection | queued count → 0; new "Logged X" line | NEEDS data-testid on the disappearance | yes — e2e-full.mjs:283-299 |
| B8 | Auto-replay outbox on `visibilitychange → visible` | `/` | `src/app/use-outbox.ts:63-66` | same as B7 | tab returns to foreground | queued count → 0 | NEEDS data-testid | not covered |
| B9 | Manual "Sync now" button | `/` | `src/app/page.tsx:413-415` | `flush` in `useOutbox.ts:25-50` | queued count > 0 | drains outbox | NEEDS data-testid | not covered (e2e covers auto-replay only) |
| B10 | Weak GPS signal error (accuracy > 50 m) | `/` | `src/app/page.tsx:259-263` | (client-side only — no call) | accuracy > 50 m | "Weak GPS signal (±X m). Move to open sky and retry." (`:261`) | NEEDS data-testid | not covered (CDP sets accuracy=20, e2e-full.mjs:49-53) |
| B11 | Geolocation permission denied error | `/` | `src/app/page.tsx:320-323` | (client-side only) | user denies permission | "Location permission denied." | NEEDS data-testid | not covered |
| B12 | `DEVICE_ALREADY_ACTIVE` error from server | `/` | `src/app/page.tsx:250-255` | `api.users.issueMyDeviceToken` (`:203-206`) | device already has a token (moderator-reset state) | "Device already activated — ask your moderator to reset it." | NEEDS data-testid | not covered |
| B13 | `DEVICE_TOKEN_INVALID` → local token cleared | `/` | `src/app/page.tsx:311-315` | `api.logs.createLog` throws | moderator reset device mid-session | "Device was reset by moderator — tap CHECK IN again." and localStorage cleared | NEEDS data-testid | not covered |
| B14 | Loading sites message | `/` | `src/app/page.tsx:266-270` | n/a | `sites === undefined` | "Loading your sites…" | NEEDS data-testid | partial — e2e-full.mjs:252 logs the message |
| B15 | "No site assigned" message | `/` | `src/app/page.tsx:264-272` | n/a | `sites.length === 0` | "No site assigned — ask your moderator." | NEEDS data-testid | not covered (e2e-full.mjs:131 just checks absence) |
| B16 | "No site assigned yet" banner (employee) | `/` | `src/app/page.tsx:330-334` | `api.sites.listMine` (`:188`) | employee with zero assignments | amber banner (`:331`) | NEEDS data-testid | not covered |
| B17 | Recent log list (last 10, with geofence + travel flag badges) | `/` | `src/app/page.tsx:418-434` | `api.logs.listMine` (`:189`) | at least one log on file | `<ul>` of status + time + "outside geofence" / "travel flag" pills | NEEDS data-testid on each `<li>` | partial — only indirect via text |
| B18 | Enable notifications (VAPID subscribe) | `/` | `src/app/notifications.tsx:42-49` (button), full handler at `:18-40` | `api.push_subs.publicVapidKey` (`:8`), `api.push_subs.saveSubscription` (`:9`) | authed employee, VAPID configured | button label flips to "Notifications on" (`:47`) | NEEDS data-testid on the header button | not covered |
| B19 | Notifications VAPID missing alert | `/` | `src/app/notifications.tsx:20-22` | `api.push_subs.publicVapidKey` returns null | deployment without `VAPID_PUBLIC_KEY` | `alert("Push not configured…")` | NEEDS data-testid | not covered |
| B20 | Install prompt button (PWA `beforeinstallprompt`) | `/` | `src/app/page.tsx:103-110` | n/a (calls `installEvent.prompt()`) | Chromium with installability + not already installed | button appears in header; clicking triggers native install dialog | NEEDS data-testid on the "Install app" button | not covered |
| B21 | iOS install hint banner | `/` | `src/app/page.tsx:123-127` | n/a | iOS Safari, not in standalone mode | instruction line at top of main (`:125`) | NEEDS data-testid | not covered |
| B22 | Privacy footer | `/` | `src/app/page.tsx:137-140` | n/a | n/a | static text (id="privacy") | NEEDS data-testid | not covered |
| B23 | Send message to moderator | `/` | `src/app/messages.tsx:32-65` | `api.messages.sendToModerators` (`:48`); `api.messages.myInbox` (`:9`); `api.messages.markThreadRead` (`:28`) | authed employee | text in input → "Sent to moderator." (`:50`); new line appears in inbox (`:58-63`) | NEEDS data-testid on input `#msg-employee` and the "Send" button | not covered |
| B24 | Auto-mark inbox as read on view | `/` | `src/app/messages.tsx:25-30` | `api.messages.markThreadRead` (`:28`) | employee, first render with unread | unread (emerald) → read (grey) text colour (`:59`) | NEEDS data-testid | not covered |
| B25 | Moderator link from employee view | `/` | `src/app/page.tsx:177-183` | n/a | authed moderator | "Open moderator console →" link | NEEDS data-testid | not covered (moderator sign-in goes to `/` which renders the link, but e2e jumps to `/moderator` directly at line 154) |

---

# C. Moderator features (`/moderator`)

| # | Feature | Route | React file:line | Convex call | Pre-conditions | Visible state | testid | e2e-full.mjs line |
|---|---|---|---|---|---|---|---|---|
| C1 | KPI banner (4 cards + demo seed row) | `/moderator` | `src/app/moderator/kpi-banner.tsx:21-50` | `api.kpi.summary` (`:9`), `api.demo.seedDemoData` (`:10`) | authed moderator | 4 cards: Active on site / Billable hrs / Pending reviews / Anomalies (24h) | NEEDS data-testid (queried in e2e-full.mjs:158-160 by `[aria-label='Key metrics'] .text-2xl`) | yes — e2e-full.mjs:158-161 |
| C2 | Seed investor demo (button) | `/moderator` (KPI banner) | `src/app/moderator/kpi-banner.tsx:31-46` | `api.demo.seedDemoData` (`:35`) | `kpi.demoModeEnabled === true` | inline message "Seeded N sites · M employees · L logs (D duplicates skipped)" (`:37`) | NEEDS data-testid | not covered |
| C3 | Provision employee (form) | `/moderator` (ProvisionPanel) | `src/app/moderator/page.tsx:200-260` | `api.users.provisionEmployee` (`:230`) or `api.users.provisionModerator` (`:231`) | authed moderator, valid email + name | success card with `email` + `JP-XXXX` ID code + copy-to-clipboard (`:245-256`) | NEEDS data-testid on inputs/button | yes — e2e-full.mjs:174-184 |
| C4 | Provision moderator (form, role select) | `/moderator` | same as C3 but with `role="moderator"`; calls `api.users.provisionModerator` at `:231` | `api.users.provisionModerator` (`:231`) | authed moderator, valid input | same success card | NEEDS data-testid | not covered |
| C5 | Copy ID-code to clipboard | `/moderator` (ProvisionPanel) | `src/app/moderator/page.tsx:250-255` | n/a (`navigator.clipboard.writeText`) | success card visible | no in-page feedback (silent) | NEEDS data-testid | not covered |
| C6 | Create site (form) | `/moderator` (SitePanel) | `src/app/moderator/page.tsx:275-333` | `api.sites.createSite` (`:311-317`) | authed moderator, valid coords/radius/timezone | inline "Created <name>" message (`:318`) | NEEDS data-testid | not covered |
| C7 | Site map picker — click on Leaflet map to set coords | `/moderator` (SitePanel) | `src/app/site-map-picker.tsx:46-48` | n/a (calls `onPick` → updates `form.lat`/`form.lng`) | n/a | marker appears; coordinate text updates (`:147`) | NEEDS data-testid | not covered |
| C8 | Site map picker — Nominatim address search (debounced) | `/moderator` (SitePanel) | `src/app/site-map-picker.tsx:71-91` | external: `https://nominatim.openstreetmap.org/search` (`:81-83`) | n/a, network | result dropdown (`:102-119`) | NEEDS data-testid | not covered |
| C9 | Site map picker — "Use my location" | `/moderator` (SitePanel) | `src/app/site-map-picker.tsx:125-135` | `navigator.geolocation.getCurrentPosition` (`:128-130`) | user grants geolocation | marker updates | NEEDS data-testid | not covered |
| C10 | Site map picker — "Verify in Google Maps" external link | `/moderator` (SitePanel) | `src/app/site-map-picker.tsx:137-145` | n/a | lat/lng set | new tab opens to Google Maps | NEEDS data-testid | not covered |
| C11 | Assign employee ↔ site (form) | `/moderator` (AssignPanel) | `src/app/moderator/page.tsx:336-403` | `api.sites.assignEmployee` (`:374`) / `api.sites.unassignEmployee` (`:389`) | authed moderator, both selects populated | inline "Assigned." / "Unassigned." / error from `errMsg` | NEEDS data-testid (tagged `data-t="emp"`/`"site"` hack in e2e-full.mjs:199-205) | partial — e2e-full.mjs:187-229 |
| C12 | Employees table (name / email / sites / status / rate / actions) | `/moderator` | `src/app/moderator/page.tsx:71-113` | `api.moderator.listEmployeesWithAssignments` (`:19`), `api.moderator.listAllSites` (`:20`) | authed moderator | table with one row per employee, status pill, action buttons | NEEDS data-testid on rows + cells | not covered |
| C13 | Set hourly rate override (inline cell) | `/moderator` (RateCell) | `src/app/moderator/page.tsx:428-462` | `api.moderator.setHourlyOverride` (`:453`) | authed moderator, numeric value (or blank to clear) | button label "set" → "✓" (`:459`) | NEEDS data-testid on input + button | not covered |
| C14 | Rate out-of-range validation (RATE_OUT_OF_RANGE) | `/moderator` | `src/app/moderator/page.tsx:450-454` (client) + `convex/moderator.ts:147-149` (server) | `api.moderator.setHourlyOverride` throws | value < 0 or > 100000 | error message via `errMsg` (currently no inline message wired) | NEEDS data-testid | not covered |
| C15 | Deactivate employee (two-step) | `/moderator` | `src/app/moderator/page.tsx:406-426` (DeactivateButton) | `api.users.deactivateEmployee` (`:412`) | authed moderator, target is active employee | row status flips to "deactivated" (red) (`:94-95`); row no longer appears in active filter | NEEDS data-testid | not covered |
| C16 | Reset device token (two-step) | `/moderator` | `src/app/moderator/page.tsx:465-481` (ResetDeviceButton) | `api.users.resetDeviceToken` (`:470`) | authed moderator, employee has `deviceId` | button becomes "confirm" → calls mutation; on next employee check-in, server returns `DEVICE_TOKEN_INVALID` | NEEDS data-testid | not covered |
| C17 | Audit log (7 days, with site+employee lookups) | `/moderator` | `src/app/moderator/page.tsx:115-184` | `api.moderator.auditRecentLogs` (`:21`) | authed moderator | table: time / employee / site / status / ±m / skew / flags | NEEDS data-testid on rows | not covered (only map button indirectly tested) |
| C18 | Audit row: geofence/travel flag badges | `/moderator` | `src/app/page.tsx:152-154` (page.tsx) — `<span>geofence✗</span>` / `travel!` | reads fields from `auditRecentLogs` | log has flags | red badge text | NEEDS data-testid | not covered |
| C19 | Audit row: clock-skew > 30 s in amber | `/moderator` | `src/app/moderator/page.tsx:149-151` | reads `l.clockSkewMs` | skew > 30 000 ms | cell text becomes amber | NEEDS data-testid | not covered |
| C20 | Audit row: open geofence modal | `/moderator` | `src/app/moderator/page.tsx:156-177` | n/a (sets local state) | log has site lat/lng (`:155`) | opens `GeofenceModal` (`:185`) | NEEDS data-testid on the "map" button | yes — e2e-full.mjs:163-167 |
| C21 | Geofence modal (Leaflet map + verdict dl) | `/moderator` (overlay) | `src/app/moderator/geofence-modal.tsx:30-172` | n/a | audit row had lat/lng | dialog with site circle, employee marker, accuracy circle, dl of values (`:156-168`); Esc closes (`:54-58`) | NEEDS data-testid on dialog + close button | partial — e2e-full.mjs:163-167 verifies leaflet container; close via Esc |
| C22 | Geofence modal: focus trap (Tab/Shift+Tab) | `/moderator` (overlay) | `src/app/moderator/geofence-modal.tsx:50-82` | n/a | modal open | focus cycles inside dialog | NEEDS data-testid | not covered |
| C23 | "N shifts need review" badge above audit | `/moderator` | `src/app/moderator/page.tsx:118-126` | `api.moderator.auditNeedsReview` (`:23`) | audit count > 0 | red pill with count | NEEDS data-testid | not covered |
| C24 | PayrollPanel — employee select + range buttons (7/14/28 d) | `/moderator` | `src/app/payroll.tsx:28-118` | `api.payroll.calcForEmployee` (`:34`); `api.payroll.listSupportedStrategies` (`:37`); `api.payroll.setPayStrategy` (`:40`); `api.payroll.exportLogsCsv` (`:41`) | authed, employee selected | range pill highlights, table populates | NEEDS data-testid (range buttons matched by text "7d"/"14d"/"28d") | partial — e2e-full.mjs:172 verifies presence only |
| C25 | PayrollPanel — pay strategy select (moderator only) | `/moderator` | `src/app/payroll.tsx:86-102` | `api.payroll.setPayStrategy` (`:89`) | authed moderator, employee selected | dropdown of jurisdictions; selecting calls mutation | NEEDS data-testid (no `data-testid` and not in e2e) | not covered |
| C26 | PayrollPanel — "Export logs CSV" (download) | `/moderator` | `src/app/payroll.tsx:103-117` | `api.payroll.exportLogsCsv` (`:106-110`) | authed moderator, employee selected | browser download triggered; filename `jpay-logs-<userId>-<date>.csv` or `jpay-logs-TRUNCATED-5000-…` | NEEDS data-testid (no `data-testid` on the button) | not covered |
| C27 | PayrollPanel — flagged shifts list | `/moderator` | `src/app/payroll.tsx:150-158` | reads `result.flagged` | result contains flagged shifts | amber list with startedAt, reason, minutes held | NEEDS data-testid on `<li>` | not covered |
| C28 | ReviewPanel — "Shifts needing review" + Recompute + Resolve | `/moderator` | `src/app/payroll.tsx:165-199` | `api.moderator.auditNeedsReview` (`:166`); `api.moderator.recomputeEmployeeShifts` (`:168`); `api.moderator.resolveShift` (`:190`) | authed moderator, ≥1 flagged shift | row disappears on Resolve; Recompute schedules `internal.shifts.deriveForUser` | NEEDS data-testid on rows + buttons | yes (Resolve only) — e2e-full.mjs:169-170 |
| C29 | Moderator MessagesPanel — broadcast to all | `/moderator` | `src/app/messages.tsx:80-91` | `api.messages.broadcast` (`:83`) | authed moderator | "Broadcast sent." (`:85`); new message in every employee's inbox | NEEDS data-testid (input has `id="msg-broadcast"`) | not covered |
| C30 | Moderator MessagesPanel — reply to one employee | `/moderator` | `src/app/messages.tsx:100-121` | `api.messages.replyToEmployee` (`:113`), `api.messages.markQueueItemRead` (`:114`) | authed moderator, ≥1 modqueue message | reply text clears, "Reply sent." (`:116`), row left border becomes neutral | NEEDS data-testid on reply input | not covered |
| C31 | Moderator MessagesPanel — dismiss (mark read) | `/moderator` | `src/app/messages.tsx:122-129` | `api.messages.markQueueItemRead` (`:124`) | modqueue message unread | emerald left-border disappears | NEEDS data-testid | not covered |
| C32 | Moderator MessagesPanel — empty queue | `/moderator` | `src/app/messages.tsx:92` | n/a | `modInbox.length === 0` | "Queue empty." (`:92`) | NEEDS data-testid | not covered |

---

# D. Demo features

| # | Feature | Route | React file:line | Convex call | Pre-conditions | Visible state | testid | e2e-full.mjs line |
|---|---|---|---|---|---|---|---|---|
| D1 | Demo layout — header (persona name, log count, nav) | `/demo` (layout) | `src/app/demo/layout.tsx:42-65` | `api.users_queries.me` (`:12`); `api.demo.getBinding` (`:13`); `api.demo.boundPersonaLogs` (`:14`) | `me.isAnonymous === true` AND `binding !== null` | header with persona name + "N log rows on file" + nav (Switch persona / About / Exit demo) | `demo-persona-name` (layout:48) — used in e2e-demo-rich.mjs:118 | not in e2e-full |
| D2 | Demo layout — guard (signed-in non-demo user) | `/demo` | `src/app/demo/layout.tsx:18-22` | `signOut()` | signed in as a non-anonymous user | auto sign-out + redirect to `/` | NEEDS data-testid | not covered |
| D3 | Demo layout — guard (no binding) | `/demo` | `src/app/demo/layout.tsx:30-38` | n/a | `me.isAnonymous === true` but no `demoSessions` row | "Demo session is not active." + back link | NEEDS data-testid | not covered |
| D4 | Persona header card | `/demo` (page) | `src/app/demo/page.tsx:85-92` | `api.demo.getBinding` (`:51`) | binding present | `demo-persona-header` card | `demo-persona-header` | yes — e2e-demo-rich.mjs:65 |
| D5 | KPI cards (persona-scoped) | `/demo` | `src/app/demo/page.tsx:64-72` | `api.demo.demoKpis` (`:52`) | binding present | 4 `kpi-card`s | `demo-kpi-banner`, `kpi-card` | yes — e2e-demo-rich.mjs:74, 85 |
| D6 | PayrollTable (per-day) | `/demo` | `src/app/demo/page.tsx:103-138` | `api.demo.boundPersonaPayroll` (`:53`) | persona has payroll | table with `payroll-day-row`s and `payroll-total-row` | `demo-payroll`, `payroll-day-row`, `payroll-total-row` | yes — e2e-demo-rich.mjs:76, 89 |
| D7 | PayrollTable — empty state | `/demo` | `src/app/demo/page.tsx:118-120` | n/a | `payroll.days.length === 0` | "No shifts yet" row | NEEDS data-testid on the empty row | not covered |
| D8 | PayrollTable — loading state | `/demo` | `src/app/demo/page.tsx:104` | n/a | `payroll === null` | "Loading…" | NEEDS data-testid | not covered |
| D9 | Needs-review list (with Recompute + Resolve) | `/demo` | `src/app/demo/page.tsx:141-191` | `api.demo.demoNeedsReview` (`:54`); `api.demo.demoRecomputeEmployeeShifts` (`:168`); `api.demo.demoResolveShift` (`:178`) | binding present | `needs-review-row` items with two buttons; busy state per row | `demo-needs-review`, `needs-review-row` | not in e2e-full (e2e-demo-rich.mjs:77 counts them) |
| D10 | Needs-review — empty state | `/demo` | `src/app/demo/page.tsx:148-149` | n/a | `shifts.length === 0` | "No shifts flagged." | NEEDS data-testid | not covered |
| D11 | Audit log (persona-scoped) | `/demo` | `src/app/demo/page.tsx:194-229` | `api.demo.demoAudit` (`:55`) | persona has logs | `audit-log-row`s | `demo-audit-log`, `audit-log-row` | yes — e2e-demo-rich.mjs:75, 125 |
| D12 | Audit log — empty state | `/demo` | `src/app/demo/page.tsx:210-212` | n/a | `logs.length === 0` | "No audit entries in the last 7 days" | NEEDS data-testid | not covered |
| D13 | Demo personas roster | `/demo` | `src/app/demo/page.tsx:232-245` | `api.demo.demoEmployeeRoster` (`:56`) | binding present | 2-col grid of all employees | NEEDS data-testid | not covered |
| D14 | MessagesSection (from persona → moderator queue, scoped to persona) | `/demo` | `src/app/demo/page.tsx:248-283` | `api.demo.demoModeratorInbox` (`:58`); `api.demo.demoMarkQueueItemRead` (`:271`) | binding present, persona has sent messages | `message-row`s with "Mark read" button | `demo-messages`, `message-row` | not in e2e-full |
| D15 | MessagesSection — empty state | `/demo` | `src/app/demo/page.tsx:253-255` | n/a | `inbox.length === 0` | "No messages from this persona to the moderator queue." | NEEDS data-testid | not covered |
| D16 | CheckInPanel — site + status + duration + button | `/demo` | `src/app/demo/page.tsx:286-413` | `api.sites.listMine` (`:57`); `api.demo.checkInAsPersona` (`:318-329`); `api.demo.boundPersonaLogs` (`:288`) | binding present, site selected | button label "CHECK IN as persona" (`:395`); result line `demo-checkin-message` | `demo-checkin`, `demo-checkin-button`, `demo-checkin-message` | yes — e2e-demo-rich.mjs:133 |
| D17 | CheckInPanel — "No sites available" error | `/demo` | `src/app/demo/page.tsx:313-316` | n/a (local check) | `personaSites.length === 0` | inline error message | NEEDS data-testid | not covered |
| D18 | CheckInPanel — duplicate detection message | `/demo` | `src/app/demo/page.tsx:331-333` | `api.demo.checkInAsPersona` returns `{ duplicate: true }` | same idempotencyKey | "Already logged (duplicate ignored)." | NEEDS data-testid | not covered |
| D19 | ExportPanel — Download CSV (last 14 d) | `/demo` | `src/app/demo/page.tsx:416-456` | `api.demo.demoExportLogsCsv` (`:426`) | binding present | download triggered; inline "Exported <file>." | `demo-export` | not in e2e-full (button clicked in e2e-demo-rich.mjs:148+) |
| D20 | Persona switcher — list of 5 personas | `/demo/persona` | `src/app/demo/persona/page.tsx:37-105` | `api.demo.getBinding` (`:38`); `api.demo.switchPersona` (`:48`) | binding present | 5 `persona-row` cards with narrative + "Play as" | `persona-switcher`, `persona-row`, `persona-play-button` | yes — e2e-demo-rich.mjs:99-101 |
| D21 | Persona switcher — current persona highlighting | `/demo/persona` | `src/app/demo/persona/page.tsx:74-79` | n/a | `binding.personaEmail === p.email` | emerald border; button label "Current" | NEEDS data-testid on the highlighted card | not covered |
| D22 | Persona switcher — error message | `/demo/persona` | `src/app/demo/persona/page.tsx:103` | `api.demo.switchPersona` throws | server error | red error line | NEEDS data-testid | not covered |
| D23 | Demo About page | `/demo/about` | `src/app/demo/about/page.tsx:5-51` | n/a | binding present | static "About this demo" with caveats | `demo-about` | not covered |
| D24 | Demo About — back to dashboard | `/demo/about` | `src/app/demo/about/page.tsx:11-18` | n/a | n/a | navigates to `/demo` | NEEDS data-testid | not covered |
| D25 | Demo Exit (sign out) | `/demo` (layout) | `src/app/demo/layout.tsx:57-63` | `signOut()` | binding present | navigates to `/` | NEEDS data-testid | not covered |
| D26 | Demo layout — bound log count "N log rows on file" | `/demo` (layout) | `src/app/demo/layout.tsx:49-52` | `api.demo.boundPersonaLogs` (`:14`) | binding present | "N log rows on file" in header | NEEDS data-testid | not covered |
| D27 | Switch persona — back to dashboard link | `/demo/persona` | `src/app/demo/persona/page.tsx:60-66` | n/a | n/a | navigates to `/demo` | NEEDS data-testid | not covered |
| D28 | Switch persona — "Switching…" busy state | `/demo/persona` | `src/app/demo/persona/page.tsx:96-98` | `api.demo.switchPersona` in flight | n/a | button text changes; button disabled | NEEDS data-testid on busy state | not covered |
| D29 | Switch persona — idempotent same persona | `/demo/persona` | `src/app/demo/persona/page.tsx:90-99` | n/a (button disabled when same) | n/a | button disabled, label "Current" | NEEDS data-testid | not covered |

---

# E. Edge cases, overlays, and out-of-band

| # | Feature | Route | React file:line | Convex call | Pre-conditions | Visible state | testid | e2e-full.mjs line |
|---|---|---|---|---|---|---|---|---|
| E1 | Consent gate (first visit) | `/` (overlay) | `src/app/page.tsx:146-175` | n/a (writes `localStorage["jpay.consent"] = "1"`) | `localStorage[CONSENT_KEY] !== "1"` | full-screen dialog, z-50; "I understand" button autofocused | NEEDS data-testid (matched in e2e-full.mjs:97, 133, 246 by text "I understand") | yes — e2e-full.mjs:97-99, 133, 246-248 |
| E2 | Force-change-password modal (blocking) | `/` (overlay) | `src/app/change-password.tsx:81-118` | `api.users.changeMyPassword` (`:16`) | `me.passwordChangedAt === undefined` | full-screen dialog, z-100 | NEEDS data-testid | yes — e2e-full.mjs:233-249 |
| E3 | ForcedPasswordChange — "Password saved ✓" + auto reload | `/` (overlay) | `src/app/change-password.tsx:109-114` + `:87-91` | (success) | n/a | "Reloading…" message, 1.2 s reload timer | NEEDS data-testid on the success state | not covered (covered only as part of the broader forced flow) |
| E4 | Geofence modal (audit-driven) | `/moderator` (overlay) | `src/app/moderator/geofence-modal.tsx:30-172` | n/a | `geofenceFix !== null` (set by audit row "map" button) | full-screen dialog with Leaflet + dl | NEEDS data-testid on dialog + "Close" button | partial — e2e-full.mjs:163-167 (open + Esc) |
| E5 | Offline page (`/~offline`, SW fallback) | `/~offline` | `src/app/~offline/page.tsx:1-20` | n/a | service worker serves cache when network is down | full-page "You are offline" with Retry link | NEEDS data-testid on Retry link | not covered |
| E6 | Sign-in form — invalid credentials error | `/` (SignIn) | `src/app/sign-in.tsx:23-25` | `signIn("password", ...)` throws | bad email/code | inline `<p class="text-red-400">` (`:38`) | NEEDS data-testid on the error line | not covered |
| E7 | Sign-in form — demo anonymous entry while demo disabled | `/` | `src/app/sign-in.tsx:49-79` | n/a (button hidden when `demo?.enabled !== true`) | `api.demo.status.enabled === false` | button not rendered | NEEDS data-testid (negative test) | not covered |
| E8 | Sign-in form — "Entering preview…" busy state | `/` | `src/app/sign-in.tsx:58, 73` | `signIn("anonymous", ...)` in flight | n/a | button text + disabled | NEEDS data-testid | not covered |
| E9 | Employee home — authed with no user doc (auto signout) | `/` | `src/app/page.tsx:53-57` | `signOut()` | `me === null` after auth | page reload, lands on SignIn | NEEDS data-testid | not covered |
| E10 | Sign-out (demo) — auto signout if signed in as non-anonymous | `/demo` (layout) | `src/app/demo/layout.tsx:18-22` | `signOut()` | n/a | redirect to `/` | NEEDS data-testid | not covered |
| E11 | Loading state — moderator | `/moderator` | `src/app/moderator/page.tsx:25-27` | n/a | `me === undefined` | "Loading…" | NEEDS data-testid | not covered |
| E12 | "No shifts flagged." empty review panel | `/moderator` | `src/app/payroll.tsx:175` | n/a | `review.length === 0` | inline note (`:175`) | NEEDS data-testid | not covered |
| E13 | "Nothing flagged." empty state of ReviewPanel | `/moderator` | `src/app/payroll.tsx:175` | n/a | same as E12 | inline note | NEEDS data-testid | not covered |
| E14 | Payroll panel — no employee selected (table hidden) | `/moderator` | `src/app/payroll.tsx:119` (gated on `result`) | n/a | `userId === ""` | only employee/range buttons visible | NEEDS data-testid on the no-selection placeholder | not covered |
| E15 | Geofence modal — opens but `L` (Leaflet) still loading | `/moderator` (overlay) | `src/app/moderator/geofence-modal.tsx:34, 49-92` | n/a | n/a | dialog with title + Close visible, empty map div (`:151-155`) | NEEDS data-testid on the map div | not covered |
| E16 | iOS install hint banner | `/` | `src/app/page.tsx:123-127` | n/a | iOS user-agent & not standalone | text hint (`:125`) | NEEDS data-testid | not covered |
| E17 | "J-Pay records your GPS …" privacy footer | `/` | `src/app/page.tsx:137-140` | n/a | n/a | static footer (id="privacy") | NEEDS data-testid | not covered |
| E18 | Notification permission state (off / on / idle) | `/` | `src/app/notifications.tsx:10-16, 47` | n/a | `Notification.permission` | button text + on/off border | NEEDS data-testid on each state | not covered |
| E19 | `signIn("password")` error path — `ACCOUNT_ARCHIVED` | `/` | `src/app/sign-in.tsx:23-25` → `convex/auth.ts:83-85` throws `ACCOUNT_ARCHIVED` | n/a | archived account | inline error from `errMsg` | NEEDS data-testid | not covered |
| E20 | `signIn("password")` error path — `INACTIVE_ACCOUNT` | `/` | `src/app/sign-in.tsx:23-25` → `convex/auth.ts:99-103` throws `INACTIVE_ACCOUNT` | n/a | deactivated session | inline error | NEEDS data-testid | not covered |
| E21 | `signIn("anonymous")` error path — `DEMO_DISABLED` | `/` | `src/app/sign-in.tsx:62-69` → `convex/auth.ts:35` throws | n/a | `DEMO_MODE !== "1"` (button is hidden) | inline error (only if button is forced) | NEEDS data-testid | not covered |
| E22 | `useOutbox` `lastError` rendering (dropped entry) | `/` | `src/app/page.tsx:409`; `useOutbox.ts:37-39` | n/a (entries with `WEAK_GPS\|DEVICE_TOKEN\|SITE_NOT\|INACTIVE\|FORBIDDEN` are dropped) | dropped item | red line (`:409`) | NEEDS data-testid | not covered |
| E23 | Outbox: WEAK_GPS in retry → drop + clear queued count | `/` | `src/app/use-outbox.ts:36-39` | `api.logs.createLog` throws `WEAK_GPS_SIGNAL` | server-side rejection | red `lastError`, count drops | NEEDS data-testid | not covered |
| E24 | Outbox: server unreachable on flush → stops draining (no drop) | `/` | `src/app/use-outbox.ts:34-43` | any transient error | network failure | count stays the same | NEEDS data-testid | not covered |
| E25 | Recent list row outside-geofence / travel-flag pills | `/` | `src/app/page.tsx:427-429` | n/a (reads log fields) | flagged log | " · outside geofence" / " · travel flag" appended | NEEDS data-testid on each pill | not covered |
| E26 | Empty "Recent" list (no logs yet) | `/` | `src/app/page.tsx:418-434` | n/a | `recentLogs.length === 0` | section not rendered at all | NEEDS data-testid (negative test) | not covered |
| E27 | Header role chip — moderator | `/` | `src/app/page.tsx:112-114` | n/a | moderator signed in via home | "MODERATOR" pill (also renders `<ModeratorLink>` instead of EmployeePanel) | NEEDS data-testid | partial — e2e-full.mjs:152 checks `MODERATOR` in text |
| E28 | `EnableNotifications` mounted only for employees | `/` | `src/app/page.tsx:111` | n/a | `me.role === "employee"` | button visible in header | NEEDS data-testid | not covered |
| E29 | Forced password modal — autofocus on submit | `/` (overlay) | `src/app/change-password.tsx:84-86` | n/a | overlay just opened | submit button gets focus | NEEDS data-testid | not covered |
| E30 | `lib/format` browserLocale timezone in audit/payroll | n/a (read-only dep) | `src/app/page.tsx:426`, `src/app/payroll.tsx:122, 140, 146, 154`, `src/app/moderator/page.tsx:144, 179` | n/a | n/a | values formatted with user's locale | NEEDS data-testid | not covered |
| E31 | `No site assigned` banner — employee just provisioned, before assignment | `/` | `src/app/page.tsx:330-334` | `api.sites.listMine` returns `[]` | authed employee with 0 sites | amber banner (`:331`) | NEEDS data-testid | not covered |
| E32 | `Loading your sites…` in-flight message | `/` | `src/app/page.tsx:267-268` | `api.sites.listMine` returning | n/a | inline message (`:268`) | NEEDS data-testid | partial — e2e-full.mjs:252 |

---

# Gap analysis — features with NO existing e2e coverage

Counted above; this is the ordered punch list. **Every row needs a new test** (and most need a new `data-testid`).

## High-priority gaps (no coverage and user-facing impact)

1. **Anonymous employee + moderator provisioning** (A2, C4) — only the moderator provision path is exercised.
2. **Sign-out from `/moderator` header** (A5) — no logout path tested.
3. **Voluntary change-password from `/moderator`** (A10) — only the employee forced path is covered.
4. **Mismatch + invalid-current-password paths in change-password** (A11, A12) — only happy path tested.
5. **Notifications subscribe + alert** (B18, B19) — no test at all.
6. **PWA install button** (B20) — no test.
7. **iOS install hint** (B21) — no test.
8. **Site picker (B2) + side-mission duration (B4) UI** — the e2e only auto-picks the first site and never tests side-mission duration.
9. **Status pill keyboard nav (Arrow keys)** (B3) — only "day finish" is clicked by text in e2e.
10. **Outbox: manual "Sync now" button** (B9).
11. **Outbox: visibilitychange auto-replay** (B8).
12. **Weak GPS rejection (B10), permission denied (B11), `DEVICE_ALREADY_ACTIVE` (B12), `DEVICE_TOKEN_INVALID` (B13)** — none tested.
13. **All "No site assigned" empty states** (B15, B16, E31).
14. **Recent list + flag pills (B17, E25, E26)** — no row-level assertion.
15. **Send message to moderator + auto-mark read** (B23, B24) — never tested.
16. **Moderator link from employee view (B25)** — never tested.
17. **Site create + map picker** (C6, C7, C8, C9, C10) — the map picker is never opened, address search is never typed, "Use my location" never pressed, "Verify in Google Maps" never asserted.
18. **Assign / Unassign panel (C11)** — partial: covered by `data-t` hack; no proper testid; no Unassign test.
19. **Employees table (C12)** — no row-level coverage.
20. **Set hourly rate (C13) + RATE_OUT_OF_RANGE (C14)** — never tested.
21. **Deactivate employee (C15)** — never tested.
22. **Reset device token (C16) + cascading DEVICE_TOKEN_INVALID on next check-in (B13)** — never tested.
23. **Audit log full table (C17) + flag badges (C18, C19)** — only the "map" button is exercised.
24. **Geofence modal: focus trap (C22), Close button (C21), `dl` of values (C21)** — only Leaflet-container presence is asserted.
25. **"N shifts need review" badge (C23)** — never asserted.
26. **PayrollPanel: range buttons (C24), strategy select (C25), CSV export (C26), flagged shifts list (C27)** — only "payroll" word in text is checked.
27. **ReviewPanel: Recompute (C28 partial), empty state (E12)** — only Resolve is asserted.
28. **Moderator messaging: broadcast (C29), reply (C30), dismiss (C31), empty queue (C32)** — never tested.
29. **Demo guard rails (D2, D3, D25, E10)** — never tested.
30. **Demo roster (D13) + messages section mark-read (D14) + empty/loading states (D7, D8, D10, D12, D15)** — never tested.
31. **Demo persona switcher: current highlighting, error, busy state, same-persona disable (D21, D22, D28, D29)** — only the happy switch is covered.
32. **Demo About page (D23) + back-to-dashboard links (D24, D27)** — never tested.
33. **`/~offline` page** (E5) — never tested.
34. **All `errMsg` paths on sign-in (E6, E19, E20, E21)** — never tested.
35. **Demo seed button (C2)** — never tested.
36. **`useOutbox.lastError` (E22, E23, E24)** — never tested.

## Lowest-priority but worth a test (smoke-level only)

- Loading states (A13, E11, D8, E15)
- Empty results (E26, C32, D7, D10, D12, D15)
- Header role chip + `EnableNotifications` visibility per role (E27, E28)
- Privacy footer (E17)
- Notifications permission state (E18)
- Time formatting (E30)
- Forced-password success state (E3)
- Forced-password autofocus (E29)

---

## Recommended testid additions (one-time PR before new e2e)

All `data-testid` should follow `kebab-case` and live on stable elements. Suggested prefixes:

| Area | Suggested testids |
|---|---|
| Sign-in form | `signin-email`, `signin-password`, `signin-submit`, `signin-toggle-mode`, `signin-demo-entry`, `signin-error` |
| Forced password modal | `forced-pw-modal`, `forced-pw-current`, `forced-pw-new`, `forced-pw-confirm`, `forced-pw-submit`, `forced-pw-message`, `forced-pw-success` |
| Voluntary password | `change-pw-toggle`, `change-pw-current`, `change-pw-new`, `change-pw-confirm`, `change-pw-submit`, `change-pw-message` |
| Home header | `role-chip`, `signout-button`, `install-button`, `enable-notifications` |
| Site picker | `site-select` |
| Status radiogroup | `status-radiogroup`, `status-pill-arrived`, `status-pill-checkpoint`, `status-pill-lunch`, `status-pill-quick-side-mission`, `status-pill-feeling-sick`, `status-pill-day-finish`, `status-pill-job-finish` |
| Side-mission | `side-mission-duration` |
| Check-in | `checkin-button`, `checkin-message`, `no-site-banner`, `outbox-queued-pill`, `outbox-sync-button`, `outbox-error`, `recent-log-row` |
| Consent gate | `consent-gate`, `consent-accept` |
| Moderator nav | `moderator-signout`, `moderator-employee-view-link` |
| Provision | `provision-name`, `provision-email`, `provision-role`, `provision-submit`, `provision-result-email`, `provision-result-idcode`, `provision-copy` |
| Site create | `site-create-name`, `site-create-lat`, `site-create-lng`, `site-create-radius`, `site-create-tz`, `site-create-submit`, `site-create-msg`, `site-map-picker`, `site-map-search`, `site-map-use-my-location`, `site-map-gmaps` |
| Assign | `assign-employee-select`, `assign-site-select`, `assign-button`, `assign-remove-button`, `assign-msg` |
| Employees table | `employees-table`, `employee-row`, `employee-rate-input`, `employee-rate-set`, `employee-deactivate`, `employee-deactivate-confirm`, `employee-deactivate-cancel`, `employee-reset-device`, `employee-reset-device-confirm`, `employee-reset-device-cancel` |
| Audit | `audit-table`, `audit-row`, `audit-map-button`, `review-needs-badge` |
| Geofence modal | `geofence-modal`, `geofence-modal-close`, `geofence-modal-map` |
| Payroll | `payroll-employee-select`, `payroll-range-7d`, `payroll-range-14d`, `payroll-range-28d`, `payroll-strategy-select`, `payroll-export-csv`, `payroll-table`, `payroll-day-row`, `payroll-total-row`, `payroll-flagged-row` |
| Review | `review-panel`, `review-row`, `review-recompute`, `review-resolve`, `review-empty` |
| Moderator messages | `mod-broadcast-input`, `mod-broadcast-submit`, `mod-inbox-empty`, `mod-inbox-row`, `mod-inbox-reply-input`, `mod-inbox-reply-submit`, `mod-inbox-dismiss` |
| Employee messages | `emp-msg-input`, `emp-msg-send`, `emp-msg-status` |
| Demo layout | `demo-exit-button`, `demo-switch-persona-link`, `demo-about-link`, `demo-log-count` |
| Demo personas | `persona-card-current`, `persona-error` |
| Demo About | `demo-about-back` |
| Offline | `offline-retry` |
| `useOutbox` | `outbox-drop-error` |

---

## Summary

- **22** existing `data-testid` values, all in `/demo/*` and used by `e2e-demo.mjs` / `e2e-demo-rich.mjs`.
- **0** `data-testid` values on the employee home, the moderator console, the sign-in form, the offline page, the geofence modal, or the change-password UI. The `e2e-full.mjs` script finds every UI element by text content, which is fragile against label drift.
- **~32** of the 130+ enumerated features have at least partial e2e coverage in `e2e-full.mjs`. The remaining **~98 features** — including every notification, install, geofence-modal interaction, every empty/loading state, every error path, every moderator message action, and the entire sign-in error surface — have **no test** today.
- The single highest-leverage change is a testid pass over the 9 React files in the `src/app` and `src/app/moderator` trees, after which the new e2e suite can be written deterministically (no button-text matching).
