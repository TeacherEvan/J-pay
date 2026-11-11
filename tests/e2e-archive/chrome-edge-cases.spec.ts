// J-Pay chrome edge-cases E2E — Playwright spec covering
//   * Consent modal privacy-policy link
//   * Privacy footer
//   * iOS install-hint dismiss (faked UA)
// Per playwright-skill: one behavior per test; fixtures over globals.
import { test, expect, type Page } from '@playwright/test';

const HAS_MOD_AUTH = Boolean(process.env.JPAY_EMAIL && process.env.JPAY_PASSWORD);

async function signInAsEmployee(page: Page) {
  await page.goto('http://localhost:3000');
  await page.getByPlaceholder('Email', { exact: true }).fill(process.env.JPAY_EMAIL!);
  await page.getByPlaceholder(/ID code|Choose a password/).fill(process.env.JPAY_PASSWORD!);
  await page.getByTestId('auth-submit-signIn').click();
}

test.describe('J-Pay chrome: consent / privacy / iOS install hint / offline', () => {
  test('/~offline renders the PWA offline fallback with a non-empty body', async ({ page }) => {
    await page.goto('http://localhost:3000/~offline');
    // The page is served as a static route by the service worker manifest.
    // We just assert the route is reachable and the body has copy.
    await expect(page).toHaveURL(/~offline/);
    const body = await page.locator('body').textContent();
    expect((body ?? '').length).toBeGreaterThan(0);
  });


  test('consent modal links the Privacy Policy (H9)', async ({ page }) => {
    await signInAsEmployee(page);
    // Consent modal: data-testid="consent-acknowledge" is the only CTA
    // and the modal copy contains a Privacy Policy <a href="/privacy">.
    await expect(page.getByTestId('consent-acknowledge')).toBeVisible({ timeout: 10000 });
    // The Privacy Policy link is inside the modal dialog.
    const link = page.locator('[role="dialog"]').getByRole('link', { name: /Privacy Policy/i });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('href', '/privacy');
  });

  test('authenticated home renders the privacy footer with stable copy', async ({ page }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await signInAsEmployee(page);
    await page.getByTestId('consent-acknowledge').click({ timeout: 10000 });
    // The footer is anchored with id="privacy" in src/app/page.tsx.
    const footer = page.locator('#privacy');
    await expect(footer).toBeVisible({ timeout: 10000 });
    // The text mentions the location-when-you-press-check-in contract.
    await expect(footer).toContainText(/Location is recorded only when you press CHECK IN/i);
  });

  test('authenticated home shows the iOS install hint under an iPhone UA', async ({ browser }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    const iphone = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const page = await iphone.newPage();
    try {
      await page.goto('http://localhost:3000');
      await page.getByPlaceholder('Email', { exact: true }).fill(process.env.JPAY_EMAIL!);
      await page.getByPlaceholder(/ID code|Choose a password/).fill(process.env.JPAY_PASSWORD!);
      await page.getByTestId('auth-submit-signIn').click();
      await page.getByTestId('consent-acknowledge').click({ timeout: 10000 });
      // The iOS banner copy is static: "iPhone: add J-Pay to your Home Screen…"
      await expect(page.getByText(/iPhone: add J-Pay to your Home Screen/i)).toBeVisible({ timeout: 10000 });
    } finally {
      await iphone.close();
    }
  });

  test('iOS install hint dismisses via the ✕ button and writes localStorage', async ({ browser }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    const iphone = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const page = await iphone.newPage();
    try {
      await page.goto('http://localhost:3000');
      await page.getByPlaceholder('Email', { exact: true }).fill(process.env.JPAY_EMAIL!);
      await page.getByPlaceholder(/ID code|Choose a password/).fill(process.env.JPAY_PASSWORD!);
      await page.getByTestId('auth-submit-signIn').click();
      await page.getByTestId('consent-acknowledge').click({ timeout: 10000 });
      // Dismiss via the aria-labeled ✕ button.
      await page.getByRole('button', { name: /Dismiss iPhone install hint/i }).click();
      // The banner is removed.
      await expect(page.getByText(/iPhone: add J-Pay to your Home Screen/i)).not.toBeVisible({ timeout: 5000 });
      // localStorage key is set.
      const stored = await page.evaluate(() => window.localStorage.getItem('jpay.iosInstallDismissed'));
      expect(stored).toBe('1');
    } finally {
      await iphone.close();
    }
  });
});
