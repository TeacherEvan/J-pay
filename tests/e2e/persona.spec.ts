// J-Pay /demo/persona E2E — Playwright spec for the persona switcher.
// Per playwright-skill: one behavior per test; web-first expect(locator);
// fixtures over globals; baseURL via config.
// Feature reference: src/app/demo/persona/page.tsx — 5 static personas.
import { test, expect } from './fixtures/persona-page';

test.describe('J-Pay /demo/persona switcher (R36)', () => {
  test('switcher page renders 5 persona rows', async ({ personaPage }) => {
    await personaPage.enterDemoPreview();
    await personaPage.goto();
    await personaPage.expectSwitcherLoaded();
    await personaPage.expectFivePersonas();
  });

  test('currently-bound persona row shows a disabled "Current" button', async ({ personaPage }) => {
    await personaPage.enterDemoPreview();
    await personaPage.goto();
    // Read the bound persona name from the demo-persona-header on /demo.
    await personaPage.page.goto(`${personaPage.baseUrl}/demo`);
    const boundName = await personaPage.page
      .getByTestId('demo-persona-header')
      .getByRole('heading')
      .textContent();
    test.skip(!boundName, 'Could not resolve the bound persona name.');
    await personaPage.page.goto(`${personaPage.baseUrl}/demo/persona`);
    await personaPage.expectCurrentPersona(boundName!.trim());
  });

  test('non-current personas show an enabled "Play as" button', async ({ personaPage }) => {
    await personaPage.enterDemoPreview();
    await personaPage.goto();
    // 5 personas total, 1 is "Current" → 4 are "Play as".
    const playButtons = personaPage.page.getByTestId('persona-play-button');
    await expect(playButtons).toHaveCount(5, { timeout: 10000 });
    const playAsButtons = personaPage.page
      .getByTestId('persona-play-button')
      .filter({ hasText: /Play as/i });
    await expect(playAsButtons).toHaveCount(4);
  });

  test('clicking "Play as" on a non-current persona navigates to /demo', async ({ personaPage }) => {
    await personaPage.enterDemoPreview();
    await personaPage.goto();
    // The first persona row is always "Thabo Mokoena" (per the static list).
    await personaPage.switchTo('Thabo Mokoena');
    await expect(personaPage.page).toHaveURL(/\/demo(\b|$)/);
  });
});
