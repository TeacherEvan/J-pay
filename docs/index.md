# J-Pay Documentation Index

Project workspace: `/home/leandi-duplessis/github/workspaces/J-pay`
TRD contract: `j-pay.md` (v1.3.0). Schema source of truth: `convex/schema.ts`.

## Sections

- [End-to-End Feature Map](E2E-FEATURE-MAP.md) — complete interactive UI surface, coverage gap analysis.
- [Notes](notes/) — session lessons (2026-08-24), playwright/e2e backups (2026-08-27, 2026-08-29).
- [Plans](plans/) — change-password UX, demo vs product parity, next-16 upgrade audit, deploy diagnosis, punch-clock design/plan, trust-boundary hardening.
- [ADRs](adr/) — ADR-001 client direct Convex auth, ADR-002 client fork model, ADR-003 shift-engine pure module.
- [Audits](audits/) — surgical audit (2026-10-25).
- [Ops](ops/) — next-16 rollback, screenshots.
- [User Review](UserReview/) — Convex auth / change-password error review artifacts.

## Cross-references

- Source features mapped to tests: `scripts/e2e-full.mjs`, `scripts/e2e-demo.mjs`, `tests-layout/`.
- Schema contract: `convex/schema.ts` (TRD §6) and `convex/_generated/dataModel.d.ts`.
- README quick-start: `README.md`.

## Gaps (documented)

- `docs/project-plan.md` — does not exist. No centralized project-plan file; plan direction is distributed across `docs/plans/*.md` and `j-pay.md`. If a single project-plan is required, it should be created and cross-linked from this index.
- `README.md` does not link back to this `docs/index.md`; consider adding a navigation link.
