// J-Pay EnableNotifications E2E — Playwright spec.
// Per playwright-skill: one behavior per test; web-first expect(locator);
// fixtures over globals; baseURL via config.
// Feature reference: src/app/notifications.tsx (TRD §5.2 push).
// The button calls Notification.requestPermission() + uses the SW +
// the VAPID public key. We mock Notification + serviceWorker to assert
// the contract deterministically.
import { test, expect, type Page } from '@playwright/test';

const HAS_MOD_AUTH = Boolean(process.env.JPAY_EMAIL && process.env.JPAY_PASSWORD);

async function mockNotificationApi(page: Page, permissionState: 'granted' | 'denied' | 'default') {
  await page.addInitScript((state: 'granted' | 'denied' | 'default') => {
    class MockNotification {
      static permission: NotificationPermission = state;
      static requestPermission = async () => state;
    }
    (window as unknown as { Notification: typeof MockNotification }).Notification = MockNotification;
  }, permissionState);

  // Stub serviceWorker.ready + pushManager so the subscribe path doesn't blow up.
  await page.addInitScript(() => {
    const fakeSub = {
      endpoint: 'https://example.invalid/push/abc123',
      keys: { p256dh: 'AAAA', auth: 'BBBB' },
      toJSON: () => ({
        endpoint: 'https://example.invalid/push/abc123',
        keys: { p256dh: 'AAAA', auth: 'BBBB' },
      }),
    };
    const fakeReg = {
      pushManager: {
        getSubscription: async () => fakeSub,
        subscribe: async () => fakeSub,
      },
    };
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve(fakeReg) },
    });
  });
}

async function signInAsEmployee(page: Page) {
  await page.goto('http://localhost:3000');
  await page.getByPlaceholder('Email', { exact: true }).fill(process.env.JPAY_EMAIL!);
  await page.getByPlaceholder(/ID code|Choose a password/).fill(process.env.JPAY_PASSWORD!);
  await page.getByTestId('auth-submit-signIn').click();
  await page.getByTestId('consent-acknowledge').click({ timeout: 10000 });
}

test.describe('J-Pay EnableNotifications (TRD §5.2 push)', () => {
  test('button is rendered for an employee session on /', async ({ page }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await mockNotificationApi(page, 'default');
    await signInAsEmployee(page);
    const btn = page.getByRole('button', { name: /Enable notifications|Notifications on/i });
    await expect(btn).toBeVisible({ timeout: 10000 });
  });

  test('clicking Enable with granted permission flips the label to "Notifications on"', async ({ page }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await mockNotificationApi(page, 'granted');
    await signInAsEmployee(page);
    const btn = page.getByRole('button', { name: /Enable notifications|Notifications on/i });
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();
    // After click + mocked saveSubscription, the state becomes "on" and
    // the label flips. VAPID is queried from Convex; if missing the
    // component alerts — we mock the query path indirectly by stubbing
    // subscribe and providing a subscription. The label change is the
    // observable contract.
    await expect(page.getByRole('button', { name: 'Notifications on' })).toBeVisible({ timeout: 10000 });
  });

  test('clicking Enable with denied permission leaves the label as "Enable notifications"', async ({ page }) => {
    test.skip(!HAS_MOD_AUTH, 'Set JPAY_EMAIL + JPAY_PASSWORD to run this leg.');
    await mockNotificationApi(page, 'denied');
    await signInAsEmployee(page);
    const btn = page.getByRole('button', { name: /Enable notifications|Notifications on/i });
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();
    // The component's `if (permission !== "granted") return;` short-circuits,
    // so the label does NOT flip to "Notifications on".
    await expect(page.getByRole('button', { name: 'Notifications on' })).not.toBeVisible({ timeout: 3000 });
  });
});
