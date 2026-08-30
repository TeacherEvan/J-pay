// Playwright E2E fixtures — employee logging dashboard.
// Per playwright-skill: fixtures > globals; getByRole + getByTestId over CSS.
// Reference: src/app/dashboard/page.tsx (TRD §5.2 / §6.2).
import { test as base, expect, Page } from '@playwright/test';

export const test = base.extend<{
  dashboardPage: DashboardPage;
}>({
  dashboardPage: async ({ page, baseURL }, use) => {
    const p = new DashboardPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

// Page object: dashboard (moderator-only).
// Selectors verified against src/app/dashboard/page.tsx — every section has
// a stable data-testid so the spec is resilient to copy edits.
export class DashboardPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  async goto() {
    await this.page.goto(`${this.baseUrl}/dashboard`);
  }

  /**
   * Sign in as a moderator and acknowledge the consent gate. Reuses the
   * real sign-in.tsx + ConsentGate paths so the test exercises the same
   * flow a real moderator would.
   */
  async signInAsModerator() {
    const email = process.env.JPAY_EMAIL;
    const password = process.env.JPAY_PASSWORD;
    if (!email || !password) {
      throw new Error(
        'signInAsModerator() requires JPAY_EMAIL + JPAY_PASSWORD in the env.',
      );
    }
    await this.page.goto(this.baseUrl);
    await this.page.getByPlaceholder('Email', { exact: true }).fill(email);
    await this.page
      .getByPlaceholder(/ID code|Choose a password/)
      .fill(password);
    await this.page.getByTestId('auth-submit-signIn').click();
    await this.page.getByTestId('consent-acknowledge').click({ timeout: 10000 });
  }
}
