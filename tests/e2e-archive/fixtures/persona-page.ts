// Playwright E2E fixtures — /demo/persona (the persona switcher).
// Per playwright-skill: fixtures > globals; getByRole + getByTestId over CSS.
// Reference: src/app/demo/persona/page.tsx.
import { test as base, expect, Page } from '@playwright/test';

export const test = base.extend<{
  personaPage: PersonaPage;
}>({
  personaPage: async ({ page, baseURL }, use) => {
    const p = new PersonaPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

// Page object: /demo/persona — the 5-persona switcher.
// Layout: data-testid="persona-switcher" container, with
//   data-testid="persona-row" per persona, and
//   data-testid="persona-play-button" on the play button.
export class PersonaPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  async goto() {
    await this.page.goto(`${this.baseUrl}/demo/persona`);
  }

  /** Precondition: must be in the demo session. */
  async enterDemoPreview() {
    await this.page.goto(this.baseUrl);
    const cta = this.page.getByTestId('demo-preview-cta');
    if (!(await cta.isVisible().catch(() => false))) {
      throw new Error('Demo preview CTA is disabled in this env — set DEMO_MODE=1.');
    }
    await cta.click();
    await this.page.waitForURL(/\/demo(\b|$)/, { timeout: 15000 });
  }

  async expectSwitcherLoaded() {
    await expect(this.page.getByTestId('persona-switcher')).toBeVisible({ timeout: 15000 });
  }

  /**
   * 5 personas are statically defined in src/app/demo/persona/page.tsx:
   * Thabo, Sipho, Lerato, David, Pieter. Verifying the count locks the
   * contract; adding/removing a persona means updating the test.
   */
  async expectFivePersonas() {
    await expect(this.page.getByTestId('persona-row')).toHaveCount(5, { timeout: 10000 });
  }

  /**
   * The currently-bound persona has its "Play as" button replaced by a
   * disabled "Current" button. The persona names are static so we can
   * target by text and assert the button label flipped.
   */
  async expectCurrentPersona(name: string) {
    const row = this.page.getByTestId('persona-row').filter({ hasText: name });
    await expect(row.getByTestId('persona-play-button')).toHaveText(/Current/i);
    await expect(row.getByTestId('persona-play-button')).toBeDisabled();
  }

  /**
   * Switch to a specific persona by name. After the call, navigation
   * to /demo should complete (router.push('/demo') in the component).
   */
  async switchTo(name: string) {
    const row = this.page.getByTestId('persona-row').filter({ hasText: name });
    await row.getByTestId('persona-play-button').click();
    await this.page.waitForURL(/\/demo(\b|$)/, { timeout: 15000 });
  }
}
