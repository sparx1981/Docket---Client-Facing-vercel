import { test, expect, Page } from '@playwright/test';
import { signIn } from './authHelpers';

/**
 * Engine Configuration → Reset Data: wipes the Archive, sync history, saved
 * backtests and current scan results (cloud + this browser) and keeps
 * Engine Configuration. The cloud wipe matters most: at every sign-in the app
 * reloads this browser from the cloud, so a browser-only wipe would bring
 * everything straight back.
 */

const API_KEY = 'e2e-reset-test-key';

const SEEDED_BETS = [
  {
    id: 'RESET-001',
    date: '2026-09-01',
    fixtureId: 'RESET-FX-1',
    sport: 'football',
    system: 'football_over_1_5',
    match: 'Reset United vs Reset Rovers',
    competition: 'Reset League',
    selection: 'Over 1.5 Goals',
    oddsTaken: 1.18,
    stake: 100,
    outcome: 'WON',
    finalScore: '2 - 1',
    settledAt: '2026-09-01T18:00:00Z',
    pnl: 18,
    roiContribution: 18,
    auditId: 'AUDIT-RESET-1',
    notes: 'Seeded by e2e test — not a real result.',
    dataSourceName: 'Test fixture',
  },
  {
    id: 'RESET-002',
    date: '2026-09-02',
    fixtureId: 'RESET-FX-2',
    sport: 'football',
    system: 'football_under_3_5',
    match: 'Reset City vs Reset Town',
    competition: 'Reset League',
    selection: 'Under 3.5 Goals',
    oddsTaken: 1.22,
    stake: 100,
    outcome: 'LOST',
    finalScore: '3 - 2',
    settledAt: '2026-09-02T18:00:00Z',
    pnl: -100,
    roiContribution: -100,
    auditId: 'AUDIT-RESET-2',
    notes: 'Seeded by e2e test — not a real result.',
    dataSourceName: 'Test fixture',
  },
];

const SEEDED_SYNC_LOG = {
  id: 'SYNC-20260901060000-E2E',
  timestamp: '2026-09-01T06:00:00.000Z',
  trigger: 'SCHEDULED',
  status: 'SUCCEEDED',
  durationMs: 1234,
  totalRecordsScanned: 10,
  qualifiersCount: 1,
  priceWatchCount: 0,
  rejectedCount: 9,
  dataSources: [{ name: 'TheStatsAPI Football API', url: '', status: 'ONLINE', recordsSupplied: 10 }],
  systemBreakdown: [],
};

const SEEDED_BACKTEST = {
  id: 'BT-E2E-1',
  runAt: '2026-09-01T10:00:00.000Z',
  system: 'football_over_1_5',
  ruleSnapshot: {
    enabled: true,
    minPrevSeasonAvgScored: 1,
    minH2HOver15Rate: 0.8,
    minRecentScoredCount: 4,
    minExchangeOdds: 1.15,
    enhancedOddsThreshold: 1.25,
    selectedLeagueIds: ['comp-1'],
  },
  summary: {
    system: 'football_over_1_5',
    leagueLabel: 'Mock Premier League',
    candidateCount: 10,
    evaluatedCount: 10,
    sampleSize: 4,
    wins: 3,
    losses: 1,
    winRatePct: 75,
    matches: [],
    scopeNote: 'Seeded by e2e test.',
  },
};

const SEEDED_SETTINGS = {
  theStatsApiKey: API_KEY,
  scheduleEnabled: false, // keep the background scan loop from firing mid-test
  leagueCatalog: [{ id: 'comp-1', name: 'Mock Premier League', country: 'Testland', type: 'league' }],
  leagueShortlistIds: ['comp-1'],
  ruleThresholds: {
    footballOver15: {
      enabled: true,
      minPrevSeasonAvgScored: 1.0,
      minH2HOver15Rate: 0.8,
      minRecentScoredCount: 4,
      minExchangeOdds: 1.15,
      enhancedOddsThreshold: 1.25,
      selectedLeagueIds: ['comp-1'],
    },
    footballUnder35: {
      enabled: false,
      maxPrevSeasonAvgScored: 1.5,
      maxPrevSeasonAvgConceded: 1.5,
      minH2HUnder35Rate: 0.8,
      minRecentUnder35Count: 4,
      minExchangeOdds: 1.2,
      selectedLeagueIds: [],
    },
  },
};

/** Seeds this browser once. sessionStorage survives the reload a reset performs, so the seed is not re-applied after it. */
async function seedBrowserData(page: Page) {
  await page.addInitScript(
    ({ bets, log, backtest, settings }) => {
      if (sessionStorage.getItem('e2e-seeded')) return;
      sessionStorage.setItem('e2e-seeded', 'true');
      localStorage.setItem('sports_selection_settings_v2', JSON.stringify(settings));
      localStorage.setItem('sports_selection_historical_v2', JSON.stringify(bets));
      localStorage.setItem('sports_selection_sync_logs_v2', JSON.stringify([log]));
      localStorage.setItem('sports_selection_backtest_runs_v1', JSON.stringify([backtest]));
      localStorage.setItem('sports_selection_last_scan_v2', log.timestamp);
    },
    { bets: SEEDED_BETS, log: SEEDED_SYNC_LOG, backtest: SEEDED_BACKTEST, settings: SEEDED_SETTINGS }
  );
  await page.route('**/api/football/competitions*', (route) =>
    route.fulfill({ json: { competitions: [{ id: 'comp-1', name: 'Mock Premier League', country: 'Testland', type: 'league' }] } })
  );
}

async function openResetModal(page: Page) {
  await page.click('#nav-settings');
  await page.click('#btn-toggle-reset-data');
  await page.click('#btn-open-reset-data');
  await expect(page.locator('#reset-data-modal')).toBeVisible();
}

test.describe('Reset Data', () => {
  test('shows what will be deleted, then wipes the data but keeps Engine Configuration', async ({ page }) => {
    // The removed 30-day backfill must never come back to re-seed the Archive.
    let resultsCalls = 0;
    await page.route('**/api/football/results*', (route) => {
      resultsCalls += 1;
      return route.fulfill({ json: { results: [] } });
    });
    await seedBrowserData(page);
    await signIn(page);
    // A brand-new account's first sign-in uploads this browser's seeded data to the
    // cloud over several sequential writes. Let that finish first: resetting
    // mid-upload would let its remaining writes land after the wipe.
    await page.waitForTimeout(2500);

    // The seeded data is on screen before the reset.
    await page.click('#nav-analytics');
    await expect(page.getByText('2 archived selections')).toBeVisible();

    await openResetModal(page);
    const modal = page.locator('#reset-data-modal');
    await expect(modal.locator('#reset-count-archive')).toContainText('2 selections');
    await expect(modal.locator('#reset-count-synclogs')).toContainText('1 logged run');
    await expect(modal.locator('#reset-count-backtests')).toContainText('1 run');
    await expect(modal).toContainText('This cannot be undone');
    await expect(modal).toContainText('Engine Configuration');

    // Guarded: only the exact word enables the button.
    const confirm = modal.locator('#btn-confirm-reset-data');
    await expect(confirm).toBeDisabled();
    await modal.locator('#input-reset-confirm').fill('reset');
    await expect(confirm).toBeDisabled();
    await modal.locator('#input-reset-confirm').fill('RESET');
    await expect(confirm).toBeEnabled();

    await Promise.all([page.waitForEvent('load'), confirm.click()]);
    await page.locator('#nav-verified').waitFor({ state: 'visible', timeout: 20_000 });
    // Give the post-reload cloud hydration time to run: if the cloud copy had
    // not been wiped too, it would repopulate everything here.
    await page.waitForTimeout(2500);

    await page.click('#nav-analytics');
    await expect(page.getByText('0 archived selections')).toBeVisible();

    const local = await page.evaluate(() => ({
      bets: localStorage.getItem('sports_selection_historical_v2'),
      logs: localStorage.getItem('sports_selection_sync_logs_v2'),
      backtests: localStorage.getItem('sports_selection_backtest_runs_v1'),
      settings: localStorage.getItem('sports_selection_settings_v2'),
      lastScan: localStorage.getItem('sports_selection_last_scan_v2'),
    }));
    expect(JSON.parse(local.bets ?? '[]')).toHaveLength(0);
    expect(JSON.parse(local.logs ?? '[]')).toHaveLength(0);
    expect(JSON.parse(local.backtests ?? '[]')).toHaveLength(0);

    // Engine Configuration is untouched.
    expect(JSON.parse(local.settings ?? '{}').theStatsApiKey).toBe(API_KEY);
    // The last-scan time is kept on purpose, so a reset does not trigger an immediate scan.
    expect(local.lastScan).toBe(SEEDED_SYNC_LOG.timestamp);

    // Nothing re-seeded the Archive from the provider.
    expect(resultsCalls).toBe(0);
  });

  test('Cancel, and the wrong word, delete nothing', async ({ page }) => {
    await seedBrowserData(page);
    await signIn(page);
    await openResetModal(page);

    await page.locator('#input-reset-confirm').fill('delete');
    await expect(page.locator('#btn-confirm-reset-data')).toBeDisabled();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('#reset-data-modal')).toHaveCount(0);

    await page.click('#nav-analytics');
    await expect(page.getByText('2 archived selections')).toBeVisible();
  });

  test('offers the Archive as a CSV download before anything is deleted', async ({ page }) => {
    await seedBrowserData(page);
    await signIn(page);
    await openResetModal(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#btn-reset-download-archive'),
    ]);
    expect(download.suggestedFilename()).toMatch(/^archive-log-all-\d{4}-\d{2}-\d{2}\.csv$/);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream!) chunks.push(chunk as Buffer);
    const csv = Buffer.concat(chunks).toString('utf-8');
    expect(csv).toContain('Reset United vs Reset Rovers');
    expect(csv).toContain('Reset City vs Reset Town');

    // Downloading deleted nothing.
    await expect(page.locator('#reset-data-modal')).toBeVisible();
    await expect(page.locator('#reset-count-archive')).toContainText('2 selections');
  });
});
