import { test, expect, Page } from '@playwright/test';

/**
 * End-to-end proof that the real data pipeline (Settings → backend proxy →
 * dataFeed.ts → rulesEngine.ts → UI) actually works, without needing a real
 * Sportradar/Sportmonks subscription. The backend itself isn't running in
 * this test (playwright.config.ts only starts the Vite frontend), so every
 * `/api/*` call is intercepted here and answered with a hand-built response
 * shaped exactly like server/index.ts's real contract. If dataFeed.ts's
 * parsing of that shape ever drifts, this test breaks — which is the point.
 */

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
  let fixturesCallCount = 0;

  await page.route('**/api/football/fixtures*', async (route) => {
    fixturesCallCount += 1;
    if (fixturesCallCount > 1) {
      return route.fulfill({ json: { provider: 'sportradar', fixtures: [] } });
    }
    return route.fulfill({
      json: {
        provider: 'sportradar',
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
      json: {
        provider: 'sportradar',
        team: {
          prevSeason: isHome ? HOME_TEAM : AWAY_TEAM,
          recentMatches: RECENT_MATCHES,
        },
      },
    });
  });

  await page.route('**/api/football/h2h*', async (route) => {
    return route.fulfill({ json: { provider: 'sportradar', h2h: H2H_MATCHES } });
  });

  await page.route('**/api/tennis/fixtures*', async (route) => {
    return route.fulfill({ json: { provider: 'sportradar', fixtures: [] } });
  });
}

async function configureSportradarKey(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('sports_selection_guest_mode', 'true');
  });
  await page.goto('/');
  await page.click('#nav-settings');
  await page.getByRole('button', { name: /sportradar.*sportmonks/i }).click();
  await page.fill('#key-sportradar-football', 'e2e-test-fake-key');
  await page.fill('#key-sportradar-tennis', 'e2e-test-fake-key');
  await page.click('#btn-save-settings');
  await expect(page.getByText('Configuration saved')).toBeVisible();
}

test.describe('Real pipeline against a mocked backend', () => {
  test('a fixture that clears every statistical filter lands in Price Watch (not Verified) because Betfair odds are not yet connected', async ({ page }) => {
    await mockBackend(page);
    await configureSportradarKey(page);

    // The banner must reflect the real (mocked) call outcome, not assume success.
    await expect(page.locator('#provider-status-banner')).toContainText('Connected', {
      timeout: 15000,
    });

    await page.click('#nav-pricewatch');
    await expect(page.locator('#price-watch-view')).toContainText('Mock City vs Mock Rovers');
    await expect(page.locator('#price-watch-view')).toContainText(
      'Not yet connected — exchange odds integration pending'
    );

    // It must NOT also appear as a Verified Qualifier — that would mean the
    // odds gate was skipped rather than genuinely enforced.
    await page.click('#nav-verified');
    await expect(page.locator('#verified-qualifiers-view')).not.toContainText('Mock City vs Mock Rovers');
  });

  test('opening the audit drawer shows the real provider that supplied the fixture', async ({ page }) => {
    await mockBackend(page);
    await configureSportradarKey(page);

    await page.click('#nav-pricewatch');
    // The desktop table and mobile card list both render in the DOM at once
    // (CSS breakpoints pick which is visible), so a text locator alone is
    // ambiguous — target the row's stable id instead.
    await page.click('#price-watch-row-FT-OV15-mock-1');

    await expect(page.locator('#verification-drawer')).toBeVisible();
    await expect(page.locator('#verification-drawer')).toContainText('Sportradar');
    // Regression guard for the fabricated-sourcing bug: must never show the
    // old, meaningless Premium/Fallback framing.
    await expect(page.locator('#verification-drawer')).not.toContainText('Premium (direct)');
    await expect(page.locator('#verification-drawer')).not.toContainText('Fallback (B2B)');
  });

  test('a provider HTTP failure is surfaced honestly, not silently swallowed', async ({ page }) => {
    await page.route('**/api/football/fixtures*', (route) =>
      route.fulfill({ status: 401, json: { error: 'Invalid API key' } })
    );
    await page.route('**/api/tennis/fixtures*', (route) =>
      route.fulfill({ status: 401, json: { error: 'Invalid API key' } })
    );
    await configureSportradarKey(page);

    await expect(page.locator('#provider-status-banner')).toContainText('Provider error', {
      timeout: 15000,
    });
    await expect(page.locator('#provider-status-banner')).toContainText(/invalid api key/i);
  });
});
