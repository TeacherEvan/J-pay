# J-Pay — Payroll & Geolocation Logger PWA

Field-workforce time tracking: employees check in with GPS-verified, server-stamped
timestamps; moderators audit locations live, provision employee accounts with one-time
ID codes, manage site geofences, and derive shifts for payroll. Built on Next.js 16 +
Supabase (Postgres + Auth — no third-party auth vendor) + a Node runtime that executes
the Convex-shaped handlers in `convex/*.ts` (see [ADR-004](docs/adr/ADR-004-supabase-authoritative-backend.md)) + Serwist.

The TRD (`j-pay.md`, **v1.6.0**) is the contract; its §6 schema is the source of truth. Docs index: [`docs/index.md`](docs/index.md).

**Verify locally** with `npm run verify` (TRD checks + mermaid gate + `npm test` + strict typecheck). The GitHub Actions lanes were retired 2026-11-10 — the account never received runners (billing lock); CI will never report on pushes.

## Quick start (local)

```bash
npm install
# .env.local — required (copy from the deployment or create a project):
#   NEXT_PUBLIC_SUPABASE_URL=...
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...        (or *_ANON_KEY)
#   SUPABASE_SERVICE_ROLE_KEY=...                   # server-only, RLS bypass
#   DEVICE_TOKEN_SECRET=$(openssl rand -hex 32)
npm run dev           # http://localhost:3000
```

The database schema lives in `supabase/migrations/`. `0001_init.sql` is the fresh-install
baseline; the rest apply incrementally. **Apply files ONE AT A TIME in the SQL editor.**
Never use `supabase db push` — migration names never matched applied history, and
`supabase/migrations/archive/` contains two files (`0003_retention_crons.OWNER_ONLY.sql`,
`0008_refresh_registry.DO_NOT_APPLY.sql`) that would break production if applied mechanically.
Do not re-apply `0001_init.sql` to production either. The Convex deployment is retired —
there is nothing to `npx convex dev` against.

Bootstrap the first moderator (one-time, uses the service-role key on this machine):

```bash
node --env-file=.env.local scripts/create-moderator.mjs --email you@example.com --name "Your Name"
```

The script prints a one-time password exactly once; the app forces a password change on
first sign-in. Sign in as moderator at `/moderator` → create sites, provision employees
(one-time `JP-XXXXXXXXXX` ID code), assign employee↔site. Employees sign in with email +
ID code, then CHECK IN. When `DEMO_MODE=1` in the deployment env, the login screen also
offers **"Enter demo preview"**.

> **Port note:** `npm run dev` guards its port — if :3000 is already taken by another
> app (e.g. a sibling project), J-pay **refuses to start** instead of silently drifting
> to :3001 and serving the wrong app at the canonical URL. Stop the other process, or
> run `PORT=3001 npm run dev` and open that URL explicitly.

## Fork model — one client per deployment (`jpay-<client>`)

Each client company gets an isolated fork + Supabase project:

1. Fork/copy this repo → `jpay-<client>`. Update `name` in `package.json` and `manifest.webmanifest`.
2. Create a NEW Supabase project (never share deployments). Apply `supabase/migrations/` **one file at a time in the SQL editor, in this order**: `0001_init.sql` → `0002` → `0004` → `0005` → `0006` → `0007` → `0009` → `0010` → `0011` → `0012` → `0013` → `0014`. Do **not** apply `archive/` and do **not** use `supabase db push` (see above) — and do not skip `0014`, which closes an unauthenticated read on `jpay_id_registry`.
3. Set env vars per deployment: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `DEVICE_TOKEN_SECRET`, `CRON_SECRET` (+ `SMOKE_TEST_KEY`, `BOOTSTRAP_KEY`,
   `MASTER_PASSWORD`, vapid keys if push is wanted).
4. Create that company's moderator with `scripts/create-moderator.mjs` (forced password change on first sign-in).
5. (Optional) Retention crons are archived — see `supabase/migrations/archive/0003_retention_crons.OWNER_ONLY.sql`. The app runs without them; they are only relevant if you need 7-day coordinate purging on this client's project, and only the owner may enable them (requires pg_cron + pg_net).
6. Deploy frontend to Vercel — pushing `main` deploys automatically. Do not push without running `npm run verify && npm run build` first. The same secrets go in the project's env settings (`CRON_SECRET`, `SMOKE_TEST_KEY`, `BOOTSTRAP_KEY`, `MASTER_PASSWORD`, VAPID keys if push is wanted; `DEMO_MODE` only if you want the demo preview on this fork).

## Gates

There is no hosted CI for this repo (GitHub Actions never allocated a runner — account
billing lock). The gate is local and mandatory before merge:

```bash
npm run verify                         # consistency + mermaid + gen-function-refs check + npm test + tsc --strict
npm run build                          # Next 16 production build (also proves the serwist override chain)
```

`npm test` alone is not sufficient — a green suite without a clean build has not
been verified. The two dormant workflow files under `.github/workflows/`
(`e2e-nightly.yml`, `canary.yml`) are intentionally disabled placeholders with
documented enable paths; they report on nothing today.

## Included features

- Employee: GPS check-in (±50m gate), 7 statuses + side-mission picker, offline
  outbox with foreground replay, one-way messages to moderators, push opt-in,
  consent gate, installable PWA.
- Moderator console (`/moderator`): site geofences with interactive OSM map picker,
  address autocomplete (Nominatim), GPS capture and Google-Maps verification link, employee provisioning with
  one-time ID codes, assignment management, deactivation, live audit log with
  skew/geofence/travel flags, needs-review queue (resolve/recompute), payroll
  by day with flagged-shift exclusion, hourly-rate override, CSV log export
  (formula-injection sanitized), direct reply + broadcast messaging.
- Backend: §6 shapes verbatim (schema-parity gate across `convex/schema.ts`,
  `supabase/migrations/`, and the adapter), row-scoped authz everywhere, HMAC device
  tokens, idempotency dedupe + unique index, impossible-travel flag, daily
  coordinate-purge via pg_cron → `/api/internal/cron`.

## Known preview limitations (polish phase pending)

- Shift rule 5 day-attribution uses the employee's first assigned site timezone;
  multi-site DST edge cases untested.
- Payroll rates: per-user override or `PAYROLL_DEFAULT_RATE` env; no overtime
  multipliers (Open Question 8).
- Push requires VAPID env vars; silently disabled without them.
- Deactivation blocks new sign-ins; existing sessions expire within the JWT window.
- Consent acceptance stored locally only.
