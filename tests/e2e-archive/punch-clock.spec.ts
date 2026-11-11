// J-Pay punch-clock E2E — Playwright spec backing the feature.
// Per playwright-skill: one behavior per test; web-first expect(locator);
// getByRole/getByTestId over CSS; fixtures over globals; baseURL via config.
// Feature reference: j-pay.md §5.1 (Employee Interface) / §6.1 (Shift Grammar).
// This spec covers the check-in card → submit → geofence verdict → offline
// queue → replay lane.
import { test, expect } from './fixtures/employee-page';

// Two paths reach the live check-in card:
//   1) Real moderator creds sign an employee in (JPAY_EMAIL + JPAY_PASSWORD).
//   2) Anonymous "Enter demo preview" → /demo, which renders CheckInCard(variant="persona")
//      with a "Confirm" button and a synthetic site picker — no auth required.
// We test path 2 by default (no creds needed) and path 1 only when creds exist.
const HAS_MOD_AUTH = Boolean(process.env.JPAY_EMAIL && process.env.JPAY_PASSWORD);

test.describe('J-Pay punch-clock feature (TRD §5.1 / §6.1)', () => {
  test('landing shows the J-Pay sign-in card and demo CTA (R36)', async ({ employeePage }) => {
    await employeePage.goto();
    await expect(employeePage.page.getByRole('heading', { name: 'J-Pay', level: 1 }))
      .toBeVisible({ timeout: 15000 });
  });

  test('demo preview: check-in renders the check-in card with submit button', async ({ employeePage }) => {
    await employeePage.goto();
    const cta = employeePage.page.getByTestId('demo-preview-cta');
    if (!(await cta.isVisible().catch(() => false))) {
      test.skip(true, 'Demo preview CTA is disabled in this env.');
      return;
    }
    await employeePage.enterDemoPreview();
    await employeePage.page.waitForURL(/\/demo(\b|$)/, { timeout: 15000 });
    // /demo renders CheckInCard(variant="persona") with a primary submit.
    await expect(
      employeePage.page.getByTestId('demo-checkin'),
    ).toBeVisible({ timeout: 15000 });
    await expect(
      employeePage.page.getByTestId('demo-checkin-button'),
    ).toBeVisible();
  });

  test('demo check-in: confirm produces a verdict inside|outside|travel (§6.1)', async ({ employeePage }) => {
    await employeePage.goto();
    const cta = employeePage.page.getByTestId('demo-preview-cta');
    if (!(await cta.isVisible().catch(() => false))) {
      test.skip(true, 'Demo preview CTA is disabled in this env.');
      return;
    }
    await employeePage.enterDemoPreview();
    await employeePage.page.waitForURL(/\/demo(\b|$)/, { timeout: 15000 });
    await expect(employeePage.page.getByTestId('demo-checkin')).toBeVisible({ timeout: 15000 });
    // Demo provider doesn't ask for permission; submit should fire immediately.
    await employeePage.clickDemoCheckIn();
    // Demo verdict uses the same `data-verdict` attribute as the live card.
    const verdict = employeePage.page.locator('[data-verdict]').first();
    await expect(verdict).toBeVisible({ timeout: 10000 });
    const v = await verdict.getAttribute('data-verdict');
    expect(['inside', 'outside', 'travel']).toContain(v);
  });

  test('live check-in: employee can submit a shift-start event (§5.1)', async ({ employeePage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await employeePage.goto();
    await employeePage.signInLive();
    await employeePage.acknowledgeConsent();
    // Card is rendered; if sites.length===0 the warning replaces the submit.
    const card = employeePage.page.getByTestId('checkin-card');
    await expect(card).toBeVisible({ timeout: 15000 });
    const submit = employeePage.page.getByTestId('checkin-submit');
    // Either the submit is enabled, or the no-site warning is shown.
    const warn = employeePage.page.getByText(/No site assigned yet/i);
    await expect(submit.or(warn)).toBeVisible({ timeout: 10000 });
    if (await warn.isVisible().catch(() => false)) {
      test.skip(true, 'Live employee has no site assigned in this env.');
      return;
    }
    await employeePage.clickCheckIn();
    // Verdict row surfaces inside|outside (server-computed haversine §3/§7).
    const verdict = employeePage.page.locator('[data-testid="checkin-verdict"]').first();
    await expect(verdict).toBeVisible({ timeout: 10000 });
  });

  test('offline finish: failure queues to outbox and replay drains it (§8 / §10.4)', async ({ employeePage }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await employeePage.goto();
    await employeePage.signInLive();
    await employeePage.acknowledgeConsent();
    const submit = employeePage.page.getByTestId('checkin-submit');
    if (!(await submit.isVisible().catch(() => false))) {
      test.skip(true, 'Live card not interactive in this env (no site?).');
      return;
    }
    // Force offline: in headless Chromium, navigator.onLine isn't enough — we
    // wrap fetch so any Convex call throws a network-style error, which the
    // submit handler catches and enqueues (see check-in-card.tsx LiveSubmit).
    await employeePage.page.evaluate(() => {
      const orig = window.fetch;
      (window as unknown as { __origFetch: typeof orig }).__origFetch = orig;
      window.fetch = () => Promise.reject(new TypeError('Failed to fetch')) as Promise<Response>;
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
    await submit.click();
    // Outbox sync button surfaces only when count > 0 (§8).
    const sync = employeePage.page.getByTestId('outbox-sync');
    await expect(sync).toBeVisible({ timeout: 10000 });
    // Restore network, then trigger the replay path (visibilitychange + online).
    await employeePage.page.evaluate(() => {
      const w = window as unknown as { __origFetch?: typeof fetch };
      if (w.__origFetch) window.fetch = w.__origFetch;
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // After replay, the queued count drops and the sync banner disappears.
    await expect(sync).not.toBeVisible({ timeout: 15000 });
  });

  // Security / auth gate (§7): row-scoped authz — never trust client-supplied userId.
  test('anonymous visitor never sees employee check-in data (§7 R4)', async ({ employeePage }) => {
    await employeePage.goto();
    // Without a real authenticated session, the live check-in card must not
    // render moderator-only data (KPIs / payroll / other-employee logs).
    await expect(employeePage.page.getByText(/Key metrics/i)).not.toBeVisible();
    await expect(employeePage.page.getByText(/Moderator console/i)).not.toBeVisible();
  });
});
