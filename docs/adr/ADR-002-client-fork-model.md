# ADR-002: One Fork Per Client (`jpay-<client>`), Single Org per Deployment

**Date:** 2026-08-24
**Status:** Accepted (owner directive)

## Context

J-Pay serves multiple client companies (field-workforce payroll). Multi-tenancy
was TRD Open Question territory (former D1): shared tables with tenant keys vs.
isolated deployments. Employee GPS data and payroll records are high-sensitivity;
cross-tenant leakage is the worst-case failure.

## Decision

Each client company gets a **fork of this repository deployed as its own stack**:

- one Convex deployment per fork (`jpay-<client>`), single org inside it;
- one Vercel project per fork pointing at that deployment via
  `NEXT_PUBLIC_CONVEX_URL`;
- secrets (device-token HMAC, VAPID, JWT signing) are per-deployment, never
  shared across clients;
- onboarding a new company = fork → new Convex project → bootstrap moderator →
  create sites → provision employees with one-time ID codes.

## Consequences

- Data isolation is structural (separate databases), not application logic —
  no tenant column can be forgotten in a query.
- Schema evolution must be replayed per fork; keep §6 copy-paste truth and apply
  migrations identically across forks.
- No cross-client analytics or shared user identities — accepted trade-off.
- Supersedes the multi-tenant branch of the former pre-flight decision D1.
