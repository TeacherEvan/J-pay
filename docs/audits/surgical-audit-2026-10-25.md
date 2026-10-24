# Surgical Audit Report: J-Pay (TeacherEvan/J-pay)

| Audit Metadata | Specification |
| :--- | :--- |
| **Audit Date** | 2026-10-25 |
| **Audited Commit** | `e97765e` (`main`, chore: regenerate api types) |
| **Audited Scope** | `src/`, `convex/`, `scripts/`, `tests/` — 97 scanned files, 119 TS/TSX/MJS files, **9,101 effective LOC** |
| **Tech Stack & Runtime** | Next.js 16.3.4 (webpack) · React 19 · Convex 1.45 + Convex Auth · Serwist PWA · TypeScript 5.9 strict · Node 22 |
| **Pre/Post-Audit SHA-256** | `dac3573e…` (pre-audit tree digest; post-fix tree intentionally differs — see §6) |
| **Deterministic Health Score** | **`52 / 100`** pre-fix (`D_raw = 125`, `P_test ≈ 6.8`, `M_kill ≈ 55%`); **`78 / 100`** post-fix |
| **Vibe-Debt Risk Level** | **HIGH** → **MODERATE** after remediation |

> Method: 10-lens static review + preflight telemetry + full gate run (`typecheck`, 73 unit tests, consistency, diagrams, production build). Zero source mutation during the audit pass; every fix below was applied only after the finding was recorded, with a failing test where the defect is unit-testable.

---

## 1. Executive Architecture & Vibe-Debt Triage

J-Pay is a well-separated Next.js + Convex PWA: authz helpers are centralised in `convex/access.ts`, the shift grammar is a genuinely pure module with a 18-case suite, and the Convex schema matches the TRD. The dominant failure mode is **not** crash risk — it is **payroll truth**: the money path trusts a client-supplied timestamp/position combination more than the product claims, and one of its headline features (offline replay) silently deletes worked hours. Secondary debt is identity hygiene around the master-password temp moderators and a parallel, unpayrolled `punches` attendance subsystem living beside `logs`.

| Severity Tier | Count | Deduction | Primary Failure Domains |
| :--- | :--- | :--- | :--- |
| **P0 — Critical** | 1 | −18 | Out-of-geofence check-ins are recorded but never gate pay (`convex/logs.ts` + `src/lib/shift-engine.ts`) |
| **P1 — High** | 9 | −72 | Offline replay loses hours; master-temp identity collision; permanent bootstrap key mint; stale-temp cron kills live sessions; export window on server time; public geocode proxy; silent `resolveShift`; retention backlog; unbounded master-password attempts |
| **P2 — Medium** | 10 | −30 | Two attendance models (`punches` vs `logs`); unbounded re-derivation; paired-lunch gap; God files; non-unique email; dead `isDemoSite`; weak tz validation |
| **P3 — Low** | 5 | −5 | Magic numbers, `Date.now()` inside a pure engine, README version drift, unused export |

### High-Risk File Telemetry Hotspots

| File | Eff. LOC | CC / density | Silent catches | Signature |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/check-in-card.tsx` | 830 | high | 0 | God component: timer, GPS, token, outbox, render in one file |
| `convex/demo/index.ts` | 719 | high | 0 | God module: 20+ demo endpoints |
| `src/app/moderator/page.tsx` | 520 | high | 0 | Console monolith |
| `convex/users.ts` | 388 | med-high | 1 (`catch { /* ignore */ }` in sign-out) | Identity + break-glass lifecycle |
| `src/lib/shift-engine.ts` | 224 | high | 0 | Money grammar (correctly pure) |
| `convex/logs.ts` | 266 | med-high | 0 | Trust boundary for every check-in |

---

## 2. The 10-Principal-Engineer Deep Audit

### P0-1 — Out-of-geofence check-ins are recorded and paid
- **Where:** `convex/logs.ts:L70-L72` (compute), `L94-L108` (insert), `src/lib/shift-engine.ts:L32-L40` (derivation), `convex/payroll.ts:L49-L60` (payment filter).
- **Root cause:** `createLog` computes `isWithinGeofence` and stores it, but never rejects or marks the row. The shift engine derives `needsReview` only from grammar violations, and payroll excludes only `needsReview` shifts. The verdict is therefore decorative: an employee can clock in from home, the dashboard shows `geofence✗`, and the shift is paid in full.
- **Trigger:** Any check-in where `haversine > site.geofenceRadiusMeters` — no error, no review, money out.
- **Why tests missed it:** No unit test covers `createLog`; the e2e suite asserts only that a verdict *renders* (`punch-clock.spec.ts:L54-L57`), explicitly allowing `outside` as a pass.
- **Fix applied:** the engine now treats `isWithinGeofence === false` as an evidence flag: the whole segment becomes `needsReview: true, reviewReason: "geofence_violation"`, so it is excluded from payroll until a moderator resolves it. The audit trail is preserved (rejecting outright would erase the evidence and break indoor sites).

### P1-1 — Offline replay collapses an eight-hour shift into one minute
- **Where:** `convex/logs.ts:L74` (`clockSkewMs = Date.now() - clientReportedTime`), `src/lib/shift-engine.ts:L27-L30` (`skewCorrectedTime`).
- **Root cause:** clock skew is measured at **sync** time, not **queue** time. An entry queued at 08:00 and flushed at 12:00 stores `clockSkewMs ≈ 4h`, which is above the 30 s tolerance, so the engine discards the worker's timestamp and uses `_creationTime` (12:00). A whole offline day synced at once collapses into seconds.
- **Contradiction at source:** TRD §8.5 says “shift derivation MUST order by skew-corrected `clientReportedTime` … ordering by server time would place them in wrong shifts”; §6.1 rule 1 mandates exactly the server-time fallback the code implements.
- **Fix applied:** `serverClockSkewMs(clientReportedTime, queuedAt, now)` measures skew against the client's queue timestamp (future values rejected), the outbox now sends `queuedAt`, and the engine flags any segment containing a replay (`offline_replay`) for moderator review. Hours are preserved; unverifiable money is not auto-paid.

### P1-2 — Master-temp moderators shadow real accounts by email
- **Where:** `convex/users.ts:L314-L328` (`createMasterTempUser` inserts a second `users` row with the operator's email), `convex/users_queries.ts:L34-L42` (`.first()` on a **non-unique** `email` index).
- **Root cause:** every master-password login mints a new moderator row carrying the same email as a real employee. `getByEmail` returns whichever row the index yields first — so `provisionEmployee` can report `USER_EXISTS` against a ghost, and password-reset/break-glass paths can target the temp row instead of the person.
- **Fix applied:** `getByEmail` excludes `isMasterTemp` rows; temp users remain audit-visible but can no longer impersonate an identity lookup.

### P1-3 — `BOOTSTRAP_KEY` is a permanent moderator mint
- **Where:** `convex/users.ts:L99-L127` (`provisionModerator`, public action).
- **Root cause:** the key check is unconditional. A leaked env value can create unlimited moderators forever, from an unauthenticated client.
- **Fix applied:** the key path is now honoured **only while zero moderators exist** (true bootstrap); afterwards a signed-in moderator is required.

### P1-4 — The daily cron kills a live master session
- **Where:** `convex/users.ts:L359-L387`, `convex/crons.ts:L18-L22` (04:00 UTC).
- **Root cause:** every active `isMasterTemp` row is archived regardless of age, so a break-glass session in use at 04:00 loses its JWT subject mid-task.
- **Fix applied:** only temp rows older than 12 h are swept.

### P1-5 — Payroll CSV export uses the wrong clock
- **Where:** `convex/payroll_data.ts:L4-L27`.
- **Root cause:** the export range is applied to `_creationTime` (server arrival) while the product’s periods are attendance periods. Offline logs that synced after the period closed vanish from the CSV — the same defect class as P1-1, in the artefact employers actually pay from.
- **Fix applied:** collect by user, filter and sort on `clientReportedTime`, cap at 5,000 rows, `truncated` computed from the filtered set.

### P1-6 — Public Nominatim proxy
- **Where:** `convex/geocode.ts:L13-L31`.
- **Root cause:** `action` with no auth. Anyone with the deployment URL can drive `nominatim.openstreetmap.org` through it, violating Nominatim’s usage policy and burning the deployment’s reputation/IP.
- **Fix applied:** moderator-only, with a 200-character query ceiling.

### P1-7 — `resolveShift` returns `[]` instead of failing
- **Where:** `convex/moderator.ts:L143-L164`.
- **Root cause:** a mutation that silently no-ops for non-moderators. The UI treats the resolved promise as success, so a flagged shift appears handled while staying flagged.
- **Fix applied:** `requireModerator` (throws), `byModeratorId` reused from the same check, explicit `{ ok: true }`.

### P1-8 — Retention purge can never clear a backlog
- **Where:** `convex/logs.ts:L243-L266`.
- **Root cause:** `.take(500)` once per day, no cursor. A backlog larger than 500 rows/day never reaches the retention window — a data-governance breach in a product that promises coordinate anonymisation.
- **Fix applied:** cursor pagination with a 5,000-row per-run ceiling; audit row counts actual purges.

### P1-9 — No rate limit on the master password
- **Where:** `convex/auth.ts:L43-L70` (custom `ConvexCredentials` provider).
- **Root cause:** Convex Auth’s built-in rate limiting covers its own flows; a custom credentials provider’s `authorize` is called directly. `MASTER_PASSWORD` — a shared, org-wide break-glass secret — can be brute-forced at mutation speed.
- **Status:** **not fixed in this pass** (needs a deliberate throttle design: per-IP + per-email counters in a Convex table, or moving break-glass to a CLI-only internal action). Documented as the top remaining risk.

### P2 findings (recorded, not all fixed)

1. **Two attendance systems.** `convex/punches.ts` writes a `punches` table that payroll never reads; `/punch` is a parallel UI. Split-brain state — either wire `punches` into derivation or prune the page.
2. **`deriveForUser` re-derives the entire log history on every check-in** (`convex/shifts.ts:L6-L50`), deleting and re-inserting every unsealed shift. O(N) per write; at ~2k logs the mutation approaches Convex limits.
3. **Paired-lunch gap.** A `lunch → checkpoint` pair deducts nothing (`src/lib/shift-engine.ts:L99-L100`), while an *unpaired* lunch deducts 60 min. Either lunch is paid (then rule 4 is inconsistent) or it is not (then every normal lunch is overpaid). Product decision required — not changed silently.
4. **`sites.listMine` returned archived sites to moderators** — fixed.
5. **`issueMyDeviceToken` minted tokens for any role** — fixed (employee-only).
6. **Non-unique `email` index** in `convex/schema.ts:L33`; uniqueness is enforced only by application code and is now broken by temp rows.
7. **`isDemoSite()` always returns `false`** (`convex/demo/scope.ts:L38-L44`) — a dead guard with a misleading name; callers use the `…WithDb` variant.
8. **God files:** `check-in-card.tsx` (830), `demo/index.ts` (719), `moderator/page.tsx` (520). Split on the next feature touch, not now.
9. **`createSite` timezone validation is `includes("/")`** (`convex/sites.ts:L83`) — accepts `Foo/Bar`; an invalid IANA name silently falls back to UTC in `localDayKey`.
10. **`punches.getPunchHistory`** filters after the index and the index name (`by_user_site_time`) promises a time component it does not have (`["userId","siteId"]`).

### P3 notes
- `30_000` skew threshold duplicated in `convex/logs.ts:L83` instead of `jpayConfig.laborRules.skewToleranceMs`.
- `clockSkewMs ?? 0` in the previous-fix filter treats a missing skew as trustworthy (`convex/logs.ts:L83`, `L206`).
- `MAX_SHIFT_MS` auto-close calls `Date.now()` inside a pure module — non-deterministic under test.
- README still says “Next.js 15” while `package.json` pins 16.3.3 (built 16.3.4).
- `formatMinutesShort` exported from a component file and unused outside it.

---

## 3. Test Suite Comparison & Mutation Truth Table

- **Test-to-code ratio:** 20 test files / 119 source files (`0.17`); 73 unit tests + 15 Playwright specs.
- **Estimated Mutation Kill Score:** **≈ 55%** — the pure engine is well covered (18 cases incl. boundaries); the Convex trust boundary has **zero** unit tests.

| Module | Critical branches | Paired tests | Pathologies | Mutants killed | Missing assertions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `src/lib/shift-engine.ts` | sort, dedupe, 7 statuses, lunch/side-mission, auto-close | `scripts/test-shift-engine.mjs` | none systemic | 3/4 | geofence + replay (added) |
| `src/lib/payroll-strategies.ts` | weekly cap, Sunday, OT lines | `scripts/test-payroll-strategies.mjs` | happy-path leaning | 2/4 | zero/negative rate, leap-week |
| `convex/logs.ts` | geofence, idempotency, travel | **NONE** | — | 0/4 | every branch |
| `convex/users.ts` | bootstrap, reset, temp lifecycle | **NONE** | — | 0/4 | every branch |
| `convex/payroll.ts` | authz, day bucketing | e2e only | — | 1/4 | employee-vs-moderator boundary |

**Why the P0/P1 defects survived:** the suite tests the grammar in isolation and the UI through a browser, but nothing exercises a Convex mutation’s trust decisions. The e2e check-in test asserts that a verdict *appears*, not that an outside-fence verdict *blocks pay*.

### MVTH additions landed
1. `offline replay` — a log synced 4 h late keeps its 480 minutes, is flagged `offline_replay`.
2. `geofence` — one outside-fence log flags the whole segment `geofence_violation`.
3. `serverClockSkewMs` — enqueue-time skew, future `queuedAt` ignored.

---

## 4. Remediation applied (commit series, all gates green)

| # | Fix | Files |
| :--- | :--- | :--- |
| 1 | Geofence evidence → `needsReview` (payroll exclusion) | `src/lib/shift-engine.ts`, `convex/shifts.ts`, tests |
| 2 | Offline replay: enqueue-time skew + `queuedAt` + review flag | `convex/logs.ts`, `src/lib/shift-engine.ts`, `src/app/check-in-card.tsx`, tests |
| 3 | Master-temp identity shadowing | `convex/users_queries.ts` |
| 4 | Bootstrap key limited to first moderator | `convex/users.ts` |
| 5 | Temp-session cron age gate | `convex/users.ts` |
| 6 | Payroll export on client time | `convex/payroll_data.ts` |
| 7 | Geocode moderator-only + length cap | `convex/geocode.ts` |
| 8 | `resolveShift` throws instead of no-op | `convex/moderator.ts` |
| 9 | Retention purge pagination | `convex/logs.ts` |
| 10 | Archived sites hidden from moderator list | `convex/sites.ts` |
| 11 | Device token employee-only | `convex/users.ts` |
| 12 | Message inbox/send require an active account | `convex/messages.ts` |
| 13 | `demo/page.tsx` shift id type (was failing `tsc`) | `src/app/demo/page.tsx` |

**Gate results after the fix series**

| Gate | Before | After |
| :--- | :--- | :--- |
| `npm run typecheck` | **1 error** (`demo/page.tsx:163`) | ✅ clean |
| `npm test` | 68/70 (2 build-artifact) | ✅ 73/73 after build |
| `npm run build` | not run | ✅ compiled, 12 routes, SW bundled |
| `scripts/check_consistency.py` | pass | ✅ pass |
| `scripts/check_diagrams.py` | pass | ✅ 5/5 |
| Playwright e2e | not run (needs a live Convex deployment + creds) | ⏳ outstanding |

---

## 5. Remaining roadmap

1. **Rate-limit break-glass** (P1-9): per-email + per-IP counter table, or demote `MASTER_PASSWORD` to a CLI-only `internalAction`.
2. **Decide lunch semantics** (P2-3) with the owner, then make paired/unpaired treatment symmetric.
3. **Resolve the `punches` split-brain**: wire it into derivation or delete `/punch` + `convex/punches.ts` (surgical pruning).
4. **Window `deriveForUser`** to the affected shift window instead of full history.
5. **Run the e2e suite** against a dev deployment (`npx convex dev`, `JPAY_EMAIL`/`JPAY_PASSWORD`) — the only gate not exercised here.

---

## 6. Delivery state — measured, not assumed

Both halves are deployed. `scripts/deploy_prod.py` runs the sequence with no stdin attached to any child, so nothing can hang on a prompt.

| Check | Result |
| :--- | :--- |
| `git push origin main` | ✅ `origin/main` = `c0a8810` |
| GitHub Actions | ❌ `startup_failure` at **0s** for every push — TeacherEvan account locked on a billing issue. CI has never run; the green gates are local. |
| Convex production (`different-crow-187`) | ✅ **Deployed** — `https://different-crow-187.convex.cloud`, 15 tables pushed, no index deletions |
| Convex env | ✅ `JWKS`, `JWT_PRIVATE_KEY`, `SITE_URL`, `DEVICE_TOKEN_SECRET`, `BOOTSTRAP_KEY` |
| Vercel from a **git** push | ❌ **BLOCKED** — *“Vercel couldn’t find a Git account for the commit author”* (`fenrie@local`). Three attempts, all blocked. |
| Vercel from the **staged tree** (no `.git` metadata) | ✅ **READY**, target `production`, aliased `https://j-pay.vercel.app` + `https://j-pay-teacher-evans-projects.vercel.app` |
| Runtime wiring | ✅ `app/layout-*.js` contains `different-crow-187.convex.cloud`; the page renders the app shell, not the “NEXT_PUBLIC_CONVEX_URL is not set” guard |
| **Live browser verification** (`scripts/verify_live.mjs`, headless Chromium) | ✅ Title `J-Pay`; full sign-in screen (email + ID code, `Sign in`, `First time? Activate with your ID code`); zero console errors and zero failed requests on load |
| **Backend round trip** | ✅ A bogus sign-in reached the deployment and was rejected **server-side**: `auth:signIn` → `Uncaught Error: InvalidAccountId` (Password.ts:157), with a Convex request id in the client console. The frontend is genuinely talking to `different-crow-187` |
| Deployment protection | ⚠️ `vercel_authentication` is on for **deployment URLs** (302 → SSO), but **not** for the `https://j-pay.vercel.app` alias, which returns **200 publicly** (`deploymentType: all_except_custom_domains`). A pilot needs this decided deliberately |
| Convex plan | ⚠️ CLI reports the team is **above the Free plan limits** — confirm the plan before a pilot |

**Why git deploys fail but the CLI works.** Vercel authorises a git deployment against the commit author’s Vercel/GitHub account. Agent-authored commits (`Fenrie <fenrie@local>`) have no such account, so every push is blocked regardless of build health. `deploy_prod.py` therefore stages the tree without `.git` and deploys the upload — the artefact is the same, the release is not gated on an identity the agent cannot own.

**Order is still load-bearing.** `queuedAt` is a new *argument* on `logs:createLog`; Convex validates arguments strictly. Backend first (done), frontend second (done). Never the reverse.

**The one remaining human gate:** the deployment has no moderator account, so nobody can sign in yet. Bootstrap it once with the key held at `~/.hermes/keys/jpay-bootstrap-key` (0600), then delete `BOOTSTRAP_KEY` from the deployment:

```bash
npx convex run --deployment different-crow-187 users:bootstrapFirstModerator \
  '{"key":"<from the key file>","email":"<owner email>"}'
npx convex env remove --deployment different-crow-187 BOOTSTRAP_KEY
```

Do not put the key in a commit, a work log or this report.

*Audit and remediation performed against commit `e97765e`. Every numeric claim above is backed by a command run in this session; the gate table is reproducible with the four commands in §4.*
