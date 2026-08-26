# Design — Employee Punch-Clock (Clock In / Clock Out)

Status: DESIGN APPROVED 2026-08-26 (Phase 1 gate passed — not implemented)
Scope (confirmed): IN — startup/loading → employee login (select name + sign-in ID from mod) → clock-in/out (GPS 1-mile radius of mod-set site, e.g. "123 Location District") → punch record (time + geo result + duration). OUT — payroll, admin dashboard, SMS notifications, mobile-only, localStorage-only.
Stack: Next.js 16 + Convex (`@convex-dev/auth` kept, Clerk not reintroduced per AGENTS.md).

## Architecture
- Convex tables: `sites` (mod-set address + lat/lng), `employees` (name, signInId), `punches` (employeeId, type: in|out, ts, lat, lng, passedGeo: bool, siteId, durationSec computed on read).
- Pages: `/login` (pick employee + sign-in ID), `/punch` (in/out buttons + geo gate).
- Geo gate: client GPS → haversine vs site lat/lng; must be ≤ 1 mile (1609.34m). Clock fails outside radius.
- Auth: Convex Auth unchanged; employee identity from selection, not Clerk.

## Components / Data Flow
1. Mod assigns site (`sites`) + creates Pete (`employees` with signInId).
2. Pete: `/login` → selects name from list + enters sign-in ID → redirect `/punch`.
3. `/punch`: reads current site; GPS captured on click; haversine computed; mutation writes `punches`; out-computes duration from paired in record.
4. Error path: outside 1-mile radius → mutation rejected / UI shows failure; no punch written.

## Testing (TDD)
- Unit: haversine geo-radius (fail at >1 mile, pass at ≤1 mile).
- Convex mutation: `punches` insert with geo result; reject if `passedGeo: false` (or gate before mutation — decided at plan time).
- No code until Phase 2 plan saved.

## Open / Unverified
- Site lat/lng source: mod-entered address geocoded server-side? ⚠ Client-side geocoding of "123 Location District" is unverified — plan must resolve.
- Duration computation: server-side Convex query vs client read-time; plan resolves.
