import type {
  CandidateFixture,
  DataProviderType,
  FeedSummaryRecord,
  FilterReductionStep,
  LeagueOption,
  RuleThresholds,
  Sport,
  SystemFeedBreakdown,
  SystemType,
} from '../types';
import { FILTER_LABELS, evaluateFootballOver15, evaluateFootballUnder35 } from './rulesEngine.js';

/** Human-readable summary of a rule's league scope, e.g. "All leagues" or "Premier League, La Liga". */
export function describeLeagueScope(selectedLeagueIds: string[], leagueCatalog: LeagueOption[]): string {
  if (selectedLeagueIds.length === 0) return 'All leagues';
  const names = selectedLeagueIds.map((id) => leagueCatalog.find((l) => l.id === id)?.name || id);
  if (names.length <= 3) return names.join(', ');
  return `${names.length} leagues selected`;
}

interface FilterDefinition {
  id: string;
  name: string;
  targetRule: string;
  targetValue: string;
  test: (fixture: CandidateFixture) => boolean;
}

/**
 * Calculates a live, honest breakdown of the effect of applying each filter in a rule
 * against the live records received from the provider's data feed.
 *
 * Strictly adheres to truthfulness:
 * - If the API key is not configured, isConfigured is false and 0 records are claimed.
 * - If the API failed to connect, the real error message is preserved and no fabricated rows are generated.
 * - All reductions and pass counts are computed directly from the actual candidate fixture objects in memory.
 */
export function calculateSystemBreakdown(params: {
  systemKey: 'footballOver15' | 'footballUnder35';
  thresholds: RuleThresholds;
  fixtures: CandidateFixture[];
  feedInfo?: FeedSummaryRecord;
  isConfigured: boolean;
  isLoading?: boolean;
  error?: string;
  leagueCatalog?: LeagueOption[];
}): SystemFeedBreakdown {
  const { systemKey, thresholds, fixtures, feedInfo, isConfigured, isLoading = false, error, leagueCatalog = [] } = params;

  if (systemKey === 'footballOver15') {
    return buildFootballOver15Breakdown({
      thresholds: thresholds.footballOver15,
      fixtures,
      feedInfo,
      isConfigured,
      isLoading,
      error,
      leagueScopeLabel: describeLeagueScope(thresholds.footballOver15.selectedLeagueIds, leagueCatalog),
    });
  }

  return buildFootballUnder35Breakdown({
    thresholds: thresholds.footballUnder35,
    fixtures,
    feedInfo,
    isConfigured,
    isLoading,
    error,
    leagueScopeLabel: describeLeagueScope(thresholds.footballUnder35.selectedLeagueIds, leagueCatalog),
  });
}

/* ================= Football Over 1.5 Goals ================= */

function buildFootballOver15Breakdown(params: {
  thresholds: RuleThresholds['footballOver15'];
  fixtures: CandidateFixture[];
  feedInfo?: FeedSummaryRecord;
  isConfigured: boolean;
  isLoading: boolean;
  error?: string;
  leagueScopeLabel: string;
}): SystemFeedBreakdown {
  const { thresholds, fixtures, feedInfo, isConfigured, isLoading, error, leagueScopeLabel } = params;

  // Filter down to football fixtures for this system (or matching match records)
  const footballFixtures = fixtures.filter(
    (f) => f.sport === 'football' && (f.system === 'football_over_1_5' || f.footballDetails !== undefined)
  );

  // Deduplicate by match title/fixture if both systems created candidates for the same match
  const uniqueFootballMatches = deduplicateMatches(footballFixtures);

  const rawTotal = feedInfo?.totalRecordsReceived ?? (uniqueFootballMatches[0]?.rawFeedTotal || uniqueFootballMatches.length);
  const enrichedCount = uniqueFootballMatches.filter((f) => !!f.footballDetails).length;
  const incompleteCount = Math.max(0, rawTotal - enrichedCount);

  const provider: DataProviderType | 'NONE' = feedInfo?.provider ?? (uniqueFootballMatches[0]?.sourceProvider || 'THESTATSAPI');

  if (!isConfigured || error || isLoading || rawTotal === 0) {
    return {
      sport: 'football',
      system: 'football_over_1_5',
      ruleTitle: 'Football — Over 1.5 Goals',
      leagueScopeLabel,
      provider: isConfigured ? provider : 'NONE',
      isConfigured,
      isLoading,
      error,
      totalFeedRecords: rawTotal,
      enrichedRecordsCount: enrichedCount,
      incompleteDataCount: incompleteCount,
      filterSteps: [],
      preliminaryQualifiersCount: 0,
      verifiedQualifiersCount: 0,
      priceWatchCount: 0,
      fetchedAt: feedInfo?.fetchedAt,
      rawMatches: uniqueFootballMatches,
      ruleThresholds: thresholds,
    };
  }

  // Every filter's pass/fail is read straight from the rules engine's own
  // check for that filter (never re-implemented here), so this funnel, the
  // scan's classification and the CSV export can never disagree.
  const passes = (f: CandidateFixture, id: string) =>
    evaluateFootballOver15(f, { ...thresholds, enabled: true }).filterChecks.find((c) => c.filterId === id)?.passed ?? false;

  const filterDefs: FilterDefinition[] = [
    {
      id: 'F1_PREV_SEASON_SCORED',
      name: FILTER_LABELS.F1_PREV_SEASON_SCORED,
      targetRule: `Both teams avg >= ${thresholds.minPrevSeasonAvgScored.toFixed(2)} goals scored/match`,
      targetValue: `>= ${thresholds.minPrevSeasonAvgScored.toFixed(2)} goals`,
      test: (f) => passes(f, 'F1_PREV_SEASON_SCORED'),
    },
    {
      id: 'F2_H2H_OVER15',
      name: FILTER_LABELS.F2_H2H_OVER15,
      targetRule: `Last 5 competitive H2H meetings >= ${(thresholds.minH2HOver15Rate * 100).toFixed(0)}% Over 1.5 Goals`,
      targetValue: `>= ${(thresholds.minH2HOver15Rate * 100).toFixed(0)}% (last 5 H2H, 5 meetings required)`,
      test: (f) => passes(f, 'F2_H2H_OVER15'),
    },
    {
      id: 'F3_RECENT_FORM_SCORED',
      name: FILTER_LABELS.F3_RECENT_FORM_SCORED,
      targetRule: `Each team scored in >= ${thresholds.minRecentScoredCount} of last 5 competitive matches`,
      targetValue: `>= ${thresholds.minRecentScoredCount} of last 5 matches`,
      test: (f) => passes(f, 'F3_RECENT_FORM_SCORED'),
    },
    {
      id: 'F4_EXCHANGE_PRICE',
      name: FILTER_LABELS.F4_EXCHANGE_PRICE,
      targetRule: `Market odds for Over 1.5 Goals >= ${thresholds.minExchangeOdds.toFixed(2)}`,
      targetValue: `>= @${thresholds.minExchangeOdds.toFixed(2)}`,
      test: (f) => passes(f, 'F4_EXCHANGE_PRICE'),
    },
  ];

  const steps = computeFilterSteps(uniqueFootballMatches, filterDefs, rawTotal);

  // Preliminary qualifiers are those that pass all statistical criteria (filters 1-3)
  const statisticalQualifiers = uniqueFootballMatches.filter(
    (f) => filterDefs[0].test(f) && filterDefs[1].test(f) && filterDefs[2].test(f)
  );
  const verifiedQualifiers = statisticalQualifiers.filter((f) => filterDefs[3].test(f));
  const priceWatch = statisticalQualifiers.filter((f) => !filterDefs[3].test(f));

  return {
    sport: 'football',
    system: 'football_over_1_5',
    ruleTitle: 'Football — Over 1.5 Goals',
    leagueScopeLabel,
    provider,
    isConfigured,
    isLoading: false,
    error: undefined,
    totalFeedRecords: rawTotal,
    enrichedRecordsCount: enrichedCount,
    incompleteDataCount: incompleteCount,
    filterSteps: steps,
    preliminaryQualifiersCount: statisticalQualifiers.length,
    verifiedQualifiersCount: verifiedQualifiers.length,
    priceWatchCount: priceWatch.length,
    fetchedAt: feedInfo?.fetchedAt,
    rawMatches: uniqueFootballMatches,
    ruleThresholds: thresholds,
  };
}

/* ================= Football Under 3.5 Goals ================= */

function buildFootballUnder35Breakdown(params: {
  thresholds: RuleThresholds['footballUnder35'];
  fixtures: CandidateFixture[];
  feedInfo?: FeedSummaryRecord;
  isConfigured: boolean;
  isLoading: boolean;
  error?: string;
  leagueScopeLabel: string;
}): SystemFeedBreakdown {
  const { thresholds, fixtures, feedInfo, isConfigured, isLoading, error, leagueScopeLabel } = params;

  const footballFixtures = fixtures.filter(
    (f) => f.sport === 'football' && (f.system === 'football_under_3_5' || f.footballDetails !== undefined)
  );
  const uniqueFootballMatches = deduplicateMatches(footballFixtures);

  const rawTotal = feedInfo?.totalRecordsReceived ?? (uniqueFootballMatches[0]?.rawFeedTotal || uniqueFootballMatches.length);
  const enrichedCount = uniqueFootballMatches.filter((f) => !!f.footballDetails).length;
  const incompleteCount = Math.max(0, rawTotal - enrichedCount);

  const provider: DataProviderType | 'NONE' = feedInfo?.provider ?? (uniqueFootballMatches[0]?.sourceProvider || 'THESTATSAPI');

  if (!isConfigured || error || isLoading || rawTotal === 0) {
    return {
      sport: 'football',
      system: 'football_under_3_5',
      ruleTitle: 'Football — Under 3.5 Goals',
      leagueScopeLabel,
      provider: isConfigured ? provider : 'NONE',
      isConfigured,
      isLoading,
      error,
      totalFeedRecords: rawTotal,
      enrichedRecordsCount: enrichedCount,
      incompleteDataCount: incompleteCount,
      filterSteps: [],
      preliminaryQualifiersCount: 0,
      verifiedQualifiersCount: 0,
      priceWatchCount: 0,
      fetchedAt: feedInfo?.fetchedAt,
      rawMatches: uniqueFootballMatches,
      ruleThresholds: thresholds,
    };
  }

  // See the equivalent note in the Over 1.5 breakdown: pass/fail comes from the rules engine.
  const passes = (f: CandidateFixture, id: string) =>
    evaluateFootballUnder35(f, { ...thresholds, enabled: true }).filterChecks.find((c) => c.filterId === id)?.passed ?? false;

  const filterDefs: FilterDefinition[] = [
    {
      id: 'F1_PREV_SEASON_SCORED_U35',
      name: FILTER_LABELS.F1_PREV_SEASON_SCORED_U35,
      targetRule: `Both teams avg < ${thresholds.maxPrevSeasonAvgScored.toFixed(2)} goals scored/match`,
      targetValue: `< ${thresholds.maxPrevSeasonAvgScored.toFixed(2)} GF/m`,
      test: (f) => passes(f, 'F1_PREV_SEASON_SCORED_U35'),
    },
    {
      id: 'F2_PREV_SEASON_CONCEDED_U35',
      name: FILTER_LABELS.F2_PREV_SEASON_CONCEDED_U35,
      targetRule: `Both teams avg < ${thresholds.maxPrevSeasonAvgConceded.toFixed(2)} goals conceded/match`,
      targetValue: `< ${thresholds.maxPrevSeasonAvgConceded.toFixed(2)} GA/m`,
      test: (f) => passes(f, 'F2_PREV_SEASON_CONCEDED_U35'),
    },
    {
      id: 'F3_H2H_UNDER35',
      name: FILTER_LABELS.F3_H2H_UNDER35,
      targetRule: `Last 10 competitive meetings >= ${(thresholds.minH2HUnder35Rate * 100).toFixed(0)}% Under 3.5 Goals`,
      targetValue: `>= ${(thresholds.minH2HUnder35Rate * 100).toFixed(0)}% (last 10 H2H, 8 meetings required)`,
      test: (f) => passes(f, 'F3_H2H_UNDER35'),
    },
    {
      id: 'F4_RECENT_FORM_UNDER35',
      name: FILTER_LABELS.F4_RECENT_FORM_UNDER35,
      targetRule: `Each team has >= ${thresholds.minRecentUnder35Count} of last 5 competitive matches Under 3.5`,
      targetValue: `>= ${thresholds.minRecentUnder35Count} of last 5 matches`,
      test: (f) => passes(f, 'F4_RECENT_FORM_UNDER35'),
    },
    {
      id: 'F5_EXCHANGE_PRICE_U35',
      name: FILTER_LABELS.F5_EXCHANGE_PRICE_U35,
      targetRule: `Market odds for Under 3.5 Goals >= ${thresholds.minExchangeOdds.toFixed(2)}`,
      targetValue: `>= @${thresholds.minExchangeOdds.toFixed(2)}`,
      test: (f) => passes(f, 'F5_EXCHANGE_PRICE_U35'),
    },
  ];

  const steps = computeFilterSteps(uniqueFootballMatches, filterDefs, rawTotal);

  const statisticalQualifiers = uniqueFootballMatches.filter(
    (f) => filterDefs[0].test(f) && filterDefs[1].test(f) && filterDefs[2].test(f) && filterDefs[3].test(f)
  );
  const verifiedQualifiers = statisticalQualifiers.filter((f) => filterDefs[4].test(f));
  const priceWatch = statisticalQualifiers.filter((f) => !filterDefs[4].test(f));

  return {
    sport: 'football',
    system: 'football_under_3_5',
    ruleTitle: 'Football — Under 3.5 Goals',
    leagueScopeLabel,
    provider,
    isConfigured,
    isLoading: false,
    error: undefined,
    totalFeedRecords: rawTotal,
    enrichedRecordsCount: enrichedCount,
    incompleteDataCount: incompleteCount,
    filterSteps: steps,
    preliminaryQualifiersCount: statisticalQualifiers.length,
    verifiedQualifiersCount: verifiedQualifiers.length,
    priceWatchCount: priceWatch.length,
    fetchedAt: feedInfo?.fetchedAt,
    rawMatches: uniqueFootballMatches,
    ruleThresholds: thresholds,
  };
}

/* ================= Helper Utilities ================= */

/**
 * Computes both standalone filter reductions and sequential pipeline reductions.
 */
function computeFilterSteps(
  matches: CandidateFixture[],
  filterDefs: FilterDefinition[],
  rawTotal: number
): FilterReductionStep[] {
  const steps: FilterReductionStep[] = [];
  let currentPipeline = [...matches];

  for (let i = 0; i < filterDefs.length; i++) {
    const def = filterDefs[i];

    // Standalone evaluation across all matches
    const standalonePassed = matches.filter(def.test).length;
    const standaloneEliminated = Math.max(0, rawTotal - standalonePassed);
    const standaloneReductionPct = rawTotal > 0 ? (standaloneEliminated / rawTotal) * 100 : 0;

    // Sequential pipeline evaluation
    const prevPipelineCount = currentPipeline.length;
    currentPipeline = currentPipeline.filter(def.test);
    const pipelineRemaining = currentPipeline.length;
    const pipelineEliminatedAtStep = Math.max(0, prevPipelineCount - pipelineRemaining);
    const cumulativeEliminated = Math.max(0, rawTotal - pipelineRemaining);
    const cumulativeReductionPct = rawTotal > 0 ? (cumulativeEliminated / rawTotal) * 100 : 0;

    steps.push({
      filterId: def.id,
      filterName: def.name,
      targetRule: def.targetRule,
      targetValue: def.targetValue,
      standalonePassedCount: standalonePassed,
      standaloneEliminatedCount: standaloneEliminated,
      standaloneReductionPct: Math.round(standaloneReductionPct * 10) / 10,
      pipelineRemainingCount: pipelineRemaining,
      pipelineEliminatedCount: pipelineEliminatedAtStep,
      cumulativeReductionPct: Math.round(cumulativeReductionPct * 10) / 10,
    });
  }

  return steps;
}

/**
 * Deduplicates fixtures by matchTitle or unique match identifier.
 */
function deduplicateMatches(fixtures: CandidateFixture[]): CandidateFixture[] {
  const seen = new Set<string>();
  const out: CandidateFixture[] = [];
  for (const f of fixtures) {
    const key = `${f.matchTitle}-${f.matchTime}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}
