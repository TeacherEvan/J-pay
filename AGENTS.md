# AGENTS.md — J-Pay Workspace

## What this folder is
The J-Pay application workspace (owner directive 2026-08-24): the TRD (`j-pay.md`), its reviews/ADRs/plans, AND the live Next.js 16 + Supabase-backed application all live here. The `convex/*.ts` files are business-logic modules executed in Node by `src/lib/backend/runtime.ts` — there is no Convex deployment (see `docs/adr/ADR-004-supabase-authoritative-backend.md`). The `TeacherEvan/J-pay-webb_logger` name is historical — do NOT create, clone, or reference sibling directories.

## Hard rules for any agent working here
1. **Scope:** touch ONLY files under this directory. Never enumerate, read, or write any sibling directory or other repo — no exceptions without a fresh, explicit owner instruction in-session.
2. **Schema truth:** the TypeScript block in `j-pay.md` §6 is the shape contract. When you edit it, keep it in sync with `supabase/migrations/` and `INDEX_FIELDS` in `src/lib/backend/db.ts`, and keep the ERD (§10.2) valid. `scripts/test-schema-parity.mjs` (in `npm test`) enforces parity across all three.
3. **Conflict rule:** where feature text and schema disagree, schema wins — flag the discrepancy in §11 Open Questions (TRD §1.1).
4. **Auth:** Supabase Auth (email + password). Convex Auth (removed 2026-08-23) and Clerk (removed earlier) must not return. The only server-side door to data is `POST /api/backend/call` (service role; RLS default-deny). Internal (`internal*`) handlers must never be browser-callable — `scripts/test-invoke-gate.mjs` guards this.
5. **Facts carry sources:** limits/version claims must cite source + check date, or be marked ⚠ UNVERIFIED.
6. **Secrets:** never write real deploy keys/VAPID keys/Clerk keys into docs. Placeholder names only.
7. **Gates before commit:** run `python3 scripts/check_consistency.py` AND `python3 scripts/check_diagrams.py`; both must pass.
8. **Commits:** scoped conventional commits (`docs(j-pay): ...`). No push without explicit ask.
9. **Migrations:** never `supabase db push`, never apply `supabase/migrations/archive/`, never re-apply an already-applied file. A migration may be applied only by the owner (SQL editor) or by an agent acting on a **fresh, explicit owner instruction in that session** — then via the Supabase MCP `apply_migration` (records it in the remote history under the local file name), one file at a time, with the file's own pre-flight guards left intact. **After an MCP apply, fix the recorded version** to the local numeric prefix (`update supabase_migrations.schema_migrations set version='00NN', name='00NN_name' where name='00NN_name'`) or the Supabase Preview check goes red on drift. Production history: `docs/ops/2026-11-12-live-hardening.md`.

## Convex generated types
`convex/_generated/` is historical — committed so `tsc` passes without codegen; it is not regenerated (no Convex deployment exists) and must not be hand-edited. Fresh clones run `npm install && npx tsc --noEmit` directly.

## Local-run pitfalls (hard-won)
- NEVER run `npx next build` while `npm run dev` is live — build wipes `.next` and the dev server starts throwing ENOENT on routes-manifest.json.
- When touching anything under `convex/` or `src/lib/backend/`, finish every task with `npm test` (the invoke gate, db adapter, and parity tests all live there) plus `npx tsc --noEmit` — there is no Convex checker or deployment to catch mistakes.
- This shell strips double quotes during `source file.sh` — never `source` generated secret files; extract values with sed instead.
- After ANY `npx next build`, `rm -rf .next` before restarting `next dev` — a dev server started over production output serves 404 chunks forever.
- `kill`ing the npm wrapper orphans `next-server` — pkill by name, and never run two dev servers against one checkout.
- `npm run dev` (via `scripts/dev-strict.mjs`) **refuses to start** if port 3000 is occupied — it will NOT silently drift to 3001. Stop the other process or run `PORT=3001 npm run dev` and open that URL explicitly.

## Key commands
```bash
# Development (guards port 3000)
npm run dev

# Local verification gate (mandatory before merge — no CI runs)
npm run verify           # TRD checks + mermaid gate + function-refs check + npm test + tsc --noEmit

# Test-only gate (subset of verify)
npm test                 # All test suites (invoked via scripts/run-gate.mjs)

# Typecheck only
npm run typecheck        # tsc --noEmit (strict)

# Production build (uses webpack, not Turbopack — @serwist/next requirement)
npm run build            # next build --webpack

# E2E walkthrough (requires dev server + headless Chrome CDP :9300)
JPAY_EMAIL=... JPAY_PASSWORD=... npm run e2e

# Create first moderator (one-time, uses service role key)
node --env-file=.env.local scripts/create-moderator.mjs --email you@example.com --name "Your Name"
```

## Architecture notes (non-obvious)
- **Supabase is the backend**, not Convex. `convex/*.ts` = plain TypeScript modules executed by `src/lib/backend/runtime.ts` via a Supabase-admin-client PostgREST adapter (`src/lib/backend/db.ts`).
- **Deny-by-default function exposure:** `invoke()` in `runtime.ts` only allows `isPublic === true` functions to be called from the browser. Internal handlers are blocked by `scripts/test-invoke-gate.mjs`.
- **Row-scoped authorization** happens in `runtime.ts` overrides and in `convex/*.ts` handlers — RLS stays default-deny with zero policies.
- **Schema parity is a 4-way gate:** TRD §6 ↔ `convex/schema.ts` ↔ union of all migrations ↔ `INDEX_FIELDS` ↔ `jpay_id_registry` view. `scripts/test-schema-parity.mjs` enforces this.
- **Migration order for forks:** `0001` → `0002` → `0004` → `0005` → `0006` → `0007` → `0009` → `0010` → `0011` → `0012` → `0013` → `0014` → `0015` → `0016` → `0017` → `0018`. Never apply `archive/` files. `0014` closes an unauthenticated read on `jpay_id_registry` — do not skip.
- **Webpack, not Turbopack:** `@serwist/next 10.0.0-preview.14` requires webpack for SW bundling. Both `next build` and `next dev` are forced to `--webpack` via `package.json` and `scripts/dev-strict.mjs`. `turbopack: {}` in `next.config.ts` silences Next 16's default-Turbopack error.

## Verification commands
```bash
python3 scripts/check_consistency.py   # TRD internal consistency
python3 scripts/check_diagrams.py      # mermaid structural gate
npm run typecheck                      # tsc --strict over app + convex handlers
npm test                               # shift grammar, adapter, invoke gate, dedup, parity, CSV guard
JPAY_EMAIL=... JPAY_PASSWORD=... npm run e2e   # full browser walkthrough (dev server + headless Chrome CDP :9300 required)
```

## Environment setup
Copy `.env.example` → `.env.local` and fill in:
- `NEXT_PUBLIC_SUPABASE_URL` — e.g. `https://<project-ref>.supabase.co`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — browser-safe (RLS governed)
- `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` — server-only, bypasses RLS
- `DEVICE_TOKEN_SECRET` — `openssl rand -hex 32`
- `BOOTSTRAP_KEY` — one-time moderator bootstrap
- `CRON_SECRET` — only if enabling archived pg_cron retention jobs
- `VAPID_*` — optional, for push notifications
- `PAYROLL_DEFAULT_RATE`, `PAYROLL_CURRENCY`, `PAYROLL_STRATEGY` — required for payroll

## Fork model & multi-org deployments
One Supabase project per client (`jpay-<client>`), single-org per deployment:
1. Fork/copy repo → `jpay-<client>`. Update `name` in `package.json` and `manifest.webmanifest`.
2. Create NEW Supabase project. Apply migrations **one file at a time in SQL editor** in the order above.
3. Set env vars per deployment.
4. Create moderator with `scripts/create-moderator.mjs` (forced password change on first sign-in).
5. Deploy frontend to Vercel — pushing `main` deploys automatically. Run `npm run verify && npm run build` first.

## CI status
GitHub Actions lanes (`.github/workflows/e2e-nightly.yml`, `canary.yml`) are **disabled placeholders** — the account never received runners (billing lock). CI will never report on pushes. Local `npm run verify` is the only gate.

<!-- supabase-backend -->

This project uses [Supabase](https://supabase.com) (Postgres + Auth) as its backend — NOT a hosted Convex deployment. The `convex/*.ts` files are business logic executed by `src/lib/backend/runtime.ts`. Never describe Convex as the live backend, and never suggest `npx convex dev` or a Convex URL to the user.

<!-- supabase-backend-end -->

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->