// J-Pay employee logging dashboard E2E — Playwright spec.
// Per playwright-skill: one behavior per test; web-first expect(locator);
// getByRole/getByTestId over CSS; fixtures over globals; baseURL via config.
// Reference: src/app/dashboard/page.tsx (TRD §5.2 / §6.2).
import { test, expect, type DashboardPage } from './fixtures/dashboard-page';

const HAS_MOD_AUTH = Boolean(
  process.env.JPAY_EMAIL && process.env.JPAY_PASSWORD,
);

test.describe('J-Pay employee logging dashboard (TRD §5.2 / §6.2)', () => {
  test('anonymous / non-moderator cannot see dashboard KPI banner (§7 R4)', async ({
    dashboardPage,
  }) => {
    await dashboardPage.goto();
    // Moderator-only data must not render. The query is `kpi.summary` which
    // a non-mod cannot execute, so the page stays at "Loading…" or empty —
    // either way the "Key Metrics" h2 is absent.
    await expect(
      dashboardPage.page.getByRole('heading', { name: /Key Metrics/i }),
    ).not.toBeVisible({ timeout: 10000 });
  });

  test('moderator session loads the dashboard with KPI + audit + roster sections', async ({
    dashboardPage,
  }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await dashboardPage.signInAsModerator();
    await dashboardPage.goto();
    // Each section has a stable data-testid (src/app/dashboard/page.tsx).
    await expect(dashboardPage.page.getByTestId('dashboard-page')).toBeVisible({
      timeout: 15000,
    });
    await expect(dashboardPage.page.getByTestId('dashboard-kpi-banner')).toBeVisible();
    await expect(dashboardPage.page.getByTestId('dashboard-audit')).toBeVisible();
    await expect(dashboardPage.page.getByTestId('dashboard-roster')).toBeVisible();
  });

  test('dashboard renders one KPI card per metric label', async ({ dashboardPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await dashboardPage.signInAsModerator();
    await dashboardPage.goto();
    const banner = dashboardPage.page.getByTestId('dashboard-kpi-banner');
    await expect(banner).toBeVisible({ timeout: 15000 });
    // Four KPI labels are static in the page (Active on site / Billable 7d /
    // Pending reviews / Anomalies 24h). Verifying all four are present
    // proves the dashboard didn't lose a section.
    await expect(banner.getByText('Active on site')).toBeVisible();
    await expect(banner.getByText(/Billable/)).toBeVisible();
    await expect(banner.getByText('Pending reviews')).toBeVisible();
    await expect(banner.getByText(/Anomalies/)).toBeVisible();
  });

  test('audit table shows a stable row per check-in or empty placeholder', async ({
    dashboardPage,
  }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await dashboardPage.signInAsModerator();
    await dashboardPage.goto();
    const audit = dashboardPage.page.getByTestId('dashboard-audit');
    await expect(audit).toBeVisible({ timeout: 15000 });
    // Either there are rows or there's the empty-state placeholder — never
    // an unhandled undefined state.
    const rows = audit.getByTestId('dashboard-audit-row');
    const empty = audit.getByText(/No recent check-ins/i);
    await expect(rows.first().or(empty)).toBeVisible({ timeout: 10000 });
  });
});
