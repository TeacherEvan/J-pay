# Playwright E2E backing — delivered 2026-08-27
Status: BUILD DELIVERED; NOT FULLY VERIFIED (see blockers).

Blockers (honest):
- User message "/playwright-skill Investigate..." did not specify which J-Pay feature.
  I targeted the PUNCH-CLOCK feature (TRD §5.1 / §6.1) — the most concrete feature.
- Workspace's real E2E pipeline uses puppeteer-core + CDP (scripts/e2e-full.mjs),
  not Playwright. Playwright wasn't installed; I added @playwright/test to
  package.json but did NOT run `npm install` or a working Playwright test.
  The spec/types fail until `npm install` lands.
- `npm test` (node test runner over scripts/test-*.mjs) passes independently;
  Playwright spec is outside that pipeline until installed.

Deliverables (verified on disk):
- playwright.config.ts (baseURL, retries=2 CI / 0 local, trace 'on-first-retry', fixtures)
- tests/e2e/fixtures/employee-page.ts (EmployeeCheckInPage POM)
- tests/e2e/punch-clock.spec.ts (4 behaviors: login/demo, consent/privacy,
  check-in/geofence verdict, offline queue + replay lane, auth isolation)
- package.json: @playwright/test ^1.52.0 added (package.json.bak preserved)

Per playwright-skill rules followed:
- getByRole/getByTestId selectors (not raw CSS)
- fixtures over globals (test.extend)
- expect(locator) web-first assertions; no page.waitForTimeout
- one behavior per test; trace 'on-first-retry'; isolates every test
- baseURL in config; retries CI=2 / local=0

Next steps to close verification:
1. `npm install` (pulls @playwright/test)
2. `npx playwright install` (browsers)
3. Confirm `JPAY_BASE_URL` points to running `npm run dev`
4. `npx playwright test tests/e2e/punch-clock.spec.ts`
