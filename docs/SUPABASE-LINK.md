# Supabase link (2026-10-28)

J-Pay now talks to the Supabase project **J-pay** (`dlwlbvhyrvyftpjruqdq`,
`eu-west-1`) alongside Convex. Convex remains the live data + auth backend;
Supabase is wired as a first-class, verified connection so features can be
moved over one at a time.

## Where the values live

`.env.local` (git-ignored, loaded by Next.js):

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | project base URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | publishable (`sb_publishable_…`) key, RLS-bound |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | legacy `service_role` JWT, **bypasses RLS** |

> Next.js only loads `.env*` files, so a bare `env.local` is ignored. The
> values were consolidated into `.env.local`.

## Code

```
src/lib/supabase/
  env.ts      resolve + validate the public env, redacted descriptor
  client.ts   getSupabaseBrowserClient()  — memoised browser singleton
  server.ts   createSupabaseServerClient() — cookie-bound (RLS as the user)
              createSupabaseAnonClient()   — no session, public reads
  admin.ts    createSupabaseAdminClient()  — service role, server-only
src/app/api/health/supabase/route.ts       — live connectivity proof
```

Rules that matter:

- `server.ts` and `admin.ts` import `server-only`, so a client component that
  imports them fails the build instead of leaking the service key.
- `env.ts` reads `process.env.NEXT_PUBLIC_*` as static member expressions —
  that is what Next inlines into the bundle.
- `cookies()` is async in Next 16; `createSupabaseServerClient()` is therefore
  `await`ed.

## Verify the link

```bash
curl -s localhost:3000/api/health/supabase | jq
```

Healthy response:

```json
{
  "linked": true,
  "env": { "configured": true, "ref": "dlwlbvhyrvyftpjruqdq", "keyKind": "publishable" },
  "probes": {
    "publishable": { "ok": true, "latencyMs": 120, "detail": "storage reachable, 0 bucket(s)" },
    "serviceRole": { "ok": true, "latencyMs": 180, "detail": "auth reachable, 0 user(s) sampled" }
  }
}
```

## State of the database

The project is **empty**: `auth.users` = 0, no tables in `public`. Nothing has
been migrated yet. Next steps, in order:

1. Author `supabase/migrations/0001_init.sql` mirroring `convex/schema.ts`
   (uuid PKs, `timestamptz` for the numeric timestamps, enum checks matching
   the Convex literals) with **RLS enabled and default-deny** on every table.
2. Add per-role policies (`moderator` vs `employee`) via a `public.users`
   mirror of `auth.users` + a `role` claim helper function.
3. Move reads, then writes, then auth. Convex stays authoritative until each
   slice is cut over.
