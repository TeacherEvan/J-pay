# J-Pay — Payroll & Geolocation Logger PWA

Field-workforce time tracking: employees check in with GPS-verified, server-stamped
timestamps; moderators audit locations live, provision employee accounts with one-time
ID codes, manage site geofences, and derive shifts for payroll. Built on Next.js 15 +
Convex + Convex Auth (password provider — no third-party auth vendor) + Serwist.

The TRD (`j-pay.md`, **v1.3.0**) is the contract; its §6 schema is the source of truth. Docs index: [`docs/index.md`](docs/index.md).

## Quick start (local)

```bash
npm install
npx convex dev        # login, create a project; regenerates convex/_generated
npx convex env set DEVICE_TOKEN_SECRET "$(openssl rand -hex 32)"
# dashboard → env vars: JWT_PRIVATE_KEY / JWKS via `node generateKeys.mjs` pattern (see .env.example)
npm run dev           # http://localhost:3000
```

Bootstrap the first moderator (one-time):

```bash
npx convex env set BOOTSTRAP_KEY "<random>"
npx convex run users:bootstrapFirstModerator '{"key":"<random>","email":"you@example.com"}'
```

Sign in as moderator at `/moderator` → create sites, provision employees (one-time
`JP-XXXXXXXXXX` ID code), assign employee↔site. Employees sign in with email + ID code,
then CHECK IN. When `DEMO_MODE=1` is set on the Convex deployment, the login screen also
offers **"Enter demo preview"** — a throwaway anonymous employee session with demo sites
(purged after 7 days); real sign-in is unaffected.

> **Port note:** `npm run dev` guards its port — if :3000 is already taken by another
> app (e.g. a sibling project), J-pay **refuses to start** instead of silently drifting
> to :3001 and serving the wrong app at the canonical URL. Stop the other process, or
> run `PORT=3001 npm run dev` and open that URL explicitly.

## Fork model — one client per deployment (`jpay-<client>`)

Each client company gets an isolated fork + Convex deployment:

1. Fork/copy this repo → `jpay-<client>`. Update `name` in `package.json` and `manifest.webmanifest`.
2. Create a NEW Convex project during that fork's `npx convex dev` (never share deployments).
3. Set env vars (DEVICE_TOKEN_SECRET, BOOTSTRAP_KEY, JWT keys) per deployment.
4. Bootstrap that company's moderator, create their sites, provision their employees.
5. Deploy frontend to Vercel (`vercel`), env `NEXT_PUBLIC_CONVEX_URL` = the fork's Convex URL.

## Gates

```bash
npm test                               # shift-engine grammar (§6.1 rules 1–9) + CSV guard
python3 scripts/check_consistency.py   # TRD internal consistency
python3 scripts/check_diagrams.py      # mermaid structural gate
npm run typecheck                      # tsc --strict over app + convex
```

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
- Backend: §6 schema verbatim, row-scoped authz everywhere, HMAC device tokens,
  idempotency dedupe, impossible-travel flag, daily coordinate-purge cron.

## Known preview limitations (polish phase pending)

- Shift rule 5 day-attribution uses the employee's first assigned site timezone;
  multi-site DST edge cases untested.
- Payroll rates: per-user override or `PAYROLL_DEFAULT_RATE` env; no overtime
  multipliers (Open Question 8).
- Push requires VAPID env vars; silently disabled without them.
- Deactivation blocks new sign-ins; existing sessions expire within the JWT window.
- Consent acceptance stored locally only.
