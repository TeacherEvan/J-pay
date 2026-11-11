// J-Pay moderator console operational E2E — site create / assign /
// deactivate / locale / geofence modal. Per playwright-skill: one
// behavior per test; web-first expect(locator); fixtures over globals.
// Feature reference: src/app/moderator/page.tsx, geofence-modal.tsx.
import { test, expect } from './fixtures/mod-ops-page';

const HAS_MOD_AUTH = Boolean(process.env.JPAY_EMAIL && process.env.JPAY_PASSWORD);

test.describe('J-Pay moderator console — ops surface (TRD §5.2 / §6.2 / §7)', () => {
  test('Create site panel renders the 5 input fields + submit', async ({ modOpsPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await modOpsPage.signInAsModerator();
    await modOpsPage.goto();
    await modOpsPage.expectSitePanel();
    // 5 placeholders, all visible.
    for (const ph of ['Name', 'Latitude', 'Longitude', 'Radius m', 'IANA timezone']) {
      await expect(modOpsPage.page.getByPlaceholder(ph)).toBeVisible();
    }
    await expect(modOpsPage.page.getByRole('button', { name: 'Create site', exact: true })).toBeVisible();
  });

  test('Assign panel renders employee + site dropdowns; both buttons disabled by default', async ({ modOpsPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await modOpsPage.signInAsModerator();
    await modOpsPage.goto();
    await modOpsPage.expectAssignPanel();
    await modOpsPage.expectAssignDisabled();
  });

  test('assigning an employee to a site flips Assign → enabled, then click shows "Assigned."', async ({ modOpsPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await modOpsPage.signInAsModerator();
    await modOpsPage.goto();
    await modOpsPage.expectAssignPanel();
    const employee = await modOpsPage.pickFirstEmployeeInAssignPanel();
    const site = await modOpsPage.pickFirstSiteInAssignPanel();
    if (!employee || !site) {
      test.skip(true, 'No employees or no sites in this env.');
      return;
    }
    await expect(modOpsPage.page.getByRole('button', { name: 'Assign', exact: true })).toBeEnabled();
    await modOpsPage.clickAssign();
    await modOpsPage.expectAssignSuccess();
  });

  test('removing an assignment shows "Unassigned." confirmation', async ({ modOpsPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await modOpsPage.signInAsModerator();
    await modOpsPage.goto();
    await modOpsPage.expectAssignPanel();
    const employee = await modOpsPage.pickFirstEmployeeInAssignPanel();
    const site = await modOpsPage.pickFirstSiteInAssignPanel();
    if (!employee || !site) {
      test.skip(true, 'No employees or no sites in this env.');
      return;
    }
    await modOpsPage.clickRemove();
    await modOpsPage.expectUnassignSuccess();
  });

  test('LocaleCell renders with 6 supported locales (en-ZA, en-US, en-GB, en-AU, es-ES, fr-FR)', async ({ modOpsPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await modOpsPage.signInAsModerator();
    await modOpsPage.goto();
    const select = modOpsPage.page.getByLabel(/^Locale for /).first();
    await expect(select).toBeVisible({ timeout: 10000 });
    const optionTexts = await select.locator('option').allTextContents();
    for (const expected of ['en-ZA', 'en-US', 'en-GB', 'en-AU', 'es-ES', 'fr-FR']) {
      expect(optionTexts).toContain(expected);
    }
  });

  test('clicking the audit-log "map" link opens the GeofenceModal', async ({ modOpsPage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await modOpsPage.signInAsModerator();
    await modOpsPage.goto();
    const mapButton = modOpsPage.page.getByRole('button', { name: /Open geofence map for / }).first();
    if (!(await mapButton.isVisible().catch(() => false))) {
      test.skip(true, 'No audit rows with site coords in this env (nothing to map).');
      return;
    }
    await modOpsPage.openGeofenceModal();
    await modOpsPage.expectGeofenceModalOpen();
    // Close it; Escape key is the contract.
    await modOpsPage.page.keyboard.press('Escape');
    await expect(modOpsPage.page.getByRole('dialog', { name: /Geofence and audit detail/i })).not.toBeVisible({ timeout: 5000 });
  });
});
