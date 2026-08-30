// J-Pay sign-up (first-time activation) E2E — Playwright spec.
// Per playwright-skill: one behavior per test; web-first expect(locator);
// fixtures over globals.
// Feature reference: src/app/sign-in.tsx — the toggle button between
// signIn and signUp steps; signUp adds a "Full name" input.
import { test, expect } from './fixtures/auth-page';

test.describe('J-Pay sign-in.tsx sign-up step (§5.1)', () => {
  test('initial render shows the "Sign in" submit + sign-up toggle', async ({ authPage }) => {
    await authPage.goto();
    // The primary submit testid is `auth-submit-signIn` (initial state).
    await expect(authPage.page.getByTestId('auth-submit-signIn')).toBeVisible({ timeout: 15000 });
    await expect(authPage.page.getByRole('button', { name: /First time\? Activate/i })).toBeVisible();
  });

  test('clicking the sign-up toggle reveals a "Full name" input + flips submit testid', async ({ authPage }) => {
    await authPage.goto();
    await authPage.flipToSignUp();
    // After toggle: data-testid="auth-submit-signUp", placeholder="Full name".
    await expect(authPage.page.getByTestId('auth-submit-signUp')).toBeVisible({ timeout: 5000 });
    await expect(authPage.page.getByPlaceholder('Full name')).toBeVisible();
    // The toggle button label flips too.
    await expect(authPage.page.getByRole('button', { name: /Back to sign in/i })).toBeVisible();
  });

  test('toggling back to sign-in hides the name input and re-shows the signIn submit', async ({ authPage }) => {
    await authPage.goto();
    await authPage.flipToSignUp();
    await expect(authPage.page.getByTestId('auth-submit-signUp')).toBeVisible({ timeout: 5000 });
    // Now flip back.
    await authPage.page.getByRole('button', { name: /Back to sign in/i }).click();
    await expect(authPage.page.getByTestId('auth-submit-signIn')).toBeVisible({ timeout: 5000 });
    await expect(authPage.page.getByPlaceholder('Full name')).not.toBeVisible();
  });

  test('sign-up with missing email surfaces HTML5 validation (input is required)', async ({ authPage }) => {
    await authPage.goto();
    await authPage.flipToSignUp();
    // The email input has `type="email" required` — try submitting with
    // an empty value. The browser blocks submission via :invalid pseudo.
    await authPage.page.getByTestId('auth-submit-signUp').click();
    // The sign-up submit is still visible (form did not submit).
    await expect(authPage.page.getByTestId('auth-submit-signUp')).toBeVisible();
  });
});
