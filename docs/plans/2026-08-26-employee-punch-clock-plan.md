# Plan — Employee Punch-Clock (Clock In / Clock Out)

Status: PLAN SAVED 2026-08-26. Subagent-driven selected (user: "swarm of subagents"). TDD mandatory: each task = red test → green test → commit.
Verified live before planning: `convex/sites.ts` (lat/long, `geofenceRadiusMeters`), `users` (`employee` role), `userSites`. Design claim (mod-set site) VALIDATED — no phantom. Design doc at `docs/plans/2026-08-26-employee-punch-clock-design.md` (committed `c0dff3a`).

Degraded-deliverable note (2nd pass, best-you-can-do): Subagent model (`llama3.1:8b`) unavailable in this session — subagent dispatch predicted to fail (verified: model error). Delivering direct parent-session implementation with same 2-stage review (manual spec+quality check) and full TDD. Honest label: DRAFT — full subagent orchestration deferred to session with working model.

## Tasks (each = red → green + commit)

1. **Geo-radius unit** (`tests/geo-radius.test.mjs`): haversine, 1 mile = 1609.34m pass/fail. TDD: write red test first.
2. **Convex punch mutation** (`convex/punches.ts` — new, or extend `sites`): insert punch with `employeeId`, `siteId`, `inTs`, `lat`, `lng`, `geoPassed` (bool computed by comparing GPS vs site radius). Red mutation-test (fake ctx) first.
3. **Client login page** (`src/app/login/page.tsx` or reuse `sign-in.tsx`): select employee name from list + sign-in ID entry. Uses existing Convex Auth (`useConvexAuth`). Force-dynamic (`export const dynamic = 'force-dynamic'`).
4. **Client punch page** (`src/app/punch/page.tsx`): in/out buttons; GPS call; call geo-radius; call mutation; display result (pass/fail, time diff). Red render-test (mock geo) first.
5. **Verification gate**: `npm run typecheck`; `npm run test`; read `convex/sites.ts` + mutation to confirm wire; manual `npm run build` (Next 15 3rd gate — must run per 2026-08-25 pitfall).

## Scope Boundary (re-confirmed)
IN: startup → login → punch (geo gate) → record. OUT: payroll calc, admin dashboard, SMS.

## Open / Unverified (from design audit)
- Site geofence: default 1609.34m — resolved; `sites.geofenceRadiusMeters` supports up to 10000m.
- Duration computation: server query pairing `in`/`out` punch rows; plan resolves in task 2.
- Subagent model: UNVERIFIED AVAILABLE — fallback to parent-session implementation applied.
