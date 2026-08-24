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
`convex/_generated/` contains hand-authored stand-ins so typecheck works before
`npx convex dev` login. The CLI overwrites them with identical-shape output on
first run — never hand-edit them to change behavior.

## Verification commands
python3 scripts/check_consistency.py   # TRD internal consistency
python3 scripts/check_diagrams.py      # mermaid structural gate
npm run typecheck                      # tsc --strict over app + convex
npm test                               # shift-engine grammar + CSV injection guard

## Execution plan
The hermes-era remediation plan was owner-deleted (2026-08-24) — it referenced a
phantom sibling workspace. The TRD (`j-pay.md`) remains the contract; the app in
this directory is the live implementation. Fork model: one deployment per client
(`jpay-<client>`), single-org per deployment.
