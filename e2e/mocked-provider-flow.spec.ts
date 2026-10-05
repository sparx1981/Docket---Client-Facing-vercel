import { test, expect, Page } from '@playwright/test';
import { signIn } from './authHelpers';

/**
 * End-to-end proof that the real data pipeline (Engine Configuration →
 * backend proxy → dataFeed.ts → rulesEngine.ts → UI) actually works, without
 * needing a real TheStatsAPI subscription. The backend itself isn't running
 * in this test (playwright.config.ts only starts the Vite frontend), so
 * every `/api/*` call is intercepted here and answered with a hand-built
 * response shaped exactly like server/app.ts's real contract. If
 * dataFeed.ts's parsing of that shape ever drifts, this test breaks — which
 * is the point.
 */

const MOCK_COMPETITIONS = [{ id: 'comp-1', name: 'Mock Premier League', country: 'Testland', type: 'league' }];

const HOME_TEAM = {
  team: 'Mock City',
  season: '2025/26 Domestic',
  league: 'Mock League',
  matchesPlayed: 38,
  goalsScored: 80,
  goalsConceded: 40,
  avgGoalsScored: 2.1,
  avgGoalsConceded: 1.05,
};

const AWAY_TEAM = {
  ...HOME_TEAM,
  team: 'Mock Rovers',
  goalsScored: 66,
  avgGoalsScored: 1.74,
};

const RECENT_MATCHES = Array.from({ length: 5 }, (_, i) => ({
  date: `2026-08-${20 + i}`,
  opponent: `Opponent ${i}`,
  isHome: true,
  teamGoals: 2,
  opponentGoals: 1,
  totalGoals: 3,
  competition: 'Mock League',
  scoredAtLeastOne: true,
  under35Goals: true,
  isCompetitive: true,
}));

const H2H_MATCHES = Array.from({ length: 5 }, (_, i) => ({
  date: `2025-0${i + 1}-01`,
  homeTeam: 'Mock City',
  awayTeam: 'Mock Rovers',
  homeScore: 2,
  awayScore: 1,
  totalGoals: 3,
  competition: 'Mock League',
  isCompetitive: true,
}));

async function mockBackend(page: Page) {
  await page.route('**/api/football/competitions*', (route) =>
    route.fulfill({ json: { competitions: MOCK_COMPETITIONS } })
  );

  let fixturesCallCount = 0;
  await page.route('**/api/football/fixtures*', async (route) => {
    fixturesCallCount += 1;
    if (fixturesCallCount > 1) {
      return route.fulfill({ json: { fixtures: [] } });
    }
    return route.fulfill({
      json: {
        fixtures: [
          {
            providerId: 'mock-1',
            homeOrPlayer1: 'Mock City',
            awayOrPlayer2: 'Mock Rovers',
            homeId: 'home-1',
            awayId: 'away-1',
            competition: 'Mock League',
            matchTime: new Date(Date.now() + 86400000).toISOString(),
            venue: 'Mock Stadium',
          },
        ],
      },
    });
  });

  await page.route('**/api/football/team/*', async (route) => {
    const url = route.request().url();
    const isHome = url.includes('home-1');
    return route.fulfill({
      json: { team: { prevSeason: isHome ? HOME_TEAM : AWAY_TEAM, recentMatches: RECENT_MATCHES } },
    });
  });

  await page.route('**/api/football/h2h*', (route) => route.fulfill({ json: { h2h: H2H_MATCHES } }));

  // The one-shot historical backfill (storage.ts) fires once a key and a
  // league are both configured — answer it too so it doesn't surface as an
  // unmocked-request console error alongside the assertions above.
  await page.route('**/api/football/results*', (route) => route.fulfill({ json: { results: [] } }));

  // No market-odds mock — TheStatsAPI simply hasn't returned a price for
  // this fixture yet, the real-world condition Price Watch exists to cover.
  await page.route('**/api/football/market-odds/*', (route) => route.fulfill({ json: { odds: [] } }));
}

// Engine Configuration's own UI is covered end-to-end by
// engine-configuration.spec.ts (API key, Leagues shortlist, and each rule's
// own league picker, all via real clicks). This suite is about the fixture
// pipeline once configuration exists, so — same pattern already used by
// csv-export.spec.ts to seed the Archive — configuration is seeded directly
// into localStorage rather than re-driving that multi-step UI flow. The
// first-login hydration path (storage.ts's hydrateUserDataFromCloud) treats
// existing local settings as authoritative when no cloud document exists
// yet for a brand-new emulator user, so this seed is exactly what the app
// would have saved had a real user clicked through Engine Configuration.
function seededSettings(overrides?: Record<string, unknown>) {
  return {
    theStatsApiKey: 'e2e-test-fake-key',
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
        // Left disabled and unconfigured — this suite only exercises Over
        // 1.5; enabling it too would double every mocked call for no
        // assertion benefit.
        enabled: false,
        maxPrevSeasonAvgScored: 1.5,
        maxPrevSeasonAvgConceded: 1.5,
        minH2HUnder35Rate: 0.8,
        minRecentUnder35Count: 4,
        minExchangeOdds: 1.2,
        selectedLeagueIds: [],
      },
    },
    ...overrides,
  };
}

async function seedEngineConfig(page: Page, overrides?: Record<string, unknown>) {
  await page.addInitScript((settings) => {
    localStorage.setItem('sports_selection_settings_v2', JSON.stringify(settings));
  }, seededSettings(overrides));
}

async function runScan(page: Page) {
  await page.click('#btn-run-daily-scan');
  await page.click('#btn-confirm-start-scan');
  await expect(page.locator('#provider-status-banner')).toContainText('Connected', { timeout: 20_000 });
  // Close the progress modal — it stays open until dismissed and otherwise
  // intercepts clicks on the tabs behind it.
  await page.click('#btn-view-scan-results');
}

test.describe('Real pipeline against a mocked backend', () => {
  test('a fixture that clears every statistical filter lands in Price Watch (not Verified) because TheStatsAPI has no price for it yet', async ({ page }) => {
    await mockBackend(page);
    await seedEngineConfig(page);
    await signIn(page);
    await runScan(page);

    await page.click('#nav-pricewatch');
    await expect(page.locator('#price-watch-view')).toContainText('Mock City vs Mock Rovers');

    // It must NOT also appear as a Verified Qualifier — that would mean the
    // odds gate was skipped rather than genuinely enforced.
    await page.click('#nav-verified');
    await expect(page.locator('#verified-qualifiers-view')).not.toContainText('Mock City vs Mock Rovers');
  });

  test('opening the audit drawer shows the real provider that supplied the fixture', async ({ page }) => {
    await mockBackend(page);
    await seedEngineConfig(page);
    await signIn(page);
    await runScan(page);

    await page.click('#nav-pricewatch');
    await page.click('#price-watch-row-FT-OV15-mock-1');

    await expect(page.locator('#verification-drawer')).toBeVisible();
    await expect(page.locator('#verification-drawer')).toContainText('TheStatsAPI');
    // Regression guard for the retired fabricated-sourcing bug: must never
    // show the old, meaningless Premium/Fallback framing.
    await expect(page.locator('#verification-drawer')).not.toContainText('Premium (direct)');
    await expect(page.locator('#verification-drawer')).not.toContainText('Fallback (B2B)');
  });

  test('a qualifier priced above the enhanced threshold shows the manual-checks list and says no automated audit runs', async ({ page }) => {
    await mockBackend(page);
    // Registered after mockBackend's empty odds mock, so this one answers.
    await page.route('**/api/football/market-odds/*', (route) =>
      route.fulfill({
        json: {
          odds: [
            {
              bookmaker: 'MockBook',
              marketType: 'OVER_UNDER_15',
              selectionName: 'Over 1.5',
              decimalOdds: 1.3,
              lastUpdated: new Date().toISOString(),
            },
          ],
        },
      })
    );
    await seedEngineConfig(page);
    await signIn(page);
    await runScan(page);

    await page.click('#nav-verified');
    await page.click('#row-FT-OV15-mock-1');

    const drawer = page.locator('#verification-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Enhanced verification log');
    await expect(drawer).toContainText('no automated liquidity or line-up audit is run');
    await expect(drawer).toContainText('Before backing this selection, check:');
    await expect(drawer).toContainText('Docket does not run them for you');
    await expect(drawer).toContainText('Price checked');
    // The retired claims must never come back.
    await expect(drawer).not.toContainText('audit passed');
    await expect(drawer).not.toContainText('Last updated');
  });

  test('a provider HTTP failure is surfaced honestly, not silently swallowed', async ({ page }) => {
    await page.route('**/api/football/competitions*', (route) =>
      route.fulfill({ json: { competitions: MOCK_COMPETITIONS } })
    );
    await page.route('**/api/football/fixtures*', (route) =>
      route.fulfill({ status: 401, json: { error: 'Invalid API key' } })
    );
    await page.route('**/api/football/results*', (route) => route.fulfill({ json: { results: [] } }));
    await seedEngineConfig(page);
    await signIn(page);

    await page.click('#btn-run-daily-scan');
    await page.click('#btn-confirm-start-scan');

    await expect(page.locator('#provider-status-banner')).toContainText('Provider error', { timeout: 20_000 });
    await expect(page.locator('#provider-status-banner')).toContainText(/invalid api key/i);
  });
});
