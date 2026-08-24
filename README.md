# J-Pay — Payroll & Geolocation Logger PWA

Field-workforce time tracking: employees check in with GPS-verified, server-stamped
timestamps; moderators audit locations live, provision employee accounts with one-time
ID codes, manage site geofences, and derive shifts for payroll. Built on Next.js 15 +
Convex + Convex Auth (password provider — no third-party auth vendor) + Serwist.

The TRD (`j-pay.md`, **v1.2.1**) is the contract; its §6 schema is the source of truth.

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
then CHECK IN.

## Fork model — one client per deployment (`jpay-<client>`)

Each client company gets an isolated fork + Convex deployment:

1. Fork/copy this repo → `jpay-<client>`. Update `name` in `package.json` and `manifest.webmanifest`.
2. Create a NEW Convex project during that fork's `npx convex dev` (never share deployments).
3. Set env vars (DEVICE_TOKEN_SECRET, BOOTSTRAP_KEY, JWT keys) per deployment.
4. Bootstrap that company's moderator, create their sites, provision their employees.
5. Deploy frontend to Vercel (`vercel`), env `NEXT_PUBLIC_CONVEX_URL` = the fork's Convex URL.

## Gates

```bash
python3 scripts/check_consistency.py   # TRD internal consistency
python3 scripts/check_diagrams.py      # mermaid structural gate
npm run typecheck                      # tsc --strict over app + convex
```

## Known preview limitations (polish phase pending)

- Shift derivation rules 4/5/9 are conservative approximations (default-lunch deduction,
  UTC day attribution).
- Moderator payroll calculator / CSV export / messaging not yet built.
- Deactivation blocks new sign-ins; existing sessions expire within the JWT window.
- Consent acceptance stored locally only.
