// Playwright E2E fixtures for J-Pay punch-clock feature backing.
// Per playwright-skill: fixtures > globals; isolate every test;
// page-object helpers for resilient selectors (getByRole/getByTestId).
import { test as base, expect, Page } from '@playwright/test';

export const test = base.extend<{
  employeePage: EmployeeCheckInPage;
}>({
  employeePage: async ({ page, baseURL }, use) => {
    const p = new EmployeeCheckInPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

// Page object: employee check-in flow (TRD §5.1 / §6.1 punch-clock).
// The live check-in card is rendered on / as data-testid="checkin-card".
export class EmployeeCheckInPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  // ----- Navigation -----

  /** Navigate to the root sign-in surface. */
  async goto() {
    await this.page.goto(this.baseUrl);
  }

  // ----- Live path (auth required) -----

  /**
   * Sign in as an employee with the moderator creds. The TRD treats the
   * moderator master secret as opening a temp session that can switch
   * contexts; sign-in.tsx falls back to the master provider on password
   * failure, so a real employee + master secret also works here.
   */
  async signInLive() {
    const email = process.env.JPAY_EMAIL;
    const password = process.env.JPAY_PASSWORD;
    if (!email || !password) {
      throw new Error(
        'signInLive() requires JPAY_EMAIL + JPAY_PASSWORD in the env.',
      );
    }
    await this.page.getByPlaceholder('Email', { exact: true }).fill(email);
    await this.page
      .getByPlaceholder(/ID code|Choose a password/)
      .fill(password);
    await this.page.getByTestId('auth-submit-signIn').click();
  }

  async acknowledgeConsent() {
    // Consent modal (§4) — must link privacy notice; never bypass.
    await this.page.getByTestId('consent-acknowledge').click();
  }

  /** Submit the live check-in. Throws if the submit is not visible. */
  async clickCheckIn() {
    // checkin-submit is the live variant's primary submit; its text changes
    // with phase ("Start shift" off, "Confirm …" mid-shift, "Check out" terminal)
    // so we key on the testid, not the label.
    await this.page.getByTestId('checkin-submit').click();
  }

  // ----- Verification helpers -----

  /**
   * Assert that a verdict row has surfaced with one of the three valid
   * data-verdict values: inside | outside | travel (§6.1).
   */
  async expectGeofenceVerdict(verdict: 'inside' | 'outside' | 'travel') {
    const row = this.page.locator(`[data-testid="checkin-verdict"][data-verdict="${verdict}"]`).first();
    await expect(row).toBeVisible({ timeout: 10000 });
  }

  /**
   * The offline-queue banner ("N check-ins queued offline") only renders
   * when the outbox has at least one entry. The "Sync now" button has
   * data-testid="outbox-sync" — that's the deterministic handle.
   */
  async expectOfflineQueued() {
    await expect(this.page.getByTestId('outbox-sync')).toBeVisible({
      timeout: 10000,
    });
  }

  /**
   * Trigger the outbox replay path. The replay lane listens for both
   * the `online` window event and the `visibilitychange` document event
   * (src/app/use-outbox.ts).
   */
  async triggerReplay() {
    await this.page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
}
