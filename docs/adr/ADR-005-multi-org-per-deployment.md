# ADR-005: Multi-Org Support per Deployment (Amending ADR-002)

**Date:** 2026-11-12
**Status:** Accepted (amends [ADR-002](ADR-002-client-fork-model.md))

## Context

ADR-002 established a one-fork-per-client (`jpay-<client>`), single-org-per-deployment
model so that tenant isolation was structural. In practice, a single J-Pay deployment
(for example, a shared agency or holding-company stack) may need to host multiple
organisations (`orgs`) within the same Supabase project while still guaranteeing that
one organisation can never read or mutate another organisation's sites, shifts,
employees, or audit records.

## Decision

A single deployment **may host multiple organisations**, with **application-level
organisation isolation enforced server-side**:

- **Membership table (`orgUsers`):** every user's access to an organisation is
  explicitly recorded in `orgUsers` (with role and active status).
- **Fail-closed `orgId` checks:** all org-scoped queries and mutations resolve and
  validate the caller's `orgId` server-side inside `src/lib/backend/runtime.ts` and
  `convex/*.ts` handlers, rejecting requests that omit or mismatch `orgId`.
- **`orgBoundaryOk`:** cross-entity operations (e.g. assigning an employee to a site,
  reading shifts or time entries) must pass `orgBoundaryOk` so that every referenced
  record belongs to the same `orgId`.
- **Single-org forks remain valid:** dedicated per-client deployments (`jpay-<client>`)
  continue to work unchanged as a single-org instance of the same codebase.

## Consequences

- Multi-org deployments no longer require separate Supabase projects per organisation.
- Tenant isolation relies on server-side enforcement (`orgUsers`, fail-closed `orgId`
  checks, `orgBoundaryOk`) rather than separate databases; every new org-scoped handler
  must enforce these checks.
- Amends ADR-002 without breaking existing single-org deployments.
