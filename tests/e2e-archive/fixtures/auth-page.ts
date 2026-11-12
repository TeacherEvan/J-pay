// Playwright E2E fixtures — auth & account flows.
// Per playwright-skill: fixtures > globals; getByRole + getByTestId over CSS.
// Reference: src/app/page.tsx, src/app/sign-in.tsx, src/app/change-password.tsx.
import { test as base, expect, Page } from '@playwright/test';

export const test = base.extend<{
  authPage: AuthPage;
}>({
  authPage: async ({ page, baseURL }, use) => {
    const p = new AuthPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

// Page object: sign-in form + account UI (TRD §3 / §4 / §7).
// Selectors verified against live source — no fabricated testids.
export class AuthPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  // ----- Navigation -----

  /** Navigate to the root sign-in surface. */
  async goto() {
    await this.page.goto(this.baseUrl);
  }

  // ----- Sign-in form (src/app/sign-in.tsx) -----

  /**
   * Email + password sign-in. Falls back to master provider on failure
   * (see sign-in.tsx onSubmit), so a moderator secret also works here.
   * Selectors use placeholder because sign-in.tsx has no <label> for the
   * inputs (placeholders are the user-visible affordance).
   */
  async signIn(email: string, password: string) {
    await this.page.getByPlaceholder('Email', { exact: true }).fill(email);
    await this.page
      .getByPlaceholder(/ID code|Choose a password/)
      .fill(password);
    await this.page.getByTestId('auth-submit-signIn').click();
  }

  async flipToSignUp() {
    await this.page
      .getByRole('button', { name: /First time\? Activate/i })
      .click();
  }

  // ----- Consent + account chrome (src/app/page.tsx) -----

  async acknowledgeConsent() {
    await this.page.getByTestId('consent-acknowledge').click();
  }

  async signOut() {
    await this.page.getByTestId('auth-signout').click();
  }

  // ----- Forced / compact change-password (src/app/change-password.tsx) -----

  async openChangePassword() {
    await this.page
      .getByText(/Change password \(replace your one-time ID code\)/)
      .click();
  }

  async changePassword(current: string, next: string, confirm: string) {
    await this.page.locator('#compact-pw-current').fill(current);
    await this.page.locator('#compact-pw-next').fill(next);
    await this.page.locator('#compact-pw-confirm').fill(confirm);
    await this.page.getByRole('button', { name: 'Update password' }).click();
  }

  // ----- Verification helpers -----

  async expectSignedInAs(role: 'employee' | 'moderator') {
    // The role badge in the header is the source of truth (src/app/page.tsx).
    await expect(
      this.page.getByRole('main').getByText(new RegExp(role, 'i')),
    ).toBeVisible({ timeout: 15000 });
  }

  async expectPasswordMessage(matcher: RegExp) {
    // role="status" aria-live="polite" is the source of truth for
    // success/failure text in PasswordFields.
    await expect(this.page.getByRole('status').filter({ hasText: matcher }))
      .toBeVisible({ timeout: 10000 });
  }
}
