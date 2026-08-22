# ADR-001: Client-Direct Convex Access with Convex Auth (Clerk Removed)

**Date:** 2026-08-23
**Status:** Accepted (owner decision D4, 2026-08-23)
**Inputs:** REVIEW-v1.1 finding B1; owner decision D4 (remove Clerk → Convex Auth)

## Context

TRD v1.1 routed all Convex traffic through Next.js route handlers / server components,
gated by a `CLERK_ISSUER` check, with Clerk as the auth vendor bridging JWTs into Convex.
Review finding B1 showed this contradicts the product's core requirement: the moderator
audit views depend on Convex *reactive queries*, which cannot be proxied through route
handlers without losing their realtime character. In parallel, the owner decided to
remove Clerk entirely and adopt Convex Auth with the password provider.

## Decision

1. Clients connect **directly to Convex** via `ConvexReactClient` using the public
   `NEXT_PUBLIC_CONVEX_URL`.
2. Authentication is **Convex Auth** (`@convex-dev/auth`, password provider);
   sessions resolve via `ctx.auth`; roles (`moderator` | `employee`) live on the
   `users` row and are enforced server-side in every function.
3. Vercel route handlers are retained only for secret-free server conveniences:
   CSV export assembly and edge rate-limiting. Device-token issuance moves INTO
   Convex (single HMAC secret surface).
4. Data isolation relies on row-scoped authz inside every Convex function (§7 R4),
   never on URL concealment.

## Consequences

- One fewer vendor; no JWT bridging configuration between Clerk and Convex.
- Auth lives entirely inside the Convex backend (`auth.config.ts`, `users` table,
  password provider). The `CLERK_ISSUER` check is obsolete — replaced by Convex
  Auth's own session validation.
- Reactive moderator queries work as designed: direct subscriptions, realtime rows.
- Route handlers shrink to CSV/export work; no secrets are exposed client-side
  because authorization is enforced per-row inside Convex, not at a proxy.
- Moderator provisioning becomes an invite-only internal mutation; no self-signup
  route ships.
