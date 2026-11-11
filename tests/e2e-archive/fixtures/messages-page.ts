// Playwright E2E fixtures — MessagesPanel.
// Per playwright-skill: fixtures > globals; getByRole + getByTestId over CSS.
// Reference: src/app/messages.tsx (employee send + mod broadcast/reply).
import { test as base, expect, Page } from '@playwright/test';

export const test = base.extend<{
  messagesPage: MessagesPage;
}>({
  messagesPage: async ({ page, baseURL }, use) => {
    const p = new MessagesPage(page, baseURL || 'http://localhost:3000');
    await use(p);
  },
});

export { expect } from '@playwright/test';

export class MessagesPage {
  constructor(public readonly page: Page, public readonly baseUrl: string) {}

  /** Navigate to the landing page (where MessagesPanel renders for both roles). */
  async gotoLanding() {
    await this.page.goto(this.baseUrl);
  }

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
  }

  // ----- Employee side -----

  /** Employee: type a message to the moderator queue. */
  async typeEmployeeMessage(text: string) {
    await this.page.getByLabel(/Message your moderator/i).fill(text);
  }

  async clickEmployeeSend() {
    await this.page.getByRole('button', { name: 'Send', exact: true }).click();
  }

  async expectEmployeeSentConfirmation() {
    await expect(this.page.getByText(/Sent to moderator\./)).toBeVisible({ timeout: 10000 });
  }

  // ----- Moderator side -----

  async expectQueueEmpty() {
    await expect(this.page.getByText(/Queue empty\./)).toBeVisible({ timeout: 10000 });
  }

  /** Mod: type a broadcast message. */
  async typeBroadcast(text: string) {
    await this.page.getByLabel(/Broadcast to all employees/i).fill(text);
  }

  async clickBroadcast() {
    await this.page.getByRole('button', { name: 'Broadcast', exact: true }).click();
  }

  async expectBroadcastSent() {
    await expect(this.page.getByText(/Broadcast sent\./)).toBeVisible({ timeout: 10000 });
  }

  /** Mod: type a reply to the first queue item. */
  async typeFirstReply(text: string) {
    await this.page.getByPlaceholder(/Reply directly/i).first().fill(text);
  }

  async clickFirstReply() {
    await this.page.getByRole('button', { name: 'Reply', exact: true }).first().click();
  }

  async expectReplySent() {
    await expect(this.page.getByText(/Reply sent\./)).toBeVisible({ timeout: 10000 });
  }

  async clickFirstDismiss() {
    await this.page.getByRole('button', { name: 'Dismiss', exact: true }).first().click();
  }
}
