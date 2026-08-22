# J-Pay — Payroll & Geolocation Logger PWA (Docs Workspace)

J-Pay is a field-workforce time-tracking PWA: employees check in with GPS-verified
timestamps, moderators audit locations in real time and compute payroll. This
repository currently holds the **documentation phase** only — TRD, reviews, ADRs,
and the implementation plan. Application code lands later.

## Contents
- `j-pay.md` — Technical Requirements Document v1.1 (source of truth: §6 schema)
- `REVIEW.md`, `REVIEW-v1.1.md` — senior reviews (v0.2 and v1.1 passes)
- `docs/plans/2026-08-23-jpay-v12-remediation.md` — active execution plan (v1.1 → v1.2)
- `docs/adr/` — architecture decision records

## Gates
```bash
python3 scripts/check_consistency.py   # TRD internal consistency
python3 scripts/check_diagrams.py      # mermaid structural gate
```

Agents: read `AGENTS.md` first.
