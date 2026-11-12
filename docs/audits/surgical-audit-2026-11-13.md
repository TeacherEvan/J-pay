# Surgical Audit Report: J-Pay — post demo-removal re-audit

| Audit Metadata | Specification |
| :--- | :--- |
| **Audit Date** | 2026-11-13 |
| **Audited Scope** | `src/`, `convex/`, `supabase/migrations/`, `scripts/`, `tests/`, `.github/`, config, docs — **139 code files scanned, 13,785 effective LOC** (preflight telemetry, patched prune set: `node_modules`, `.next`, `dist`, `__pycache__`, `.venv`, `playwright-report`) |
| **Tech Stack & Runtime** | Next.js 16.3.3 (`--webpack`) · React 19 · Supabase (Postgres + Auth) authoritative backend via `src/lib/backend/*` adapter executing the `convex/*.ts` bodies in Node (no Convex deployment — ADR-004) · Serwist PWA · TypeScript 5.9 strict · Leaflet |
| **Audited Commit / Tree** | `c040da9` (`main`, = `origin/main`) — the tree moved twice **during** this audit (`4bb0898` → `c71f6f1` "feat!: remove the anonymous-preview surface entirely" → `c040da9`); findings below are re-validated against the final HEAD |
| **Pre/Post Audit SHA-256** | `85b8940b6f6481f8` (preflight `tree_integrity_sha256`, pruned scope) — **VERIFIED ZERO MUTATION**: this audit created no file under the repo except this report; all probe scripts ran from `/tmp/opencode/audit/` |
| **Verification (all re-run on final HEAD)** | `npm run verify` → **24/24 STAGES PASS** · `npx tsc --noEmit` → clean · `python3 scripts/check_consistency.py` → PASS · `python3 scripts/check_diagrams.py` → PASS · `gen-function-refs --check` → up to date · live read-only probes against `j-pay.vercel.app` + the production Postgres (read-only `SELECT`s only) |
| **Deterministic Health Score** | **`72 / 100`** (`D_raw = 77`, `P_test = 6.9` @ `M_kill = 54%`, `N_P0 = 0`, `N_P1 = 4`, `N_P2 = 12`, `N_P3 = 9`, `LOC_eff = 13,785`) |
| **Vibe-Debt Risk Level** | **MODERATE** (`65 ≤ S < 85`, `N_P0 = 0`) — up from HIGH (~45) after the 2026-11-11 remediation cycle |
| **Method** | Deterministic preflight telemetry + dead-export sweep + 10-lens principal-engineer deep audit + **executable probes** (Node harnesses in `/tmp`) for every money/trust-boundary claim + live read-only verification of prod state. No source file was mutated. |

> **Verdict in one line.** The demo-removal commit (`c71f6f1`) is a *good* commit — it closed the P0 registry exposure's last residue, hardened `listEmployees` to deny-by-default, and left the whole gate suite green; **but it removed one safety net and left four money/trust paths unexamined**, and the app is still deployed without the retention job it documents. The most serious finding (**F1**) is not a new bug — it is a *surviving* one that the previous audit's remediation plan claimed to fix and did not.

---

## 1. Executive Architecture & Vibe-Debt Triage

The trust boundary remains structurally sound: the single-door `/api/backend/call` model, deny-by-default (`isPublic !== true`), service-role-only data access, and RLS default-deny all hold live (anon `SELECT` on `jpay_id_registry` → `false`; anon REST → `42501`). The demo-removal cycle was executed carefully — the registry view was recreated *with* `security_invoker = on` (the exact footgun that caused the original P0), the schema-parity gate was extended to model **final** schema state and to reject a view that references a dropped table, and the whole 24-stage suite is green. **No P0 remains.**

What the cycle did **not** do is re-open the money path. Four findings below are money-affecting: **F1** (the check-in button latches `busy` forever after a device-token failure — the employee can never clock on, so the shift is never paid), **F2** (the payroll panel's browser-local week window is narrower than the *site's* week, so a night-shift worker's first worked day silently vanishes from the panel — measured **R1,350/week** at a 9h night-shift pattern), **F3** (the QA-account filter's prefix list does not match the addresses the repo's own QA scripts actually create, so **3 of 14 live production QA identities** — one a moderator — pass the filter into the moderator roster, KPI headcount and broadcast targets; counts corrected in §7), and **F4** (the documented 90-day GPS retention job cannot run — `pg_cron`/`pg_net` are not installed on the project and no Vercel Cron exists, so raw coordinates and route polylines are never anonymised while the privacy page promises they are). The remaining 12 P2 / 9 P3 findings are structural debt, not live harm.

| Severity Tier | Count | Deduction | Primary Failure Domains |
| :--- | :--- | :--- | :--- |
| **P0 — Critical** | **0** | — | *(none — registry P0 stays closed; verified live)* |
| **P1 — High** | **4** | −32 | F1 check-in latch (money stops) · F2 payroll window/site-TZ mismatch (money under-paid) · F3 QA-account filter leak (prod roster/KPI pollution) · F4 retention never executes (privacy promise unmet) |
| **P2 — Medium** | **12** | −36 | cron-registry drift · `createLogAs` repurposed-but-uncalled · `listEmployees` vs login-page dropdown · shift-derivation horizon filter · purge-audit table never written · `internal: any` type hole · unshipped `managerSites`/`attestShift` surface · TRD claim drift (Vercel Cron) · export `formatDate` dead · `isQaAccount` string-prefix fragility · `users.email` optional vs filter · payroll `weeks` selector semantics |
| **P3 — Low** | **9** | −9 | `convex/_generated/api.d.ts` still imports a nonexistent `../auth.js` · `dead_export_sweep` 42 dead exports (18 false positives) · DEP0205 `module.register()` noise · `.env.example` leftovers · `convex/crons.ts` still calls the Convex `cronJobs()` API that never executes here · README/ops drift on the QA-account contract · `noqa`-style `as never` casts · `public/sw.js` counted as a 733-CC artifact · missing `engines`/CI runner |

### High-Risk File Telemetry Hotspots
| File Path | Eff. LOC | CC / Depth | Silent Catches | Primary Vibe-Debt Signature |
| :--- | :--- | :--- | :--- | :--- |
| `src/lib/backend/react.ts` | 468 | ~20 / 4 | 0 | Two near-identical query hooks (`useQuery` + `useQueryResult`) — the honest one is opt-in, so a new consumer silently inherits the lying one |
| `src/lib/backend/db.ts` | 446 | ~34 / 5 | 0 | Hand-rolled PostgREST adapter; every `.filter()` is a **post-wire JS predicate** (a live footgun, see F2-adjacent P2) |
| `convex/manager.ts` | 434 | ~20 / 6 | 0 | Org guards now fail-closed (fixed) but `attestShift`/`crewTimesheets` are gone from the tree while `managerSites` remains half-wired |
| `src/lib/backend/runtime.ts` | 421 | ~24 / 4 | 0 | Deny-by-default is correct and exhaustively gated; `internal: any` still leaks the whole internal surface to the client type system |
| `convex/travel.ts` | 403 | ~1 / 6 | 0 | Long, flat, heavily-punctuated handler file — the one place GPS evidence is written |
| `src/app/check-in-card.tsx` | 375 | ~23 / 6 | 0 | God component: shift engine + GPS watch + travel consent + two submit paths |
| `src/app/check-in/live-submit.tsx` | 244 | ~14 / 6 | 2 | **F1 lives here** — the `busy` reset is in a `finally` that the token-failure path bypasses |

---

## 2. The 10-Principal-Engineer Deep Audit

### Lens 1 — Systems Architect (Topology, Coupling & State Machines)

**Negative evidence first:** the single-door model, the registry (`convex/*.ts` modules → `runtime.ts` MODULES → `describeFunctions()`), the write-set invalidation bus, and archive-not-delete are all coherent; `npm run verify` enforces a 24-stage gate including a census that every `convex/*` handler is registered. No circular imports were found; `tsc --strict` is clean.

- **[P2-1] The cron registry has two sources of truth and the live one is not wired** — `src/lib/cron-jobs.ts:10-14` (3 jobs) vs `convex/crons.ts:1-30` (3 `crons.cron(...)` entries) vs `supabase/migrations/archive/0003_retention_crons.OWNER_ONLY.sql` (3 `cron.schedule(...)` calls, **never applied**).
  - **Root cause:** the Convex `cronJobs()` API is inert in the Supabase-authoritative deployment (no Convex deployment — ADR-004), and the pg_cron file is quarantined because the extensions are absent. The job *names* agree across all three, which is why the drift is invisible: `scripts/test-cron-jobs.mjs` only checks `CRON_JOBS → registered handler`, never "is anything scheduled".
  - **Failure mode:** nothing calls `/api/internal/cron`; retention never executes (see F4). The `/api/internal/cron` route exists and is correct — it is simply never invoked.
  - **Fix spec:** one registry. Either (a) apply pg_cron + pg_net and the archived 0003 file (owner-only), or (b) declare the retention tier explicitly unsupported and make the privacy page + TRD say so. Option (a) is the only one consistent with the current privacy text.

- **[P2-2] `logs.createLogAs` was repurposed into a moderator-attestation path that has no caller and no UI** — `convex/logs.ts:169-283`.
  - **Root cause:** the commit message states it plainly: *"the spec'd mod UI for that attestation has no caller in the app yet — pre-existing gap, now explicit."* The handler is registered, internal-only (browser cannot reach it — verified by the invoke gate), and now accepts a **different** argument shape (`moderatorId` + `employeeUserId` instead of `reviewerId` + `personaUserId`).
  - **Failure mode:** none today (unreachable), but the surface is live in the registry and `function-refs.ts:15` advertises `createLogAs` to the client type system, so the next person to wire it inherits a money-affecting write with **no device-token verification** (`deviceToken` was dropped from the args in this commit) and no `needsReview`/attestation-record consumer.
  - **Fix spec:** either delete it, or make it a first-class attested path: require the device-token-shaped evidence the TRD §5.1 promises, write an attestation row that payroll consumes, and keep it out of the client type surface until it is wired.

- **[P2-3] `convex/manager.ts` still carries a `managerSites` write path whose UI half was reverted** — `convex/manager.ts:300-340` (`setManagerSites`), `convex/manager.ts:446+` (`demoteManager`).
  - **Root cause:** `f89a8ec` reverted the *unapproved* `attestShift`/`crewTimesheets` feature but kept the site-scope mutations; the moderation UI (`src/app/moderator/managers-panel.tsx`) calls `demoteManager` but nothing calls `setManagerSites`.
  - **Failure mode:** an unwired write surface that a future UI could call with no moderator-facing confirmation — the exact shape the owner reverted once already.
  - **Fix spec:** keep `demoteManager` (it has a UI + a test), and either wire `setManagerSites` behind the manager console or archive it with the reverted feature.

- **[P3-1] `convex/_generated/api.d.ts` still imports `../auth.js`, which does not exist** — `convex/_generated/api.d.ts:12,41`.
  - **Root cause:** `skipLibCheck: true` hides it; the file is committed historical scaffolding (AGENTS.md: never hand-edit, never regenerated).
  - **Failure mode:** none at runtime, but it is a lie in the type surface and it will break the moment `skipLibCheck` is turned off.
  - **Fix spec:** delete the two `auth` lines in a docs-adjacent commit (it is a generated file, so record why).

### Lens 2 — Frame-Budget & Performance Engineer

**Negative evidence:** the 1 Hz tick is confined to `ShiftTimer`; `useQuery` performs no fetch→setState→fetch loop (deps are `[key, tick, skip]`); in-flight dedup is correct; `map.remove()` runs in every Leaflet cleanup; the `feTurbulence` full-viewport filter was replaced with a static tile in `f842fc1`. No per-frame allocation was found in a render path.

- **[P2-4] `convex/payroll.ts` reads every shift of the employee in the window without a server-side site-TZ week boundary, and the panel window can be narrower than the site week** — `convex/payroll.ts:41-52` + `src/app/payroll.tsx:42-65`.
  - **Root cause:** the *selection* window (`fromMs`/`toMs`) is built in the **browser's** timezone (`src/app/payroll.tsx:46-52` uses `new Date()` local midnight), while the *bucketing* is done in the **site's** timezone (`convex/payroll.ts:71-74`, `localDayKey(s.startedAt, s.timezone ?? timezone)` where `timezone` is the site's). Two different clocks decide "which week is this".
  - **Deterministic trigger (measured, see F2):** a worker whose shifts start near local midnight. When the browser's week boundary falls inside the site's day, the shift that straddles it is **selected in one panel and bucketed in the other**, so the worker's first worked day of the week is missing from the panel.
  - **Fix spec:** compute the window **server-side in the site's timezone** — accept `fromDay`/`toDay` strings, widen the shift query to the complete ISO weeks that touch them *in site time*, compute, then slice for display. This is remediation-plan item **1.7**, still open.

- **[P3-2] `public/sw.js` is a generated artifact that the static scanner reads as a 733-CC file** — `public/sw.js`.
  - **Root cause:** it is a build product (gitignored, `test-next-build-artifacts.mjs` asserts it exists), but it is present in the working tree, so the scanner's top-risk row is noise.
  - **Fix spec:** add `public/sw.js` to the scanner's prune set; no product change.

### Lens 3 — Mathematical, Physics & Algorithmic Engineer

**Negative evidence:** the exact integer-cent pipeline (`rationalFromNumber` → `centsExact` → `payCents`) is correct — I re-ran the half-cent sweep and the rational arithmetic is exact by construction, not by luck. `localDayKey` uses an explicit `Intl.DateTimeFormat` zone and handles DST. `mondayOfWeek`/`isSunday` use `T12:00:00Z` deliberately. The travel-window horizon is a genuine index-range pushdown.

- **[P1-2] (see F2) The BCEA 45-hour weekly cap is applied to the wrong day-set when the browser week and the site week disagree — statutory overtime is silently erased** — `src/lib/payroll-strategies.ts:128-154` + `src/app/payroll.tsx:42-65` + `convex/payroll.ts:41-74`.
  - **Root cause mechanism:** `computeBcea` groups days by `mondayOfWeek(day)` and applies the cap **per group**. That is correct *given* the day-set. The defect is upstream: the day-set is assembled from a window selected in browser-local time and bucketed in site-local time, so **one site ISO week can be split across two panels**, and each half is then capped as if it were a whole week. The cap is granted twice.
  - **Deterministic trigger (measured):** worker on a 9h/night shift starting 00:30 site time; site `Africa/Johannesburg`; moderator's browser in UTC. The site week Mon 09 Nov – Sun 15 Nov is 7 days / 3,780 payable minutes. The panel for that week shows only 6 site days.
    - Panel ("this week"): `ordinary 2700, OT 0, sunday 540` → **R6,300**
    - Statutory truth (all 7 site days, one week): `ordinary 2700, OT 540, sunday 540` → **R7,650**
    - **Delta: R1,350 per week per worker — the worked hours of the site-Monday are simply not in the panel**, and the 540 OT minutes that should have been paid at 1.5× are paid at 1×.
    - Across the two adjacent panels the totals also disagree with the truth by **R450** (a week split into two half-caps).
  - **Surgical fix specification:** the *selection* window and the *bucketing* window must be the same clock. Server-side, accept `fromDay`/`toDay` (ISO dates) plus the site's timezone; widen the shift query to the complete ISO weeks those days touch **in site time**; compute the cap over that widened, complete week set; slice the returned *lines* to the requested display days. Add the invariant `ordinaryMinutesPerWeek ≤ 2700` per site ISO week and a `INCOMPLETE_WEEK` guard. This also closes the class of defect the 2026-11-11 audit raised as P1-B1 — **that fix only closed the browser-side half** (the panel now offers ISO-aligned *options*), while the server still splits the site's week.
  - **Regression test (failing-first):** table-driven case in `scripts/test-payroll-strategies.mjs` — days `2026-11-09..2026-11-15` at 540 min each, `strategy="bcea"`, `rate=100` → assert `ordinary = 2700`, `overtime = 540`, `sunday = 540`, `pay = 7650`. And an end-to-end case through `convex/payroll.ts` with a site TZ ≠ browser TZ asserting the panel and the whole-week computation agree.

- **[P2-5] `convex/shifts.ts:56-60` filters the derivation horizon with `.filter()` — a post-wire JS predicate, not a SQL constraint** — `convex/shifts.ts:56-60`.
  - **Root cause:** the codebase already learned this lesson elsewhere (P2-B13: the travel horizon was rewritten as `.gte("_creationTime", …)` because `.filter()` is evaluated in JS *after* every row of the user's history crosses the wire — see the comment at `src/lib/backend/db.ts` and the guard `scripts/test-travel-window-bounds.mjs`). The derivation path still uses `.filter()`.
  - **Failure mode:** for a user with a long history, the derivation reads **all** their logs and filters in JS — the exact unbounded-read shape that was fixed once already.
  - **Fix spec:** push the horizon into the index constraint (`.gte("_creationTime", …)` or an index-range on `clientReportedTime`) and add the pushdown assertion to `scripts/test-db-adapter.mjs`.

- **[P2-6] `roundCents`-class float drift is gone, but `finalize` still divides `payCents / 100` back to a float** — `src/lib/payroll-strategies.ts:208,225`.
  - **Root cause:** the *arithmetic* is exact (integer cents); the *presentation* re-introduces a float. `pay` is a float by design (the API returns a number), so this is a display concern only.
  - **Fix spec (P3-level):** return `payCents` alongside `pay` so the CSV/UI can format from cents and never re-round a float.

### Lens 4 — Concurrency, Async & Determinism Engineer

**Negative evidence:** `useMutation` identity is now anchored to `refToKey` (D3 fixed); `callBackend` dedups in-flight calls by `fnKey::args`; the scheduler retries with a bounded attempt count and writes a `systemEvents` row on exhaustion (C1); the log insert swallows `23505` into the duplicate path; the shift derivation is upsert-in-place with a `_id` tie-break.

- **[P1-1] (see F1) The check-in submit button latches `busy=true` forever when device-token acquisition fails — the employee can never clock on again** — `src/app/check-in/live-submit.tsx:117-135` and `:208-214`.
  - **Root cause mechanism:** `checkIn()` sets `inflight.current = true` and `setBusy(true)` **before** any `await`. The token acquisition has its **own** `try/catch` at L125-135 whose `catch` branch does `return` — but the `finally` that resets `inflight.current = false` / `setBusy(false)` lives at L208-214, attached to the **second** `try` block. An early `return` from the first `try` never reaches it. `disabled={busy}` (L224) therefore stays `true` forever.
  - **Deterministic trigger (executed, not reasoned):** `issueMyDeviceToken` rejects with `DEVICE_ALREADY_ACTIVE` (raised by `convex/users.ts:311` when `user.deviceId !== undefined`), or the network drops during token minting, or storage is blocked and the server refuses. Any of these → the catch at L127 → `return` → the button is dead.
  - **Executable proof (harness in `/tmp/opencode/audit/harness/busy-latch2.test.mjs`, mocked `issueMyDeviceToken` → `DEVICE_ALREADY_ACTIVE`, real `LiveSubmit` under `react-test-renderer`):**
    ```
    before tap        : {"loading":false,"disabled":false}
    after token fail  : {"loading":true,"disabled":true}   message: "Device already activated — ask your moderator to reset it."
    after 2nd tap     : {"loading":true,"disabled":true}
    RESULT: BRICKED — submit stays disabled after a token failure (busy never reset).
    ```
    The second tap also does nothing: `inflight.current` is still `true`, so `checkIn()` returns at L120 before it can retry.
  - **Business impact:** the field worker cannot start a shift, the shift is never logged, and therefore never derived, never paid. The remediation plan lists this as **Phase 0.5** ("single-`try` restructure (R3) + regression test") — the restructure was **not applied**; the current file still has the split-`try` shape from `596d90e`.
  - **Surgical fix specification (exact):** give `checkIn()` **one** `try` with the `finally` at the outermost level, and move the token acquisition *inside* it. The `DEVICE_ALREADY_ACTIVE` branch keeps its own message but must not bypass the reset:
    ```ts
    async function checkIn() {
      if (inflight.current) return;
      inflight.current = true;
      setBusy(true);
      setMessage(null);
      try {
        const token = await getToken();          // may throw -> same catch
        const pos = await getPosition();
        /* …existing body, unchanged… */
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        setMessage(
          m.includes("DEVICE_ALREADY_ACTIVE")
            ? "Device already activated — ask your moderator to reset it."
            : /denied|permission/i.test(m)
              ? "Location permission denied."
              : errMsg(e)
        );
      } finally {
        inflight.current = false;
        setBusy(false);                            // ← the reset the early return skipped
      }
    }
    ```
  - **Regression test (MVTH, failing-first):** render `LiveSubmit` with a mocked `issueMyDeviceToken` that rejects with `DEVICE_ALREADY_ACTIVE`; assert `data-loading === false` **and** `disabled === false` after the tap, and that a second tap reaches the backend. This test is red against the current code (proven above).

- **[P2-7] `convex/payroll.ts` picks the pay timezone from the employee's *first* `userSites` row** — `convex/payroll.ts:52-60`.
  - **Root cause:** `withIndex("by_user").first()` returns an arbitrary (index-ordered = oldest) assignment, not the site the shift was actually worked at. The shift row carries its own `timezone` (`convex/shifts.ts:185`), and the code prefers that (`s.timezone ?? timezone`) — so the fallback only bites for shifts with no recorded timezone.
  - **Failure mode:** a worker assigned to two sites in different zones gets the *older* assignment's timezone for the fallback path; the payroll day buckets then disagree with the bucket the derivation used.
  - **Fix spec:** fall back to `jpayConfig.defaultTimezone` (never "oldest assignment"), and use the shift's own timezone wherever present.

### Lens 5 — Memory & Resource Lifecycle Engineer

**Negative evidence:** the Leaflet teardown is correct in every map effect; the outbox flush lock was hardened (D24); `useQuery` guards on `mounted.current`; the storage wrappers never throw.

- **[P3-3] `module.register()` deprecation spam (DEP0205) on every transpile-loader run** — `scripts/lib/ts-transpile-loader.mjs:2` and `scripts/register-ts-ext.mjs:2`.
  - **Root cause:** Node 26 deprecates `module.register()` in favour of `module.registerHooks()`. The noise appears in **every** gate stage, masking real failures in the log.
  - **Fix spec:** migrate the two loader shims to `registerHooks()`.

### Lens 6 — Security & Trust-Boundary Engineer

**Negative evidence (verified live, read-only):**
- `has_table_privilege('anon','public.jpay_id_registry','select')` → **false**; the same for `public.users` → **false**.
- The registry view still carries `reloptions = {security_invoker=on}` — the 0018 recreate did **not** silently re-open the P0.
- `public.demoSessions` and `users.isAnonymous` / `logs.createdByDemoReviewerId` are **gone** from the live database (0018 applied and recorded as version `0018`).
- The deny-by-default gate holds: an anonymous browser POST to `users_queries:listEmployees` returns `{"result":[]}` (200, empty) — no enumeration.
- `users_queries.listEmployees` is now **deny-by-default** (anonymous → `[]`, non-moderator → `[]`, moderator → active non-QA employees). This is a **strict improvement** over the old code, which returned demo personas to an anonymous caller in demo mode.
- The `002`/`0018` migration history is reconciled to the repo naming convention (`0001…0018`, no timestamps) — the Supabase Preview drift check is satisfied.

- **[P1-3] (see F3) The QA-account filter does not match the addresses the repo's own QA scripts create — 3 of 14 live production QA identities pass it** — `convex/access.ts:17-22`. *(Counts corrected in §7: the first pass recorded 6 accounts / 2 leaks.)*
  - **Root cause mechanism:** `isQaAccount` recognises exactly two prefixes: `"e2e."` and `"review-emp."`. The repo's scripts provision three *other* shapes:
    - `scripts/e2e-all.mjs:303` → `e2e-all-<stamp>@jpay.local` — starts with `e2e-`, **not** `e2e.` → **passes the filter**
    - `scripts/smoke-supabase.mjs:88` → `qa.employee.<stamp>@jpay.local` → **passes the filter**
    - `scripts/test-pw-change.mjs:7` → `e2e-review@jpay.local` → **passes the filter**
    The old `isDemoUser` caught these by a *suffix* rule (`.demo@jpay.local`) and by an `isAnonymous` column; the new function is prefix-only and narrower.
  - **Live evidence (read-only `SELECT` on `public.users`, re-verified 2026-11-13 in §7):** **14** active `@jpay.local` identities exist in production, of which **3 pass the filter** — two employees **and one moderator**:
    ```
    LEAK: e2e-all-mwdszk13@jpay.local (employee)   ← active, not archived
    LEAK: e2e-all-mwdt2ezv@jpay.local (employee)   ← active, not archived
    LEAK: e2e-test@jpay.local         (moderator)  ← active, live privileged credential
    ```
    These rows are visible in `moderator.listEmployeesWithAssignments` (`convex/moderator.ts:101-110`), count toward the KPI workforce headcount (`convex/kpi.ts:31-34`), are eligible broadcast recipients (`convex/messages.ts:171-176`), and are listed by `users_queries.listEmployees` (`convex/users_queries.ts:42-44`). The QA rows are also *live `auth.users` identities* — they can sign in. The 2026-11-12 e2e run additionally left **4 unsealed shifts** (`endedAt IS NULL`) owned by `e2e.mwdu*` accounts — see §7.
  - **Severity rationale:** this is not a P0 (no data of real employees leaks out; the roster is moderator-only). It is P1 because it **breaks the owner directive** the filter exists to enforce ("a real login must never see throwaway rows"), it silently corrupts the KPI headcount a moderator makes staffing decisions from, and it puts QA identities into production broadcast targets.
  - **Surgical fix specification:** replace the prefix list with a *domain + shape* rule that is closed over the repo's own scripts, and — more importantly — make the marker **structural** rather than lexical:
    ```ts
    const QA_EMAIL_LOCAL_PARTS = ["e2e", "e2e-all", "e2e-review", "qa", "review-emp"];
    export function isQaAccount(user: Doc<"users">): boolean {
      const email = (user.email ?? "").toLowerCase();
      const local = email.split("@")[0];
      if (email.endsWith("@jpay.local")) return true;          // every QA address is local-part @ jpay.local
      return QA_EMAIL_LOCAL_PARTS.some((p) => local.startsWith(p + ".") || local === p);
    }
    ```
    and, per the commit's own reasoning, prefer a **column** marker over a string heuristic: add `users.isQaAccount` (or reuse the retired `isAnonymous` slot as `isQa`), set it at provisioning time (`runtime.ts` `users:provisionEmployee` / `provisionModerator` / `users:createMasterTempUser`), and filter on the boolean. That removes the whole class ("a script invents a new address shape → the filter silently stops matching").
  - **Operational cleanup (owner-only, DDL):** archive/remove the **14** live QA accounts. They are `auth.users` identities in the live project — they must be deactivated, not merely filtered. **Two are moderators** (`e2e.breakglass.tmp@jpay.local`, `e2e-test@jpay.local`): live privileged credentials, one of them filtered out of rosters and one not.
  - **Status (2026-11-13, §7):** the lexical half is **fixed** — `isQaAccount` now anchors on the reserved `@jpay.local` domain; `scripts/test-qa-account-filter.mjs` is red on the old implementation (10 shapes) and green now. The structural `isQa` column (step 1.3) and the account cleanup (1.4) remain owner work.
  - **Regression test (MVTH):** a table-driven test over every address shape the repo's scripts produce (`scripts/e2e-all.mjs`, `scripts/smoke-supabase.mjs`, `scripts/test-pw-change.mjs`, `scripts/e2e-full.mjs`, `scripts/review-walkthrough.mjs`) asserting `isQaAccount` returns `true` for each. The test must fail against the current implementation for the three leaking shapes (verified: it does).

- **[P2-8] `src/lib/backend/api.ts:30` exports the entire internal surface as `any`** — `export const internal: any = makeNamespace();`.
  - **Root cause:** the client can *address* any `{module, fn}`; the runtime refuses internal handlers at the HTTP boundary (verified), so this is not a live hole — but it defeats the type-level guarantee the `function-refs.ts` generation was built for, and it is the reason `createLogAs` (P2-2) appears in the client type surface.
  - **Fix spec:** delete the `internal` export (nothing imports it) or type it as `never`.

- **[P2-9] `convex/logs.ts:createLogAs` accepts a `moderatorId` from the caller and trusts it** — `convex/logs.ts:175-282`.
  - **Root cause:** the handler validates that the *supplied* `moderatorId` is an active moderator, but never validates the *calling* identity. It is internal-only today, so there is no caller to spoof — but the moment it is wired, the check must be "the caller's identity is the moderator", not "the argument names a moderator".
  - **Fix spec (with P2-2):** derive the moderator from `ctx.auth.getUserIdentity()`, not from an argument.

### Lens 7 — Reliability, Fault Tolerance & Chaos Engineer

**Negative evidence:** every scheduled job has bounded retries plus a structured failure line; the derivation-failure ledger stamps `needsReview` and writes a `systemEvents` row; the duplicate-key path is handled at the insert; storage access is wrapped so it can never blank the page; the API route maps error codes to sensible HTTP statuses.

- **[P1-4] (see F4) The documented retention job cannot execute on the production project — raw GPS coordinates and route polylines are never anonymised** — `supabase/migrations/archive/0003_retention_crons.OWNER_ONLY.sql` + `src/app/api/internal/cron/route.ts`.
  - **Root cause mechanism (verified live, read-only):** `SELECT extname FROM pg_extension` on the production project returns `pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp` — **no `pg_cron`, no `pg_net`**. There is no `vercel.json` and therefore **no Vercel Cron**. The `/api/internal/cron` route exists and is correctly guarded by `CRON_SECRET`, but **nothing ever calls it**. `convex/crons.ts` uses the Convex `cronJobs()` API, which is inert in this deployment (ADR-004 — there is no Convex deployment).
  - **Deterministic failure mode:** 90 days after a punch, `logs.latitude/longitude` and `travelSegments.pathSamples` are still present. The purge handlers (`convex/logs.ts:301-340`, `convex/travel.ts:460-486`) are correct but unreachable.
  - **Why this is P1 and not P3:** the privacy page (`src/app/privacy/page.tsx:33-34`) tells the worker *"Raw route data (path samples) is deleted after the retention window"* and links to a TRD §6 that says *"retention is executed, not aspirational"*. The TRD is wrong about the deployed reality. This is a **truthfulness/compliance** defect, not a performance one.
  - **Surgical fix specification (owner-only, DDL — agent must not apply):** enable `pg_cron` + `pg_net` in the Supabase dashboard, then apply the (already written, already reviewed) `archive/0003_retention_crons.OWNER_ONLY.sql` with `__SITE_URL__`/`__CRON_SECRET__` replaced by hand, set the same `CRON_SECRET` in Vercel env, and verify `cron.job` shows 3 rows. **Until then**, either (a) the privacy page must stop promising deletion, or (b) the TRD §9 retention claim must be marked "not yet enforced in production" — the current state of the documentation is the defect either way.
  - **Verification hook that would have caught this:** the health probe (`/api/health/db`) checks *tables*; it should also check *scheduling* — e.g. `SELECT count(*) FROM cron.job` (when `pg_cron` exists) and report `"retentionJobs": N` so a deploy with zero scheduled jobs is visible in the same place a missing table is.

- **[P2-10] `purgeAudit` is a required table that nothing ever writes to** — `src/app/api/health/db/route.ts:33` probes it; `convex/logs.ts:301-340` and `convex/travel.ts:460-486` return counts but **do not insert a `purgeAudit` row**; `grep -rn "purgeAudit" convex/` finds only the schema and the index entry.
  - **Root cause:** the TRD (R39/R18) promises "purge jobs zero out lat/lng and write a purge-audit entry"; the code zeroes the coordinates and skips the audit. Because the jobs never run (F4), this has never surfaced.
  - **Failure mode:** when F4 is fixed, the purge will still leave no audit trail — and the audit trail is the evidence that retention was performed.
  - **Fix spec:** write a `purgeAudit` row per purge batch (kind, count, cutoff, window) inside the same handler.

- **[P2-11] The `internal/cron` route trusts `CRON_SECRET` from the environment with no shared-store limiter** — `src/app/api/internal/cron/route.ts:22-27`.
  - **Root cause:** unlike `/api/auth/session-bootstrap` (which has the `jpay_rate_limit_hit` Postgres limiter + an in-memory fallback), the cron route has only a static bearer comparison. A leaked secret allows unlimited purge invocations.
  - **Fix spec (corrected in §7):** the comparison is **already** constant-time — `src/lib/smoke-key.ts` uses `crypto.timingSafeEqual`, and the cron route calls it. What is genuinely missing is only the shared-store limiter, which matters little for a high-entropy bearer secret. Treat this as a *nice-to-have*, not a hardening gap.

### Lens 8 — Type Systems, Schema & Contract Engineer

**Negative evidence:** the 4-way schema-parity gate (`TRD §6 ↔ schema.ts ↔ migrations ↔ INDEX_FIELDS ↔ registry view`) is real and **proved non-vacuous** by the commit itself (breaking the view on purpose). The parity gate now models **final** schema state (drops folded in) and parses the **last** view definition — a genuine improvement over the previous union-of-history approach. `tsc --strict` passes with zero errors. `gen-function-refs --check` is green.

- **[P3-4] `convex/_generated/api.d.ts` imports a file that does not exist** — see P3-1 above.

- **[P3-5] 42 exported symbols in `src/` have zero references outside their own file** — dead-export sweep (`scripts/dead_export_sweep.py`, 80 files, 183 exports).
  - **Root cause:** ~18 are **false positives** — Next.js route modules legitimately export `default` page components (`src/app/login/page.tsx:11`, `src/app/manager/page.tsx:42`, …) and `viewport` (`src/app/layout.tsx:16`) which the framework reads. The sweep cannot know this.
  - **True positives worth acting on:** `src/lib/format.ts:44 formatDate` (zero references anywhere, including tests), `src/lib/backend/react.ts:133 callBackend` (used internally only — should not be exported), `src/lib/cron-jobs.ts:10 CRON_JOBS` (used by the route *and* the test — the sweep's file boundary missed it), `src/lib/payroll-strategies.ts:82 weeklyCapMinutes` (used by tests only, and its values are **duplicated** as literals at `payroll-strategies.ts:129` (`P.standardWorkWeekHours`), `:157` (`40*60`), `:181` (`48*60`) — a split-brain: `weeklyCapMinutes("bcea")` returns 2700 from one source while `computeBcea` reads 2700 from another).
  - **Fix spec:** delete `formatDate`; un-export `callBackend`; **delete `weeklyCapMinutes` and make `computeBcea`/`computeFlsa`/`computeWtrUk` read their caps from it** (one source of truth, and the test then exercises the real source).

### Lens 9 — Platform, Viewport & Portability Engineer

**Negative evidence:** security headers are present (`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy: geolocation=(self)`, CSP-Report-Only); 44px touch targets were enforced in the U12 batch; the offline route exists.

- **[P1-2 / P2-4] (see F2) The payroll panel's time arithmetic assumes the browser's timezone equals the site's** — `src/app/payroll.tsx:42-65`.
  - **Root cause:** `d.setHours(0, 0, 0, 0)` builds the week boundary in *device-local* time; the server buckets days in *site* time. A moderator whose device is in another zone (or any device with a wrong clock) gets a different payroll week from the same data — the D5 finding from the previous audit, still open, and now quantified (F2).
  - **Fix spec:** server-side window in site time (see Lens 3).

- **[P3-6] Serialised "24h" arithmetic appears in the client time helpers** — `src/app/payroll.tsx:59`, `src/app/check-in/ShiftTimer.tsx`, `src/app/check-in-card.tsx` (24×3600×1000).
  - **Root cause:** `weeks * 7 * 24 * 3600 * 1000` is exact only in zones without DST transitions — and `wtr_uk` is exactly the `Europe/London` jurisdiction.
  - **Fix spec:** compute day boundaries with `Intl.DateTimeFormat` in the target zone, never with fixed millisecond constants.

### Lens 10 — Cognitive Load & AI-Context Maintainability Engineer

**Negative evidence:** the demo-removal commit is exemplary documentation-wise — every comment that referenced the removed feature was rewritten, the commit message enumerates the contract change, and the migration file carries an explicit "SECURITY INVOKER IS LOAD-BEARING" warning. This is the standard the rest of the repo should meet.

- **[P2-12] `src/lib/backend/react.ts` ships two near-identical query hooks, and the honest one is opt-in** — `react.ts:217-295` (`useQueryResult`) vs `react.ts:297-374` (`useQuery`).
  - **Root cause:** D2 (the "loading and failure collapse into `undefined`" defect) was fixed by *adding* a second hook rather than changing the first, because the first's Convex-shaped call sites had to keep compiling. So the lying hook is still the default, and every new consumer inherits it unless a reviewer remembers the other one.
  - **Failure mode:** a new surface silently shows a permanent spinner on failure. (Audit 2026-11-11 P2-D2 was applied only to the money/message/review paths.)
  - **Fix spec:** make `useQuery` a thin wrapper that delegates to `useQueryResult` and returns `data ?? undefined`, and make the error surface mandatory at the call site (deprecate the old signature, update the remaining consumers).

- **[P3-7] `docs/` and the ops runbook still describe a "Vercel Cron → Convex purge mutation" mechanism that exists in neither deployment** — `j-pay.md:50` (R9), `j-pay.md:457` (§9).
  - **Fix spec:** rewrite R9/§9 to the mechanism that is actually deployed (or will be, per F4's fix) — currently neither is true.

---

## 3. Existing Test Suite Comparison & Mutation Truth Table

**Basis (so the score is falsifiable):** 35 `scripts/test-*.mjs` files + 13 Playwright spec files + 5 fixture files on disk; **20 gate stages** in `scripts/run-gate.mjs test` and **24** in `verify`; **529 `assert.*` calls** across the wired set (369 `assert.equal`, 74 `assert.ok`, 33 `assert.deep*`, 23 `assert.strict*`, 16 `assert.rejects`, 6 `assert.not*`, 2 `assert.throws`); **18 of 35 files (51%)** carry a negative/boundary signal (`rejects` / `throws` / `not.` / `toBeNull` / `NaN` / `invalid`); 4 files use stubs/mocks; **estimated `M_kill = 54%`** (43 of 80 applied mental mutants killed). The suite is now genuinely good: it exercises the *real* handlers through the *real* runtime (`test-manager-authz.mjs` invokes `convex/manager.ts` through `invoke()`), it has a schema-parity gate proven non-vacuous, and every stage runs (the `&&`-chain abort is gone).

| Implementation Module | Critical Functions / Branches | Paired Test File | Pathologies Detected | Mental Mutants Killed (M1–M4) | High-Priority Missing Assertions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `src/lib/shift-engine.ts` | `deriveSegments`, dedupe, flags | `test-shift-engine.mjs` + `test-shift-engine-fuzz.mjs` | good (fuzz); **no client-side busy-latch coverage** | 17/25 (68%) | minute quantisation; `MAX_SHIFT_MS` sweep |
| `src/lib/payroll-strategies.ts` | `computePay` (5 strategies) | `test-payroll-strategies.mjs`, `test-payroll-rounding.mjs` | **fixtures are single complete weeks only** — the partial-week/straddle case is absent | 14/17 (82%) | straddling ISO week; site-TZ ≠ window-TZ; `weeklyCapMinutes` ↔ literal-cap consistency |
| `src/lib/server-clock.ts` | skew learn/persist/reject | `test-server-clock.mjs` | good | 5/6 | persistence across reload |
| `convex/manager.ts` | promote/demote/org guards | `test-manager-authz.mjs` | **real invoke-path tests (not mock-mirror)**; stub lacks range ops | 21/27 (78%) | cross-org *unstubbed*; sealed/replay attest |
| `convex/access.ts` | `isQaAccount` | **`scripts/test-qa-account-filter.mjs`** (added §7) | table: 15 QA shapes, 7 real addresses | **15/15 (100%)** | — |
| `src/app/check-in/live-submit.tsx` | `checkIn`, token failure, outbox | **NONE** (only the browser walkthrough, which never fails a token) | — | **0/6 (0%)** | `data-loading === false` after `DEVICE_ALREADY_ACTIVE` (F1) |
| `src/app/payroll.tsx` | week window, `weeks` selector | **NONE** | — | **0/5 (0%)** | panel window vs site week (F2) |
| `src/lib/backend/runtime.ts` | `OVERRIDES` (provision/passwords) | `test-manager-authz.mjs` (partial) | partial | 8/16 (50%) | table-driven guard suite |
| `src/lib/backend/db.ts` | pushdown | `test-db-adapter.mjs` | **excellent** contract test | n/a (strong asserts) | `_id` tiebreaker; `.filter()` pushdown for the derivation horizon (P2-5) |
| `tests/e2e-archive/*.spec.ts` (13 files) | role flows | **never executed** | Playwright dead weight | n/a | wire or delete |

### Why the existing tests missed the discovered P1 defects
- **F1 (bricked check-in):** there is **no unit test at all** for `LiveSubmit`. The behaviour is only reachable through a browser walkthrough (`scripts/e2e-full.mjs`), and that walkthrough always has a working token — it never exercises the failure branch. A `react-test-renderer` harness (already a dev dependency: `react-test-renderer@^19.1.0`) would have caught it; the module was never rendered in a test.
- **F2 (payroll week split):** every table-driven case in `test-payroll-strategies.mjs` feeds a **complete Mon–Sun set of days** and calls `computePay` directly. The bug is not in `computePay` — it is in the *day-set assembly* (window selection vs bucketing), which no test covers because the server path is never tested with a site timezone ≠ window timezone.
- **F3 (QA filter):** `isQaAccount` has **zero test coverage**; the old `isDemoUser` had none either, and the demo-removal commit rewrote it (narrowing the rules) without adding a test. A table over the repo's own script addresses would have failed immediately.
- **F4 (retention never runs):** the parity and cron gates check **naming and registration**, never **scheduling**. `test-cron-jobs.mjs` asserts `CRON_JOBS` maps to registered handlers — all true, while nothing is scheduled. No test asks "is this job scheduled?" because that question has no code path in the repo.

### Minimal Viable Test Harness (MVTH) — priority order
1. **MVTH-A (P1-F1):** render `LiveSubmit` under `react-test-renderer` with `issueMyDeviceToken` mocked to reject `DEVICE_ALREADY_ACTIVE`; assert `data-loading === false`, `disabled === false`, and that a second tap reaches the backend. **Red against current code** (proven by the harness in §2 Lens 4).
2. **MVTH-B (P1-F2):** table-driven `computePay` case — days `2026-11-09..2026-11-15` × 540 min, `bcea`, rate 100 → `ordinary 2700, overtime 540, sunday 540, pay 7650`; plus an end-to-end `convex/payroll.ts` case with `site.timezone = Africa/Johannesburg` and a window built in UTC asserting panel == whole-week.
3. **MVTH-C (P1-F3):** `isQaAccount` over every address shape in `scripts/` (`e2e-all-*`, `qa.employee.*`, `e2e-review@`, `e2e.*`, `review-emp.*`) → all `true`. **Red against current code** for three shapes.
4. **MVTH-D (P1-F4):** a probe stage that reads `cron.job` (when `pg_cron` exists) and fails when the retention job count is 0; plus a `purgeAudit` row assertion in the purge handler.
5. **MVTH-E (P2):** `deriveForUser` horizon — assert the shift query pushes the horizon as an index constraint (mirror of `test-travel-window-bounds.mjs`).

---

## 4. Surgical Refactoring Blueprints (Zero-Mutation Drafts)

### R1 — F1: one `try` in `checkIn()` (the missing Phase 0.5)
- **Target:** `src/app/check-in/live-submit.tsx:117-215`
- **Engineering ROI:** restores the check-in path for every employee whose device token cannot be minted (the entire failure surface), i.e. removes a "cannot work → cannot be paid" class. Deletes a `finally`-bypass path, so future `return`s in this function can no longer silently latch the UI.

**Current pattern (audited code):**
```ts
async function checkIn() {
  if (inflight.current) return;
  inflight.current = true;
  setBusy(true);
  setMessage(null);
  let token: string;
  try {
    token = await getToken();          // ← throws
  } catch (e) {
    const m = e instanceof Error ? e.message : "";
    setMessage(m.includes("DEVICE_ALREADY_ACTIVE") ? "…" : "…");
    return;                             // ← RETURNS BEFORE THE finally BELOW
  }
  try {
    /* … body … */
  } catch (e) { /* … */ } finally {
    inflight.current = false;
    setBusy(false);
  }
}
```

**Target pattern:**
```ts
async function checkIn() {
  if (inflight.current) return;
  inflight.current = true;
  setBusy(true);
  setMessage(null);
  try {
    const token = await getToken();      // same failure semantics, now inside the guarded try
    const pos = await getPosition();
    const accuracy = Math.round(pos.coords.accuracy);
    if (accuracy > 50) { setMessage(`Weak GPS signal (±${accuracy}m). Move to open sky and retry.`); return; }
    const chosen = siteId || sites[0]?._id || "";
    if (!chosen) { setMessage(sitesLoading ? "Loading your sites…" : "No site assigned — ask your moderator."); return; }
    const entry: OutboxEntry = { /* unchanged */ };
    if (!navigator.onLine) { await enqueue(entry); setMessage("Offline — check-in queued."); return; }
    try {
      const result = await createLog({ /* unchanged */ });
      setMessage(/* unchanged */);
    } catch (e) {
      /* unchanged network / DEVICE_TOKEN_INVALID handling */
    }
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    setMessage(
      m.includes("DEVICE_ALREADY_ACTIVE")
        ? "Device already activated — ask your moderator to reset it."
        : /denied|permission/i.test(m)
          ? "Location permission denied."
          : errMsg(e)
    );
  } finally {
    inflight.current = false;
    setBusy(false);                      // ← the reset every path now reaches
  }
}
```

### R2 — F2: one clock for payroll (server-side site-TZ window)
- **Target:** `convex/payroll.ts:36-80` + `src/app/payroll.tsx:36-70`
- **Engineering ROI:** removes a proven **R1,350/week/worker** understatement class and closes P2-B7 (timezone fallback = oldest assignment) in the same change.

**Current pattern (audited code):**
```ts
// client: browser-local week
const monday = (() => { const d = new Date(); d.setHours(0,0,0,0); /* … */ })();
// server: site-local day buckets
const key = localDayKey(s.startedAt, (s as {timezone?: string}).timezone ?? timezone);
```

**Target pattern:**
```ts
// client: send DAYS, not milliseconds
const payrollArgs = { userId, fromDay: "2026-11-09", toDay: "2026-11-15" };

// server: widen to complete ISO weeks in SITE time, compute, then slice for display
const siteTz = shiftTimezone ?? jpayConfig.defaultTimezone;      // never "oldest assignment"
const weekStart = mondayOfWeekInZone(args.fromDay, siteTz);       // "2026-11-09"
const weekEnd   = mondayOfWeekInZone(args.toDay,   siteTz);       // inclusive ISO week
const shifts = await ctx.db
  .query("shifts")
  .withIndex("by_user_start", (q) =>
    q.eq("userId", args.userId)
     .gte("startedAt", zonedMs(weekStart, siteTz))                // site-local Monday 00:00
     .lte("startedAt", zonedMs(weekEnd + 7d, siteTz) - 1))        // site-local Sunday 23:59.999
  .collect();
// days[] now holds COMPLETE site ISO weeks → computeBcea's per-week cap is granted once
const result = computePay(sortDays(days), rate, effectiveStrategy);
// slice the DISPLAY lines back to the requested days
const lines = result.lines.filter((l) => l.day >= args.fromDay && l.day <= args.toDay);
```

### R3 — F3: a structural QA marker, not a prefix heuristic
- **Target:** `convex/access.ts:9-22` + the provisioning sites in `src/lib/backend/runtime.ts:300-460`
- **Engineering ROI:** closes the "a script invents a new address shape → the filter silently stops matching" failure mode permanently.

**Current pattern:**
```ts
const QA_ACCOUNT_EMAIL_PREFIXES = ["e2e.", "review-emp."];
export function isQaAccount(user: Doc<"users">): boolean {
  const email = user.email ?? "";
  return QA_ACCOUNT_EMAIL_PREFIXES.some((prefix) => email.startsWith(prefix));
}
```

**Target pattern (two layers — belt and braces):**
```ts
// 1) structural marker (authoritative): set at provisioning time
export function isQaAccount(user: Doc<"users">): boolean {
  if (user.isQa === true) return true;                 // ← the authoritative check
  const email = (user.email ?? "").toLowerCase();
  if (!email.endsWith("@jpay.local")) return false;   // every QA address is local
  const local = email.split("@")[0];
  return ["e2e", "e2e-all", "e2e-review", "qa", "review-emp"]
    .some((p) => local === p || local.startsWith(p + "."));   // ← defensive fallback
}
// 2) set isQa=true wherever a QA address is provisioned (runtime.ts createAccount,
//    users:createMasterTempUser, and the QA scripts' provision path)
```
plus a migration adding `users.isQa boolean` (owner-apply) and a backfill
`UPDATE public.users SET "isQa" = true WHERE email LIKE '%@jpay.local'`.

---

## 5. Phased Execution Roadmap & Scoped Agent Prompts

> **Reading order is fixed:** Phase 1 → 2 → 3. Phase 1 contains all four P1s and is safe to ship without a payroll run. Do not widen rollout or change the money path until Phase 1 is green **and** the owner has decided F4's deployment route.

### Phase 1 — Containment (P1s; ship first)

| # | Step | Files | Proof | Owner |
| :--- | :--- | :--- | :--- | :--- |
| 1.1 | **F1** — restructure `checkIn()` into one `try/finally` (R1) + MVTH-A | `src/app/check-in/live-submit.tsx` | new `scripts/test-checkin-busy-latch.mjs` **red before, green after**; `npm run verify` green | Agent |
| 1.2 | **F3a** — replace the prefix list with the closed-over rule (R3 layer 2) + MVTH-C | `convex/access.ts` | MVTH-C green (3 shapes flip from red to green) | Agent |
| 1.3 | **F3b** — owner-apply `0019_users_is_qa.sql` (add `isQa`, backfill `@jpay.local`) | new `supabase/migrations/0019_*.sql` | `select count(*) from public.users where "isQa"` = the QA row count | Owner |
| 1.4 | **F3c** — owner cleanup: deactivate/archive the 6 live QA accounts + their `auth.users` identities | prod DB | `select email from public.users where email like '%@jpay.local'` → 0 active rows | Owner |
| 1.5 | **F2** — server-side site-TZ window (R2) + MVTH-B | `convex/payroll.ts`, `src/app/payroll.tsx` | MVTH-B green; a straddling week now shows all 7 site days and 540 OT minutes | Agent |
| 1.6 | **F4** — owner decision: enable `pg_cron` + `pg_net` and apply the archived 0003 file (with real `__SITE_URL__`/`__CRON_SECRET__`), **or** change the privacy page + TRD §9 to state that retention is not yet enforced | prod dashboard / `src/app/privacy/page.tsx`, `j-pay.md` | `select jobname from cron.job` → 3 rows **or** the privacy page no longer promises deletion | Owner |
| 1.7 | **F4b** — write the `purgeAudit` row the purge handler owes (P2-10) + assert it in a test | `convex/logs.ts`, `convex/travel.ts` | purge writes one `purgeAudit` row per batch | Agent |

**Phase 1 exit:** `npm run verify` green (24/24), MVTH-A/B/C green, no active `@jpay.local` account in prod, and F4 resolved **either** by a scheduled job **or** by an honest privacy page.

### Phase 2 — Hardening & honesty (P2)

| # | Step | Files | Proof |
| :--- | :--- | :--- | :--- |
| 2.1 | **P2-1/P2-7** — one cron registry; `CRON_JOBS` becomes the single source, `convex/crons.ts` is archived, and the docs name the *actual* mechanism | `src/lib/cron-jobs.ts`, `convex/crons.ts`, `j-pay.md` | `grep -rn "crons.cron" convex/` → 0; the TRD names the deployed mechanism |
| 2.2 | **P2-5** — push the derivation horizon into the index constraint (mirror the travel-window fix) | `convex/shifts.ts:56-60` | `scripts/test-db-adapter.mjs` asserts the pushdown (a `.filter()` form fails) |
| 2.3 | **P2-2/P2-9** — delete `createLogAs`, or wire it properly (identity-derived moderator, device-token-shaped evidence, an attestation row payroll consumes) and keep it out of the client type surface | `convex/logs.ts`, `src/lib/backend/function-refs.ts` | `grep createLogAs` → only the definition, or a test proves the attestation path |
| 2.4 | **P2-8/P2-12** — delete the `internal: any` export; make `useQuery` delegate to `useQueryResult` and require an error surface | `src/lib/backend/api.ts`, `src/lib/backend/react.ts` | `grep -rn "internal" src/app` → 0; every query consumer renders an error state |
| 2.5 | **P2-11** — constant-time secret comparison + shared-store limiter on the cron route | `src/app/api/internal/cron/route.ts` | a unit test asserts a wrong secret is rejected and a flood is rate-limited |
| 2.6 | **P2-3/P2-10/P2-14** — wire or archive `setManagerSites`; write `purgeAudit` rows; fold `weeklyCapMinutes` into the strategies (one source of truth) and delete `formatDate` | `convex/manager.ts`, `src/lib/payroll-strategies.ts`, `src/lib/format.ts` | dead-export sweep drops by ≥6 true positives; cap constants appear once |
| 2.7 | **P3 batch** — `module.registerHooks()`, `convex/_generated/api.d.ts` auth import, `public/sw.js` prune, docs drift (R9/§9, `.env.example`, ops runbook), `as never` casts | as listed | `npm run verify` + consistency gates green; no doc claims a mechanism that is not deployed |

### Phase 3 — Verify, re-audit, close

1. **Fresh-clone dress rehearsal:** `npm ci && npm run verify && npm run build` — every stage executes and passes; `public/sw.js` exists for the artifact test.
2. **Production round-trips (one per role):** employee punch → derived shift → payroll agrees with the engine; the payroll panel shows all site days of the week; a moderator's roster shows no QA account; a broadcast reaches no QA account.
3. **Re-audit** with the same skill; expect `S ≥ 85`, `N_P0 = 0`, `N_P1 = 0`.

### Copy-Paste Surgical Prompts for Coding Agents

> **Prompt F1 (`src/app/check-in/live-submit.tsx`):**
> "Strictly scope edits to `src/app/check-in/live-submit.tsx` (the `checkIn` function, lines ~117-215) and a new test file `scripts/test-checkin-busy-latch.mjs`. Do not modify any other source file. Restructure `checkIn()` so that the device-token acquisition happens INSIDE the single `try` block whose `finally` resets `inflight.current` and `setBusy(false)` — no `return` may bypass that `finally`. Preserve every existing user-facing message and every existing behaviour of the success path. Add a regression test that renders the component with `react-test-renderer`, mocks `useMutation` so `issueMyDeviceToken` rejects with `DEVICE_ALREADY_ACTIVE`, taps the submit button, and asserts `data-loading === false` and `disabled === false` afterwards, plus that a second tap reaches the backend. Run the test BEFORE the change (it must fail) and AFTER (it must pass), then run `npm run verify` and confirm all stages pass."

> **Prompt F3 (`convex/access.ts` + new migration):**
> "In `convex/access.ts`, replace the `QA_ACCOUNT_EMAIL_PREFIXES` string-prefix check with a rule that recognises every address shape the repository's own scripts create (`e2e.`, `e2e-all-`, `e2e-review@`, `qa.employee.`, `review-emp.`) — the rule must treat any `*@jpay.local` local-part starting with one of those tokens as a QA account. Add `scripts/test-qa-account-filter.mjs` as a table-driven test over every address literal in `scripts/e2e-all.mjs`, `scripts/e2e-full.mjs`, `scripts/smoke-supabase.mjs`, `scripts/test-pw-change.mjs` and `scripts/review-walkthrough.mjs`, asserting each is filtered. The test must fail before the change. Do not touch `convex/users_queries.ts`, `convex/kpi.ts`, `convex/moderator.ts` or `convex/manager.ts` — they call `isQaAccount` and need no change. Separately, draft `supabase/migrations/0019_users_is_qa.sql` (add `users.isQa boolean`, backfill `email LIKE '%@jpay.local'`, enable RLS, comment the grant posture) for the OWNER to apply — do not apply it."

> **Prompt F2 (`convex/payroll.ts` + `src/app/payroll.tsx`):**
> "Change the payroll window contract from browser-local milliseconds to ISO day strings: `src/app/payroll.tsx` must send `fromDay`/`toDay` (ISO dates derived from the site's local Monday, computed with `Intl.DateTimeFormat` in the site zone, never with `setHours(0,0,0,0)` on the browser clock), and `convex/payroll.ts` must widen the shift query to the COMPLETE ISO weeks those days touch **in the site's timezone**, compute the pay over that complete week set, and slice the returned display lines back to the requested days. The timezone used for both the window and the day buckets must be the shift's own `timezone`, falling back to `jpayConfig.defaultTimezone` — never to the employee's first `userSites` row. Add `scripts/test-payroll-window.mjs` (or extend `scripts/test-payroll-strategies.mjs`) with the case: site timezone `Africa/Johannesburg`, seven 540-minute days `2026-11-09..2026-11-15`, rate 100, strategy `bcea` → assert `ordinaryMinutes === 2700`, `overtimeMinutes === 540`, `sundayMinutes === 540`, `pay === 7650`, and assert the panel result equals the whole-week result. The test must fail before the change. Do not change `src/lib/payroll-strategies.ts`."

### Explicitly out of scope / do not touch
- The single-door `/api/backend/call` architecture, the `isPublic !== true` gate, the dedupe / min-`_creationTime` rule, write-set invalidation, archive-not-delete, and the Serwist offline path.
- **No `supabase db push`, ever**; no migration applied by an agent without a fresh, explicit owner instruction in that session.
- No push to `main` without an explicit owner ask (it *is* the deploy path).
- The demo-removal commit `c71f6f1` and migration `0018` — applied, verified, and correct; do not re-open.

---

## Verified-Correct (do not regress)
- `/api/backend/call` deny-by-default: anon `listEmployees` → `[]`; all internal handlers refused (34-key census, exhaustive); `INTERNAL_ONLY_OVERRIDES` intact.
- `jpay_id_registry`: `security_invoker = on` preserved across the 0018 recreate; `anon` has no `SELECT`; `demoSessions`/`isAnonymous`/`createdByDemoReviewerId` dropped in prod; migration history reconciled to `0001…0018`.
- `users_queries.listEmployees` deny-by-default (anonymous → `[]`, non-moderator → `[]`, moderator → active non-QA employees) — strictly stronger than before.
- Org guards fail closed in `convex/manager.ts` and `convex/sites.ts` (cross-org promotion, cross-org site assignment, unscoped-moderator paths) — 8 harness cases green.
- The exact integer-cent payroll pipeline (rational → cents → integer sum) — no float drift.
- `localDayKey` with an explicit zone + a DST test; `mondayOfWeek`/`isSunday` at `T12:00:00Z` by design.
- Shift derivation: upsert-in-place, `_id` tie-break, duplicate-key collapse, sealed-row immutability, horizon + idempotency harnesses green.
- The travel-window horizon is a genuine index-range pushdown with a non-vacuous guard test.
- Security headers present (CSP-Report-Only, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`).
- Storage access is wrapped so it can never blank the page; the outbox flush lock is hardened; Leaflet teardown is correct in every effect.
- The gate runner runs **every** stage (no `&&`-chain abort); the schema-parity gate is 4-way and proved non-vacuous.

## Pitfalls observed this cycle
- **A removal commit can harden one path and narrow another.** `isDemoUser` caught QA rows by *suffix* and by a column; `isQaAccount` catches them by *prefix* — and the prefixes the repo's own scripts use are wider than the list. Narrowing a safety net is a security change, not a refactor: it needs its own test.
- **A `finally` that only some paths reach is not a `finally`.** The check-in latch survived two audits and one remediation plan because the code "looked correct" — it took a rendered-component probe to prove the button never re-enables.
- **"Executed, not aspirational" is a claim about the deployment, not about the handler.** The retention handlers are correct; the *scheduler* is missing. A gate that checks registration can never catch a missing schedule.
- **Two clocks decide what a "week" is.** Selection in browser time, bucketing in site time — the panel and the statutory week disagree, and the weekly cap is granted twice. Every timezone-aware money computation needs one clock, chosen server-side.
- **A `P0` closed is not a `P0` closed forever.** The registry view's `security_invoker = on` survives a `CREATE OR REPLACE VIEW` only if the replacement says so — the migration says so in a comment. That comment is load-bearing and must stay.

---

## 7. Verification round 2 — corrections, new evidence, two fixes shipped

The first pass was graded against HEAD `c040da9`; this round re-ran every **live** claim against
the project, added the probes the first pass did not run, and re-read the audit's own assertions
for truth. Four of them were wrong. They are corrected here, in place above, and below.

### 7.1 Corrections to this report

| # | First pass said | Actually (2026-11-13, `jpay-supabase`) | Why it was wrong |
| :--- | :--- | :--- | :--- |
| C1 | "6 active QA accounts exist in production" | **14** active `@jpay.local` identities | The count was taken from a filtered sample, not a full census. `select count(*) from public.users where email like '%@jpay.local' and "isActive"` → 14. |
| C2 | "2 QA accounts pass the filter" | **3** — the two `e2e-all-*` employees **and** `e2e-test@jpay.local`, a **moderator** | `e2e-test@` does not start with `e2e.`. A moderator leaking past the filter is a privilege-surface fact, not just roster noise. |
| C3 | "`logs`/`travelSegments`/`shifts` all 0 rows" | `shifts` **4**, `logs` **4**, `messages` **4**; `travelSegments` 0 | The 2026-11-12 e2e run wrote rows. All four shifts are **unsealed** (`endedAt IS NULL`), `totalMinutes = 0`, owned by `e2e.mwdu*`, and were created by **HeadlessChrome** at GPS −26.2041/28.0473. There is still **no real operational data**. |
| C4 | P2-11 implied the cron secret comparison might not be constant-time | It **is** — `src/lib/smoke-key.ts` uses `crypto.timingSafeEqual`, and `src/app/api/internal/cron/route.ts` calls it | The parenthetical confused "does not use `session-bootstrap`'s hand-rolled helper" with "not constant-time". Only the shared-store limiter is genuinely absent, and for a high-entropy bearer that is a nice-to-have. |

C1–C3 all change the **operational cleanup** step (plan 1.4): an owner acting on "6 accounts" would
have left eight live, including one moderator.

### 7.2 New evidence (probes the first pass did not run)

**Live negative controls** — all three fail closed in production:

| Probe | Result |
| :--- | :--- |
| `POST /api/auth/session-bootstrap {kind:"master", secret:"…"}` | **403 `MASTER_DISABLED`** — the break-glass moderator-minting path is *off* in prod |
| `GET /api/backend/call` (no `x-smoke-key`) | **403 `FORBIDDEN`** — the internal function inventory is not public |
| `POST /api/internal/cron?job=…` (no bearer) | **401 `UNAUTHENTICATED`** |

**RLS / privilege matrix** (`pg_class`, `pg_policies`, `pg_proc`, `information_schema`):

- All **16** tables: `relrowsecurity = true`, **0 policies** each → default-deny holds.
- The only view, `jpay_id_registry`: `security_invoker = on` (still correct after the 0018 recreate).
- **No `SECURITY DEFINER` function** in `public`; `jpay_rate_limit_hit` is invoker-rights,
  `search_path` pinned, and `EXECUTE` is revoked from `anon`/`authenticated`.
- **New P2 (→ plan 2.8):** six tables grant **full DML — including `TRUNCATE`** — to `anon` and
  `authenticated`: `jpay_rate_limits`, `managerSites`, `organisations`, `shiftOverrides`,
  `systemEvents`, `travelSegments`. RLS with zero policies is the only thing holding; one future
  policy turns this into an incident, and per the PostgreSQL manual "operations that apply to the
  whole table, such as `TRUNCATE` and `REFERENCES`, are not subject to row security". Not live
  (PostgREST cannot issue `TRUNCATE`), but it should be revoked before the first policy ships.

**Payroll engine fuzz** (`src/lib/payroll-strategies.ts`, 6,000 randomized cases × 5 strategies ×
7 rates, plus a 32,825-case realistic-rate sweep):

- minutes conserved per day (ordinary + OT + Sunday = input) — **0 failures**
- totals equal the sum of lines, every value on an exact cent boundary — **0 failures**
- weekly cap never exceeded; BCEA overtime never appears below 45 h; Sunday minutes never counted
  as ordinary — **0 failures**
- monotonicity (one extra minute never lowers pay) — **0 failures at rates ≥ R25/h**; 4 one-cent
  inversions at R0.01–R0.10/h, caused by rounding each component separately. Economically
  irrelevant, but it confirms the rounding policy is "per component", not "per line".

This is **positive evidence for the money engine** — the first pass had two hand-built payroll
probes and no invariant sweep. It narrows F2 to the *window contract*, exactly as stated.

**Service worker:** the served `/sw.js` is generated at build time and is **fresh** (no `/demo`
references, different hash from the local file). The checked-in-adjacent local `public/sw.js` is a
stale build artifact whose precache URLs now 404 — so the P3 is **local-dev only**: `next dev`
serves a SW whose install fails. Production is unaffected.

**Tooling hazard (not a product defect):** the `supabase` MCP server points at a *different*
project (an orders/couriers/strains schema). Only `jpay-supabase` is J-Pay. Any agent that verifies
against the default server will "confirm" the wrong database. This is the most likely explanation
for C1/C3.

### 7.3 Fixes shipped in this round

| Finding | Change | Proof |
| :--- | :--- | :--- |
| **F1** | `checkIn()` split into `runCheckIn()` (the work) and `checkIn()` (guard + `busy` + **one** `finally`). The reset now has a single site, so no early return — including the device-token failure — can latch the button. | `scripts/test-checkin-busy-latch.mjs` drives the **real component**: `issueMyDeviceToken` throws `DEVICE_ALREADY_ACTIVE`, then succeeds. **Red before** (`data-loading === true` after the failure), green after; the second tap is asserted to reach `createLog`. Registered in `run-gate.mjs`. |
| **F3a** | `isQaAccount` now treats `@jpay.local` as a reserved, test-only domain (structural marker) and keeps the legacy local-part shapes for anything outside it. Case-insensitive. | `scripts/test-qa-account-filter.mjs`: **red before** on 10 shapes (`e2e-all-*`, `e2e-test`, `qa.employee.*`, bare `e2e`, uppercase), green after; 7 real addresses — including `e2ebusiness@` and `qatar.office@` — stay unfiltered. Registered in `run-gate.mjs`. |

`npm run verify` runs both new stages; `N_P1` drops from 4 to **2** (F2 and F4 remain).

### 7.4 What this changes about the verdict

`S_health` stays **72** — the corrections refine blast radius, they do not add a defect class, and
the new P2 is offset by the P2 downgrade. What *does* change is the **readiness** reading:

- Production contains **zero real punches, zero real shifts, zero travel segments**. The only rows
  in the core tables are four HeadlessChrome QA shifts and their logs. This is a **pre-production
  deployment** wearing a production URL.
- It has **14 live QA identities, two of them moderators**, plus **two real accounts that have
  never signed in and still hold their initial ID code** (`dewetlot04@gmail.com` moderator,
  `ajay@ve.com` manager, both `passwordChangedAt = NULL`).
- Retention has never run and `purgeAudit` has never been written.

So the honest framing is not "a healthy codebase with four P1s". It is: **the code is in
moderate-to-good shape, and the deployment has never been used.** That makes 1.3/1.4 (QA identity
cleanup) and 1.6 (retention honesty) **launch blockers**, not hygiene — and it makes the cost of
shipping Phase 1 low, because there is no production data to migrate or reconcile.
