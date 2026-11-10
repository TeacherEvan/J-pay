# ADR-004: Supabase Postgres + Supabase Auth as the Authoritative Backend

**Date:** 2026-10-28 (live) · documented 2026-11-10
**Status:** Accepted (supersedes ADR-001's Convex-Auth client-direct model; ADR-003's pure-engine decision unaffected and still enforced)

## Context

The original architecture (TRD v1.x) was Next.js + Convex BaaS: clients talked
directly to Convex (`ConvexReactClient`), Convex Auth (password provider) owned
identities, `convex/*.ts` held all business logic, and `convex/crons.ts` drove
retention. In late October 2026 the Convex deployment began rate-limiting the
app out of usable service (see `docs/SUPABASE-LINK.md` — "Convex is rate-limited
and no longer serves the app"). Rather than rewrite ~2,500 lines of payroll,
shift-grammar, geofence and audit logic in one move against a live app, the
execution context was replaced instead of the logic:

```
Browser (src/app/**)
  │  useQuery / useMutation / useAction   ← src/lib/backend/react.ts (custom hooks)
  ▼
POST /api/backend/call { ref: "users:me", args }   ← src/app/api/backend/call/route.ts
  │  verify Supabase access token (Bearer or cookie), load public.users,
  │  refuse inactive accounts
  ▼
src/lib/backend/runtime.ts
  │  ctx.db → src/lib/backend/db.ts → PostgREST (service role)
  │  ctx.auth → verified identity;  ctx.scheduler → inline + bounded retry
  ▼
convex/*.ts    ← unchanged business logic (payroll, shifts, geo, audit…)
  ▼
Supabase Postgres (RLS default-deny, no policies) + Supabase Auth
```

Verified incidents that forced hardening during the cutover (all fixed on `main`,
see `docs/audits/surgical-audit-2026-11-10.md`): the public/internal gate was
dead code and exposed 27 internal handlers to anonymous browsers (P0-1); the
retention tier was silently dead (no `pg_cron`, orphaned `convex/crons.ts` — P1-4);
`GET /api/backend/call` published the internal function inventory (P2-3).

## Decision

1. **Supabase Postgres is the system of record**; Convex deployments are retired
   for all forks and for production. Nothing in the runtime invokes Convex.
2. **Supabase Auth owns identities.** No Convex Auth, no Clerk, no anonymous
   providers. The only server-side door to data is `POST /api/backend/call`
   (service role; RLS stays default-deny with zero policies). All authorization
   re-checks (role, `isActive`, `archivedAt`) happen there and in the handlers.
3. **`convex/*.ts` remains the business-logic home** — but as plain Node module
   exports executed by `src/lib/backend/runtime.ts`, not as a deployed Convex app.
   The TRD §6 schema block remains the *shape* contract (`convex/schema.ts`), and
   `scripts/test-schema-parity.mjs` (npm test) enforces that the shapes exist in
   `convex/schema.ts`, `supabase/migrations/0001_init.sql`, and the adapter's
   `INDEX_FIELDS` (`src/lib/backend/db.ts`). The `jpay_id_registry` view exists
   so `ctx.db.get(id)` can route uuids across tables.
4. **Fork model** (ADR-002) becomes: fork → create a Supabase project → apply
   `supabase/migrations/0001..0003` → set `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `DEVICE_TOKEN_SECRET`, `CRON_SECRET` (+ `SMOKE_TEST_KEY`, `BOOTSTRAP_KEY`,
   vapid keys) → create the first moderator with
   `scripts/create-moderator.mjs` (forced password change on first sign-in) →
   deploy to Vercel. (Migration `0002` applies the `logs` idempotency unique
   index; `0003` schedules the retention jobs.)
5. **Retention is executed, not aspirational** — re-wired as `pg_cron` →
   `POST /api/internal/cron?job=<name>` (`src/app/api/internal/cron`, bearer
   `CRON_SECRET`) → the same internal handlers `convex/crons.ts` used to target.
6. **Browser-callable = explicitly public.** `invoke()` is deny-by-default
   (`isPublic === true` required); the 2026-11-10 registry census (120 functions,
   30 internal) is enforced by `scripts/test-invoke-gate.mjs` in `npm test`.

## Consequences

- No `npx convex dev`, no Convex deploy keys, no JWT-JWKS bootstrap for forks.
  (`CONVEX_DEPLOYMENT` in env files remains only as inert history.)
- One extra hop (Node route → PostgREST) replaces client-direct reactive queries;
  the app compensates with a custom client adapter (`src/lib/backend/react.ts`)
  with scoped invalidation — see its tests.
- Schema-parity drift is a *gate failure*, not a review nit. Any table/column
  change must land in the TRD §6 block, `convex/schema.ts`, the SQL migration,
  and `INDEX_FIELDS` together.
- Pure business logic stays pure (ADR-003 unaffected): `src/lib/shift-engine.ts`,
  payroll strategies and `src/lib/csv.ts` are framework-free and gate-tested.
- The `convex/_generated/` tree is historical (committed for the codegen-free
  typecheck); it is not regenerated and must not be hand-edited.
