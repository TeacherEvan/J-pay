# Playwright E2E expansion — delivered 2026-08-29

Status: BUILD DELIVERED, COMPILE-VERIFIED, RUN-UNVERIFIED (see blockers).

## What was done

Closed the gap between live J-Pay features and the existing Playwright suite.
The 2026-08-27 round added a single spec for the punch-clock feature on `/`.
That round left /punch, /login, /demo, /demo/persona, /demo/about, the
moderator console surface (site create / assign / locale / geofence modal /
review panel), payroll panel, MessagesPanel, EnableNotifications, PWA install
CTA, the sign-up step, the iOS install hint, and the privacy footer without
any E2E coverage.

This round added 11 new specs + 7 new fixtures, and removed one spec that
had drifted out of sync with the live code.

## Spec drift found and fixed

`tests/e2e/stub-pages.spec.ts` (and its fixture `tests/e2e/fixtures/stub-page.ts`)
asserted that `/login` and `/punch` rendered degraded DRAFT surfaces with
disabled Clock In/Out buttons. Both pages were promoted to real implementations
in commits 4b70a03 (login) and 2a7e004 (punch), but the spec was never updated
and would fail against the live app.

Decision (per "following best practices"): the natural place to lock down the
real behavior of those two pages is the new `punch.spec.ts` and `login.spec.ts`,
which exercise the actual GPS gate, geofence verdict, employee dropdown, and
form validation. The stale DRAFT spec was deleted; the same coverage is now
provided by the real specs.

## New deliverables (verified on disk)

```
tests/e2e/fixtures/punch-page.ts        PunchPage: geolocation mock, GPS gate, geofence helpers
tests/e2e/fixtures/login-page.ts        LoginPage: employee select, sign-in ID, submit guard
tests/e2e/fixtures/demo-page.ts         DemoPage: /demo shell + 6 sections (KPI, payroll, audit, etc.)
tests/e2e/fixtures/persona-page.ts      PersonaPage: 5-persona switcher
tests/e2e/fixtures/mod-ops-page.ts      ModeratorOpsPage: site create, assign, locale, geofence modal
tests/e2e/fixtures/payroll-page.ts      PayrollPage: payroll + review panels
tests/e2e/fixtures/messages-page.ts     MessagesPage: employee send + mod queue/broadcast/reply

tests/e2e/punch.spec.ts                 /punch real page (5 behaviors)
tests/e2e/login.spec.ts                 /login real page (7 behaviors)
tests/e2e/demo.spec.ts                  /demo dashboard + /demo/about (6 behaviors)
tests/e2e/persona.spec.ts               /demo/persona switcher (4 behaviors)
tests/e2e/moderator-ops.spec.ts         mod console: sites, assign, locale, geofence (6 behaviors)
tests/e2e/payroll.spec.ts               payroll + review panels (5 behaviors)
tests/e2e/messages.spec.ts              MessagesPanel employee + mod flows (5 behaviors)
tests/e2e/notifications.spec.ts         EnableNotifications VAPID button (3 behaviors)
tests/e2e/pwa-install.spec.ts           beforeinstallprompt CTA (3 behaviors)
tests/e2e/signup.spec.ts                sign-in.tsx sign-up step (4 behaviors)
tests/e2e/chrome-edge-cases.spec.ts     /~offline, consent privacy link, privacy footer, iOS hint (5 behaviors)
```

## Verification performed (empirical)

- `npx tsc --noEmit` — exit code 0. Zero new TypeScript errors in
  `tests/e2e/` or `src/`. The only error in the full output is the
  pre-existing duplicate-`next` issue in `jpay/next.config.ts` (the
  untracked `jpay/` subdir has its own `node_modules/next` that conflicts
  with the root install). This is unrelated to the work in this round.
- `npx playwright test --list` — 76 tests across 15 files, all discoverable,
  no syntax errors. The original 27 + the new 49 (48 new + 1 added for /~offline).
- All selectors are derived from the live source (data-testid, label, role).
  No fabricated test IDs.

## Verification gap (honest)

I did NOT run the suite end-to-end (`npx playwright test`). To actually
execute these tests you need:

1. A running Convex deployment reachable from the dev server
   (`npm run dev` requires `NEXT_PUBLIC_CONVEX_URL` + a Convex backend
   that the Anonymous + Password + Master providers can talk to).
2. A seeded Convex backend with provisioned employees + 3 demo sites +
   the master-password env var. The existing puppeteer pipeline
   (`scripts/e2e-full.mjs`) handles this end-to-end; the Playwright
   spec does not.
3. `JPAY_EMAIL` + `JPAY_PASSWORD` env vars for the legs that exercise
   real auth (most of the new specs).
4. `JPAY_BASE_URL` pointing at the running dev server (defaults to
   `http://localhost:3000`).
5. `npx playwright install` for browser binaries (Chromium is the only
   project used; Firefox/WebKit projects are not configured).

Tests that don't need real auth (the demo CTA path, the PWA install
event, the /~offline route, the iOS UA emulation) should run end-to-end
once the dev server is up.

Tests that need real auth (punch, login, moderator-ops, payroll, messages,
notifications, pwa-install authed leg, chrome-edge-cases authed legs) all
use the `test.skip(!HAS_MOD_AUTH, ...)` convention established by the
2026-08-27 spec — they skip cleanly when `JPAY_EMAIL`/`JPAY_PASSWORD`
aren't set, never silently passing.

## Per-feature coverage map

| Feature (TRD ref)            | Spec file                  | Behaviors |
|------------------------------|----------------------------|-----------|
| §3.1 GPS accuracy gate       | punch.spec.ts              | 1         |
| §3.1 Geofence verdict        | punch.spec.ts              | 1         |
| §4 Consent privacy link      | chrome-edge-cases.spec.ts  | 1         |
| §4 PWA install CTA           | pwa-install.spec.ts        | 3         |
| §4 iOS install hint dismiss  | chrome-edge-cases.spec.ts  | 2         |
| §4 /~offline fallback        | chrome-edge-cases.spec.ts  | 1         |
| §5.1 /login form             | login.spec.ts              | 7         |
| §5.1 /punch (real page)      | punch.spec.ts              | 5         |
| §5.1 Sign-up step            | signup.spec.ts             | 4         |
| §5.2 /dashboard              | dashboard.spec.ts (existing) | 4       |
| §5.2 /moderator              | moderator.spec.ts (existing) | 4       |
| §5.2 SitePanel               | moderator-ops.spec.ts      | 1         |
| §5.2 AssignPanel             | moderator-ops.spec.ts      | 3         |
| §5.2 LocaleCell              | moderator-ops.spec.ts      | 1         |
| §5.2 GeofenceModal           | moderator-ops.spec.ts      | 1         |
| §5.2 PayrollPanel            | payroll.spec.ts            | 3         |
| §5.2 ReviewPanel             | payroll.spec.ts            | 2         |
| §5.2 MessagesPanel (employee) | messages.spec.ts          | 3         |
| §5.2 MessagesPanel (mod)     | messages.spec.ts           | 2         |
| §5.2 EnableNotifications     | notifications.spec.ts      | 3         |
| §5.2 Privacy footer          | chrome-edge-cases.spec.ts  | 1         |
| R36 /demo dashboard          | demo.spec.ts               | 6         |
| R36 /demo/persona            | persona.spec.ts            | 4         |
| R36 /demo/about              | demo.spec.ts               | (rolled in) |
| §6.1 Punch-clock /           | punch-clock.spec.ts (existing) | 6     |
| §7 R4 Row-scoped authz       | punch-clock.spec.ts (existing) | (1)  |

## Per playwright-skill rules followed

- `getByRole` / `getByTestId` / `getByLabel` selectors (not raw CSS)
- Fixtures over globals (`test.extend`)
- `expect(locator)` web-first assertions; no `page.waitForTimeout`
- One behavior per test; trace `'on-first-retry'`
- `baseURL` in config; retries CI=2 / local=0
- `test.skip(!HAS_MOD_AUTH, ...)` for legs needing real auth
- `JPAY_BASE_URL` env override for the dev-server URL

## Next steps to close the run-verification gap

1. `npx convex dev` against a real Convex deployment
2. `JPAY_EMAIL=… JPAY_PASSWORD=… JPAY_BASE_URL=http://localhost:3000 npx playwright test`
3. (Optional) wire Playwright into CI as a parallel lane next to
   `npm run e2e` (the puppeteer pipeline)
