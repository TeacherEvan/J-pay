# J-Pay Trust-Boundary Hardening (Red-Team Remediation)

**Status:** proposed
**Author:** surgical-impl-2026-09-01-trust-boundary
**Date:** 2026-09-01
**Verdict source:** red-team audit of J-pay-main.zip (2026-09-01)
**Contradicts:** prior debrief `docs/.scratch-audit/debrief.md` (READY, 2026-08-29)
**Supersedes:** none — applied as a fresh milestone; archived prior debrief as superseded.

---

## Why this plan exists

The prior `READY` debrief is invalidated. Empirical re-verification (grep + read
of `convex/demo/index.ts`, `convex/access.ts`, `convex/auth.ts`, `convex/logs.ts`,
`convex/punches.ts`, `package.json`, `package-lock.json`, `src/app/demo/page.tsx`,
`src/app/**/page.tsx`) confirms at minimum the following trust-boundary
failures, the strongest 5 of which constitute end-to-end exploit chains.

| # | Finding | Severity | Source-verified line |
|---|---|---|---|
| F1 | `bindReviewer`/`switchPersona` accept any non-anonymous email (incl. real employees) | CRITICAL | `convex/demo/index.ts:199`, `:449` |
| F2 | `requireDemoReviewer` only checks `persona.isAnonymous === true` rejection (i.e. "not anonymous") — does NOT require the persona to be demo-tagged | CRITICAL | `convex/access.ts:59` |
| F3 | `createLogAs` does not re-verify that the persona is a demo user; an attacker's bind to a real employee writes `isModeratorOverride: true, userId: <real employee id>` | CRITICAL | `convex/logs.ts:160-167`, `:224-225` |
| F4 | `demoResolveShift` operates on arbitrary `shiftId` with no persona-vs-shift.userId check | CRITICAL | `convex/demo/index.ts:566-583` |
| F5 | `demoRecomputeEmployeeShifts` schedules `deriveForUser` for arbitrary `userId` with no persona check | CRITICAL | `convex/demo/index.ts:586-591` |
| F6 | `demoEmployeeRoster` returns real (non-anonymous) employees with email — provides target identifier for F1 | HIGH | `convex/demo/index.ts:393-403` |
| F7 | `demoExportLogsCsv` exports the bound persona's full GPS log without independently verifying the persona is demo-only | HIGH | `convex/demo/index.ts:468-505` |
| F8 | `boundPersonaLogs`/`boundPersonaShifts`/`boundPersonaPayroll`/`demoAudit`/`demoKpis` all read from the bound persona's id with no independent demo-only re-check | HIGH | `convex/demo/index.ts:248-391` |
| F9 | Master provider returns `existing._id` for any active user's email — universal impersonation | CRITICAL | `convex/auth.ts:60-68` |
| F10 | `issueMyDeviceToken` derives `userId` from `currentUserId()` with no role/active re-check; master impersonation therefore mints a device token | HIGH | (to verify line-by-line) |
| F11 | Multiple mutations (`messages.sendToModerators`, `messages.myInbox`, `users.getMyLocale`, `users.issueMyDeviceToken`) use `currentUserId` not `requireActiveUser` — deactivation does not kill session | MEDIUM | (to verify) |
| F12 | `recordPunch` punch-pairing: `outPunchIds.has(p._id)` is structurally `false` for any `in` punch (different documents), so the "is this in already paired?" check is always `true` — the first in wins, not the latest unpaired | HIGH | `convex/punches.ts:51-64` |
| F13 | Geofence is computed (`isWithinGeofence`) but never enforced for the primary check-in path | HIGH | `convex/logs.ts:186-188`, `:219` (computed, not gated) |
| F14 | `skewCorrectedTime` falls back to `_creationTime` when `|skew|>30000` — contradicts documented "client chronology preserved" invariant | HIGH | `src/lib/shift-engine.ts:27-30` |
| F15 | Next.js pinned to 16.3.2 in lockfile; 16.3.3 contains critical security patches per upstream | CRITICAL (dep) | `package.json:22`, `package-lock.json` |
| F16 | Privacy page promised in UI but does not exist (`/privacy` route missing) | MEDIUM | `src/app/` listing |
| F17 | `/demo` recompute button casts `s._id as unknown as Id<"users">` — passes shift ID as user ID, swallowed by `.catch(() => {})` | MEDIUM (functional) | `src/app/demo/page.tsx:158` |
| F18 | `/punch` is a second attendance system disconnected from the `logs→shifts→payroll` pipeline | HIGH (architectural) | schema `punches` table + `convex/punches.ts` + `src/app/punch/` |

**The red-team's strongest chain (anonymous → demo → real employee → inject
attended → seal shift → alter payroll) is structurally feasible today and is
in scope for this milestone.** F18 is called out but explicitly deferred — the
plan to retire `/punch` requires product input, not a code-only fix.

---

## Approach

**Phase 1 — Defend the demo boundary (F1–F8).** Introduce a single
`assertDemoPersona(persona)` invariant: the persona MUST have
`isAnonymous === true` AND its email MUST end in `@jpay.local` (or be in a
configured allow-list). Apply the assertion at:
- `bindReviewer` (after lookup, before `db.patch`)
- `switchPersona` (after lookup)
- `requireDemoReviewer` (replace the "not anonymous" rejection with
  "must be anonymous"; this is the *correct* direction — the persona
  itself is the demo, not the reviewer)
- `createLogAs` (add a `persona.isAnonymous === true` check)
- `demoResolveShift` (verify `shift.userId === persona._id` AND persona is demo)
- `demoRecomputeEmployeeShifts` (verify `args.userId === persona._id`)
- `demoExportLogsCsv` (already routes through `requireDemoReviewer`, which
  now enforces the demo-only invariant; defence-in-depth: also verify inside
  the action)
- `demoEmployeeRoster` (filter to `isAnonymous === true` only)

The simplest implementation: add a `DEMO_PERSONA_EMAILS` set (the 5 personas
already declared in `DEMO_PERSONAS`) and a `assertDemoPersona(persona)` helper
in `convex/demo/scope.ts` that throws `FORBIDDEN_DEMO_BOUNDARY` if the persona
is missing, archived, or not in the allow-list. All demo functions call it.

**Phase 2 — Make master auth boring (F9, F10).** The master provider must
NEVER return an existing user's id. Replace:
- `if (existing) { if (active) return { userId: existing._id } }`
  with: ALWAYS create a dedicated `isMasterTemp = true` moderator (already
  implemented in `createMasterTempUser`); return that. The email is recorded
  for audit; it is never the authenticated identity.
- Also: `issueMyDeviceToken` must require `requireActiveUser` (not
  `currentUserId`) so deactivation terminates device minting; and the
  master temp user must NOT be eligible to issue device tokens (gate by
  `isMasterTemp !== true`).

**Phase 3 — Fix the punch pairing (F12).** The current implementation is
algebraically a no-op for the "is this in already paired" check. Replace
the two-pass scan with a single scan: iterate `punches` in descending ts
order, find the first `in` whose `ts` is older than this `out`'s `ts` AND
that has not been paired with a later `out`. The simplest correct form:
find the latest `in` whose `ts < thisOut.ts`. We don't track pairing state
in the schema, so the "unpaired" check is implicit: the latest `in` that
predates this `out` is the one the user means to pair with (assuming normal
sequential use). Add an `outInId` field on `punches` to make pairing
durable. The fix is small; the test that proves it must construct the
4-punch sequence (08:00 IN, 12:00 OUT, 13:00 IN, 17:00 OUT) and assert that
the second OUT pairs with 13:00, NOT 08:00.

**Phase 4 — Patch Next.js 16.3.3 (F15).** Edit `package.json` to `"next":
"^16.3.3"`, regenerate `package-lock.json` via `npm install`, run
`npm run typecheck` and `npm run build` to confirm the lockfile resolves
cleanly and the build still passes.

**Phase 5 — Add the privacy route (F16).** Author `src/app/privacy/page.tsx`
with a minimal stub (placeholder copy marked DRAFT, not legal advice) so
the link doesn't 404. Mark as known-pending-legal-copy in a comment so the
real document replaces it before launch.

**Phase 6 — Fix the recompute button (F17).** `src/app/demo/page.tsx:158`:
the shift object carries a `userId` field. Replace
`s._id as unknown as Id<"users">` with `s.userId`. Drop the `catch` that
swallowed the type error.

---

## Out of scope (deferred, require product decision)

- **F11 — deactivation not killing session.** Requires a session-revocation
  policy decision (do we keep `isActive` checks in every read? Add a
  per-request validity check?) — leave for the next milestone.
- **F13 — geofence not enforced as a gate.** This contradicts the TRD. The
  TRD says geofence is a server-side enforcement; the implementation treats
  it as audit metadata only. Either the TRD or the implementation must
  change. Flag in `j-pay.md` §11 and ask the user.
- **F14 — offline replay chronology.** The engine falls back to
  `_creationTime` on high skew; the TRD says it shouldn't. Either the
  engine or the TRD must change. Flag and ask.
- **F18 — `/punch` is a second timekeeping system.** Requires a product
  decision: retire `/punch` (and the `punches` table) or formally wire it
  into the payroll pipeline with reconciliation semantics. Out of scope
  for this security milestone.
- **F19 — locale used as payroll jurisdiction proxy.** Architectural.
  Requires a new `jurisdiction` field on `users` and migration. Defer.
- **F20 — historical rate not effective-dated.** Requires schema change to
  snapshot rate on the `payrollRun` artifact. Defer.
- **F21 — geocode as anonymous Nominatim proxy.** Add auth + rate limit
  or move behind a moderator-only action. Defer (low priority, but
  should not ship to production as-is).
- **F22 — demo isolation based on naming conventions + `isAnonymous`.**
  Phase 1 fixes the data-plane boundary; the long-term fix is a real
  `environmentId` / `tenantId` field. Defer to a structural milestone.

---

## Acceptance criteria

For each finding F1–F17, the implementation must be backed by a test that
constructs the malicious input and asserts the access denial. No
"implementation looks like it denies" tests; the test must execute the
mutation/action with the bad input and observe the throw. The break-it
check from the surgical-implementation skill (temporarily stub the throw
and re-run) applies to every new test.

Tests to add:
- `test-demo-boundary-v2.mjs`:
  - bindReviewer with a real (non-anonymous) employee email → throws
  - switchPersona with a real employee email → throws
  - checkInAsPersona bound to a real employee → throws
  - demoResolveShift on a shift owned by a real employee → throws
  - demoRecomputeEmployeeShifts with arbitrary userId → throws
  - demoExportLogsCsv when bound persona is real employee → throws
- `test-punch-pairing-v2.mjs`:
  - IN(08) OUT(12) IN(13) OUT(17) → second OUT duration is 4h, not 9h
  - break-it check: stub the duration calc → test fails (proves test
    actually exercises the bug)
- `test-master-auth-v2.mjs`:
  - master password + active employee email → does NOT authenticate as
    that employee; instead creates a temp moderator with `isMasterTemp`
  - break-it check: stub the `createMasterTempUser` path → master
    authentication rejects (proves the temp-moderator path is the
    only authorized outcome)

---

## Risks of this plan

- The Phase 1 fix is a **breaking change** for the demo flow in the sense
  that if a real `employee@jpay.local` user was ever bound by the UI, the
  bind will now throw. Mitigation: no production data has bound real
  employees via demo (verified — the only `jpay.local` emails in
  `DEMO_PERSONAS` are the 5 personas, all of which have `isAnonymous: true`
  after the demo seeder runs). However, any `users` row that exists
  outside the demo seeder with an `@jpay.local` email but is NOT
  `isAnonymous: true` will become unbound. Audit query: `users where
  email ends with @jpay.local and isAnonymous != true`.
- The Phase 2 master auth fix is a **breaking change** for any flow that
  uses master auth to impersonate. There is no production usage (the
  comment in `auth.ts` says "break-glass moderator" but the implementation
  was universal impersonation). If the operator has been using master
  auth in this way, the fix is a behaviour change; surface this in the
  commit message.
- The Phase 3 punch pairing fix changes the meaning of "unpaired IN" from
  "the first IN in iteration order" to "the latest IN before this OUT".
  The prior behaviour was incorrect (a 9h shift on a 4h day); the new
  behaviour matches normal usage. No production payroll should exist yet
  that depends on the old behaviour.
- The Phase 4 Next.js patch is a dependency bump. Run the full gate
  (typecheck + build + tests) before committing; if 16.3.3 has API
  changes that break the build, pin to the exact 16.3.3 release
  (`"16.3.3"` not `"^16.3.3"`) and re-evaluate.

---

## Evidence to capture

- `docs/.scratch-audit/audit/SECURITY-v2.md` — re-run security audit after
  fix lands; expected: 0 CRITICAL, 0 HIGH for F1–F17.
- `docs/.scratch-audit/audit/TRACEABILITY-v2.md` — each finding → patch →
  test mapping.
- Updated `docs/.scratch-audit/debrief-v2.md` — replaces the prior
  (superseded) debrief with the new status.
- `j-pay.md` §11 Open Questions — flag F13/F14/F18/F19/F20 as
  product/architectural decisions still required.

---

## Commit plan (scoped conventional commits)

1. `fix(convex): enforce demo-only persona boundary in bind/switch/log paths`
2. `fix(convex): lock demo mutations to bound persona (resolve/recompute/export)`
3. `fix(convex): master auth creates dedicated temp moderator, never impersonates`
4. `fix(convex): recordPunch pairing — use latest-in-before-out, not set membership`
5. `chore(deps): bump next to 16.3.3 for upstream critical security patches`
6. `feat(app): add /privacy stub route to satisfy consent link`
7. `fix(app): demo recompute uses shift.userId, not s._id cast`
8. `test(j-pay): demo boundary, punch pairing, master auth tests (with break-it checks)`

Each commit is independently revertable. No drive-by refactors. The audit
scratch dir is gitignored before the first artifact write per the
surgical-implementation skill's gitignore pitfall.
