# AGENTS.md — J-Pay Workspace

## What this folder is
The J-Pay application workspace (owner directive 2026-08-24, superseding the
earlier docs-only split): the TRD (`j-pay.md`), its reviews/ADRs/plans, AND the
live Next.js + Convex application all live here. The `TeacherEvan/J-pay-webb_logger`
name is historical — do NOT create, clone, or reference sibling directories.

## Hard rules for any agent working here
1. **Scope:** touch ONLY files under this directory. Never enumerate, read, or
   write any sibling directory or other repo — no exceptions without a fresh,
   explicit owner instruction in-session.
2. **Schema truth:** the TypeScript block in `j-pay.md` §6 is the contract. When you edit it,
   keep it syntactically valid Convex code and keep the ERD (§10.2) in sync.
3. **Conflict rule:** where feature text and schema disagree, schema wins — flag the
   discrepancy in §11 Open Questions (TRD §1.1).
4. **Auth:** Convex Auth (`@convex-dev/auth`) — Clerk was removed by owner decision
   (2026-08-23). Do not reintroduce it.
5. **Facts carry sources:** limits/version claims must cite source + check date, or be marked ⚠ UNVERIFIED.
6. **Secrets:** never write real deploy keys/VAPID keys/Clerk keys into docs. Placeholder names only.
7. **Gates before commit:** run `python3 scripts/check_consistency.py` AND
   `python3 scripts/check_diagrams.py`; both must pass.
8. **Commits:** scoped conventional commits (`docs(j-pay): ...`). No push without explicit ask.

## Convex generated types
`convex/_generated/` is CLI-generated (real output since first login) — never
hand-edit it to change behavior. Pre-login stubs are no longer needed; fresh
clones run `npm install && npx tsc --noEmit` only after `npx convex dev` has
generated types, or copy the committed `.d.ts` set from an initialized fork.

## Local-run pitfalls (hard-won)
- NEVER run `npx next build` while `npm run dev` is live — build wipes `.next`
  and the dev server starts throwing ENOENT on routes-manifest.json.
- When touching anything under `convex/`, finish every task with a real push
  check (`timeout 110 npx convex dev`) before committing — local tsc alone has
  missed Convex-checker circular-inference and index-rule errors repeatedly.
- This shell strips double quotes during `source file.sh` — never `source`
  generated secret files; extract values with sed instead.
- After ANY `npx next build`, `rm -rf .next` before restarting `next dev` — a
  dev server started over production output serves 404 chunks forever.
- `kill`ing the npm wrapper orphans `next-server` — pkill by name, and never
  run two dev servers against one checkout.

## Verification commands
python3 scripts/check_consistency.py   # TRD internal consistency
python3 scripts/check_diagrams.py      # mermaid structural gate
npm run typecheck                      # tsc --strict over app + convex
npm test                               # shift-engine grammar + CSV injection guard
JPAY_EMAIL=... JPAY_PASSWORD=... npm run e2e   # full browser walkthrough (dev server + headless Chrome CDP :9300 required)

## Execution plan
The hermes-era remediation plan was owner-deleted (2026-08-24) — it referenced a
phantom sibling workspace. The TRD (`j-pay.md`) remains the contract; the app in
this directory is the live implementation. Fork model: one deployment per client
(`jpay-<client>`), single-org per deployment.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
