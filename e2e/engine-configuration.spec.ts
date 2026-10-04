import { test, expect, Page } from '@playwright/test';
import { signIn } from './authHelpers';

const MOCK_COMPETITIONS = [
  { id: 'comp-1', name: 'Mock Premier League', country: 'Testland', type: 'league' },
  { id: 'comp-2', name: 'Mock Championship', country: 'Testland', type: 'league' },
];

async function mockCompetitions(page: Page) {
  await page.route('**/api/football/competitions*', (route) =>
    route.fulfill({ json: { competitions: MOCK_COMPETITIONS } })
  );
}

test.describe('Engine Configuration — collapsible sections', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.click('#nav-settings');
  });

  test('Cloud storage callout is collapsible, defaults to collapsed, and explains Firestore vs browser storage', async ({ page }) => {
    await expect(page.getByText('Browser storage vs Firestore cloud database:')).toBeHidden();

    await page.click('#btn-toggle-cloud-storage');
    await expect(page.getByText('Browser storage vs Firestore cloud database:')).toBeVisible();
    await expect(page.locator('#settings-view')).toContainText('Firebase Firestore cloud database');

    await page.click('#btn-toggle-cloud-storage');
    await expect(page.getByText('Browser storage vs Firestore cloud database:')).toBeHidden();
  });

  test('Send test email reports success, and surfaces the backend error when it fails', async ({ page }) => {
    await page.click('#btn-toggle-schedule');

    let calls = 0;
    await page.route('**/api/notifications/test', (route) => {
      calls++;
      const header = route.request().headers()['authorization'] ?? '';
      if (!header.startsWith('Bearer ')) return route.fulfill({ status: 401, json: { error: 'no token' } });
      return calls === 1
        ? route.fulfill({ json: { ok: true } })
        : route.fulfill({ status: 502, json: { error: 'The email endpoint answered 500: template error' } });
    });

    await page.click('#btn-send-test-email');
    await expect(page.locator('#test-email-result')).toContainText('Test email sent');

    await page.click('#btn-send-test-email');
    await expect(page.locator('#test-email-result')).toContainText('template error');
    expect(calls).toBe(2);
  });

  test('Schedule, API Config and Leagues all start collapsed', async ({ page }) => {
    await expect(page.locator('#scan-time')).toBeHidden();
    await expect(page.locator('#key-thestatsapi')).toBeHidden();
    await expect(page.locator('#btn-load-leagues')).toBeHidden();
  });

  test('clicking a section header expands it, and again collapses it', async ({ page }) => {
    await expect(page.locator('#scan-time')).toBeHidden();
    await page.click('#btn-toggle-schedule');
    await expect(page.locator('#scan-time')).toBeVisible();
    await page.click('#btn-toggle-schedule');
    await expect(page.locator('#scan-time')).toBeHidden();
  });

  test('other sections stay collapsed while one is open (independent state)', async ({ page }) => {
    await page.click('#btn-toggle-api-config');
    await expect(page.locator('#key-thestatsapi')).toBeVisible();
    await expect(page.locator('#scan-time')).toBeHidden();
    await expect(page.locator('#btn-load-leagues')).toBeHidden();
  });

  test('Filter Thresholds is locked until a Leagues shortlist is saved', async ({ page }) => {
    // Locked sections render their explanation in place of the toggle
    // itself — the header button is disabled, not merely collapsed.
    await expect(page.locator('#btn-toggle-filter-thresholds')).toBeDisabled();
    await expect(page.getByText(/Locked until a/)).toBeVisible();
    await expect(page.locator('#over15-odds')).toBeHidden();
  });

  test('the TheStatsAPI key field saves and persists across reload', async ({ page }) => {
    await page.click('#btn-toggle-api-config');
    await page.fill('#key-thestatsapi', 'e2e-test-fake-key');
    await page.click('#btn-save-settings');
    await expect(page.getByText('Configuration saved')).toBeVisible();

    await page.reload();
    await page.click('#nav-settings');
    await page.click('#btn-toggle-api-config');
    await expect(page.locator('#key-thestatsapi')).toHaveValue('e2e-test-fake-key');
  });
});

test.describe('Engine Configuration — saving a Leagues shortlist unlocks Filter Thresholds', () => {
  test.beforeEach(async ({ page }) => {
    await mockCompetitions(page);
    await signIn(page);
    await page.click('#nav-settings');
    await page.click('#btn-toggle-api-config');
    await page.fill('#key-thestatsapi', 'e2e-test-fake-key');
    await page.click('#btn-toggle-leagues');
    await page.click('#btn-load-leagues');
    await expect(page.getByText('2 competitions')).toBeVisible();
    await page.click('#league-shortlist-toggle');
    await page.getByText('Mock Premier League').click();
    await page.click('#btn-save-settings');
    await expect(page.getByText('Configuration saved')).toBeVisible();

    // Filter Thresholds is unlocked now, but Over 1.5's own League field
    // (separate from the shortlist above) still defaults to empty, which
    // disables its threshold inputs — select it too, then save again.
    await page.click('#btn-toggle-filter-thresholds');
    await page.click('#over15-league-toggle');
    await page.getByText('Mock Premier League').click();
    await page.click('#btn-save-settings');
    await expect(page.getByText('Configuration saved')).toBeVisible();
  });

  test('Filter Thresholds unlocks and shows the documented default threshold values', async ({ page }) => {
    await expect(page.getByText(/Locked until a/)).toHaveCount(0);
    await expect(page.locator('#over15-odds')).toBeVisible();

    await expect(page.locator('#over15-odds')).toHaveValue('1.15');
    await expect(page.locator('#under35-odds')).toHaveValue('1.2');
  });

  test('changing a threshold and saving persists across reload', async ({ page }) => {
    await page.fill('#over15-odds', '1.30');
    await page.click('#btn-save-settings');
    await expect(page.getByText('Configuration saved')).toBeVisible();

    await page.reload();
    await page.click('#nav-settings');
    await page.click('#btn-toggle-filter-thresholds');
    await expect(page.locator('#over15-odds')).toHaveValue('1.3');
  });
});
