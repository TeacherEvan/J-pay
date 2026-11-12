# Supabase cutover — Supabase is the backend now

_Status: live in production on 2026-10-28. Convex is rate-limited and no longer
serves the app._

```
Browser (src/app/**)
  │  useQuery / useMutation / useAction / useAuthActions   ← src/lib/backend/react.ts
  ▼
POST /api/backend/call  { ref: "users:me", args }         ← src/app/api/backend/call/route.ts
  │  1. verify the Supabase access token (Bearer or cookie)
  │  2. load public.users, refuse inactive accounts
  │  3. dispatch to the Convex-shaped handler
  ▼
src/lib/backend/runtime.ts
  │  ctx.db   → src/lib/backend/db.ts → PostgREST (service role)
  │  ctx.auth → the verified identity  ctx.scheduler → inline execution
  ▼
convex/*.ts    ← unchanged business logic (payroll, shifts, geo, audit…)
  ▼
Supabase Postgres (public.*, RLS on, zero policies) + Supabase Auth (email + password)
```

## Why this shape

`convex/` holds ~2 500 lines of business logic — shift derivation, BCEA/FLSA
payroll, geofencing, audit, message retention. Rewriting all of it in one move
would have been a multi-day risk with a live app on the line. So the *execution
context* was replaced instead of the logic:

- `src/lib/backend/db.ts` re-implements the slice of Convex's `ctx.db` the code
  actually uses (`query`/`withIndex`/`filter`/`order`/`take`/`first`/`collect`,
  `get`/`insert`/`patch`/`replace`/`delete`) over PostgREST.
- `src/lib/backend/runtime.ts` supplies `ctx.auth`, `ctx.scheduler` and
  `ctx.runQuery`/`runMutation`, enforces the public/internal split, and replaces
  the five account functions that touched Convex Auth with Supabase Auth
  equivalents (`createAccount`, `modifyAccountCredentials`, `retrieveAccount`).
- `convex/access.ts` reads identity through `getAuthUserId` instead of
  `auth.getUserId` — the same lookup, without dragging the convexAuth provider
  graph (and its JWT env) into every import chain.

One behavioural note: `ctx.scheduler.runAfter(0, …)` runs **inline** rather than
after the mutation returns. Postgres does not wrap these handlers in a
transaction, so finishing derived work (`shifts.deriveForUser`) before responding
keeps reads consistent.

## Schema

`supabase/migrations/0001_init.sql` mirrors `convex/schema.ts`:

- `_id uuid` + `_creationTime bigint` (milliseconds), so the Convex code keeps working.
- Column names stay camelCase (quoted) — the adapter maps nothing, so there is
  no second name space to drift.
- `users._id` references `auth.users(id)`; Convex's `authAccounts` /
  `authSessions` tables are gone — Supabase Auth owns credentials.
- `public.jpay_id_registry` is a view used to resolve a uuid to its table, since
  `ctx.db.get(id)` gets no table hint unlike Convex's typed ids.

## Security model

| Layer | Control |
| --- | --- |
| Browser key | publishable key only; RLS on every table with **zero policies** plus `revoke all from anon, authenticated` → it can read nothing |
| API route | verifies the Supabase access token, refuses users with no active `public.users` row |
| Dispatch | `internalQuery` / `internalMutation` / `internalAction` are refused unless the call comes from another backend function (`fromServer`) |
| Server key | `SUPABASE_SERVICE_ROLE_KEY`, `server-only` module, never in a client bundle |

Role checks (`requireModerator`, `requireEmployee`) are the
original Convex code and still run inside each handler.

## Accounts

- **Bootstrap the first moderator:** `node --env-file=.env.local scripts/create-moderator.mjs --email <email> --name "Name"` (the old `bootstrap-supabase.mjs` was retired 2026-11-11 — see `scripts/archive/bootstrap-supabase.RETIRED.mjs`).
  — prints the ID code once. The app forces a password change on first sign-in.
- **Employees / moderators** are provisioned in-app by a moderator; the ID code
  is the initial password (same contract as before).
- **Break-glass:** `MASTER_PASSWORD` enables the `master` sign-in path;
  `BOOTSTRAP_KEY` gates `provisionModerator` / `resetPasswordBreakGlass`.

## Verify

```bash
node scripts/smoke-supabase.mjs <moderator-email> <id-code>                 # local
node scripts/smoke-supabase.mjs <moderator-email> <id-code> https://j-pay.vercel.app
```

Fifteen checks: moderator session → provision employee → create/assign site →
device token → punch → check-in log → history → KPI → messaging → payroll calc
→ CSV export. It writes real rows; clean up with

```sql
delete from public.users where "email" like 'qa.employee.%@jpay.local';
delete from public.sites where "name" like 'QA Site %';
```

`GET /api/health/supabase` still reports link status and probes both keys.

## Rollback

`convex/` is untouched apart from `convex/access.ts`. The previous build is one
redeploy away (`NEXT_PUBLIC_CONVEX_URL` is still set). `convex/schema.ts` remains
the schema contract — keep `supabase/migrations` in sync when it changes.

## Known gaps

- No rate limiting on `/api/backend/call` (Convex shipped it built in).
- Queries load whole tables and filter in JS; push predicates into SQL when
  `logs` grows into six figures.
- Realtime subscriptions were not ported — the client refetches after mutations.
- `convex/auth.ts`, `convex/http.ts`, `convex/crons.ts` are now dead code.
