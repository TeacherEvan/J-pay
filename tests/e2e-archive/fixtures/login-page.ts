// Playwright E2E fixtures — /login (real employee sign-in page).
// Per playwright-skill: fixtures > globals; getByRole + getByTestId over CSS.
// Reference: src/app/login/page.tsx (commit 4b70a03).
import { test as base, expect, Page } from '@playwright/test';

export const test = base.extend<{
  loginPage: LoginPage;
}>({
  loginPage: async ({ page, baseURL }, use) => {
    const p = new LoginPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

// Page object: /login real implementation.
// Distinct from the landing SignIn card (/) — this page uses real <label>
// elements and a per-employee <select> populated by api.users_queries.listEmployees.
export class LoginPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  async goto() {
    await this.page.goto(`${this.baseUrl}/login`);
  }

  /** Heading is "Employee Sign In" — distinct from the landing J-Pay h1. */
  async expectHeading() {
    await expect(this.page.getByRole('heading', { name: /Employee Sign In/i })).toBeVisible({ timeout: 15000 });
  }

  /**
   * Sign-in button is disabled when the employee select is empty OR the
   * sign-in ID is blank. This locks down the client-side guard.
   */
  async expectSubmitDisabled() {
    await expect(this.page.getByRole('button', { name: /^Sign In$/ })).toBeDisabled({ timeout: 10000 });
  }

  /**
   * Pick the first real employee from the dropdown (skips cleanly if the
   * listEmployees query returns empty in this env).
   */
  async pickFirstEmployee(): Promise<string | null> {
    const select = this.page.getByLabel(/Your Name/i);
    const options = await select.locator('option').all();
    // Find first option with a non-empty value (skip the "— Select —" placeholder).
    for (const opt of options) {
      const value = (await opt.getAttribute('value')) ?? '';
      if (value) {
        await select.selectOption(value);
        return value;
      }
    }
    return null;
  }

  /** Type a sign-in ID. */
  async fillSignInId(value: string) {
    await this.page.getByLabel(/Sign-In ID/i).fill(value);
  }

  /** Click the primary "Sign In" submit. */
  async submit() {
    await this.page.getByRole('button', { name: /^Sign In$/ }).click();
  }

  /** The inline error <div role="alert"> surfaces when signIn throws. */
  async expectError(matcher: RegExp) {
    await expect(this.page.getByRole('alert').filter({ hasText: matcher })).toBeVisible({ timeout: 10000 });
  }

  /** Already-authenticated branch shows the green "Redirecting…" message. */
  async expectAlreadySignedIn() {
    await expect(this.page.getByText(/Redirecting/i)).toBeVisible({ timeout: 10000 });
  }
}
