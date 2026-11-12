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
of `convex/access.ts`, `convex/auth.ts`, `convex/logs.ts`,
`convex/punches.ts`, `package.json`, `package-lock.json`,
`src/app/**/page.tsx`) confirms at minimum the following trust-boundary
failures.

| # | Finding | Severity | Source-verified line |
|---|---|---|---|
| F9 | Master provider returns `existing._id` for any active user's email — universal impersonation | CRITICAL | `convex/auth.ts:60-68` |
| F10 | `issueMyDeviceToken` derives `userId` from `currentUserId()` with no role/active re-check; master impersonation therefore mints a device token | HIGH | (to verify line-by-line) |
| F11 | Multiple mutations (`messages.sendToModerators`, `messages.myInbox`, `users.getMyLocale`, `users.issueMyDeviceToken`) use `currentUserId` not `requireActiveUser` — deactivation does not kill session | MEDIUM | (to verify) |
| F12 | `recordPunch` punch-pairing: `outPunchIds.has(p._id)` is structurally `false` for any `in` punch (different documents), so the "is this in already paired?" check is always `true` — the first in wins, not the latest unpaired | HIGH | `convex/punches.ts:51-64` |
| F13 | Geofence is computed (`isWithinGeofence`) but never enforced for the primary check-in path | HIGH | `convex/logs.ts:186-188`, `:219` (computed, not gated) |
| F14 | `skewCorrectedTime` falls back to `_creationTime` when `|skew|>30000` — contradicts documented "client chronology preserved" invariant | HIGH | `src/lib/shift-engine.ts:27-30` |
| F15 | Next.js pinned to 16.3.2 in lockfile; 16.3.3 contains critical security patches per upstream | CRITICAL (dep) | `package.json:22`, `package-lock.json` |
| F16 | Privacy page promised in UI but does not exist (`/privacy` route missing) | MEDIUM | `src/app/` listing |
| F18 | `/punch` is a second attendance system disconnected from the `logs→shifts→payroll` pipeline | HIGH (architectural) | schema `punches` table + `convex/punches.ts` + `src/app/punch/` |

F18 is called out but explicitly deferred — the plan to retire `/punch`
requires product input, not a code-only fix.

---

## Approach

**Phase 1 — Make master auth boring (F9, F10).** The master provider must
NEVER return an existing user's id. Replace:
- `if (existing) { if (active) return { userId: existing._id } }`
  with: ALWAYS create a dedicated `isMasterTemp = true` moderator (already
  implemented in `createMasterTempUser`); return that. The email is recorded
  for audit; it is never the authenticated identity.
- Also: `issueMyDeviceToken` must require `requireActiveUser` (not
  `currentUserId`) so deactivation terminates device minting; and the
  master temp user must NOT be eligible to issue device tokens (gate by
  `isMasterTemp !== true`).

**Phase 2 — Fix the punch pairing (F12).** The current implementation is
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

**Phase 3 — Patch Next.js 16.3.3 (F15).** Edit `package.json` to `"next":
"^16.3.3"`, regenerate `package-lock.json` via `npm install`, run
`npm run typecheck` and `npm run build` to confirm the lockfile resolves
cleanly and the build still passes.

**Phase 4 — Add the privacy route (F16).** Author `src/app/privacy/page.tsx`
with a minimal stub (placeholder copy marked DRAFT, not legal advice) so
the link doesn't 404. Mark as known-pending-legal-copy in a comment so the
real document replaces it before launch.

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

---

## Acceptance criteria

For each finding F9–F16, the implementation must be backed by a test that
constructs the malicious input and asserts the access denial. No
"implementation looks like it denies" tests; the test must execute the
mutation/action with the bad input and observe the throw. The break-it
check from the surgical-implementation skill (temporarily stub the throw
and re-run) applies to every new test.

Tests to add:
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

- The Phase 1 master auth fix is a **breaking change** for any flow that
  uses master auth to impersonate. There is no production usage (the
  comment in `auth.ts` says "break-glass moderator" but the implementation
  was universal impersonation). If the operator has been using master
  auth in this way, the fix is a behaviour change; surface this in the
  commit message.
- The Phase 2 punch pairing fix changes the meaning of "unpaired IN" from
  "the first IN in iteration order" to "the latest IN before this OUT".
  The prior behaviour was incorrect (a 9h shift on a 4h day); the new
  behaviour matches normal usage. No production payroll should exist yet
  that depends on the old behaviour.
- The Phase 3 Next.js patch is a dependency bump. Run the full gate
  (typecheck + build + tests) before committing; if 16.3.3 has API
  changes that break the build, pin to the exact 16.3.3 release
  (`"16.3.3"` not `"^16.3.3"`) and re-evaluate.

---

## Evidence to capture

- `docs/.scratch-audit/audit/SECURITY-v2.md` — re-run security audit after
  fix lands; expected: 0 CRITICAL, 0 HIGH for F9–F16.
- `docs/.scratch-audit/audit/TRACEABILITY-v2.md` — each finding → patch →
  test mapping.
- Updated `docs/.scratch-audit/debrief-v2.md` — replaces the prior
  (superseded) debrief with the new status.
- `j-pay.md` §11 Open Questions — flag F13/F14/F18/F19/F20 as
  product/architectural decisions still required.

---

## Commit plan (scoped conventional commits)

1. `fix(convex): master auth creates dedicated temp moderator, never impersonates`
2. `fix(convex): recordPunch pairing — use latest-in-before-out, not set membership`
3. `chore(deps): bump next to 16.3.3 for upstream critical security patches`
4. `feat(app): add /privacy stub route to satisfy consent link`
5. `test(j-pay): punch pairing, master auth tests (with break-it checks)`

Each commit is independently revertable. No drive-by refactors. The audit
scratch dir is gitignored before the first artifact write per the
surgical-implementation skill's gitignore pitfall.
