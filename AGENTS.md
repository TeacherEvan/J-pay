# AGENTS.md — J-Pay Docs Workspace

## What this folder is
Documentation-only workspace holding the J-Pay TRD (`j-pay.md`), its reviews,
ADR records, and implementation plans. The future app repo is
`TeacherEvan/J-pay-webb_logger` — do NOT scaffold or clone it here.

## Hard rules for any agent working here
1. **Scope:** touch only files under this directory. No sibling repos, no scaffolding.
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

## Verification commands
python3 scripts/check_consistency.py   # TRD internal consistency
python3 scripts/check_diagrams.py      # mermaid structural gate

## Execution plan
The active implementation plan lives at `docs/plans/2026-08-23-jpay-v12-remediation.md`
(writing-plans-enhanced format). Execute it task-by-task with its TDD gates; do not skip
the failing-test-first steps.
