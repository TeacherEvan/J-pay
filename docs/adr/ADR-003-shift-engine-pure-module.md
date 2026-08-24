# ADR-003: Shift Engine as Pure Module with Grammar Unit Tests

**Date:** 2026-08-24
**Status:** Accepted

## Context

The shift derivation grammar (TRD §6.1 rules 1–9) was implemented inline inside
a Convex `internalMutation`, untestable without a live deployment, and payroll
amounts depend on it. First attempt to test it surfaced four fixture errors and
one real defect class: equal skew-corrected ordering keys preserve insertion
order, so reversed log pairs closed as clean zero-minute shifts with no review
flag.

## Decision

1. Extract the entire grammar walk into `src/lib/shift-engine.ts` — pure
   TypeScript, no Convex imports. Inputs are plain log shapes; outputs are
   segment records.
2. `convex/shifts.ts` becomes a thin adapter: fetch logs → call
   `deriveSegments()` → replace cached `shifts` rows.
3. `scripts/test-shift-engine.mjs` runs 15 cases under `node:test`
   (stdlib — no new dependency) covering rules 1–9, staleness auto-close,
   DST day-attribution, tie-order behavior. `npm test` is a first-class gate
   alongside the doc gates and typecheck.
4. Defensive hardening adopted from testing: any close whose end precedes its
   start is flagged `reversed_times`; rule 9's excessive-duration branch is
   documented as reachable only via non-picker duration sources.

## Consequences

- Payroll math is regression-guarded before it ever reaches a paycheck.
- Future grammar changes get red/green treatment like any other repo change.
- The engine module must stay dependency-free; if it ever needs Convex types it
  has leaked its seam and should be split again.
