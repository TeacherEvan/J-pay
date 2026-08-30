// J-Pay /login E2E — Playwright spec for the real employee sign-in page
// (commit 4b70a03). Per playwright-skill: one behavior per test;
// web-first expect(locator); fixtures over globals; baseURL via config.
// Feature reference: src/app/login/page.tsx — uses real <label>s and a
// per-employee <select> populated by api.users_queries.listEmployees.
import { test, expect } from './fixtures/login-page';

const HAS_MOD_AUTH = Boolean(process.env.JPAY_EMAIL && process.env.JPAY_PASSWORD);

test.describe('J-Pay /login real implementation (commit 4b70a03)', () => {
  test('page renders the "Employee Sign In" heading', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.expectHeading();
  });

  test('employee select is present and label-driven (not placeholder)', async ({ loginPage }) => {
    await loginPage.goto();
    // The form uses <label htmlFor="employee">, so getByLabel works
    // (a placeholder-driven input would NOT match getByLabel).
    const select = loginPage.page.getByLabel(/Your Name/i);
    await expect(select).toBeVisible({ timeout: 10000 });
    await expect(select).toHaveAttribute('id', 'employee');
  });

  test('sign-in ID input is present and label-driven', async ({ loginPage }) => {
    await loginPage.goto();
    const input = loginPage.page.getByLabel(/Sign-In ID/i);
    await expect(input).toBeVisible({ timeout: 10000 });
    await expect(input).toHaveAttribute('id', 'signInId');
  });

  test('submit is disabled when no employee + no sign-in ID are set', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.expectSubmitDisabled();
  });

  test('submit is still disabled when only the sign-in ID is filled', async ({ loginPage }) => {
    await loginPage.goto();
    await loginPage.fillSignInId('some-id-code');
    await loginPage.expectSubmitDisabled();
  });

  test('submit is still disabled when only the employee is selected', async ({ loginPage }) => {
    await loginPage.goto();
    const email = await loginPage.pickFirstEmployee();
    if (!email) {
      test.skip(true, 'No provisioned employees in this env.');
      return;
    }
    await loginPage.expectSubmitDisabled();
  });

  test('submitting with a wrong sign-in ID surfaces an inline error (H1: auth error mapping)', async ({ loginPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Real sign-in needs a provisioned employee list.');
    await loginPage.goto();
    const email = await loginPage.pickFirstEmployee();
    if (!email) {
      test.skip(true, 'No provisioned employees in this env.');
      return;
    }
    await loginPage.fillSignInId('definitely-wrong-jp-xyz');
    await loginPage.submit();
    // The component catches the signIn error and renders role="alert" copy.
    // The exact text comes from errMsg() — we assert the alert surfaces.
    await loginPage.expectError(/.+/);
  });

  test('authed visitors see the "Redirecting…" branch (no form)', async ({ loginPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await loginPage.page.goto(loginPage.baseUrl);
    // Sign in first.
    await loginPage.page.getByPlaceholder('Email', { exact: true }).fill(process.env.JPAY_EMAIL!);
    await loginPage.page.getByPlaceholder(/ID code|Choose a password/).fill(process.env.JPAY_PASSWORD!);
    await loginPage.page.getByTestId('auth-submit-signIn').click();
    await loginPage.page.getByTestId('consent-acknowledge').click({ timeout: 10000 });
    // Now navigate to /login — should render the authed branch.
    await loginPage.page.goto(`${loginPage.baseUrl}/login`);
    await loginPage.expectAlreadySignedIn();
  });
});
