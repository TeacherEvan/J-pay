// Playwright E2E fixtures — payroll panel + review panel.
// Per playwright-skill: fixtures > globals; getByRole + getByTestId over CSS.
// Reference: src/app/payroll.tsx (PayrollPanel, ReviewPanel).
import { test as base, expect, Page } from '@playwright/test';

export const test = base.extend<{
  payrollPage: PayrollPage;
}>({
  payrollPage: async ({ page, baseURL }, use) => {
    const p = new PayrollPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

export class PayrollPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  /**
   * The payroll panel lives inside /moderator (and inside the dashboard's
   * moderator home link). Either path exercises the same component.
   */
  async gotoModeratorConsole() {
    await this.page.goto(`${this.baseUrl}/moderator`);
  }

  async signInAsModerator() {
    const email = process.env.JPAY_EMAIL;
    const password = process.env.JPAY_PASSWORD;
    if (!email || !password) {
      throw new Error('signInAsModerator() requires JPAY_EMAIL + JPAY_PASSWORD in the env.');
    }
    await this.page.goto(this.baseUrl);
    await this.page.getByPlaceholder('Email', { exact: true }).fill(email);
    await this.page.getByPlaceholder(/ID code|Choose a password/).fill(password);
    await this.page.getByTestId('auth-submit-signIn').click();
    await this.page.getByTestId('consent-acknowledge').click({ timeout: 10000 });
    await this.page.getByRole('heading', { name: 'Moderator console' }).waitFor({ timeout: 15000 });
  }

  async expectPayrollHeading() {
    await expect(this.page.getByRole('heading', { name: 'Payroll', exact: true })).toBeVisible({ timeout: 15000 });
  }

  async pickFirstEmployee(): Promise<string | null> {
    // PayrollPanel has its own Employee… select inside the panel.
    const panel = this.page.locator('section').filter({ has: this.page.getByRole('heading', { name: 'Payroll', exact: true }) }).first();
    const select = panel.getByRole('combobox').first();
    const opts = await select.locator('option').all();
    for (const o of opts) {
      const v = (await o.getAttribute('value')) ?? '';
      if (v) { await select.selectOption(v); return v; }
    }
    return null;
  }

  async selectRange(days: 7 | 14 | 28) {
    await this.page.getByRole('button', { name: `${days}d`, exact: true }).click();
  }

  async expectPayrollTableRendered() {
    // The table renders a "Total" row on the right edge when a result is present.
    await expect(this.page.getByText(/Total \(/)).toBeVisible({ timeout: 15000 });
  }

  async expectExportButtonEnabled() {
    await expect(this.page.getByRole('button', { name: /Export logs CSV/i })).toBeEnabled({ timeout: 10000 });
  }

  // ----- Review panel -----

  async expectReviewHeading() {
    await expect(this.page.getByRole('heading', { name: /Shifts needing review/i })).toBeVisible({ timeout: 15000 });
  }

  async clickFirstResolve() {
    await this.page.getByTestId('review-resolve').first().click();
  }

  async clickFirstRecompute() {
    await this.page.getByTestId('review-recompute').first().click();
  }
}
