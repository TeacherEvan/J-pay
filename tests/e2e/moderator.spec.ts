// J-Pay moderator console E2E — Playwright spec.
// Per playwright-skill: one behavior per test; web-first expect(locator);
// getByRole over CSS; fixtures over globals; baseURL via config.
// Reference: src/app/moderator/page.tsx, convex/moderator.ts (setHourlyOverride).
import { test, expect } from './fixtures/moderator-page';
import type { Page } from '@playwright/test';

const HAS_MOD_AUTH = Boolean(
  process.env.JPAY_EMAIL && process.env.JPAY_PASSWORD,
);

async function signInAsModerator(page: Page, baseUrl: string) {
  await page.goto(baseUrl);
  // sign-in.tsx has no <label>s — placeholders are the user-visible hook.
  await page.getByPlaceholder('Email', { exact: true }).fill(process.env.JPAY_EMAIL!);
  await page
    .getByPlaceholder(/ID code|Choose a password/)
    .fill(process.env.JPAY_PASSWORD!);
  await page.getByTestId('auth-submit-signIn').click();
  // Consent gate (§4) must be acknowledged before the console renders.
  await page.getByTestId('consent-acknowledge').click({ timeout: 10000 });
  // First-time users land in the ForcedPasswordChange dialog; the moderator
  // console heading only renders after that flow settles.
  await page
    .getByRole('heading', { name: 'Moderator console' })
    .waitFor({ timeout: 15000 });
}

test.describe('J-Pay moderator console (TRD §5.2 / §6.2 / §7 R3)', () => {
  test('anonymous / non-moderator hit on /moderator shows access-only gate (§7 R4)', async ({
    moderatorPage,
  }) => {
    await moderatorPage.goto();
    await moderatorPage.expectAccessOnlyGate();
    // The page renders a back-link to the employee home, not the dashboard.
    await expect(
      moderatorPage.page.getByRole('link', { name: /Back to check-in/i }),
    ).toBeVisible();
  });

  test('moderator session loads the console with KPI + provisioning panels', async ({
    moderatorPage,
  }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await signInAsModerator(moderatorPage.page, moderatorPage.baseUrl);
    await moderatorPage.goto();
    // KpiBanner + "Moderator console" h1 + "Provision employee" panel are
    // all only present for authenticated moderators.
    await expect(
      moderatorPage.page.getByRole('heading', { name: 'Moderator console' }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      moderatorPage.page.getByRole('heading', { name: /Provision employee/i }),
    ).toBeVisible();
  });

  test('rate range guard R3: negative rate is rejected by the server', async ({
    moderatorPage,
  }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await signInAsModerator(moderatorPage.page, moderatorPage.baseUrl);
    await moderatorPage.goto();
    await expect(
      moderatorPage.page.getByRole('heading', { name: 'Moderator console' }),
    ).toBeVisible({ timeout: 15000 });

    // Pick any employee row's rate input. The DOM is keyed `#rate-{userId}`
    // by RateCell; the rate-guard contract is universal, so the userId is
    // not load-bearing for this test.
    const firstRateInput = moderatorPage.page.locator('input[id^="rate-"]').first();
    await expect(firstRateInput).toBeVisible({ timeout: 10000 });
    const inputId = await firstRateInput.getAttribute('id');
    expect(inputId).toBeTruthy();
    const userId = inputId!.replace(/^rate-/, '');

    // Type a negative value and click "set". The client does not pre-block
    // (RateCell only checks Number.isNaN), so the server-side guard in
    // convex/moderator.ts::setHourlyOverride throws ConvexError("RATE_OUT_OF_RANGE").
    await moderatorPage.setHourlyRate(userId, '-5');
    await moderatorPage.expectRateRejected(userId);
  });

  test('rate range guard R3: valid rate (e.g. 50) flips the saved ARIA state', async ({
    moderatorPage,
  }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await signInAsModerator(moderatorPage.page, moderatorPage.baseUrl);
    await moderatorPage.goto();
    await expect(
      moderatorPage.page.getByRole('heading', { name: 'Moderator console' }),
    ).toBeVisible({ timeout: 15000 });

    const firstRateInput = moderatorPage.page.locator('input[id^="rate-"]').first();
    await expect(firstRateInput).toBeVisible({ timeout: 10000 });
    const inputId = await firstRateInput.getAttribute('id');
    expect(inputId).toBeTruthy();
    const userId = inputId!.replace(/^rate-/, '');

    await moderatorPage.setHourlyRate(userId, '50');
    // Per RateCell, success flips ARIA label to "Rate saved for {userId}".
    await expect(
      moderatorPage.page.getByRole('button', { name: `Rate saved for ${userId}` }),
    ).toBeVisible({ timeout: 10000 });
  });
});
