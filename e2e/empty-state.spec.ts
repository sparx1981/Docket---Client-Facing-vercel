import { test, expect } from '@playwright/test';

/**
 * With a completely fresh browser (no localStorage, no API keys configured),
 * every view must show an honest empty state pointing at Engine
 * Configuration — never fabricated data, never a silent blank screen, and
 * never a console error. This is the single most important regression
 * suite for this app: it is the exact failure mode ("looks like real data
 * but isn't") that prompted the whole rewrite away from hardcoded fixtures.
 */
test.describe('Fresh install — no provider configured', () => {
  test.beforeEach(async ({ page }) => {
    // Fail fast on any uncaught exception or console error — a crash here
    // would otherwise just render a blank screen with no visible signal.
    // Excludes plain resource-load failures (e.g. the Google Fonts request
    // this app makes at runtime per README, which this sandbox has no
    // egress for) — those are an environment/network condition, not an
    // application defect.
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/failed to load resource/i.test(msg.text())) {
        errors.push(msg.text());
      }
    });
    (page as any)._collectedErrors = errors;
    await page.addInitScript(() => {
      sessionStorage.setItem('sports_selection_guest_mode', 'true');
    });
    await page.goto('/');
  });

  test('loads with no console/page errors', async ({ page }) => {
    await expect(page.locator('#nav-verified')).toBeVisible();
    const errors = (page as any)._collectedErrors as string[];
    expect(errors, `Unexpected console/page errors: ${errors.join('; ')}`).toEqual([]);
  });

  test('provider status banner honestly reports "not configured", not a fake success', async ({ page }) => {
    const banner = page.locator('#provider-status-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Not configured');
    await expect(banner).toContainText(
      'No Sportradar or Sportmonks API key is configured'
    );
    // Regression guard: must never claim a provider is connected/online
    // when no key exists and no call has been made.
    await expect(banner).not.toContainText('Connected');
    await expect(banner).not.toContainText(/online/i);
  });

  test('Verified Qualifiers shows a real empty state, not fabricated selections', async ({ page }) => {
    await page.click('#nav-verified');
    await expect(page.locator('#verified-qualifiers-view')).toContainText('No fixtures loaded');
    await expect(page.locator('#verified-qualifiers-view')).toContainText(
      'No data provider configured'
    );
  });

  test('Price Watch shows a real empty state', async ({ page }) => {
    await page.click('#nav-pricewatch');
    await expect(page.locator('#price-watch-view')).toContainText('No fixtures loaded');
  });

  test('Archive log starts empty with no seeded/synthetic rows', async ({ page }) => {
    await page.click('#nav-analytics');
    await expect(page.locator('#analytics-view')).toContainText('Nothing archived yet');
    // The exact bug this whole product pass fixed: a fabricated 250-row
    // seed dataset. Assert the count readout is truly zero.
    await expect(page.locator('#analytics-view')).toContainText('0 archived selections');
  });

  test('CSV export is disabled when there is nothing to export', async ({ page }) => {
    await page.click('#nav-analytics');
    const exportBtn = page.getByRole('button', { name: /export csv/i });
    await expect(exportBtn).toBeDisabled();
  });
});
