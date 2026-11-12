# AGENTS.md — J-Pay Workspace

## What this folder is
The J-Pay application workspace (owner directive 2026-08-24, superseding the
earlier docs-only split): the TRD (`j-pay.md`), its reviews/ADRs/plans, AND the
live Next.js + Supabase-backed application all live here. The `convex/*.ts` files are
business-logic modules executed in Node by `src/lib/backend/runtime.ts` — there is no
Convex deployment (see `docs/adr/ADR-004-supabase-authoritative-backend.md`). The `TeacherEvan/J-pay-webb_logger`
name is historical — do NOT create, clone, or reference sibling directories.

## Hard rules for any agent working here
1. **Scope:** touch ONLY files under this directory. Never enumerate, read, or
   write any sibling directory or other repo — no exceptions without a fresh,
   explicit owner instruction in-session.
2. **Schema truth:** the TypeScript block in `j-pay.md` §6 is the shape contract. When you
   edit it, keep it in sync with `supabase/migrations/` and `INDEX_FIELDS` in
   `src/lib/backend/db.ts`, and keep the ERD (§10.2) valid. `scripts/test-schema-parity.mjs`
   (in `npm test`) enforces parity across all three.
3. **Conflict rule:** where feature text and schema disagree, schema wins — flag the
   discrepancy in §11 Open Questions (TRD §1.1).
4. **Auth:** Supabase Auth (email + password). Convex Auth (removed 2026-08-23) and Clerk
   (removed earlier) must not return. The only server-side door to data is
   `POST /api/backend/call` (service role; RLS default-deny). Internal (`internal*`)
   handlers must never be browser-callable — `scripts/test-invoke-gate.mjs` guards this.
5. **Facts carry sources:** limits/version claims must cite source + check date, or be marked ⚠ UNVERIFIED.
6. **Secrets:** never write real deploy keys/VAPID keys/Clerk keys into docs. Placeholder names only.
7. **Gates before commit:** run `python3 scripts/check_consistency.py` AND
   `python3 scripts/check_diagrams.py`; both must pass.
8. **Commits:** scoped conventional commits (`docs(j-pay): ...`). No push without explicit ask.
9. **Migrations:** never `supabase db push`, never apply `supabase/migrations/archive/`,
   never re-apply an already-applied file. A migration may be applied only by the owner
   (SQL editor) or by an agent acting on a **fresh, explicit owner instruction in that
   session** — then via the Supabase MCP `apply_migration` (records it in the remote
   history under the local file name), one file at a time, with the file's own pre-flight
   guards left intact. Production history: `docs/ops/2026-11-12-live-hardening.md`.

## Convex generated types
`convex/_generated/` is historical — committed so `tsc` passes without codegen;
it is not regenerated (no Convex deployment exists) and must not be hand-edited.
Fresh clones run `npm install && npx tsc --noEmit` directly.

## Local-run pitfalls (hard-won)
- NEVER run `npx next build` while `npm run dev` is live — build wipes `.next`
  and the dev server starts throwing ENOENT on routes-manifest.json.
- When touching anything under `convex/` or `src/lib/backend/`, finish every task with
  `npm test` (the invoke gate, db adapter, and parity tests all live there) plus
  `npx tsc --noEmit` — there is no Convex checker or deployment to catch mistakes.
- This shell strips double quotes during `source file.sh` — never `source`
  generated secret files; extract values with sed instead.
- After ANY `npx next build`, `rm -rf .next` before restarting `next dev` — a
  dev server started over production output serves 404 chunks forever.
- `kill`ing the npm wrapper orphans `next-server` — pkill by name, and never
  run two dev servers against one checkout.

## Verification commands
python3 scripts/check_consistency.py   # TRD internal consistency
python3 scripts/check_diagrams.py      # mermaid structural gate
npm run typecheck                      # tsc --strict over app + convex handlers
npm test                               # shift grammar, adapter, invoke gate, dedup, parity, CSV guard
JPAY_EMAIL=... JPAY_PASSWORD=... npm run e2e   # full browser walkthrough (dev server + headless Chrome CDP :9300 required)

## Execution plan
The hermes-era remediation plan was owner-deleted (2026-08-24) — it referenced a
phantom sibling workspace. The TRD (`j-pay.md`) remains the shape contract; the app in
this directory is the live implementation, backed by Supabase (ADR-004). Fork model:
one Supabase project per client (`jpay-<client>`), single-org per deployment — see README.

<!-- supabase-backend -->

This project uses [Supabase](https://supabase.com) (Postgres + Auth) as its
backend — NOT a hosted Convex deployment. The `convex/*.ts` files are business
logic executed by `src/lib/backend/runtime.ts`. Never describe Convex as the
live backend, and never suggest `npx convex dev` or a Convex URL to the user.

<!-- supabase-backend-end -->

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
