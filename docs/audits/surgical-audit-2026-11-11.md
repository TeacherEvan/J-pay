# Surgical Audit Report: J-Pay (TeacherEvan/J-pay)

| Audit Metadata | Specification |
| :--- | :--- |
| **Audit Date** | 2026-11-11 |
| **Audited Scope** | `src/`, `convex/`, `supabase/migrations/`, `scripts/` — 148 scanned files, **15,192 effective LOC** |
| **Tech Stack & Runtime** | Next.js 16.3.3 (webpack) · React 19 · Supabase (Postgres + Auth) authoritative backend via `src/lib/backend/*` adapter executing the `convex/*.ts` bodies in Node · Serwist PWA · TypeScript 5.9 strict |
| **Audited Commit** | `4aebd6b` (`main`), tree clean at audit time |
| **Pre/Post Audit SHA-256** | `d0abd1485f6cf482…` / `d0abd1485f6cf482…` (pruned copy; **VERIFIED ZERO SOURCE MUTATION** — report files are the only new artefacts) |
| **Verification** | `npm run verify` → **PASS** (all harnesses green) · consistent with prior gates |
| **Deterministic Health Score** | **`~78 / 100`** (no P0; residual P1/P2 below; `M_kill ≈ 55–60%`, `P_test ≈ 6–7`) |
| **Vibe-Debt Risk Level** | **MODERATE** (`N_P0 = 0`, score band 65–85) |

> Method: preflight telemetry (pruned copy hashing identical pre/post), focused 10-lens review of the 29 commits landed since the 2026-11-10 re-audit (`2a3c9ed..4aebd6b`, +4,446/−2,548), gate run. Full re-derivation of untouched subsystems was not repeated; prior audits cover them. Companion work order: `plans/2026-11-11-implementation-plan.md`.

**Headline:** the 2026-11-10 plan was largely executed and the fixed layer held — but **C3 and P2-5 did not land** (verified in-tree on second pass). The residual risk has shifted from "broken money path" to "operations honesty": **twelve migrations (0002–0012) are still unapplied in any known environment**, the privacy policy is still a DRAFT placeholder linked from a GPS-consent gate, and one fix from this batch (B1) is a heuristic, not a proof.

---

## 1. Executive Architecture & Vibe-Debt Triage

The adapter remains the load-bearing wall and is now mostly de-risked: the `isPublic !== true` gate stands, consent revocation closes open legs (`bfed45c`), out-of-order fixes are rejected (`acbbf85`), one-open-leg is enforced by a partial unique index (`f80f7d1`/`0010`), derivation failure is surfaced via `needsReview` + `systemEvents` (`503afa1`, `0011`), session-bootstrap is rate-limited (`d3e14ab`), the outbox no longer head-of-line blocks (`e05fc3f`), and Leaflet imports and the double-tap race are fixed (`c45ea90`, `61ada27`). New surface added since the last audit — the organisations feature (`92b7781`, `0009`) and the 2026-11-10 bugfix tail — carries modest new debt (full-table collects in `listOrgs`).

| Severity Tier | Count | Deduction | Primary Failure Domains |
| :--- | :--- | :--- | :--- |
| **P0 — Critical** | 0 | — | none found; prior P0 gate verified intact in-tree |
| **P1 — High** | 2 | −16 | Unapplied migrations / deploy-order (B5 residual); B1 residual under-fill heuristic |
| **P2 — Medium** | 7 | −21 | `/privacy` DRAFT linked from consent gate (launch blocker); `listOrgs` full-table collects; `jpay_id_registry` incremental-install path unproven; e2e lane self-skips; `npm audit` serwist chain (C3 reopened); hand-maintained invalidation maps (P2-5 reopened); serverless rate limit per-instance |
| **P3 — Low** | ~8 | −8 | `eq(null)` sentinel notes, `api.ts` residual `any` in spots, `sw.js` silent catches (build artefact), root housekeeping remnants |

### High-Risk File Telemetry Hotspots (this batch)
| File Path | Eff. LOC | Est. CC / Depth | Silent Catches | Primary Vibe-Debt Signature |
| :--- | :--- | :--- | :--- | :--- |
| `convex/travel.ts` | 495 | ~12 / 4 | 0 | GPS money-adjacent; now guarded but complex |
| `src/app/check-in-card.tsx` | ~360 (post-C5) | 16 / 6 | 2 | God component, split by `596d90e`; watch residual |
| `src/lib/backend/db.ts` | 521 | 33 / 5 | 0 | B1 heuristic window; legacy full-table path retained |
| `convex/organisations.ts` | ~80 | low / 2 | 0 | New: full-table collects in `listOrgs` |

## 2. The 10-Principal-Engineer Deep Audit (delta)

### Lens 1 — Systems Architect
- **[P2-1] `listOrgs` loads all sites and users to count per org** — `convex/organisations.ts` (listOrgs). O(table) per console load; replace with per-org indexed counts or a SQL view/`rpc`. Deterministic trigger: console open on a large install.
- Lens otherwise: organisations model is sound (archive-not-delete, audit-preserving); ADR-004 still governs; no new split-brain found.

### Lens 2 — Frame-Budget & Performance Engineer
- **[P1-1-residual] B1 fix is a bounded heuristic, not a guarantee** — `src/lib/backend/db.ts:433-441`. When residual filtering exists, SQL `LIMIT` is replaced by `limit*2+50` (cap 5000) fetched then JS-filtered. If more than `limit+50` push-matching rows are rejected by the predicate/`neq`, results still under-fill silently — the exact defect class B1 was filed to eliminate, shrunk but not closed. Trigger: `moderatorInbox`-style queries once `logs` grows and >50 archived rows crowd the newest window. Surgical fix: loop (fetch next window until `limit` post-filter rows or exhaustion) or push the predicate into SQL where expressible; keep differential test comparing SQL-pushdown vs JS-oracle on adversarial fixtures.
- Manager hot paths cleaned (`84d3990`); `travel:recordFix` invalidation narrowed to `travelSegments` (`51164da`). `listOrgs` collects noted above.

### Lens 3 — Mathematical & Algorithmic Engineer
- Shift engine untouched this batch; prior property fuzzing stands. **N/A (delta).**

### Lens 4 — Concurrency, Async & Determinism Engineer
- C2 duplicate-write guard landed (`4aebd6b`); B3/B4 closed with tests. Residual: `paginate()` remains array-offset (C8, still unfixed) — no current caller; fix-or-delete before first use.

### Lens 5 — Memory & Resource Lifecycle Engineer
- `useQuery` deps previously fixed; unmount cleanup correct; no new leaks found in the delta. **N/A (delta).**

### Lens 6 — Security & Trust-Boundary Engineer
- Session-bootstrap rate limit (`d3e14ab`) — in-memory per-instance bucket; on serverless this is best-effort, not a global guarantee. **[P2-2]** For real brute-force protection on the master path, back the bucket with Postgres (atomic `UPDATE … RETURNING`) or Vercel KV; document the limitation.
- P0 gate (`isPublic !== true`) verified intact in-tree. Manager grant/revoke now audited + archived (`6460a33`, `0012`). `/api/backend/call` inventory still dev-only/smoke-key gated per prior item — unchanged.

### Lens 7 — Reliability, Fault Tolerance & Chaos Engineer
- **[P1-2 / B5-residual] Migrations 0002–0012 remain unapplied in any known environment**; `0009_organisations.sql` adds a whole new table read by the moderator console. Until applied (in numeric order, post-backup), the organisations flow and parts of the payroll path (`shiftOverrides` reads) are live-code-against-missing-schema — the `/api/health/db` probe (`41a52c6`) exists precisely to detect this; it must be checked post-deploy. Health probe is a mitigation, not a substitute for 0.1-class apply.
- `systemEvents` ledger (`503afa1`) closes the "silent derivation failure" gap on paper; verify it actually fires on a forced throw in staging before relying on it.

### Lens 8 — Type Systems, Schema & Contract Engineer
- `api.ts` type-safe surface landed (`4aebd6b`); residual `any`/`as never` pockets were removed in the U13 decomposition. Incremental-install registry/NOTIFY refresh landed (`5a275bd`, `0008`). **[P2-3]** `jpay_id_registry` view refresh must be verified on an *existing* install (only 0001 was edited in place for fresh installs) — the fix is unproven until one real incremental apply runs green.

### Lens 9 — Platform, Viewport & Portability Engineer
- U9 scroll fix, U10 popup-preserving refresh, U11 tri-state notifications, U12 a11y batch, U14 scoped tick — all landed and consistent with this lens. No new findings.

### Lens 10 — Cognitive Load & AI-Context Maintainability Engineer
- God files shrinking (`moderator/page.tsx` decomposed, `check-in-card.tsx` submit paths extracted, shared `LiveCrewMap`). `src/lib/backend/db.ts` (521) remains the biggest context sink.

## 3. Existing Test Suite Comparison & Mutation Truth Table (delta)
- **Verification:** `npm run verify` PASS · consistency PASS · mermaid PASS.
- **Mutation basis:** **4 of 36** test files carry a negative/boundary signal; `vi.mock`-heavy harnesses re-implement contracts inline. Estimated **M_kill ≈ 55%** stands but is soft — do not read it as measured.
- **Dead-export sweep:** 42 "dead value export" candidates; ~25 are Next.js router conventions (`page.tsx` default exports, `layout.tsx`) the sweep cannot follow → false positives. Remaining candidates (`react.ts` internals, `csv.ts`, `format.ts`, `cron-jobs.ts`) are used via the `api.*` proxy or dynamic access — **no confirmed dead production code**; sweep retained as a candidate list only. `paginate()` no longer exists in `db.ts` (deleted, not just deferred — confirmed by grep).
- **npm audit (`--omit=dev`): 6 vulnerabilities (2 moderate, 4 high)** — all in `@serwist/*` (`glob`, `minimatch`, `zod<4.6.6`); `d601d76` fixed other advisories but not this chain (breaking `@serwist/next@8.4.4` or an `overrides` entry required). **C3 is OPEN.**

### Lens 2 (added) — [P2-5-still-open] Hand-maintained invalidation maps
`src/lib/backend/react.ts:56` (`MUTATION_TABLE_MAP`), `:123` (`QUERY_TABLE_MAP`) still drive `useQuery` invalidation. Server knows what it touched; client guesses. A new mutation is automatically mapped to nothing → readers go permanently stale, silently. **Fix:** server returns `tables` in the `/api/backend/call` response (from handler metadata or an explicit `tables` hint); client invalidates from that; maps deleted. Regression test: invoke `logs:createLog`, assert the punch/shift/logs queries refetch without any map entry.

### Why Existing Tests Missed the Residuals
- **P1-1-residual (B1 window):** the MVTH case added for B1 asserts the common under-fill; no fixture exercises >50 residual rejections inside the window.
- **P2-2 (rate limit):** harness asserts 429 at the cap; no multi-instance/two-bucket test (impossible in-process) — hence P2 not P1.

### Minimal Viable Test Harness (MVTH) additions
1. **Adapter window exhaustion:** 150 push-matching rows, predicate rejects 120 newest, `take(60)` returns 60 rows from the older window (requires the loop fix).
2. **systemEvents on forced derivation throw:** stub `deriveForUser` to throw; assert closed shift `needsReview=true`, `reviewReason="derivation_failed"`, and exactly one `systemEvents` row.
3. **`listOrgs` counts:** two orgs, archived site/user excluded; assert counts.

## 4. Surgical Refactoring Blueprints (Zero-Mutation Drafts)

### Refactor R1: Close the B1 residual — window loop instead of fixed oversize
- **Target Scope:** `src/lib/backend/db.ts:433-441` (and callers of `finish`)
- **Engineering ROI:** eliminates the silent under-fill class entirely; cost is one extra round-trip only when the first window is heavily filtered.

**Current Pattern:**
```ts
} else if (this.limit !== undefined) {
  const fetchLimit = Math.min(this.limit * 2 + 50, 5000);
  query = query.limit(fetchLimit);
}
```
**Target Pattern:**
```ts
// Fetch in windows until post-filter rows reach this.limit or SQL is exhausted.
const WINDOW = Math.max(this.limit * 2, 100);
let offset = 0, acc: Doc[] = [];
for (;;) {
  const { data, error } = await query.range(offset, offset + WINDOW - 1);
  if (error) throw new Error(`${this.table}: ${error.message}`);
  const rows = (data ?? []).map(r => this.db.normalise(this.table, r));
  acc = acc.concat(this.finish(rows));
  if (acc.length >= this.limit || rows.length < WINDOW) break;
  offset += WINDOW;
}
return acc.slice(0, this.limit);
```

### Refactor R2: `listOrgs` without full-table scans
**Current:** three `.collect()`s + in-JS counts. **Target:** SQL `rpc`/view `org_counts` (`select o.id, count(distinct s.id), count(distinct u.id) … group by o.id`) or per-org indexed `count` queries; fallback to current path if RPC absent.

## 5. Phased Execution Roadmap
See `plans/2026-11-11-implementation-plan.md` — Phase 0 (owner: apply migrations, privacy policy, env vars), Phase 1 (B1 loop, MVTH#1), Phase 2 (rate-limit persistence, listOrgs), Phase 3 (registry verification on incremental install, re-audit).

## Pitfalls observed this cycle
- A bounded "fetch extra" window is a mitigation, not a fix — always pair it with an exhaustion-loop test or an explicit documented bound.
- In-memory rate limiting on serverless is per-instance; never report it as brute-force protection without a shared store.
- "Migrations written" ≠ "migrations applied" — every audit since 2026-11-10 has listed 0002+ as unapplied; treat apply + `/api/health/db` green as part of the definition of done.

---

## 6. Post-remediation re-audit (2026-11-11, same day, HEAD `2fd7f0b`)

Landed in this cycle: **B1/R1 closed for real** (window-loop pagination + MVTH#9, red-proof verified), **MVTH#2** (derivation-failure ledger), **MVTH#3** (`listOrgs` counts), **P2-5 closed** (server-reported `{tables, reads}` on `/api/backend/call`; client maps deleted; `test-write-set.mjs`), **item 5** (`listOrgs` indexed `by_org` queries), **rate limiting** (Postgres `jpay_rate_limit_hit` RPC, migration `0013`, in-memory fallback), **C3 closed** (`glob@^14.0.4`, `minimatch@^11.0.7`, `zod@^4.6.7` overrides; `npm audit --omit=dev` = **0**; production build verified, `.next` removed).

| Audit Metadata (re-check) | Value |
| :--- | :--- |
| **Tree digest (pruned scanner)** | `8b9b034ab7be7803…` (source changes expected vs `d0abd148…`; zero unintended drift — `git status` clean at commit) |
| **Gates** | `npm test` fail 0 · `npx tsc --noEmit` clean · consistency PASS · mermaid PASS · `npm run build` exit 0 · `npm audit --omit=dev` **0 vulnerabilities** |
| **Revised counts** | P1: **1** (unapplied migrations / deploy-order, B5 residual) · P2: **3** (`/privacy` DRAFT, incremental-install registry unverified, e2e lane self-skips) · P3 ≈ 7 |
| **Revised score** | `D_raw ≈ 26` → **S_health ≈ 87 / 100** (formula-literal). Risk: **MODERATE, conditional** — LOW by score, but no environment runs the migrated schema yet; the number is not deployable evidence until Phase 0 completes |
| **Mutation basis** | 4/36→5/36 negative-signal files (write-set telemetry adds an assertion class); `M_kill ≈ 55–60%` still soft |

### Still owner-gated (unchanged)
Migrations `0002`–`0013` unapplied · `/api/health/db` green pending apply · `/privacy` DRAFT · CI secrets for nightly e2e · prod round-trip verification. **Do not treat the app as launch-ready on the strength of this report.**
