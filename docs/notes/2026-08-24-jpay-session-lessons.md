---
title: J-Pay Session Lessons — Docs-to-App Build-Out
date: 2026-08-24
project: "[[j-pay]]"
tags: [jpay, convex, nextjs, lessons, tdd, agents]
up: "[[j-pay]]"
related:
  - "[[ADR-002-client-fork-model]]"
  - "[[ADR-003-shift-engine-pure-module]]"
status: evergreen-candidates
---

# J-Pay Session Lessons — 2026-08-24

> [!abstract]
> One session took [[j-pay]] from docs-only workspace to a working preview app:
> moderator console, offline-first employee check-in, payroll engine, messaging,
> web-push scaffolding — plus a unit-tested shift grammar. This note captures the
> transferable lessons and the scars.

## Verified facts (probed this session, not remembered)

| Claim | Probe | Result |
|---|---|---|
| `web-push@3.6.7` current | `npm view` | ✅ |
| `@convex-dev/auth@0.0.95` current | `npm view` | ✅ |
| Node 24 strips TS types natively | ran suites with `--experimental-strip-types` | ✅ |
| `next@^15` latest stable line | registry probe | ✅ 15.5.x |

## Architecture lessons

> [!lesson] Green gates ≠ synced docs
> Both repo gates passed while the ERD had drifted 11 fields across 5 tables.
> Regex gates only enforce what someone thought to grep. **Every "keep X in sync"
> rule needs its own mechanical check** or it will rot silently.

> [!lesson] TDD catches the author more than the library
> First real test suite for the shift grammar: 15 cases, 5 failed — **4 were my
> fixture errors** (stale timestamps tripping 16h auto-close, a window that
> contradicted my own 2× threshold, an unreachable flag via picker caps), 1 was a
> genuine hardening find (stable-sort ties closing reversed pairs as clean
> 0-minute shifts → now flagged `reversed_times`). Tests encode intent; failures
> audit the author first.

> [!lesson] Unreachable-by-UI branches deserve explicit tests anyway
> Rule 9's >240 min flag can't be hit through the picker (caps at 120). Tested via
* synthetic legacy data with clamped-to-zero assertion — the branch documents
> intent for future duration sources.

## Convex-specific scars

- `FilterApi<API, Predicate>` takes a **predicate type**
  (`FunctionReference<any,"internal",any,any>`), *not* a visibility string — the
  string silently yields `{}`.
- `ApiFromModules<typeof modules>` expects modules of **Registered** exports;
  raw `FunctionReference` values map to `never`.
- `typeof import()` barrels survive cycles **only** when the barrel's value side
  doesn't force eager member evaluation; cross-file scheduler refs through
  `internal.*` degrade inference if a file's own visibility depends on the barrel.
  Leaf modules for internal queries break the loop cleanly.
- **Actions have no `ctx.db`.** Data access from actions goes through
  `ctx.runQuery(internal.module.fn, args)`.
- `"use node"` files may only host actions; queries/mutations stay in isolate files.
- `npx convex codegen` demands a logged-in deployment; pre-login typechecking
  needs hand-written `_generated` stubs that the CLI later overwrites.
- `cronJobs()` is a factory call, not a constructor.

## Process scars

- **Claim-vs-grep:** I reported "inline rate editing lives in the employees
  table" one round before it existed. `grep` found zero call sites. A feature
  name existing ≠ wired ([[verify-before-planning-gaps]] reflex).
- **Owner directives override stale agent-authored rules** — the docs-only split
  was superseded live; AGENTS.md was amended same-session so the next agent
  inherits the correction, not the contradiction.
- **Working-directory discipline:** proposing work in sibling repos reads as
  permission-grabbing. The opened folder is the target unless told otherwise.
- `&&` commit chains silently stop at the first failure — e.g. `git add` on an
  explicitly-named ignored path exits nonzero and nothing after it runs. Verify
  the log, not the echo.
- Point-in-time records (reviews) stay untouched even when their references go
  stale; living docs get fixed.

## Open threads handed forward

- Overtime multipliers — blocked on owner decision (TRD §11 Q8).
- WebAuthn platform auth — TRD Phase 2.
- Per-deployment DST site combos — unit-level tz math proven; field combos manual.
- Push E2E — needs a deployed backend with VAPID keys.

*Related: [[ADR-001-client-direct-convex-auth]] · [[ADR-002-client-fork-model]] · [[ADR-003-shift-engine-pure-module]]*
