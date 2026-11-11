# Archived Playwright E2E suite (2026-11-11)

76 specs, never wired into `npm test` / `verify`, and written against
Convex-era assumptions ("page gated by Convex Auth", "VAPID queried from
Convex"). Superseded by the maintained headless-Chrome walkthrough in
`scripts/e2e-full.mjs` (`npm run e2e`, needs a dev server + `JPAY_EMAIL` /
`JPAY_PASSWORD`). Kept for reference only; not executed, not maintained,
not a gate. If browser coverage is wanted for the live Supabase deployment,
port the few still-relevant journeys to `scripts/e2e-full.mjs` rather than
reviving this directory wholesale.

The `@playwright/test` dependency was removed from package.json.
