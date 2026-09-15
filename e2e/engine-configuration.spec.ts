import { test, expect } from '@playwright/test';

// Minimal seeded row so the Archive table (and its column tooltips) render
// at all — with an empty archive the table is replaced by an empty state.
const SEEDED_BET = {
  id: 'TEST-CFG-001',
  date: '2026-09-01',
  fixtureId: 'TEST-CFG-FX-1',
  sport: 'football',
  system: 'football_over_1_5',
  match: 'Config Test United vs Config Test Rovers',
  competition: 'Test League',
  selection: 'Over 1.5 Goals',
  oddsTaken: 1.18,
  stake: 100,
  outcome: 'WON',
  finalScore: '2 - 1',
  settledAt: '2026-09-01T18:00:00Z',
  pnl: 18,
  roiContribution: 18,
  auditId: 'AUDIT-TEST-CFG-1',
  notes: 'Seeded by e2e test — not a real result.',
  dataSourceName: 'Test fixture',
};

test.describe('Engine Configuration — collapsible sections & storage disclosure', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('#nav-settings');
  });

  test('storage callout states plainly that data is local-only', async ({ page }) => {
    const settingsView = page.locator('#settings-view');
    await expect(settingsView).toContainText('stored only in this browser');
    await expect(settingsView).toContainText('Export CSV');
  });

  test('all four sections start collapsed', async ({ page }) => {
    // A field inside each section should not be present/visible until its
    // header is clicked — this is the literal requirement: collapsed by
    // default, not just visually de-emphasized.
    await expect(page.locator('#scan-time')).toBeHidden();
    await expect(page.locator('#key-sportradar')).toBeHidden();
    await expect(page.locator('#key-flashscore')).toBeHidden();
    await expect(page.locator('#over15-odds')).toBeHidden();
  });

  test('clicking a section header expands it, and again collapses it', async ({ page }) => {
    const header = page.getByRole('button', { name: /scan schedule/i });
    await expect(page.locator('#scan-time')).toBeHidden();

    await header.click();
    await expect(page.locator('#scan-time')).toBeVisible();

    await header.click();
    await expect(page.locator('#scan-time')).toBeHidden();
  });

  test('other sections stay collapsed while one is open (independent state)', async ({ page }) => {
    await page.getByRole('button', { name: /filter thresholds/i }).click();
    await expect(page.locator('#over15-odds')).toBeVisible();
    await expect(page.locator('#key-sportradar')).toBeHidden();
    await expect(page.locator('#scan-time')).toBeHidden();
  });

  test('Sportradar, Sportmonks and Betfair fields link to their real key-management pages', async ({ page }) => {
    await page.getByRole('button', { name: /sportradar.*sportmonks/i }).click();
    await page.getByRole('button', { name: /direct data feeds/i }).click();

    // Scoped to each field's own container rather than relative position,
    // since two independently-collapsible sections both being open makes
    // DOM order (JSX source order, not click order) an easy thing to get
    // wrong when asserting by index.
    const sportradarLink = page.locator('#key-sportradar').locator('..').getByRole('link');
    await expect(sportradarLink).toHaveAttribute('href', 'https://developer.sportradar.com/');

    const sportmonksLink = page.locator('#key-sportmonks').locator('..').getByRole('link');
    await expect(sportmonksLink).toHaveAttribute('href', /sportmonks\.com/);
    // External key-management links must open in a new tab, not navigate away
    // from the app the user is configuring.
    await expect(sportmonksLink).toHaveAttribute('target', '_blank');

    const betfairAppKeyLink = page.locator('#key-bf-app').locator('..').getByRole('link');
    await expect(betfairAppKeyLink).toHaveAttribute('href', 'https://developer.betfair.com/');

    // Flashscore/Tennis Abstract have no real API — they must NOT get a
    // fabricated "get a key" link implying one exists.
    const flashscoreField = page.locator('#key-flashscore').locator('..');
    await expect(flashscoreField.getByRole('link')).toHaveCount(0);
  });
});

test.describe('Engine Configuration — Filter Thresholds reflect saved config live', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.click('#nav-settings');
    await page.getByRole('button', { name: /filter thresholds/i }).click();
  });

  test('default threshold values match the documented product defaults', async ({ page }) => {
    await expect(page.locator('#over15-odds')).toHaveValue('1.15');
    await expect(page.locator('#under35-odds')).toHaveValue('1.2');
    await expect(page.locator('#tennis-odds')).toHaveValue('1.2');
    await expect(page.locator('#tennis-rank-delta')).toHaveValue('50');
  });

  test('changing a threshold and saving persists across reload', async ({ page }) => {
    await page.fill('#over15-odds', '1.30');
    await page.click('#btn-save-settings');
    await expect(page.getByText('Configuration saved')).toBeVisible();

    await page.reload();
    await page.click('#nav-settings');
    await page.getByRole('button', { name: /filter thresholds/i }).click();
    await expect(page.locator('#over15-odds')).toHaveValue('1.3');
  });

  test('disabling a system persists and is reflected honestly elsewhere', async ({ page }) => {
    // Seed one Archive row so the Archive table (and its column tooltips,
    // checked below) actually render instead of showing an empty state.
    await page.addInitScript((bet) => {
      localStorage.setItem('sports_selection_historical_v2', JSON.stringify([bet]));
      localStorage.setItem('sports_selection_backfill_attempted_v1', 'true');
    }, SEEDED_BET);
    await page.goto('/');
    await page.click('#nav-settings');
    await page.getByRole('button', { name: /filter thresholds/i }).click();

    await page.click('#thresh-over15-enabled');
    await page.click('#btn-save-settings');
    await expect(page.getByText('Configuration saved')).toBeVisible();

    // The Price Watch "Screening Filter Conditions" popover reads live from
    // this same settings object — it must say "disabled", not a stale odds
    // figure, once the system is turned off.
    await page.click('#nav-pricewatch');
    await page.getByRole('button', { name: /^filter$/i }).click();
    await expect(page.getByText('Screening Filter Conditions')).toBeVisible();

    const over15Row = page
      .locator('div')
      .filter({ hasText: 'Football: Over 1.5 Goals' })
      .last();
    await expect(over15Row).toContainText('disabled');

    // The Verified Qualifiers info modal's "Selection Criteria & Rules"
    // list reads from the same live config too.
    await page.click('#nav-verified');
    await page.click('#btn-info-verified');
    await expect(page.getByText('Football: Over 1.5 Goals')).toBeVisible();
    const infoCriteria = page
      .locator('div')
      .filter({ hasText: 'Football: Over 1.5 Goals' })
      .first();
    await expect(infoCriteria).toContainText('Currently disabled in Engine Configuration');
    await page.click('#btn-close-section-info');

    // ...and so does the Archive & Performance "Odds" column tooltip.
    await page.click('#nav-analytics');
    await page.getByRole('button', { name: /odds column explanation/i }).click();
    await expect(page.getByText('Betfair Exchange Odds')).toBeVisible();
    await expect(page.locator('#analytics-view')).toContainText('Over 1.5 disabled');
  });
});
