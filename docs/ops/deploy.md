# Deploying J-Pay (production)

**The only path is `git push` to `main`.** Vercel's Git integration builds
`main` on push and deploys to production automatically. There is no upload
path, no staged-secret copy, no "Convex first" leg — the backend is
Supabase/Postgres and the `convex/*.ts` files are business logic executed by
`src/lib/backend/runtime.ts`.

**Before any push — the deploy gate.** `package.json` builds with
`npm run verify && next build --webpack`, so Vercel fails the deploy if any
test stage fails. Run the same locally before pushing:

```bash
npm run verify   # tsc --noEmit + every offline suite
npm run build    # verify, then the production build
```

**Never push to `main` without explicit owner authorization** — pushing
deploys.

**After any push — post-deploy probe.** `GET /api/health/db` on the deployed
site must return `{ ok: true, tables: N }`. A `503` lists the missing table
names: the deploy is not good, and migrations may not have been applied. A
green probe is checked by a human, not assumed.

**Migrations are owner-applied, one file at a time, in the SQL editor.**
Never `supabase db push`. See
`docs/ops/2026-11-11-phase0-migration-runbook.md` and `README.md`.

**Retired tooling.**
`scripts/archive/deploy_prod.RETIRED.py` is archived (2026-11-11, audit F3 /
plan 2.1). It staged `.env*` into a git-less upload, ran against a dead
Convex leg, and hard-coded a master project. It must not be run; it is kept
only as history. The earlier claim ("agent-authored commits cannot trigger
Vercel deployments") no longer applies — Vercel Git deployments for this
project are configured to build on push; treat branch protection and owner
authorization as the gates, not upload tooling.
