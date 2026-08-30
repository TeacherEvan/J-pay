// Playwright E2E fixtures — /punch (real punch clock page).
// Per playwright-skill: fixtures > globals; getByRole + getByTestId over CSS.
// Reference: src/app/punch/page.tsx (TRD §5.1 / §3.1 accuracy gate / §6.1).
import { test as base, expect, Page, BrowserContext } from '@playwright/test';

export const test = base.extend<{
  punchPage: PunchPage;
}>({
  punchPage: async ({ page, baseURL }, use) => {
    const p = new PunchPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

// Page object: /punch real implementation (commit 2a7e004).
// Selectors verified against live source. The page is gated by Convex Auth;
// most flows skip cleanly when the env is unsigned-in.
export class PunchPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  // ----- Navigation -----

  async goto() {
    await this.page.goto(`${this.baseUrl}/punch`);
  }

  // ----- Geolocation mocking -----

  /**
   * Mock navigator.geolocation.getCurrentPosition so the punch flow can
   * exercise either the accuracy gate (>50m rejection) or the geofence
   * verdict without a real GPS fix.
   *
   * @param opts.accuracyMeters simulated fix accuracy (default 18m)
   * @param opts.lat optional override (defaults to whatever the site query returns)
   * @param opts.lng optional override
   * @param opts.failWith error code to reject with (PERMISSION_DENIED, etc.)
   */
  async mockGeolocation(
    opts: { accuracyMeters?: number; lat?: number; lng?: number; failWith?: 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' } = {},
  ) {
    await this.page.addInitScript((o: { accuracyMeters?: number; lat?: number; lng?: number; failWith?: string }) => {
      const fake = {
        getCurrentPosition: (success: PositionCallback, error?: PositionErrorCallback) => {
          if (o.failWith && error) {
            const err = { code: 1, message: o.failWith, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as unknown as GeolocationPositionError;
            // Map friendly name to actual numeric code
            const codeMap: Record<string, number> = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
            (err as unknown as { code: number }).code = codeMap[o.failWith] ?? 1;
            error(err);
            return;
          }
          const pos = {
            coords: {
              latitude: o.lat ?? 0,
              longitude: o.lng ?? 0,
              accuracy: o.accuracyMeters ?? 18,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          } as unknown as GeolocationPosition;
          success(pos);
        },
        watchPosition: () => 0,
        clearWatch: () => {},
      };
      Object.defineProperty(navigator, 'geolocation', { configurable: true, value: fake });
    }, opts as never);
  }

  // ----- Auth flow helper -----

  /**
   * Sign in as the moderator creds and acknowledge the consent gate so
   * /punch can render the live surface. Without creds the test must skip
   * (this is a real-auth-required page).
   */
  async signInAsEmployee() {
    const email = process.env.JPAY_EMAIL;
    const password = process.env.JPAY_PASSWORD;
    if (!email || !password) {
      throw new Error('signInAsEmployee() requires JPAY_EMAIL + JPAY_PASSWORD in the env.');
    }
    await this.page.goto(this.baseUrl);
    await this.page.getByPlaceholder('Email', { exact: true }).fill(email);
    await this.page.getByPlaceholder(/ID code|Choose a password/).fill(password);
    await this.page.getByTestId('auth-submit-signIn').click();
    await this.page.getByTestId('consent-acknowledge').click({ timeout: 10000 });
  }

  // ----- Verification helpers -----

  /** Unauthenticated /punch renders "Please sign in first" + Go to login link. */
  async expectSignInRequired() {
    await expect(this.page.getByText(/Please sign in first/i)).toBeVisible({ timeout: 15000 });
    await expect(this.page.getByRole('link', { name: /Go to login/i })).toBeVisible();
  }

  /** No-site-assigned branch renders the "No Site Assigned" card. */
  async expectNoSiteAssigned() {
    await expect(this.page.getByText(/No Site Assigned/i)).toBeVisible({ timeout: 15000 });
  }

  /** Success state shows the green "Success" status banner. */
  async expectClockedIn() {
    await expect(this.page.getByText(/Success/i)).toBeVisible({ timeout: 15000 });
  }

  /** Outside-geofence state shows the "Outside geofence" message. */
  async expectOutsideGeofence() {
    await expect(this.page.getByText(/Outside geofence/i)).toBeVisible({ timeout: 15000 });
  }

  /** GPS-accuracy gate (>50m) shows the "exceeds 50m limit" error. */
  async expectWeakGpsRejected() {
    await expect(this.page.getByText(/exceeds 50m limit/i)).toBeVisible({ timeout: 15000 });
  }

  /** Permission denial shows "Location permission denied." (re-thrown via check-in-card onError). */
  async expectPermissionDenied() {
    await expect(this.page.getByText(/Location permission denied/i)).toBeVisible({ timeout: 15000 });
  }
}
