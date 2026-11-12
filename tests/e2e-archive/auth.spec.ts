// J-Pay auth & account-flow E2E — Playwright spec.
// Per playwright-skill: one behavior per test; web-first expect(locator);
// getByRole/getByLabel over CSS; fixtures over globals; baseURL via config.
// Reference: src/app/page.tsx, src/app/sign-in.tsx, src/app/change-password.tsx.
import { test, expect } from './fixtures/auth-page';

// Moderator creds gate the real-auth legs (matches e2e-full.mjs convention).
// Without them, those tests skip — they do not silently pass.
const HAS_MOD_AUTH = Boolean(process.env.JPAY_EMAIL && process.env.JPAY_PASSWORD);

test.describe('J-Pay auth & account flows (TRD §3 / §4 / §7)', () => {
  test('landing renders the J-Pay sign-in card (R36)', async ({ authPage }) => {
    await authPage.goto();
    await expect(
      authPage.page.getByRole('heading', { name: 'J-Pay', level: 1 }),
    ).toBeVisible({ timeout: 15000 });
    // Email + password fields are present and the primary submit exists.
    await expect(authPage.page.getByPlaceholder('Email', { exact: true })).toBeVisible();
    await expect(
      authPage.page.getByPlaceholder(/ID code|Choose a password/),
    ).toBeVisible();
    await expect(authPage.page.getByTestId('auth-submit-signIn')).toBeVisible();
  });

  test('bad credentials do not authenticate the user', async ({ authPage }) => {
    await authPage.goto();
    await authPage.signIn('nobody@example.invalid', 'definitely-wrong-12345');
    // Source of truth for an unauthenticated session: the sign-in submit is
    // still present AND the sign-out button (only present when authed) is NOT.
    await expect(
      authPage.page.getByTestId('auth-submit-signIn'),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      authPage.page.getByTestId('auth-signout'),
    ).not.toBeVisible({ timeout: 5000 });
  });

  test('sign-in → consent gate → role badge (skipped without mod creds)', async ({ authPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await authPage.goto();
    await authPage.signIn(process.env.JPAY_EMAIL!, process.env.JPAY_PASSWORD!);
    // Consent modal (§4) blocks the UI until acknowledged.
    await authPage.acknowledgeConsent();
    // After sign-in, the role badge in the header is the source of truth.
    await authPage.expectSignedInAs('moderator');
  });

  test('sign-out clears the session and returns to sign-in', async ({ authPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await authPage.goto();
    await authPage.signIn(process.env.JPAY_EMAIL!, process.env.JPAY_PASSWORD!);
    await authPage.acknowledgeConsent();
    await authPage.expectSignedInAs('moderator');
    await authPage.signOut();
    // After sign-out + reload, the sign-in card reappears.
    await expect(
      authPage.page.getByTestId('auth-submit-signIn'),
    ).toBeVisible({ timeout: 15000 });
  });

  // --- change-password (src/app/change-password.tsx) ---

  test('change-password: mismatched confirm surfaces inline error', async ({ authPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await authPage.goto();
    await authPage.signIn(process.env.JPAY_EMAIL!, process.env.JPAY_PASSWORD!);
    await authPage.acknowledgeConsent();
    await authPage.openChangePassword();
    await authPage.changePassword(
      process.env.JPAY_PASSWORD!,
      'new-secret-1',
      'different-secret-2',
    );
    // Client guard runs before the mutation: next !== confirm.
    await authPage.expectPasswordMessage(/do not match/i);
  });

  test('change-password: too-short next keeps the submit button disabled', async ({ authPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await authPage.goto();
    await authPage.signIn(process.env.JPAY_EMAIL!, process.env.JPAY_PASSWORD!);
    await authPage.acknowledgeConsent();
    await authPage.openChangePassword();
    // The button is `disabled={busy || !current || next.length < 8}`.
    await authPage.page.locator('#compact-pw-current').fill(process.env.JPAY_PASSWORD!);
    await authPage.page.locator('#compact-pw-next').fill('short');
    await authPage.page.locator('#compact-pw-confirm').fill('short');
    await expect(
      authPage.page.getByRole('button', { name: 'Update password' }),
    ).toBeDisabled();
  });
});
