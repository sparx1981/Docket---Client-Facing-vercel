import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RuleThresholds, TeamRecentMatch, CandidateFixture, AppSettings } from '../src/types/index.ts';
import { evaluateCombinedLast10Goals, evaluateFootballUnder35 } from '../src/services/rulesEngine.ts';
import { runVerificationAudit } from '../src/services/verificationEngine.ts';
import { buildFootballCandidate, fetchCandidateFixtures } from '../src/services/dataFeed.ts';
import { calculateSystemBreakdown } from '../src/services/filterBreakdown.ts';
import { buildFeedCsv } from '../src/services/feedCsv.ts';
import { runBacktest } from '../src/services/backtest.ts';

const thresholds: RuleThresholds = {
  footballOver15: { enabled: true, minPrevSeasonAvgScored: 1, minH2HOver15Rate: .8, minRecentScoredCount: 4, minExchangeOdds: 1.15, enhancedOddsThreshold: 1.25, selectedLeagueIds: [] },
  footballUnder35: { enabled: true, maxLast5AvgScored: 1, maxLast5AvgConceded: 1.8, maxLast10AvgTotalGoals: 2, minExchangeOdds: 1.2, selectedLeagueIds: ['league'] },
};
const matches = (goals: number, count = 10): TeamRecentMatch[] => Array.from({ length: count }, (_, i) => ({
  date: `2026-09-${String(20 - i).padStart(2, '0')}`, opponent: 'Opponent', isHome: true,
  teamGoals: 0, opponentGoals: goals, totalGoals: goals, competition: 'League',
  scoredAtLeastOne: false, under35Goals: goals < 4, isCompetitive: true,
}));
const season = { team: 'Team', season: '2025', league: 'League', matchesPlayed: 10, goalsScored: 10, goalsConceded: 10, avgGoalsScored: 1, avgGoalsConceded: 1 };
function fixture(home = matches(1), away = [...matches(1).slice(0, 5), ...matches(5).slice(5)]): CandidateFixture {
  return buildFootballCandidate('football_under_3_5', {
    providerId: 'match', homeOrPlayer1: 'Home', awayOrPlayer2: 'Away', competition: 'League', matchTime: '2026-10-10T12:00:00Z',
  }, { homePrevSeason: season, awayPrevSeason: season, homeRecentMatches: home, awayRecentMatches: away, h2hMatches: [] }, thresholds,
  undefined, { bookmaker: 'Bookmaker', marketType: 'OVER_UNDER_35', selectionName: 'Under 3.5', decimalOdds: 1.2, lastUpdated: '2026-10-08T12:00:00Z' });
}

test('combines both teams rather than requiring each average to pass; 2.00 passes with no H2H', () => {
  const f = fixture();
  assert.equal(f.status, 'VERIFIED_QUALIFIER');
  assert.equal(runVerificationAudit(f, thresholds).status, 'VERIFIED');
  assert.equal(evaluateCombinedLast10Goals(matches(1), matches(3), 2).average, 2);
});
test('2.05 fails even though every match is Under 3.5', () => {
  const home = matches(2); home[9].opponentGoals = 3; home[9].totalGoals = 3;
  const f = fixture(home, matches(2));
  assert.equal(evaluateCombinedLast10Goals(home, matches(2), 2).average, 2.05);
  assert.equal(f.status, 'FAILED');
  assert.equal(runVerificationAudit(f, thresholds).status, 'FAILED_RECALC');
});
test('requires ten matches from each team, never divides a short sample by 20', () => {
  for (const home of [undefined, matches(0, 9)]) {
    assert.equal(evaluateCombinedLast10Goals(home, matches(0), 2).average, undefined);
  }
  const result = evaluateFootballUnder35(fixture(matches(0, 9), matches(0)), thresholds.footballUnder35);
  assert.equal(result.isVerifiedQualifier, false);
  assert.equal(result.filterChecks.find((c) => c.filterId === 'F3_LAST10_AVG_TOTAL_GOALS')?.noData, true);
});
test('uses newest ten against any opponents and raw scored + conceded', () => {
  const home = matches(2).reverse(); home.forEach((m) => { m.totalGoals = 999; });
  home.unshift({ ...matches(20)[0], date: '2020-01-01' });
  assert.equal(evaluateCombinedLast10Goals(home, matches(2), 2).average, 2);
});
test('inclusive configurable maximum and invalid scores', () => {
  assert.equal(evaluateCombinedLast10Goals(matches(3), matches(3), 3).passed, true);
  assert.equal(evaluateCombinedLast10Goals(matches(3), matches(3), 2).passed, false);
  const home = matches(0); home[0].teamGoals = NaN;
  assert.equal(evaluateCombinedLast10Goals(home, matches(0), 2).passed, false);
});
test('legacy H2H settings default to 2.00 rather than reusing 80%', () => {
  const legacy = { ...thresholds.footballUnder35, maxLast10AvgTotalGoals: undefined, minH2HUnder35Rate: .8 } as unknown as RuleThresholds['footballUnder35'];
  assert.equal(evaluateFootballUnder35(fixture(), legacy).isVerifiedQualifier, true);
});

test('last-five conceded 1.80 passes, scored 1.00 fails, and both sides must pass', () => {
  const home = matches(0); home[0].opponentGoals = 9;
  assert.equal(fixture(home, matches(0)).status, 'VERIFIED_QUALIFIER');
  home[0].opponentGoals = 10;
  assert.equal(fixture(home, matches(0)).status, 'FAILED');
  const away = matches(0); away[0].teamGoals = 5;
  assert.equal(fixture(matches(0), away).status, 'FAILED');
});

test('Under 3.5 audit can verify recent evidence without season stats or H2H', () => {
  const f = fixture(matches(0), matches(0));
  f.partialStats = { homeRecentMatches: f.footballDetails!.homeRecentMatches, awayRecentMatches: f.footballDetails!.awayRecentMatches };
  f.footballDetails = undefined;
  assert.equal(evaluateFootballUnder35(f, thresholds.footballUnder35).isVerifiedQualifier, true);
  assert.equal(runVerificationAudit(f, thresholds).status, 'VERIFIED');
  f.marketOdds = undefined;
  assert.equal(evaluateFootballUnder35(f, thresholds.footballUnder35).isPriceWatch, true);
  assert.equal(runVerificationAudit(f, thresholds).status, 'PRICE_DEFICIT');
});

test('live ingestion, filter impact and CSV use recent history even when season stats and H2H are absent', async () => {
  const originalFetch = globalThis.fetch;
  let cards = 0;
  globalThis.fetch = async (input) => {
    const path = String(input);
    let body: unknown;
    if (path.includes('/fixtures?')) body = { fixtures: cards++ === 0 ? [{ providerId: 'match', homeOrPlayer1: 'Home', awayOrPlayer2: 'Away', homeId: 'h', awayId: 'a', competition: 'League', matchTime: '2026-10-10T12:00:00Z' }] : [] };
    else if (path.includes('/team/')) body = { team: { recentMatches: matches(0) } };
    else if (path.includes('/h2h?')) body = { h2h: [] };
    else if (path.includes('/market-odds/')) body = { odds: [fixture().marketOdds] };
    else throw new Error(`Unexpected test request: ${path}`);
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const settings = { theStatsApiKey: 'test', leagueCatalog: [], ruleThresholds: { ...thresholds, footballOver15: { ...thresholds.footballOver15, enabled: false } } } as unknown as AppSettings;
    const result = await fetchCandidateFixtures(settings);
    assert.equal(result.fixtures.length, 1);
    assert.equal(result.fixtures[0].status, 'VERIFIED_QUALIFIER');
    assert.equal(runVerificationAudit(result.fixtures[0], thresholds).status, 'VERIFIED');
    const breakdown = calculateSystemBreakdown({ systemKey: 'footballUnder35', thresholds, isConfigured: true, fixtures: result.fixtures, leagueCatalog: [] });
    assert.equal(breakdown.verifiedQualifiersCount, 1);
    assert.equal(breakdown.enrichedRecordsCount, 1);
    const csv = buildFeedCsv(breakdown)!;
    assert.ok(csv.includes('Home last 10 match scores'));
    assert.ok(csv.includes('0 total goals / 20 match entries = 0.00'));
    assert.ok(!csv.includes('H2H'));
  } finally { globalThis.fetch = originalFetch; }
});

test('backtest qualifies from historical recent evidence without previous season or H2H', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const path = String(input);
    const body = path.includes('/backtest-context?')
      ? { context: { homeRecentMatches: matches(0), awayRecentMatches: matches(0) } }
      : { matches: [{ providerId: 'match', homeId: 'h', awayId: 'a', homeOrPlayer1: 'Home', awayOrPlayer2: 'Away', competition: 'League', competitionId: 'league', seasonId: 'season', matchTime: '2026-10-01T12:00:00Z', homeScore: 0, awayScore: 0 }] };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await runBacktest({ theStatsApiKey: 'test', ruleThresholds: thresholds } as AppSettings, 'football_under_3_5', ['league'], 'League', 10);
    assert.equal(result.matches.length, 1);
  } finally { globalThis.fetch = originalFetch; }
});
