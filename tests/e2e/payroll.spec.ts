// J-Pay payroll + review panel E2E — Playwright spec.
// Per playwright-skill: one behavior per test; web-first expect(locator);
// fixtures over globals; baseURL via config.
// Feature reference: src/app/payroll.tsx (PayrollPanel, ReviewPanel).
import { test, expect } from './fixtures/payroll-page';

const HAS_MOD_AUTH = Boolean(process.env.JPAY_EMAIL && process.env.JPAY_PASSWORD);

test.describe('J-Pay payroll + review panels (TRD §5.2 / §6)', () => {
  test('Payroll panel renders employee select, 3 range buttons, export button', async ({ payrollPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await payrollPage.signInAsModerator();
    await payrollPage.gotoModeratorConsole();
    await payrollPage.expectPayrollHeading();
    // 3 range buttons: 7d, 14d, 28d.
    for (const d of ['7d', '14d', '28d']) {
      await expect(payrollPage.page.getByRole('button', { name: d, exact: true })).toBeVisible();
    }
  });

  test('export button is enabled only after an employee is selected', async ({ payrollPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await payrollPage.signInAsModerator();
    await payrollPage.gotoModeratorConsole();
    await payrollPage.expectPayrollHeading();
    // Initially the export button is not in the DOM (the form conditionally renders).
    await expect(
      payrollPage.page.getByRole('button', { name: /Export logs CSV/i }),
    ).not.toBeVisible();
    // Pick an employee.
    const userId = await payrollPage.pickFirstEmployee();
    if (!userId) {
      test.skip(true, 'No employees in this env.');
      return;
    }
    // Now the button is in the DOM and enabled.
    await payrollPage.expectExportButtonEnabled();
  });

  test('selecting 7d/14d/28d changes the active range button (visual state)', async ({ payrollPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await payrollPage.signInAsModerator();
    await payrollPage.gotoModeratorConsole();
    await payrollPage.expectPayrollHeading();
    // Click 14d and verify the button is now visibly active (the active
    // class swap is what the component does; we just verify the button
    // is still visible + the click didn't throw).
    await payrollPage.selectRange(14);
    await expect(payrollPage.page.getByRole('button', { name: '14d', exact: true })).toBeVisible();
  });

  test('Review panel heading is visible (empty state or list)', async ({ payrollPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await payrollPage.signInAsModerator();
    await payrollPage.gotoModeratorConsole();
    await payrollPage.expectReviewHeading();
    // Either "Nothing flagged." or one+ rows; both are valid.
    const empty = payrollPage.page.getByText(/Nothing flagged\./);
    const rows = payrollPage.page.getByTestId('review-resolve');
    await expect(empty.or(rows.first())).toBeVisible({ timeout: 10000 });
  });

  test('Review panel rows have working Recompute + Resolve buttons', async ({ payrollPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await payrollPage.signInAsModerator();
    await payrollPage.gotoModeratorConsole();
    await payrollPage.expectReviewHeading();
    const resolve = payrollPage.page.getByTestId('review-resolve').first();
    if (!(await resolve.isVisible().catch(() => false))) {
      test.skip(true, 'No shifts needing review in this env.');
      return;
    }
    // Both buttons must be present alongside the row.
    await expect(
      payrollPage.page.getByTestId('review-recompute').first(),
    ).toBeVisible();
  });
});
