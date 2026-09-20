import {
  CandidateFixture,
  DataProviderType,
  FeedSummaryRecord,
  FilterReductionStep,
  RuleThresholds,
  Sport,
  SystemFeedBreakdown,
  SystemType,
} from '../types';

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
  systemKey: 'footballOver15' | 'footballUnder35' | 'tennisStraightSets';
  thresholds: RuleThresholds;
  fixtures: CandidateFixture[];
  feedInfo?: FeedSummaryRecord;
  isConfigured: boolean;
  isLoading?: boolean;
  error?: string;
}): SystemFeedBreakdown {
  const { systemKey, thresholds, fixtures, feedInfo, isConfigured, isLoading = false, error } = params;

  if (systemKey === 'footballOver15') {
    return buildFootballOver15Breakdown({
      thresholds: thresholds.footballOver15,
      fixtures,
      feedInfo,
      isConfigured,
      isLoading,
      error,
    });
  }

  if (systemKey === 'footballUnder35') {
    return buildFootballUnder35Breakdown({
      thresholds: thresholds.footballUnder35,
      fixtures,
      feedInfo,
      isConfigured,
      isLoading,
      error,
    });
  }

  return buildTennisStraightSetsBreakdown({
    thresholds: thresholds.tennisStraightSets,
    fixtures,
    feedInfo,
    isConfigured,
    isLoading,
    error,
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
}): SystemFeedBreakdown {
  const { thresholds, fixtures, feedInfo, isConfigured, isLoading, error } = params;

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
    };
  }

  const filterDefs: FilterDefinition[] = [
    {
      id: 'F1_PREV_SEASON_SCORED',
      name: 'Min. prev-season avg scored',
      targetRule: `Both teams avg >= ${thresholds.minPrevSeasonAvgScored.toFixed(2)} goals scored/match`,
      targetValue: `>= ${thresholds.minPrevSeasonAvgScored.toFixed(2)} goals`,
      test: (f) => {
        if (!f.footballDetails) return false;
        return (
          f.footballDetails.homePrevSeason.avgGoalsScored >= thresholds.minPrevSeasonAvgScored &&
          f.footballDetails.awayPrevSeason.avgGoalsScored >= thresholds.minPrevSeasonAvgScored
        );
      },
    },
    {
      id: 'F2_H2H_OVER15',
      name: 'Min. H2H Over 1.5 rate',
      targetRule: `Last 5 competitive H2H meetings >= ${(thresholds.minH2HOver15Rate * 100).toFixed(0)}% Over 1.5 Goals`,
      targetValue: `>= ${(thresholds.minH2HOver15Rate * 100).toFixed(0)}% (last 5 H2H)`,
      test: (f) => {
        if (!f.footballDetails) return false;
        const competitiveH2H = f.footballDetails.h2hMatches.filter((m) => m.isCompetitive).slice(0, 5);
        const over15Count = competitiveH2H.filter((m) => m.totalGoals > 1).length;
        const minReq = Math.ceil(thresholds.minH2HOver15Rate * 5);
        return competitiveH2H.length >= 5 && over15Count >= minReq;
      },
    },
    {
      id: 'F3_RECENT_FORM_SCORED',
      name: 'Min. recent scoring count',
      targetRule: `Each team scored in >= ${thresholds.minRecentScoredCount} of last 5 competitive matches`,
      targetValue: `>= ${thresholds.minRecentScoredCount} of last 5 matches`,
      test: (f) => {
        if (!f.footballDetails) return false;
        const homeComp = f.footballDetails.homeRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
        const awayComp = f.footballDetails.awayRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
        const homeScored = homeComp.filter((m) => m.scoredAtLeastOne).length;
        const awayScored = awayComp.filter((m) => m.scoredAtLeastOne).length;
        return (
          homeComp.length >= 5 &&
          awayComp.length >= 5 &&
          homeScored >= thresholds.minRecentScoredCount &&
          awayScored >= thresholds.minRecentScoredCount
        );
      },
    },
    {
      id: 'F4_EXCHANGE_PRICE',
      name: 'Min. exchange odds',
      targetRule: `Betfair Exchange Over 1.5 Goals price >= ${thresholds.minExchangeOdds.toFixed(2)}`,
      targetValue: `>= @${thresholds.minExchangeOdds.toFixed(2)}`,
      test: (f) => {
        const odds = f.betfairMarket?.decimalOdds;
        return typeof odds === 'number' && odds >= thresholds.minExchangeOdds;
      },
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
}): SystemFeedBreakdown {
  const { thresholds, fixtures, feedInfo, isConfigured, isLoading, error } = params;

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
    };
  }

  const filterDefs: FilterDefinition[] = [
    {
      id: 'F1_PREV_SEASON_SCORED_U35',
      name: 'Max. prev-season avg scored',
      targetRule: `Both teams avg < ${thresholds.maxPrevSeasonAvgScored.toFixed(2)} goals scored/match`,
      targetValue: `< ${thresholds.maxPrevSeasonAvgScored.toFixed(2)} GF/m`,
      test: (f) => {
        if (!f.footballDetails) return false;
        return (
          f.footballDetails.homePrevSeason.avgGoalsScored < thresholds.maxPrevSeasonAvgScored &&
          f.footballDetails.awayPrevSeason.avgGoalsScored < thresholds.maxPrevSeasonAvgScored
        );
      },
    },
    {
      id: 'F2_PREV_SEASON_CONCEDED_U35',
      name: 'Max. prev-season avg conceded',
      targetRule: `Both teams avg < ${thresholds.maxPrevSeasonAvgConceded.toFixed(2)} goals conceded/match`,
      targetValue: `< ${thresholds.maxPrevSeasonAvgConceded.toFixed(2)} GA/m`,
      test: (f) => {
        if (!f.footballDetails) return false;
        return (
          f.footballDetails.homePrevSeason.avgGoalsConceded < thresholds.maxPrevSeasonAvgConceded &&
          f.footballDetails.awayPrevSeason.avgGoalsConceded < thresholds.maxPrevSeasonAvgConceded
        );
      },
    },
    {
      id: 'F3_H2H_UNDER35',
      name: 'Min. H2H Under 3.5 rate',
      targetRule: `Last 10 competitive meetings >= ${(thresholds.minH2HUnder35Rate * 100).toFixed(0)}% Under 3.5 Goals`,
      targetValue: `>= ${(thresholds.minH2HUnder35Rate * 100).toFixed(0)}% (last 10 H2H)`,
      test: (f) => {
        if (!f.footballDetails) return false;
        const compH2H = f.footballDetails.h2hMatches.filter((m) => m.isCompetitive).slice(0, 10);
        const under35Count = compH2H.filter((m) => m.totalGoals < 4).length;
        return compH2H.length >= 8 && under35Count / compH2H.length >= thresholds.minH2HUnder35Rate;
      },
    },
    {
      id: 'F4_RECENT_FORM_UNDER35',
      name: 'Min. recent Under 3.5 count',
      targetRule: `Each team has >= ${thresholds.minRecentUnder35Count} of last 5 competitive matches Under 3.5`,
      targetValue: `>= ${thresholds.minRecentUnder35Count} of last 5 matches`,
      test: (f) => {
        if (!f.footballDetails) return false;
        const homeComp = f.footballDetails.homeRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
        const awayComp = f.footballDetails.awayRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
        const homeU35 = homeComp.filter((m) => m.under35Goals).length;
        const awayU35 = awayComp.filter((m) => m.under35Goals).length;
        return (
          homeComp.length >= 5 &&
          awayComp.length >= 5 &&
          homeU35 >= thresholds.minRecentUnder35Count &&
          awayU35 >= thresholds.minRecentUnder35Count
        );
      },
    },
    {
      id: 'F5_EXCHANGE_PRICE_U35',
      name: 'Min. exchange odds',
      targetRule: `Betfair Exchange Under 3.5 Goals price >= ${thresholds.minExchangeOdds.toFixed(2)}`,
      targetValue: `>= @${thresholds.minExchangeOdds.toFixed(2)}`,
      test: (f) => {
        const odds = f.betfairMarket?.decimalOdds;
        return typeof odds === 'number' && odds >= thresholds.minExchangeOdds;
      },
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
  };
}

/* ================= Tennis Straight Sets ================= */

function buildTennisStraightSetsBreakdown(params: {
  thresholds: RuleThresholds['tennisStraightSets'];
  fixtures: CandidateFixture[];
  feedInfo?: FeedSummaryRecord;
  isConfigured: boolean;
  isLoading: boolean;
  error?: string;
}): SystemFeedBreakdown {
  const { thresholds, fixtures, feedInfo, isConfigured, isLoading, error } = params;

  const tennisFixtures = fixtures.filter(
    (f) => f.sport === 'tennis' || f.tennisDetails !== undefined || f.system === 'tennis_straight_sets'
  );
  const uniqueTennisMatches = deduplicateMatches(tennisFixtures);

  const rawTotal = feedInfo?.totalRecordsReceived ?? (uniqueTennisMatches[0]?.rawFeedTotal || uniqueTennisMatches.length);
  const enrichedCount = uniqueTennisMatches.filter((f) => !!f.tennisDetails).length;
  const incompleteCount = Math.max(0, rawTotal - enrichedCount);

  const provider: DataProviderType | 'NONE' = feedInfo?.provider ?? (uniqueTennisMatches[0]?.sourceProvider || 'SPORTRADAR');

  if (!isConfigured || error || isLoading || rawTotal === 0) {
    return {
      sport: 'tennis',
      system: 'tennis_straight_sets',
      ruleTitle: 'Tennis — Straight Sets',
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
      rawMatches: uniqueTennisMatches,
    };
  }

  const filterDefs: FilterDefinition[] = [
    {
      id: 'T1_RANKING_DELTA',
      name: 'Min. ranking delta',
      targetRule: `Selected player ranked >= ${thresholds.minRankingDelta} places higher than opponent`,
      targetValue: `>= +${thresholds.minRankingDelta} places`,
      test: (f) => {
        if (!f.tennisDetails) return false;
        const diff = f.tennisDetails.opponentPlayer.ranking - f.tennisDetails.selectedPlayer.ranking;
        return diff >= thresholds.minRankingDelta;
      },
    },
    {
      id: 'T2_SURFACE_WIN_RATE',
      name: 'Min. career surface win rate',
      targetRule: `Selected player career surface win rate >= ${thresholds.minSurfaceWinRate.toFixed(1)}%`,
      targetValue: `>= ${thresholds.minSurfaceWinRate.toFixed(1)}% on surface`,
      test: (f) => {
        if (!f.tennisDetails) return false;
        return f.tennisDetails.selectedPlayer.careerSurfaceWinRate >= thresholds.minSurfaceWinRate;
      },
    },
    {
      id: 'T3_RECENT_SINGLES_FORM',
      name: 'Min. recent wins',
      targetRule: `Won >= ${thresholds.minRecentWinsCount} of last 10 completed competitive singles matches`,
      targetValue: `>= ${thresholds.minRecentWinsCount} of last 10 singles`,
      test: (f) => {
        if (!f.tennisDetails) return false;
        const recent = f.tennisDetails.playerRecentSingles
          .filter((m) => m.isCompetitiveSingles && m.isCompleted)
          .slice(0, 10);
        const wins = recent.filter((m) => m.won).length;
        return recent.length >= 10 && wins >= thresholds.minRecentWinsCount;
      },
    },
    {
      id: 'T4_EXCHANGE_PRICE_TENNIS',
      name: 'Min. exchange odds',
      targetRule: `Betfair Exchange Straight-Sets price >= ${thresholds.minExchangeOdds.toFixed(2)}`,
      targetValue: `>= @${thresholds.minExchangeOdds.toFixed(2)}`,
      test: (f) => {
        const odds = f.betfairMarket?.decimalOdds;
        return typeof odds === 'number' && odds >= thresholds.minExchangeOdds;
      },
    },
  ];

  const steps = computeFilterSteps(uniqueTennisMatches, filterDefs, rawTotal);

  const statisticalQualifiers = uniqueTennisMatches.filter(
    (f) => filterDefs[0].test(f) && filterDefs[1].test(f) && filterDefs[2].test(f)
  );
  const verifiedQualifiers = statisticalQualifiers.filter((f) => filterDefs[3].test(f));
  const priceWatch = statisticalQualifiers.filter((f) => !filterDefs[3].test(f));

  return {
    sport: 'tennis',
    system: 'tennis_straight_sets',
    ruleTitle: 'Tennis — Straight Sets',
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
    rawMatches: uniqueTennisMatches,
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
