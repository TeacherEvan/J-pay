// Playwright E2E fixtures — moderator console surface beyond what
// moderator-page.ts covers (rate cell). This handles:
//   * Site creation form (SitePanel)
//   * Assign employee↔site (AssignPanel)
//   * Deactivate employee (DeactivateButton + confirm flow)
//   * Locale selector (LocaleCell)
//   * Geofence modal (GeofenceModal — opens from audit-log "map" link)
// Reference: src/app/moderator/page.tsx, src/app/moderator/geofence-modal.tsx.
import { test as base, expect, Page } from '@playwright/test';

export const test = base.extend<{
  modOpsPage: ModeratorOpsPage;
}>({
  modOpsPage: async ({ page, baseURL }, use) => {
    const p = new ModeratorOpsPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

export class ModeratorOpsPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  async goto() {
    await this.page.goto(`${this.baseUrl}/moderator`);
  }

  /**
   * Sign in as moderator. The "First time? Activate" step is never shown
   * for the seeded moderator creds (they've already set a password).
   * After sign-in the consent modal still gates the moderator console.
   */
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
    // The console renders ProvisionPanel + the heading only after the
    // session settles. Use the heading as the deterministic settle signal.
    await this.page.getByRole('heading', { name: 'Moderator console' }).waitFor({ timeout: 15000 });
  }

  // ----- Site creation (SitePanel) -----

  async expectSitePanel() {
    await expect(this.page.getByRole('heading', { name: 'Create site' })).toBeVisible({ timeout: 15000 });
  }

  /** Fill name/lat/lng/radius/tz. tz defaults to Africa/Johannesburg in the form. */
  async fillSiteForm(opts: { name: string; lat: string; lng: string; radius?: string; tz?: string }) {
    // The 5 fields are real <input>s with placeholders (no labels).
    const panel = this.page.locator('div').filter({ has: this.page.getByRole('heading', { name: 'Create site' }) }).first();
    await panel.getByPlaceholder('Name').fill(opts.name);
    await panel.getByPlaceholder('Latitude').fill(opts.lat);
    await panel.getByPlaceholder('Longitude').fill(opts.lng);
    if (opts.radius) {
      await panel.getByPlaceholder('Radius m').fill(opts.radius);
    }
    if (opts.tz) {
      await panel.getByPlaceholder('IANA timezone').fill(opts.tz);
    }
  }

  async clickCreateSite() {
    await this.page.getByRole('button', { name: 'Create site', exact: true }).click();
  }

  /** The form echoes "Created {name}" in the <p> below the button on success. */
  async expectSiteCreated(name: string) {
    await expect(this.page.getByText(`Created ${name}`, { exact: true })).toBeVisible({ timeout: 15000 });
  }

  // ----- Assign employee ↔ site (AssignPanel) -----

  async expectAssignPanel() {
    await expect(this.page.getByRole('heading', { name: /Assign employee/ })).toBeVisible({ timeout: 15000 });
  }

  async expectAssignDisabled() {
    // Both selects empty → both Assign + Remove disabled.
    await expect(this.page.getByRole('button', { name: 'Assign', exact: true })).toBeDisabled();
    await expect(this.page.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
  }

  /**
   * Pick the first non-empty option from the Employee… dropdown.
   * Returns the value (employee id) or null if the list is empty.
   */
  async pickFirstEmployeeInAssignPanel(): Promise<string | null> {
    const select = this.page.locator('select').filter({ has: this.page.locator('option', { hasText: 'Employee…' }) }).first();
    const opts = await select.locator('option').all();
    for (const o of opts) {
      const v = (await o.getAttribute('value')) ?? '';
      if (v) { await select.selectOption(v); return v; }
    }
    return null;
  }

  /**
   * Pick the first non-empty option from the Site… dropdown.
   * Returns the value (site id) or null if the list is empty.
   */
  async pickFirstSiteInAssignPanel(): Promise<string | null> {
    const select = this.page.locator('select').filter({ has: this.page.locator('option', { hasText: 'Site…' }) }).first();
    const opts = await select.locator('option').all();
    for (const o of opts) {
      const v = (await o.getAttribute('value')) ?? '';
      if (v) { await select.selectOption(v); return v; }
    }
    return null;
  }

  async clickAssign() {
    await this.page.getByRole('button', { name: 'Assign', exact: true }).click();
  }

  async clickRemove() {
    await this.page.getByRole('button', { name: 'Remove', exact: true }).click();
  }

  async expectAssignSuccess() {
    await expect(this.page.getByText(/^Assigned\.$/, { exact: false })).toBeVisible({ timeout: 10000 });
  }

  async expectUnassignSuccess() {
    await expect(this.page.getByText(/^Unassigned\.$/, { exact: false })).toBeVisible({ timeout: 10000 });
  }

  // ----- Locale cell (LocaleCell) -----

  /** Pick a different locale for the first employee row. */
  async changeFirstEmployeeLocale(newLocale: 'en-ZA' | 'en-US' | 'en-GB' | 'en-AU' | 'es-ES' | 'fr-FR') {
    const select = this.page.getByLabel(/^Locale for /).first();
    await select.selectOption(newLocale);
  }

  // ----- Geofence modal (GeofenceModal) -----

  /** Click the first "map" button in the audit log to open the GeofenceModal. */
  async openGeofenceModal() {
    await this.page.getByRole('button', { name: /Open geofence map for / }).first().click();
  }

  async expectGeofenceModalOpen() {
    await expect(this.page.getByRole('dialog', { name: /Geofence and audit detail/i })).toBeVisible({ timeout: 10000 });
  }

  async closeGeofenceModal() {
    await this.page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  }
}
