// J-Pay /demo E2E — Playwright spec for the demo persona dashboard (R36).
// Per playwright-skill: one behavior per test; web-first expect(locator);
// fixtures over globals; baseURL via config.
// Feature reference: src/app/demo/page.tsx, src/app/demo/about/page.tsx.
import { test, expect } from './fixtures/demo-page';

test.describe('J-Pay /demo persona dashboard (TRD §3 / R36)', () => {
  test('demo preview CTA → /demo renders the demo-page shell', async ({ demoPage }) => {
    await demoPage.enterDemoPreview();
    await demoPage.expectPageLoaded();
  });

  test('/demo renders the persona header with the bound persona name', async ({ demoPage }) => {
    await demoPage.enterDemoPreview();
    await demoPage.expectPersonaHeader();
    // PersonaHeader's h2 has the persona name; not asserting the literal
    // name (depends on which persona is bound on first sign-in).
    await expect(
      demoPage.page.getByTestId('demo-persona-header').getByRole('heading'),
    ).toBeVisible();
  });

  test('/demo KPI banner shows exactly 4 cards (§5.2)', async ({ demoPage }) => {
    await demoPage.enterDemoPreview();
    await demoPage.expectKpiSection();
  });

  test('/demo renders the payroll, needs-review, audit-log, messages, and export sections', async ({ demoPage }) => {
    await demoPage.enterDemoPreview();
    await demoPage.expectPayrollSection();
    await demoPage.expectNeedsReviewSection();
    await demoPage.expectAuditSection();
    await demoPage.expectMessagesSection();
    await demoPage.expectExportSection();
  });

  test('/demo export button has a stable "Download CSV" label', async ({ demoPage }) => {
    await demoPage.enterDemoPreview();
    const exportBtn = demoPage.page
      .getByTestId('demo-export')
      .getByRole('button', { name: /Download CSV/i });
    await expect(exportBtn).toBeVisible();
    await expect(exportBtn).toBeEnabled();
  });

  test('/demo/about renders the persona info blurb (R36)', async ({ demoPage }) => {
    await demoPage.enterDemoPreview();
    await demoPage.page.goto(`${demoPage.baseUrl}/demo/about`);
    await expect(
      demoPage.page.getByRole('heading', { name: /About this demo/i }),
    ).toBeVisible({ timeout: 15000 });
    // The "What this demo is not" <ul> is also stable copy.
    await expect(demoPage.page.getByText(/What this demo is not/i)).toBeVisible();
  });
});
