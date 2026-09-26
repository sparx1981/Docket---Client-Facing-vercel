import { test, expect } from '@playwright/test';
import { signIn } from './authHelpers';

/**
 * A freshly signed-in account with no provider key configured and no scan
 * ever run must show an honest empty state everywhere — never fabricated
 * data, never a silent blank screen, and never a console error. This is the
 * single most important regression suite for this app: it is the exact
 * failure mode ("looks like real data but isn't") that prompted the whole
 * rewrite away from hardcoded fixtures.
 */
test.describe('Fresh install — no provider configured', () => {
  test.beforeEach(async ({ page }) => {
    // Fail fast on any uncaught exception or console error — a crash here
    // would otherwise just render a blank screen with no visible signal.
    // Excludes plain resource-load failures (e.g. the Google Fonts request
    // this app makes at runtime, which this sandbox has no egress for) —
    // that's an environment/network condition, not an application defect.
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !/failed to load resource/i.test(msg.text())) {
        errors.push(msg.text());
      }
    });
    (page as any)._collectedErrors = errors;
    await signIn(page);
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
    await expect(banner).toContainText('No TheStatsAPI key is configured');
    // Regression guard: must never claim a provider is connected/online
    // when no key exists and no call has been made.
    await expect(banner).not.toContainText('Connected');
    await expect(banner).not.toContainText(/checking/i);
  });

  test('Verified Qualifiers shows a real empty state, not fabricated selections', async ({ page }) => {
    await page.click('#nav-verified');
    await expect(page.locator('#verified-qualifiers-view')).toContainText('Nothing qualified today');
  });

  test('Price Watch shows a real empty state', async ({ page }) => {
    await page.click('#nav-pricewatch');
    await expect(page.locator('#price-watch-view')).toContainText('Nothing on price watch');
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
    await expect(page.locator('#btn-export-csv')).toBeDisabled();
  });
});
