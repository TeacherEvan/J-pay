# Surgical Audit Report: J-Pay (TeacherEvan/J-pay)

| Audit Metadata | Specification |
| :--- | :--- |
| **Audit Date** | 2026-11-10 |
| **Audited Scope** | `src/`, `convex/`, `scripts/`, `tests/`, `supabase/` — 112 scanned files, **11,399 effective LOC** (`public/sw.js` minified build artefact excluded from scoring; counted for census only) |
| **Tech Stack & Runtime** | Next.js 16.3.3 (webpack) · React 19 · **Supabase (Postgres + Auth) as authoritative backend via custom `src/lib/backend/*` adapter, reusing the Convex function bodies in Node** · Serwist PWA · TypeScript 5.9 strict · Node 26 |
| **Audited Commit** | `2ace827` (`main`). Working tree was clean at audit time; the owner committed the in-flight visual work mid-audit (`9a11f35` → `2ace827`, 20 files, style-only). No audited source file was modified by this audit. |
| **Pre/Post Audit UTC** | pre-audit tree digest `9a44e715…` (dirty tree @ `9a11f35`) · clean-tree digest `686fe6c7…` (@ `2ace827`) · post-audit changes limited to this report (docs-only) — **VERIFIED ZERO SOURCE MUTATION** |
| **Deterministic Health Score** | **`70 / 100`** (`D_raw = 77`, `P_test ≈ 6.8`, `M_kill ≈ 55%`) |
| **Vibe-Debt Risk Level** | **HIGH** (score band is Moderate, but `N_P0 = 1` forces HIGH) |

> Method: 10-lens static review + preflight telemetry (polyglot AST scanner, pruned of `node_modules/.next/_generated`) + targeted runtime probes against the installed `convex` package + full gate run (`npm test`: **95 + 6 pass, 0 fail**; `check_consistency.py` PASS; `check_diagrams.py` PASS) + dead-export sweep. Zero source mutation during the audit pass. Previous audit: `docs/audits/surgical-audit-2026-10-25.md` (52 → 78 post-remediation). This audit reverses that: the Supabase cutover (`f823fa1`, "refactor(backend)!: make Supabase the authoritative backend") introduced a new P0 trust-boundary defect class the earlier report could not see.

**The headline:** the app works, the money-path math is still pure and well-tested, the tests are green — and the server's own authorization model was silently deleted by the cutover. Every `internal*` Convex function (27 of them) is remotely callable by any browser, and the scheduled retention jobs that keep GPS data lawful have never run under Supabase.

---

## 1. Executive Architecture & Vibe-Debt Triage

J-Pay is now a Next.js PWA whose entire backend is a single route (`POST /api/backend/call`) executing the pre-existing `convex/*.ts` function bodies against a reimplemented `ctx.db` that loads **entire Postgres tables into memory per query**, with **no transaction semantics** and a fire-and-forget scheduler whose failures are logged to a console and dropped. The shift grammar (`src/lib/shift-engine.ts`) remains genuinely pure and is well tested; the adapter layer that now stands between it and production — `src/lib/backend/{runtime,db,react}.ts` — has **zero tests**, and it is where this release's P0 lives. Secondary structural debt: docs/README/TRD still describe Convex as the live backend (the fork model, quick start, and env list are all wrong), four God files carry the UI, and the hand-maintained query-invalidation maps in `react.ts` will drift silently.

| Severity Tier | Count | Deduction | Primary Failure Domains |
| :--- | :--- | :--- | :--- |
| **P0 — Critical (Security / Crash / Data Loss)** | 1 | −18 | `src/lib/backend/runtime.ts:413` — internal-function gate is dead code; all 27 `internal*` handlers remotely callable without auth |
| **P1 — High (Race / Logic / Cost / Compliance)** | 5 | −40 | `db.ts:205` full-table `loadAll` per query; `runtime.ts:147-171` scheduler swallows failures + `cancel()` no-op; `convex/crons.ts` retention jobs never fire under Supabase (GPS coords never purged); no transactions → TOCTOU on payroll paths + `deriveForUser` interleaving; `react.ts:341` unstable effect deps → infinite refetch loop |
| **P2 — Medium (God File / Debt / Disclosure)** | 5 | −15 | Doc/TRD/AGENTS drift + missing ADR for Supabase cutover; God files (CC 37/16); `GET /api/backend/call` publishes internal inventory; no rate limiting + fragile `TOO_MANY_ATTEMPTS` substring match; hand-maintained invalidation maps |
| **P3 — Low (Magic Constants / DX)** | 4 | −4 | Dead `e2e-helpers` exports (6); `archivedAt !== null` vs `undefined` sentinel split; strict `===` on `null`/`0`/`false` edge in adapter `eq`; `sw.js` silent catches (build artefact, noted only) |

### High-Risk File Telemetry Hotspots
| File Path | Eff. LOC | Est. CC / Depth | Silent Catches | Primary Vibe-Debt Signature |
| :--- | :--- | :--- | :--- | :--- |
| `src/app/check-in-card.tsx` | 573 | 16 / 6 | 2 | God component: timer, GPS, tokens, outbox, render |
| `convex/demo/index.ts` | 677 | 1 (windowed est.) / 4 | 0 | God module: 20+ demo endpoints, 23 alloc markers |
| `src/app/moderator/page.tsx` | 513 | **37** / 5 | 0 | Console monolith; branches nested 5 deep |
| `src/lib/backend/react.ts` | 415 | 17 / 4 | 0 | Hand-maintained invalidation + auth/session singletons |
| `src/lib/backend/db.ts` | 360 | 33 / 5 | 0 | Full-table loads; JS-side filtering; O(N) network |
| `src/lib/backend/runtime.ts` | 365 | 22 / 4 | 0 | Dead authz gate; swallowed scheduler; registry |
| `convex/users.ts` | 345 | 17 / 4 | 0 | Identity + break-glass lifecycle |
| `src/lib/shift-engine.ts` | 288 | 30 / 6 | 0 | Money grammar (correctly pure, property-fuzzed) |
| `public/sw.js` | 2 | 733 (minified) | 5 | Build artefact — excluded from scoring; regenerate, don't audit |

---

## 2. The 10-Principal-Engineer Deep Audit

### Lens 1 — Systems Architect (Topology, Coupling & State Machines)
- **[P0-1-adjacent] Split-brain backend doctrine** — repo-wide (`README.md`, `j-pay.md`, `AGENTS.md` vs `src/lib/backend/*`, `supabase/migrations/0001_init.sql`, commit `f823fa1`).
  - **Root Cause Mechanism:** Documentation still declares Convex + Convex Auth the architecture (Quick start: `npx convex dev`; fork model "one Convex deployment per client"; TRD §stack). The live system is Supabase Auth + Postgres executing Convex-shaped bodies in Node. Two would-be sources of truth; every future agent session inherits the wrong model — the exact failure mode that killed the hermes-era plan.
  - **Deterministic Trigger:** Any new contributor/agent provisions per README, lands on a dead quick start, or "fixes" the adapter against a non-existent Convex deployment.
  - **Surgical Fix:** ADR-004 recording the cutover + authority split (Postgres holds data; Supabase Auth holds identities; `src/lib/backend/runtime.ts` is the only path; `convex/` retains function *bodies* only). Rewrite README quick start, fork model, env list (`NEXT_PUBLIC_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `BOOTSTRAP_KEY`, `MASTER_PASSWORD`, `DEVICE_TOKEN_SECRET`, VAPID). TRD §6 stays the contract for shapes; ADR-004 becomes the contract for runtime.
- **[P2-2] God files** — coordinates above; `moderator/page.tsx` at CC 37 is the worst offender. Fix by extracting per-tab panels (employees/sites/audit/review) into `src/app/moderator/*.tsx` siblings — behaviour-preserving, no state redesign.
- **[P2-5] Hand-maintained invalidation maps** — `src/lib/backend/react.ts:52-146`. A new mutation automatically belongs to no table; its readers go permanently stale with no error. Replace with server-reported write-set from `/api/backend/call` (derive from `describeModules` metadata or an explicit `tables` return field) — the server knows what it touched; the client should not guess.

### Lens 2 — Frame-Budget & Performance Engineer
- **[P1-1] Every query loads whole tables into Node memory** — `src/lib/backend/db.ts:205-220` (`loadAll`) and `:364-397` (`QueryBuilder.run`).
  - **Root Cause Mechanism:** `withIndex(...).eq(...).collect()` semantics are preserved by fetching `select("*").range(from, from+999)` until exhaustion, then filtering/sorting in JS. Cost per call is O(table) network bytes + O(N log N) JS sort — independent of selectivity. `logs` grows ~2 rows per punch; at 50 employees × 3 punches/day, ~110k rows/year ≈ full table scanned **on every check-in**, every `auditRecentLogs`, every `listMine`.
  - **Deterministic Trigger:** Any query after ~10k logs; 3G mobile on site; cold serverless instance — latency and egress bill scale linearly with history, and every concurrent mutation re-scans.
  - **Surgical Fix:** Map `INDEX_FIELDS` constraints into PostgREST filters (`.eq/.lt/.gte` + `.order().limit()`) so the database does the work; keep JS evaluation only as a differential-test oracle. `paginate()` then becomes keyset, not offset-slice over a full sort. `unique()` must use `.limit(2)`, never full-load.
- **[P1-1b] Declared-vs-actual complexity** — `db.ts:222-228` docs admit "Tables here are small". They no longer are for `logs`; the comment is now a correctness-of-ops lie. Fix with the same change; add `EXPLAIN` evidence in the PR.
- Payload audit: `git ls-files -z | xargs -0 du -h | sort -hr` — largest tracked binaries are PNGs/icons under `public/`/`docs/ops/screenshots` (none exceed a few MB; no 100 MB+ media defect). `public/sw.js` is a minified build artefact committed to the tree (2 LOC) — exclude from audits; add to `.gitattributes` as generated.

### Lens 3 — Mathematical & Algorithmic Engineer
- Shift derivation: `serverClockSkewMs` anchors to client `queuedAt` (future rejected), `skewCorrectedTime` decays by `skewToleranceMs` — sound, property-fuzzed (50k permutations, `scripts/test-shift-engine-fuzz.mjs`). `deriveSegments` dedupe is deterministic (skew-corrected time → `_creationTime` → key) with `duplicate_key_conflict` flagging — the correct pattern. **N/A for new defects.**
- **[P3-3] Adapter comparison strictness** — `db.ts:88-125`. `eq` uses strict `===` after `?? null`; a Postgres `boolean true` never equals JS `1` (fine), but `0` vs `false` remain distinct where Convex treated both as falsy-ish in filter expressions — silent row loss in predicates mixing those. Constrain: document "no implicit coercion" as contract + test both types.
- **[P3-4] Pagination cursor is an array offset** — `db.ts:422-436`. Inserts during iteration shift rows under the cursor → skipped/duplicated pages in `paginate()`. No current caller uses `paginate()` (grep-clean) — fix before first use (keyset on `_creationTime`) or delete it.

### Lens 4 — Concurrency, Async & Determinism Engineer
- **[P1-2] No transaction semantics anywhere** — `db.ts:242-312` (`get`/`insert`/`patch`/`replace`/`delete` issue independent statements) + `runtime.ts:116-172` (`RequestContext` holds no tx). Convex serialized mutations per document; here two concurrent `punches:recordPunch` calls both read "no existing idempotencyKey", both insert, both schedule re-derivation that interleaves at await points → duplicate attendance rows and shift clobbering. Same shape on `users:provisionEmployee` (check-then-create race → two Supabase Auth users, one `users` row).
  - **Trigger:** Double-tap punch within one derivation window (~100-400 ms), or network retry by the outbox replay (`src/lib/outbox.ts` fires retries).
  - **Surgical Fix:** (a) unique index `logs(userId, idempotencyKey)` in `0001_init.sql` — engine already dedupes by that key, so this is belt-and-braces at exactly one line; (b) wrap money-path write sets in a single Postgres function (`rpc`) or `serializable` transaction for `recordPunch`/`createLog` + derivation; (c) make `deriveForUser` idempotent-by-construction (it is, post P1-1 prior) and last-writer-safe by keying shifts on `shiftKey` upsert.
- **[P1-3] Fire-and-forget scheduler that lies** — `runtime.ts:147-171`. `runAfter(0, internal.shifts.deriveForUser, …)` runs **inline** (claims "keeps the data consistent" — the completion order is unobservable) and, worse, **any throw is `console.error`'d and swallowed**; `cancel()` is `async () => {}`.
  - **Trigger:** `deriveForUser` throws on any edge (bad row, OOM, timeout) → punch returns 200, shift never re-derives, payroll silently under-counts, moderator sees `needsReview` with no cause. The failure is un-detectable except by reading server logs you do not have.
  - **Surgical Fix:** For the money path, `await` the derivation before returning the punch response and **propagate** failures (punch stays successful but the response carries `derivationStatus: "failed"` and the row is flagged `needsReview` with reason `derivation_failed`). For non-critical jobs keep inline but write failures to a `systemEvents` table — never console-only. Implement `scheduler.cancel` or delete it.
- **[P1-5] Infinite refetch loop in `useQuery`** — `src/lib/backend/react.ts:341` (deps `[key, tick, skip, ref, args, refKey]`).
  - **Root Cause Mechanism:** `args` is an object literal at every call site audited (`{ siteId }`, `{ limit: 50 }`, …) → new identity every render; `api.*.*` Proxy access also mints a fresh `{module, fn}` object per render (`api.ts:21-33`) → `ref` identity unstable too. `key` (string) is stable, but React re-runs the effect because `args`/`ref` differ → fetch → `setState` (always a fresh object) → re-render → effect re-runs → fetch… **no base case**. In-flight dedup (`inFlightQueries`) only collapses concurrent duplicates; it does nothing for the steady-state loop. Every mounted `useQuery` with inline args polls forever at render frequency.
  - **Trigger:** Open `/demo` (11 mounted queries) or `/punch` on a throttled connection; observe the network tab: continuous repeating requests; on battery-powered devices, real cost. This is very likely a contributor to any observed "it stutters" reports.
  - **Surgical Fix:** Dep array → `[key, tick, skip]` only (key fully determines the request; `ref`/`refKey` derive from it). Memoize `args` at call sites only if desired; the dep fix is sufficient and provable with one test (mount with mocked `fetch`, assert ≤1 call across 5 re-renders with identical args). Add invalidation-burst test: one `bump({tables})` → exactly one refetch per matching query.
- Stale closures: `useConvexAuth`/session singletons (`react.ts:395-455`) — module-level `sessionState` + listeners; `initSession()` guards re-init; listeners removed on unmount. Correct pattern. N/A.

### Lens 5 — Memory & Resource Lifecycle Engineer
- Server: `sharedClient`/`sharedIdCache` process-wide (`db.ts:171-178`) — intentional pooling; the `idCache` grows unboundedly (every row seen, forever, per process instance) → slow leak on long-lived Node processes; cap with a 5k-entry LRU or accept (container churn mitigates). P3.
- `useQuery` cleanup sets `active=false`, `mounted` ref maintained — no leak in the happy path; the P1-5 loop is a lifecycle defect masquerading as polling.
- WebAudio/SW: `public/sw.js` regenerated by Serwist build; 5 silent catches inside minified glue — noted, not scored. No hand-written listeners without removal found in `src/app` sweep. N/A beyond P1-5.
- **[P1-4-adjacent] Resource-implied leak** — `loadAll` allocates `rows.map(...)` + `normalise` per row per query; at O(N) steady-state this is GC churn on the server per punch. Fixed by Lens 2 change.

### Lens 6 — Security & Trust-Boundary Engineer
- **[P0-1] THE internal-function gate is dead code — every `internal*` handler is browser-callable without auth** — `src/lib/backend/runtime.ts:413-415` (and overrides list `:248`).
  - **Root Cause Mechanism:** The guard is `if (!fromServer && handler.isPublic === false) throw`. Convex's public functions carry `isPublic: true`; internal functions carry `isInternal: true` and **`isPublic === undefined`** (verified against installed `convex@1.45` runtime: `internalMutation(...)` → keys include `isInternal`, `isPublic` is absent). `undefined === false` is `false` → the throw never fires. TypeScript cannot see it (`Handler.isPublic?: boolean`), the fork model shipped it, and `npm test` never touches this path.
  - **Deterministic Trigger:** `curl -X POST /api/backend/call -H 'content-type: application/json' -d '{"ref":{"module":"payroll_data","fn":"logsForExport"},"args":{"userId":"<any uuid>","fromMs":0,"toMs":9999999999999}}'` → full GPS trail + pay bones of any employee, no token required. Equally callable: `logs:createLogAs` (forge demo-persona punches), `shifts:deriveForUser` (force re-derivation), `demo/seed:seedAll`, `messages:purgeExpiredMessages` (destructive), `push:pushToUser` (spam arbitrary push), `push_subs:recordSubscriptionError`, `users:archiveStaleMasterTemps`, and ~20 others. Confirmed exploitable logic-wise: handlers were written assuming server-only callers and perform **no** `ctx.auth` checks.
  - **Surgical Fix (one line + gate):** `if (!fromServer && handler.isPublic !== true) throw new ConvexError("UNKNOWN_FUNCTION");` — anything not explicitly public is refused, including internal and unknown. Add a table-driven test enumerating the registry (`describeFunctions()`), asserting every `isInternal` key is rejected from the browser path and every genuinely public key still resolves. Regression test must fail against current code (it will — 27 keys will fall through).
- **[P2-3] `GET /api/backend/call` publishes the full function inventory** — `src/app/api/backend/call/route.ts:121-128`. Returns all keys + kinds, including internal handlers and the module map. Zero auth. It is handy for smoke tests (`scripts/smoke-*.mjs`) but it is an attack-map. Fix: require `x-smoke-key` shared secret or `NODE_ENV !== "production"`, and strip `kind` for non-public keys.
- **[P2-4] No rate limiting on `/api/backend/call`** — per-IP token bucket missing; password-change brute force depends on Supabase's `error.message` containing "rate" (`runtime.ts:359-363`) — fragile substring coupling to vendor text. Fix: Edge/in-memory bucket (e.g. 60 req/min per IP per route) + explicit attempt counter in `users` (`failedPasswordAttempts`, lockout after 5) instead of message scraping.
- Identity gate (`resolveIdentity`): bearer via `admin.auth.getUser`, cookie via `@supabase/ssr`, active-account check incl. `archivedAt` — sound. `INACTIVE_ACCOUNT` → 403 mapping correct. RLS default-deny confirmed in `0001_init.sql` (every table, zero policies) — the single-door claim holds **once P0-1 is fixed**.
- Service-role key: server-only (`admin.ts`), never in browser bundle (`NEXT_PUBLIC_*` grep clean). N/A beyond P0-1.
- Master-password path: constant-time compare, `MODERATOR_EXISTS` after bootstrap, temp users audit-visible — matches prior remediation. N/A.

### Lens 7 — Reliability, Fault Tolerance & Chaos Engineer
- **[P1-3] (repeated for the money path)** — see Lens 4; also `runtime.ts:141` `runAction` claims server-context but is only as trustworthy as its caller.
- **[P1-4] Retention/cleanup never runs** — `convex/crons.ts` wires `purgeExpiredCoords`, `purgeStaleReviewers`, `archiveStaleMasterTemps`, `purgeExpiredMessages` to Convex's scheduler. Under Supabase, `crons.ts` is never executed (no Convex deployment in the fork model; MODULES does not register `crons`; `.github/workflows/` has no scheduled job; `vercel.json` has no `crons`; `supabase/migrations/0001_init.sql` has **no `pg_cron`** — grep clean).
  - **Root Cause Mechanism:** The entire retention tier is orphaned by the cutover. GPS coordinates (`purgeExpiredCoords` deletes raw lat/lng after N days) and 7-day demo purging are **legal/compliance features**, not hygiene. They are silently dead, and the docs still promise them.
  - **Trigger:** Deployment has run since `f823fa1` (2026-10-2x); zero purge executions; `logs` rows with precise coordinates accumulate indefinitely; `messages` with expired TTLs persist; master-temp moderator rows accumulate (break-glass blast radius grows).
  - **Surgical Fix:** Add `0002_crons.sql` enabling `pg_cron` + scheduling daily calls to an authenticated internal HTTP endpoint (`/api/internal/cron`) that holds a `CRON_SECRET` bearer and invokes the same internal handlers via `invoke(..., {kind:'cron'}, true)`. Vercel alternative: paid-plan crons hitting the same route. Verify with `select * from cron.job;` + one dry-run log line per job retained.
- Silent `catch {}` in `react.ts` query path → `console.warn` + stale `data: undefined` renders as empty states rather than error UI — acceptable if the UI distinguishes "loading/error/empty"; it does not today (P3 UX note, fold into Phase 3).
- `sw.js`: regenerated per build; do not hand-patch.

### Lens 8 — Type Systems, Schema & Contract Engineer
- `src/lib/backend/api.ts:21-33` — `api`/`internal` are `any` Proxies; call sites lose autocomplete and typo-safety on refs; a mistyped `api.moderatr.resolveShift` becomes a runtime `UNKNOWN_FUNCTION` 404 instead of a compile error. Fix (P3): generate `FunctionRef` unions from `describeFunctions()` at codegen time, or hand-maintain a string-literal union — small, bounded.
- Adapter `eq` null-semantics (`left ?? null) === (right ?? null`) — documented Convex-parity; string/bool/number strict compare, no coercion — safe but surprising; contract-test it.
- Schema parity test (`scripts/test-schema-parity.mjs`, 11 tables across Convex/SQL/registry view) — genuinely good; keep it in the fast gate.
- `resolveIdentity`: `archivedAt !== null` mixes a Postgres sentinel with an absent-key check; if a column is dropped from the select list this silently becomes `undefined !== null` → **every user rejected** (`INACTIVE_ACCOUNT`) with no diagnosable log. Fix: `row.archivedAt != null` (loose) or explicit key-presence check. P3.
- `useQuery<T = any>` returns `T | undefined` where call sites cast (`as Site`) — the lie boundary when backend shapes drift; schema-parity + integration tests are the only guard. Acceptable for now; note in ADR-004.

### Lens 9 — Platform, Viewport & Portability Engineer
- PWA offline replay: `src/lib/outbox.ts` — queued punches replay with `queuedAt` anchoring skew (prior P1-1 remediation, verified in tree). Portable. N/A new defects.
- `devicePixelRatio`/touch: handled in the 2026-11-10 visual overhaul (`2ace827`); no motion/DPR findings after sweep of `globals.css` diff (animation respects `prefers-reduced-motion` — spot-checked). N/A.
- iOS Safari `performance`/`crypto.getRandomValues` — used for device tokens; available ≥ iOS 15.4. N/A with min-version note in TRD.

### Lens 10 — Cognitive Load & AI-Context Maintainability Engineer
- `moderator/page.tsx` (513/CC 37/depth 5), `demo/index.ts` (677), `react.ts` (415) — all exceed the 400 LOC God threshold. Every future agent edit on these files pays a re-read tax and a regression tax. Phase 3 extraction plan below.
- Magic constants: `CODE_ALPHABET` (`runtime.ts:176`), `PAGE_SIZE = 1000` (`db.ts:31`), `REPLAY_REVIEW_MS` (named — good), `MAX_ACCURACY_METERS` (named — good). Only `PAGE_SIZE` needs a named `ADAPTER_PAGE_SIZE` + doc link. P3.
- The `api` Proxy means "Find all callers of `api.X.Y`" works via grep — acceptable; ADR-004 should say so explicitly for future agents.
- `scripts/review-walkthrough.mjs` (846 LOC) and `scripts/e2e-all.mjs` (531) are test tooling, out of runtime scope — noted, not scored.

---

## 3. Existing Test Suite Comparison & Mutation Truth Table

- **Test-to-Code Ratio:** `20 test files / 112 impl files` (`tests/`, `scripts/test-*`); gate is green (95 + 6 pass).
- **What the suite covers:** shift grammar + 50k fuzz, payroll strategies (62 asserts), CSV injection guard, jurisdictions, schema parity (11 tables), punch mutation, outbox, geo, device tokens, demo access, react-adapter dedup/invalidation (6 tests), a11y statics, next-build artifacts.
- **What it does not cover:** the entire `src/lib/backend/*` adapter (runtime gate, registry, `invoke`, `/api/backend/call` identity path, `db.ts` semantics) — verified: no test imports them; `grep -rn "backend/runtime\|backend/db" tests scripts/test-*` → no matches.
- **Estimated Mutation Kill Score ($M_{\text{kill}}$):** **≈ 55%**, basis: strong on pure money modules (~75%), ~0% on adapter/runtime (the layer that broke), weak on UI components. `P_test = 15 × (1 − 0.55) ≈ 6.8`.

| Implementation Module | Critical Branches | Paired Test File | Pathologies Detected | Mental Mutants (M1–M4) | High-Priority Missing Assertions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `src/lib/shift-engine.ts` | dedupe order, skew decay, replay flag, FSM phase machine | `test-shift-engine.mjs` + `-fuzz.mjs` | none material | 3/4 (75%) | M2 empty-replay edge, M4 async N/A (atomically pure) |
| `src/lib/payroll-strategies.ts` | rounding, jurisdiction branches | `test-payroll-strategies.mjs` | happy-path leaning | 3/4 (75%) | M3 side-effect (FX table) deletion |
| `src/lib/backend/db.ts` | `eq` null sentinel, `sortKey`, `paginate` offset | **NONE** | untested module | 0/4 (0%) | all — MVTH #1 |
| `src/lib/backend/runtime.ts` | `isPublic` gate, overrides, `runAfter` swallow | **NONE** | untested module, dead gate shipped | 0/4 (0%) | all — MVTH #2 (the P0 regression test) |
| `src/lib/backend/react.ts` | effect deps, invalidation bus, session singleton | `test-react-adapter-dedup.mjs` | covers dedup/invalidation only; **not** the P1-5 loop | 1/4 (25%) | M1 boundary (mount stability), M4 async failure |
| `convex/*.ts` (via adapter) | authz helpers inside handlers | **NONE** — handlers trusted the Convex gate | mock-mirror absent (no mock at all) | n/a | MVTH #3 |
| `src/app/api/backend/call/route.ts` | identity resolution, status mapping | **NONE** | untested trust boundary | 0/4 | MVTH #2 covers via integration |

### Why Existing Tests Missed Discovered Defects
- **[P0-1]:** The gate was never unit-tested; the suite exercises Convex-land modules as pure functions and never exercises `invoke()`'s `fromServer=false` path. The `undefined === false` bug is invisible to `tsc`, to linters, and to every green test — it requires one assertion: *"internal ref from browser throws"*.
- **[P1-5]:** `test-react-adapter-dedup.mjs` tests `callBackend`/`bump`/`subscribe` in isolation — the defect lives in the React effect's dependency array, one level up. No renderer-mounted test exists.
- **[P1-2/P1-3]:** No test harness can see the absence of a transaction; coverage of Postgres behaviour would require the integration lane in MVTH #3.
- **[P1-4]:** Cron wiring is deployment topology, not callable code; no test can fail for it. Only `pg_cron` inventory + one synthetic run per job proves it (Phase 1 gate).

### Minimal Viable Test Harness (MVTH) Specifications
1. **Adapter truth table** (`scripts/test-db-adapter.mjs`): table-driven cases over a scratch in-memory PostgREST mock asserting — `eq` with `null`/`undefined`/`0`/`false`; `withIndex(...).eq(...).first()` returns smallest `_creationTime`; `take(n)` never scans beyond n after Lens 2 fix; `unique()` throws on 0 and on 2; `paginate()` keyset stays stable across concurrent insert (fails with offset cursor — proves M2); `patch(undefined)` round-trips to absent, not `NULL`.
2. **Browser trust-boundary gate** (`scripts/test-invoke-gate.mjs`): import `invoke` with `fromServer=false`; table-driven over every registered key (from `describeFunctions()`), each must reject (`UNKNOWN_FUNCTION`); a known-public allowlist (`users_queries:me`, …) must pass. **This test fails on current code** (27 keys fall through) — that is the regression proof for the P0 fix.
3. **Identity integration** (`scripts/test-backend-call-route.mjs` or Playwright spec): unauthenticated POST to `/api/backend/call` (a) with internal ref → 404, no data; (b) with public ref → expected UNAUTHENTICATED/401 shape; (c) with `x-smoke-key` on GET → inventory; without → 403.
4. **UseQuery stability** (`scripts/test-use-query-loop.mjs` with `react-test-renderer` or `@testing-library/react`): mount with inline-object args and a mocked `fetch`; flush 3 renders; assert call count === 1; then `bump({tables})` once; assert exactly +1.
5. **Cron liveness** (`scripts/test-cron-inventory.mjs` executed in CI against the Supabase project): `select jobname, schedule from cron.job` contains all four jobs; hits `/api/internal/cron?job=purge-expired-coordinates` with `CRON_SECRET`; asserts `200` + rows deleted.

---

## 4. Surgical Refactoring Blueprints (Zero-Mutation Drafts)

### Refactor R1 — Replace the Dead Gate with Deny-by-Default (P0-1)
- **Target Scope:** `src/lib/backend/runtime.ts:401-418`
- **Engineering ROI:** Closes unauthenticated read of GPS/payroll data for ~0 LOC; removes false confidence from every "auth" audit downstream; unblocks MVTH #2 as a permanent gate.

**Current Pattern (Audited Code):**
```ts
  fromServer = false
): Promise<unknown> {
  const key = refToKey(ref);
  const override = OVERRIDES[key];
  if (override) {
    if (!fromServer && INTERNAL_ONLY_OVERRIDES.has(key)) {
      throw new ConvexError(`UNKNOWN_FUNCTION:${key}`);
    }
    return await override(new RequestContext(identity) as unknown as never, args ?? {});
  }
  const handler = registry().get(key);
  if (!handler) throw new ConvexError(`UNKNOWN_FUNCTION:${key}`);
  if (!fromServer && handler.isPublic === false) {   // ← undefined === false → never throws
    throw new ConvexError(`UNKNOWN_FUNCTION:${key}`);
  }
```

**Target Pattern (Surgical Blueprint):**
```ts
  const handler = registry().get(key);
  if (!handler) throw new ConvexError(`UNKNOWN_FUNCTION:${key}`);
  // Deny-by-default: ONLY an explicit isPublic === true may serve the browser.
  if (!fromServer && handler.isPublic !== true) {
    throw new ConvexError(`UNKNOWN_FUNCTION:${key}`);
  }
```
*(Leave the override block unchanged; it already has its own deny-list. Add MVTH #2 to lock both.)*

### Refactor R2 — Push Index Constraints into PostgREST (P1-1)
- **Target Scope:** `src/lib/backend/db.ts:31-61` (`INDEX_FIELDS` → column map) and `:364-397` (`run`)
- **Engineering ROI:** O(N) → O(log N + selectivity) per query; removes JS-side filter/sort of full history; egress on Supabase drops by ~100× at production row counts.

**Current Pattern:**
```ts
  private async run(): Promise<Doc[]> {
    let rows = await this.db.loadAll(this.table);      // SELECT * … range() … ALL ROWS
    …js filter/sort…
```

**Target Pattern:**
```ts
  private async run(): Promise<Doc[]> {
    let q = this.client.from(this.table).select("*");
    for (const c of this.constraints) {                 // from withIndex()
      const col = INDEX_COLUMN[this.table]?.[c.field] ?? c.field;
      if (c.op === "eq") q = q.eq(col, c.value ?? null);
      else if (c.op === "lt") q = q.lt(col, c.value); /* … */
    }
    for (const c of this.orderSpec) q = q.order(c.col, { ascending: c.asc });
    if (this.limit !== undefined) q = q.limit(this.limit);
    const { data, error } = await q;
    if (error) throw new Error(`${this.table}: ${error.message}`);
    return (data ?? []).map((r) => this.normalise(this.table, r));
    // Predicate (.filter(q => …)) stays in JS — it has no SQL equivalent.
  }
```
Plus: `0002_crons_and_indexes.sql` with `create unique index logs_user_idem_uniq on public.logs ("userId", "idempotencyKey");` and keyset paginate (or delete `paginate()`).

### Refactor R3 — Money Path: Fail Loud, Not Logged
- **Target Scope:** `src/lib/backend/runtime.ts:147-171` + `convex/logs.ts:119,245`
- **Engineering ROI:** Converts silent payroll drift into explicit `needsReview` evidence; ~15 LOC.
**Target:** for `internal.shifts.deriveForUser`, `await invoke(...)` before returning the mutation result; on throw, write `systemEvents {kind:"derivation_failed", userId, at}` + stamp the just-closed shift row `needsReview:true, reviewReason:"derivation_failed"`; do not rethrow (the punch itself is valid evidence). All other `runAfter` call sites keep inline-execute but log failures to `systemEvents`, never console-only.

### Refactor R4 — Kill the Refetch Loop
- **Target Scope:** `src/lib/backend/react.ts:341`
**Target:** `}, [key, tick, skip]);` — one-line; ship with MVTH #4 proving ≤1 fetch per mount and +1 per `bump`.

---

## 5. Phased Execution Roadmap & Scoped Agent Prompts

**Phase 1 — Containment & Safety Lock (P0 + P1, security & money before anything else)**
1. R1 gate fix + MVTH #2 (red-first: commit failing test, then fix) — **1 session**.
2. GET inventory lockdown (`x-smoke-key` or prod-off) — **15 min**.
3. MVTH #3 integration probe unauthenticated → expect 404/401 matrix — **1 session**.
4. R4 refetch-loop fix + MVTH #4 — **1 session**.
5. R3 derivation-failure surfacing (`needsReview: derivation_failed`) — **1 session**.
6. `0002_crons.sql`: `pg_cron` enabled, 4 jobs → authenticated `/api/internal/cron`; plus `logs_user_idem_uniq` — **1 session**; verify via `select * from cron.job` and one forced run.
7. Rate bucket on `/api/backend/call` — **1 session**.

**Phase 2 — Concurrency & Cost Hardening (P1 remainder)**
8. R2 PostgREST predicate pushdown + `paginate` keyset-or-delete; EXPLAIN evidence in PR; fuzz `scripts/test-db-adapter.mjs` — **2 sessions**.
9. Money-path write-set in one Postgres `rpc` (or `serializable` tx) for punch/log + derivation; prove double-tap test (MVTH extension) — **1–2 sessions**.
10. LRU-cap `sharedIdCache` (5k) — **15 min**.

**Phase 3 — Structural De-Vibing & Docs Truth (P2/P3)**
11. ADR-004 (backend authority) + README/TRD/AGENTS sync; fork-model rewrite; kill the Convex quick start — **1 session**.
12. Extract `moderator/page.tsx` → per-tab panels; extract `check-in-card.tsx` GPS/token/outbox into `src/lib/client/` modules (behavior-preserving) — **2 sessions**.
13. Generate `FunctionRef` string-union from registry; drop `any` from `api.ts` — **1 session**.
14. Server-reported write-set for invalidation (replace hand maps) — **1 session**.
15. P3 sweep: dead exports, `!= null` sentinel, named constants, `paginate` decision — **½ session**.

### Copy-Paste Surgical Prompts for Coding Agents

> **Prompt [P0-1] (`src/lib/backend/runtime.ts`, `src/app/api/backend/call/route.ts`):**
> "Edit only `src/lib/backend/runtime.ts` (lines ~401-418), `src/app/api/backend/call/route.ts` (GET handler), and new file `scripts/test-invoke-gate.mjs`. First write the test: import `invoke`/`describeFunctions`; for every key marked internal by the source modules (or every key where `isPublic !== true`), assert `invoke(ref, {}, null, false)` rejects with `UNKNOWN_FUNCTION`; assert an allowlisted public key passes. Run it — it MUST fail (27 internal keys fall through today). Then apply Refactor R1 (deny-by-default `handler.isPublic !== true`). Re-run test — green. Lock the GET route behind `x-smoke-key` compared with `crypto.timingSafeEqual`. Do not modify anything under `convex/`. Run `npm test`."

> **Prompt [P1-5] (`src/lib/backend/react.ts`):**
> "Edit only `src/lib/backend/react.ts` and new `scripts/test-use-query-loop.mjs`. Add a renderer-mounted test with mocked `fetch`: mount a component calling `useQuery(api.sites.listMine, { siteId: 'x' })`; flush effects; assert `fetch` called exactly once per mount; call the exposed invalidation `bump({tables:['sites']})`; assert exactly one additional call. Fail the test on current deps `[key, tick, skip, ref, args, refKey]`, then change the deps to `[key, tick, skip]` and show green. Do not touch `convex/` or `db.ts`."

> **Prompt [P1-4] (`supabase/migrations/0002_crons.sql`, new `src/app/api/internal/cron/route.ts`):**
> "Create `supabase/migrations/0002_crons.sql` enabling `pg_cron`; schedule four daily jobs (02:00/03:00/04:00/05:00 UTC) that `net.http_post` to `${baseUrl}/api/internal/cron?job=<name>` with header `Authorization: Bearer $CRON_SECRET`. Create the route: verify the bearer with `timingSafeEqual` against `process.env.CRON_SECRET` (500 if unset, 401 otherwise); map job name → internal handler key; call `invoke(ref, {}, null, true)`; return `{ok:true, job}`. Route must reject unknown `job` with 400. Add `create unique index if not exists logs_user_idem_uniq on public.logs (\"userId\",\"idempotencyKey\")` in the same migration. Document in the PR body the exact `select jobname, schedule, command from cron.job` output as proof. Do not edit existing migration 0001."

> **Prompt [P2-1] (`README.md`, `j-pay.md`, `AGENTS.md`, `docs/adr/ADR-004-*.md`):**
> "Write `docs/adr/ADR-004-supabase-authoritative-backend.md` from commit `f823fa1` (refactor(backend)!: make Supabase the authoritative backend): context, decision (Postgres holds data; Supabase Auth holds identities; Node runtime executes `convex/*.ts` bodies; `src/lib/backend/*` is the only client↔data path; Convex deployment retired for forks), consequences (no `npx convex dev`; retention via `pg_cron`; schema parity test is the DDL/type bridge; TRD §6 remains shape-contract). Then update README Quick start, fork model, env list; prepend a pointer to ADR-004 in `j-pay.md` §stack and `AGENTS.md`. Run `python3 scripts/check_consistency.py` and `python3 scripts/check_diagrams.py` — both must pass."

---

## 6. Zero-Mutation Verification & Hand-off

- `git status --porcelain` before/after audit: **empty / empty** (the owner committed the in-flight style work mid-audit as `2ace827`; no audited file was edited by this session — all probes ran against a scratch copy under `/tmp/opencode/audit-work` and against installed `node_modules`).
- Pre-audit digests: dirty tree `9a44e715…` (`9a11f35`); clean tree **`686fe6c7…`** (`2ace827`) — post-audit tree changes are this file only (`docs/audits/surgical-audit-2026-11-10.md`).
- Gates run: `npm test` → 95 + 6 pass / 0 fail · `check_consistency.py` → PASS · `check_diagrams.py` → PASS.
- **Not done / explicitly out of scope:** any source fix (this report is the deliverable); live DB verification of `pg_cron` (requires the Supabase project); e2e browser run (requires dev server + test credentials); production deploy verification.
- **Score honesty note:** `S_health = 70` sits in the Moderate band but `N_P0 = 1` pins the classification to HIGH. If P0-1 alone is fixed and MVTH #2 lands, recompute: `D_raw = 59`, `S ≈ 76`, risk HIGH→MODERATE (subject to review of P1 closure).
