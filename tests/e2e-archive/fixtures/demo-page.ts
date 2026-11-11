// Playwright E2E fixtures — /demo (the demo persona dashboard).
// Per playwright-skill: fixtures > globals; getByRole + getByTestId over CSS.
// Reference: src/app/demo/page.tsx (R36).
import { test as base, expect, Page } from '@playwright/test';

export const test = base.extend<{
  demoPage: DemoPage;
}>({
  demoPage: async ({ page, baseURL }, use) => {
    const p = new DemoPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

// Page object: /demo real implementation (5-persona dashboard).
// Sections identified by data-testid:
//   demo-page, demo-persona-header, demo-kpi-banner, kpi-card,
//   demo-payroll, payroll-day-row, payroll-total-row,
//   demo-needs-review, needs-review-row,
//   demo-audit-log, audit-log-row,
//   demo-messages, message-row,
//   demo-export
export class DemoPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  async goto() {
    await this.page.goto(`${this.baseUrl}/demo`);
  }

  /**
   * Sign in anonymously via the landing page. Skips cleanly if the demo
   * CTA is disabled (i.e. DEMO_MODE=0 in the Convex env).
   */
  async enterDemoPreview() {
    await this.page.goto(this.baseUrl);
    const cta = this.page.getByTestId('demo-preview-cta');
    if (!(await cta.isVisible().catch(() => false))) {
      throw new Error('Demo preview CTA is disabled in this env — set DEMO_MODE=1.');
    }
    await cta.click();
    await this.page.waitForURL(/\/demo(\b|$)/, { timeout: 15000 });
  }

  async expectPageLoaded() {
    await expect(this.page.getByTestId('demo-page')).toBeVisible({ timeout: 15000 });
  }

  async expectKpiSection() {
    const banner = this.page.getByTestId('demo-kpi-banner');
    await expect(banner).toBeVisible();
    // 4 KPI cards: Active on site, Billable this week, Pending reviews, Anomalies (24h).
    await expect(banner.getByTestId('kpi-card')).toHaveCount(4, { timeout: 10000 });
  }

  async expectPersonaHeader() {
    await expect(this.page.getByTestId('demo-persona-header')).toBeVisible();
  }

  async expectPayrollSection() {
    await expect(this.page.getByTestId('demo-payroll')).toBeVisible({ timeout: 10000 });
  }

  async expectNeedsReviewSection() {
    await expect(this.page.getByTestId('demo-needs-review')).toBeVisible();
  }

  async expectAuditSection() {
    await expect(this.page.getByTestId('demo-audit-log')).toBeVisible();
  }

  async expectMessagesSection() {
    await expect(this.page.getByTestId('demo-messages')).toBeVisible();
  }

  async expectExportSection() {
    await expect(this.page.getByTestId('demo-export')).toBeVisible();
  }

  /**
   * Click the CSV export button. The action returns a blob; the file
   * download event is what we wait for. Tests should listen for the
   * 'download' event before calling this.
   */
  async clickExportCsv() {
    await this.page.getByTestId('demo-export').getByRole('button', { name: /Download CSV/i }).click();
  }
}
