// Playwright E2E fixtures — moderator console + payroll.
// Per playwright-skill: fixtures > globals; getByRole + getByTestId over CSS.
// Reference: src/app/moderator/page.tsx, convex/moderator.ts.
import { test as base, expect, Page } from '@playwright/test';

export const test = base.extend<{
  moderatorPage: ModeratorPage;
}>({
  moderatorPage: async ({ page, baseURL }, use) => {
    const p = new ModeratorPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

// Page object: moderator console (TRD §5.2 / §6.2 / §7 R3).
// Selectors verified against live source.
export class ModeratorPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  async goto() {
    await this.page.goto(`${this.baseUrl}/moderator`);
  }

  // ----- Auth gate (§7) -----

  /** Anonymous or non-moderator user — must see the access gate. */
  async expectAccessOnlyGate() {
    await expect(this.page.getByText('Moderator access only.'))
      .toBeVisible({ timeout: 15000 });
  }

  async expectConsoleLoaded() {
    // KpiBanner + the "Moderator console" h1 + the "Provision employee" panel
    // are all only present for authenticated moderators.
    await expect(
      this.page.getByRole('heading', { name: 'Moderator console' }),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      this.page.getByRole('heading', { name: /Provision employee/i }),
    ).toBeVisible();
  }

  // ----- Rate range guard (R3 / RATE_OUT_OF_RANGE) -----

  /**
   * Type a value into the per-employee rate input and click "set".
   * The input id is `rate-${userId}` per RateCell in moderator/page.tsx;
   * we use it (not placeholder) because the field is keyed by user id.
   */
  async setHourlyRate(userId: string, value: string) {
    const input = this.page.locator(`#rate-${userId}`);
    await input.fill(value);
    // ARIA label flips from "Set hourly rate for {id}" → "Rate saved for {id}"
    // on success, so we wait for the set-button by its initial label.
    await this.page
      .getByRole('button', { name: `Set hourly rate for ${userId}` })
      .click();
  }

  /**
   * Negative rate — the *server* rejects (convex/moderator.ts setHourlyOverride
   * has `if (args.rate < 0 || args.rate > 100000) throw new ConvexError("RATE_OUT_OF_RANGE")`).
   * The client does not pre-block negative input (RateCell has `min={0}` but
   * the onClick only checks Number.isNaN, not sign). So we expect: the
   * saved-state ARIA label does NOT flip to "Rate saved for ...", and the
   * set button remains in its unsaved form.
   */
  async expectRateRejected(userId: string) {
    await expect(
      this.page.getByRole('button', { name: `Rate saved for ${userId}` }),
    ).not.toBeVisible({ timeout: 5000 });
    // And the set button is still present in its unsaved form.
    await expect(
      this.page.getByRole('button', { name: `Set hourly rate for ${userId}` }),
    ).toBeVisible();
  }
}
