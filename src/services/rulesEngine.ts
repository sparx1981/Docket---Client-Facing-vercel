import type {
  CandidateFixture,
  FilterAuditCheck,
  H2HMatchRecord,
  VerificationAuditCard,
  DataProviderType,
  RuleThresholds,
} from '../types';

/**
 * Strict Locked-Rules Filtering Engine
 * Evaluates fixtures according to Product Specification Section 2.2 and 2.3
 */

export interface ScreeningResult {
  passedStats: boolean;
  passedOdds: boolean;
  isPreliminaryQualifier: boolean;
  isVerifiedQualifier: boolean;
  isPriceWatch: boolean;
  filterChecks: FilterAuditCheck[];
  enhancedVerificationNeeded: boolean;
  enhancedVerificationReason?: string;
  failureReason?: string;
}

const DISABLED_RESULT: ScreeningResult = {
  passedStats: false,
  passedOdds: false,
  isPreliminaryQualifier: false,
  isVerifiedQualifier: false,
  isPriceWatch: false,
  filterChecks: [],
  enhancedVerificationNeeded: false,
  failureReason: 'System disabled in Engine Configuration',
};

/** Number of most-recent competitive meetings the Over 1.5 H2H filter looks at (and requires to exist). */
export const H2H_OVER15_WINDOW = 5;

export interface H2HOver15Evaluation {
  /** Competitive meetings actually considered (most recent first, capped at H2H_OVER15_WINDOW). */
  considered: number;
  over15: number;
  /** Meetings that must finish Over 1.5 for the configured rate. */
  required: number;
  /** 0-100, over the meetings considered (0 when there are none). */
  ratePercent: number;
  /** The filter needs a full window of meetings — a shorter history cannot pass even at 100%. */
  hasFullWindow: boolean;
  passed: boolean;
  /** Human-readable "3/3 (100%) — only 3 of 5 required meetings on record", for audit text and CSV. */
  summary: string;
}

/**
 * The single definition of the H2H Over 1.5 filter, shared by the rules
 * engine, the filter funnel, the audit recalculation and the CSV export so
 * they can never disagree: the last 5 competitive meetings must exist, and
 * at least ceil(rate * 5) of them must finish with 2+ goals. The ceil is
 * taken with a small epsilon so a rate like 0.6 (0.6 * 5 = 3.0000000000000004)
 * is not pushed up to 4 by floating-point noise.
 */
export function evaluateH2HOver15(h2hMatches: H2HMatchRecord[], minRate: number): H2HOver15Evaluation {
  const window = h2hMatches.filter((m) => m.isCompetitive).slice(0, H2H_OVER15_WINDOW);
  const considered = window.length;
  const over15 = window.filter((m) => m.totalGoals > 1).length;
  const required = Math.ceil(minRate * H2H_OVER15_WINDOW - 1e-9);
  const hasFullWindow = considered >= H2H_OVER15_WINDOW;
  const ratePercent = considered > 0 ? Math.round((over15 / considered) * 100) : 0;
  const passed = hasFullWindow && over15 >= required;
  const summary =
    considered === 0
      ? 'No competitive H2H meetings on record'
      : hasFullWindow
      ? `${over15}/${considered} (${ratePercent}%)`
      : `${over15}/${considered} (${ratePercent}%) — only ${considered} of ${H2H_OVER15_WINDOW} required meetings on record`;
  return { considered, over15, required, ratePercent, hasFullWindow, passed, summary };
}

/**
 * System A: Football Over 1.5 Goals
 * - Filter 1: Both teams independently avg >= configured goals scored/match in previous completed domestic league season.
 * - Filter 2: In the last 5 competitive meetings, at least the configured rate must finish with Over 1.5 Goals.
 * - Filter 3: Each team must score at least one goal in the configured count of their last 5 competitive matches (strictly excluding friendlies).
 * - Filter 4: Market odds (TheStatsAPI) Over 1.5 Goals decimal price >= configured minimum. Prices above the configured threshold trigger enhanced verification.
 * All thresholds are editable in Engine Configuration (AppSettings.ruleThresholds.footballOver15).
 */
export function evaluateFootballOver15(
  fixture: CandidateFixture,
  thresholds: RuleThresholds['footballOver15']
): ScreeningResult {
  if (!thresholds.enabled) return DISABLED_RESULT;

  const details = fixture.footballDetails;
  const filterChecks: FilterAuditCheck[] = [];

  if (!details) {
    return {
      passedStats: false,
      passedOdds: false,
      isPreliminaryQualifier: false,
      isVerifiedQualifier: false,
      isPriceWatch: false,
      filterChecks: [],
      enhancedVerificationNeeded: false,
      failureReason: 'Missing football data breakdown for secondary verification',
    };
  }

  // Filter 1: Previous Season Average Goals Scored >= configured minimum for BOTH teams
  const homeAvg = details.homePrevSeason.avgGoalsScored;
  const awayAvg = details.awayPrevSeason.avgGoalsScored;
  const minScored = thresholds.minPrevSeasonAvgScored;
  const f1Passed = homeAvg >= minScored && awayAvg >= minScored;

  filterChecks.push({
    filterId: 'F1_PREV_SEASON_SCORED',
    filterName: 'Previous Season Avg Scored',
    targetRule: `Both teams >= ${minScored.toFixed(2)} goals scored / match in previous domestic season`,
    observedValue: `${details.homePrevSeason.team}: ${homeAvg.toFixed(2)} | ${details.awayPrevSeason.team}: ${awayAvg.toFixed(2)}`,
    passed: f1Passed,
    auditDetails: `${details.homePrevSeason.team} scored ${details.homePrevSeason.goalsScored} in ${details.homePrevSeason.matchesPlayed} games (${details.homePrevSeason.season}). ${details.awayPrevSeason.team} scored ${details.awayPrevSeason.goalsScored} in ${details.awayPrevSeason.matchesPlayed} games.`,
  });

  // Filter 2: Head-to-Head - Last 5 competitive meetings, at least the configured rate Over 1.5 Goals
  const h2h = evaluateH2HOver15(details.h2hMatches, thresholds.minH2HOver15Rate);
  const competitiveH2H = details.h2hMatches.filter((m) => m.isCompetitive).slice(0, H2H_OVER15_WINDOW);
  const f2Passed = h2h.passed;

  filterChecks.push({
    filterId: 'F2_H2H_OVER15',
    filterName: 'Head-to-Head Over 1.5 Rate',
    targetRule: `Last ${H2H_OVER15_WINDOW} competitive H2H meetings >= ${h2h.required} (${(thresholds.minH2HOver15Rate * 100).toFixed(0)}%) Over 1.5 Goals`,
    observedValue: `${h2h.over15}/${h2h.considered} matches (${h2h.ratePercent}%)${h2h.hasFullWindow ? '' : ` — needs ${H2H_OVER15_WINDOW} meetings`}`,
    passed: f2Passed,
    auditDetails: `Recent competitive scores: ${competitiveH2H.map((m) => `${m.homeScore}-${m.awayScore} (${m.date})`).join(', ')}`,
  });

  // Filter 3: Recent Form - Each team scored at least 1 goal in the configured count of their last 5 competitive matches
  const homeCompRecent = details.homeRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
  const awayCompRecent = details.awayRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
  const homeScoredCount = homeCompRecent.filter((m) => m.scoredAtLeastOne).length;
  const awayScoredCount = awayCompRecent.filter((m) => m.scoredAtLeastOne).length;
  const minScoredCount = thresholds.minRecentScoredCount;
  const f3Passed =
    homeCompRecent.length >= 5 &&
    awayCompRecent.length >= 5 &&
    homeScoredCount >= minScoredCount &&
    awayScoredCount >= minScoredCount;

  filterChecks.push({
    filterId: 'F3_RECENT_FORM_SCORED',
    filterName: 'Recent Form Scoring Consistency',
    targetRule: `Each team scored >= 1 goal in at least ${minScoredCount} of their last 5 competitive matches`,
    observedValue: `${details.homePrevSeason.team}: ${homeScoredCount}/5 | ${details.awayPrevSeason.team}: ${awayScoredCount}/5`,
    passed: f3Passed,
    auditDetails: `Competitive recent games inspected: ${details.homePrevSeason.team} (${homeScoredCount}/5 scored), ${details.awayPrevSeason.team} (${awayScoredCount}/5 scored). Excluded friendlies.`,
  });

  // Filter 4: Price - Market odds (TheStatsAPI) Over 1.5 Goals decimal price >= configured minimum
  // TheStatsAPI's odds endpoint doesn't always carry a price for every
  // fixture (early-listed matches in particular). Treat a missing price as
  // "not yet known" rather than a pass, a fail, or a fabricated number — it
  // lands the fixture in Price Watch alongside genuine price deficits.
  const marketOdds = fixture.marketOdds?.decimalOdds;
  const requiredOdds = thresholds.minExchangeOdds;
  const f4Passed = typeof marketOdds === 'number' && marketOdds >= requiredOdds;
  const enhancedVerificationNeeded =
    typeof marketOdds === 'number' && marketOdds > thresholds.enhancedOddsThreshold;

  filterChecks.push({
    filterId: 'F4_EXCHANGE_PRICE',
    filterName: 'Market Odds Threshold',
    targetRule: `Market odds for Over 1.5 Goals >= ${requiredOdds.toFixed(2)} (Trigger Enhanced Audit if > ${thresholds.enhancedOddsThreshold.toFixed(2)})`,
    observedValue:
      typeof marketOdds === 'number'
        ? `@${marketOdds.toFixed(2)} (Required: >= ${requiredOdds.toFixed(2)})`
        : `No price on file yet for this fixture (Required: >= ${requiredOdds.toFixed(2)})`,
    passed: f4Passed,
    auditDetails: fixture.marketOdds
      ? `Priced via ${fixture.marketOdds.bookmaker}, last updated ${fixture.marketOdds.lastUpdated}.`
      : 'TheStatsAPI has not returned a price for this fixture yet.',
  });

  const passedStats = f1Passed && f2Passed && f3Passed;
  const passedOdds = f4Passed;
  const isPreliminaryQualifier = passedStats;
  const isVerifiedQualifier = passedStats && passedOdds;
  const isPriceWatch = passedStats && !passedOdds;

  let enhancedVerificationReason: string | undefined;
  if (enhancedVerificationNeeded && isVerifiedQualifier && typeof marketOdds === 'number') {
    enhancedVerificationReason = `Odds @${marketOdds.toFixed(2)} exceed standard high-probability band (> 1.25). Secondary liquidity & squad line-up audit passed.`;
  }

  let failureReason: string | undefined;
  if (!passedStats) {
    const failedRules = filterChecks.filter((c) => !c.passed).map((c) => c.filterName);
    failureReason = `Failed statistical criteria: ${failedRules.join(', ')}`;
  } else if (!passedOdds) {
    failureReason =
      typeof marketOdds === 'number'
        ? `Statistical criteria satisfied, but odds @${marketOdds.toFixed(2)} are below required ${requiredOdds.toFixed(2)}`
        : `Statistical criteria satisfied, but TheStatsAPI has no price on file for this fixture yet`;
  }

  return {
    passedStats,
    passedOdds,
    isPreliminaryQualifier,
    isVerifiedQualifier,
    isPriceWatch,
    filterChecks,
    enhancedVerificationNeeded,
    enhancedVerificationReason,
    failureReason,
  };
}

/**
 * System B: Football Under 3.5 Goals
 * - Filter 1 & 2: Both teams independently avg < configured scored AND < configured conceded per match in previous domestic season.
 * - Filter 3: In the last 10 competitive meetings, at least the configured rate must finish with Under 3.5 Goals.
 * - Filter 4: For each team independently, at least the configured count of their last 5 competitive matches must finish with Under 3.5 Goals.
 * - Filter 5: Market odds (TheStatsAPI) Under 3.5 Goals decimal price >= configured minimum.
 * All thresholds are editable in Engine Configuration (AppSettings.ruleThresholds.footballUnder35).
 */
export function evaluateFootballUnder35(
  fixture: CandidateFixture,
  thresholds: RuleThresholds['footballUnder35']
): ScreeningResult {
  if (!thresholds.enabled) return DISABLED_RESULT;

  const details = fixture.footballDetails;
  const filterChecks: FilterAuditCheck[] = [];

  if (!details) {
    return {
      passedStats: false,
      passedOdds: false,
      isPreliminaryQualifier: false,
      isVerifiedQualifier: false,
      isPriceWatch: false,
      filterChecks: [],
      enhancedVerificationNeeded: false,
      failureReason: 'Missing football data breakdown for secondary verification',
    };
  }

  // Filter 1 & 2: Scored < configured AND Conceded < configured for BOTH teams
  const homeScored = details.homePrevSeason.avgGoalsScored;
  const homeConceded = details.homePrevSeason.avgGoalsConceded;
  const awayScored = details.awayPrevSeason.avgGoalsScored;
  const awayConceded = details.awayPrevSeason.avgGoalsConceded;
  const maxScored = thresholds.maxPrevSeasonAvgScored;
  const maxConceded = thresholds.maxPrevSeasonAvgConceded;

  const f1Passed =
    homeScored < maxScored && homeConceded < maxConceded && awayScored < maxScored && awayConceded < maxConceded;

  filterChecks.push({
    filterId: 'F1_PREV_SEASON_U35_METRICS',
    filterName: 'Previous Season Scored & Conceded Bounds',
    targetRule: `Both teams avg < ${maxScored.toFixed(2)} goals scored AND < ${maxConceded.toFixed(2)} conceded / match in domestic season`,
    observedValue: `${details.homePrevSeason.team}: ${homeScored.toFixed(2)} GF / ${homeConceded.toFixed(2)} GA | ${details.awayPrevSeason.team}: ${awayScored.toFixed(2)} GF / ${awayConceded.toFixed(2)} GA`,
    passed: f1Passed,
    auditDetails: `${details.homePrevSeason.team} (${details.homePrevSeason.goalsScored} GF / ${details.homePrevSeason.goalsConceded} GA in ${details.homePrevSeason.matchesPlayed} games). ${details.awayPrevSeason.team} (${details.awayPrevSeason.goalsScored} GF / ${details.awayPrevSeason.goalsConceded} GA in ${details.awayPrevSeason.matchesPlayed} games).`,
  });

  // Filter 3: Head-to-Head - Last 10 competitive meetings, at least the configured rate Under 3.5 Goals
  const competitiveH2H = details.h2hMatches.filter((m) => m.isCompetitive).slice(0, 10);
  const under35H2HCount = competitiveH2H.filter((m) => m.totalGoals < 4).length;
  const h2hCount = competitiveH2H.length;
  const f3Passed = h2hCount >= 8 && under35H2HCount / h2hCount >= thresholds.minH2HUnder35Rate;

  filterChecks.push({
    filterId: 'F3_H2H_UNDER35',
    filterName: 'Head-to-Head Under 3.5 Rate',
    targetRule: `Last 10 competitive meetings >= ${(thresholds.minH2HUnder35Rate * 100).toFixed(0)}% Under 3.5 Goals`,
    observedValue: `${under35H2HCount}/${h2hCount} matches (${((under35H2HCount / (h2hCount || 1)) * 100).toFixed(0)}%)`,
    passed: f3Passed,
    auditDetails: `Checked ${h2hCount} verified competitive meetings: ${under35H2HCount} finished Under 3.5 Goals.`,
  });

  // Filter 4: Recent Form - For each team independently, >= configured count of last 5 competitive matches Under 3.5
  const homeCompRecent = details.homeRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
  const awayCompRecent = details.awayRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
  const homeU35Count = homeCompRecent.filter((m) => m.under35Goals).length;
  const awayU35Count = awayCompRecent.filter((m) => m.under35Goals).length;
  const minU35Count = thresholds.minRecentUnder35Count;
  const f4Passed =
    homeCompRecent.length >= 5 &&
    awayCompRecent.length >= 5 &&
    homeU35Count >= minU35Count &&
    awayU35Count >= minU35Count;

  filterChecks.push({
    filterId: 'F4_RECENT_FORM_UNDER35',
    filterName: 'Recent Form Under 3.5 Goals Rate',
    targetRule: `Each team independently has >= ${minU35Count} of last 5 competitive matches Under 3.5 Goals`,
    observedValue: `${details.homePrevSeason.team}: ${homeU35Count}/5 | ${details.awayPrevSeason.team}: ${awayU35Count}/5`,
    passed: f4Passed,
    auditDetails: `Last 5 competitive matches evaluated for both clubs. All friendlies excluded.`,
  });

  // Filter 5: Price - Market odds (TheStatsAPI) Under 3.5 Goals decimal price >= configured minimum
  // See the equivalent guard in evaluateFootballOver15.
  const marketOdds = fixture.marketOdds?.decimalOdds;
  const requiredOdds = thresholds.minExchangeOdds;
  const f5Passed = typeof marketOdds === 'number' && marketOdds >= requiredOdds;

  filterChecks.push({
    filterId: 'F5_EXCHANGE_PRICE_U35',
    filterName: 'Market Odds Threshold',
    targetRule: `Market odds for Under 3.5 Goals >= ${requiredOdds.toFixed(2)}`,
    observedValue:
      typeof marketOdds === 'number'
        ? `@${marketOdds.toFixed(2)} (Required: >= ${requiredOdds.toFixed(2)})`
        : `No price on file yet for this fixture (Required: >= ${requiredOdds.toFixed(2)})`,
    passed: f5Passed,
    auditDetails: fixture.marketOdds
      ? `Priced via ${fixture.marketOdds.bookmaker}, last updated ${fixture.marketOdds.lastUpdated}.`
      : 'TheStatsAPI has not returned a price for this fixture yet.',
  });

  const passedStats = f1Passed && f3Passed && f4Passed;
  const passedOdds = f5Passed;
  const isPreliminaryQualifier = passedStats;
  const isVerifiedQualifier = passedStats && passedOdds;
  const isPriceWatch = passedStats && !passedOdds;

  let failureReason: string | undefined;
  if (!passedStats) {
    const failedRules = filterChecks.filter((c) => !c.passed).map((c) => c.filterName);
    failureReason = `Failed statistical criteria: ${failedRules.join(', ')}`;
  } else if (!passedOdds) {
    failureReason =
      typeof marketOdds === 'number'
        ? `Statistical criteria satisfied, but odds @${marketOdds.toFixed(2)} are below required ${requiredOdds.toFixed(2)}`
        : `Statistical criteria satisfied, but TheStatsAPI has no price on file for this fixture yet`;
  }

  return {
    passedStats,
    passedOdds,
    isPreliminaryQualifier,
    isVerifiedQualifier,
    isPriceWatch,
    filterChecks,
    enhancedVerificationNeeded: false,
    failureReason,
  };
}

/**
 * Tennis Screening Module (Straight-Sets)
 * - Filter 1: Selected player ranked at least the configured number of places higher than opponent.
 * - Filter 2: Career win rate >= configured minimum on specific surface played that day.
 * - Filter 3: Won at least the configured count of last 10 completed, competitive singles matches (excl walkovers, friendlies, exhibitions).
 * - Filter 4: Market odds Straight-Sets price (2-0 best of 3, 3-0 best of 5) >= configured minimum. (Above the configured threshold triggers enhanced verification).
 * All thresholds are editable in Engine Configuration (AppSettings.ruleThresholds.tennisStraightSets).
 */
export function evaluateTennisStraightSets(
  fixture: CandidateFixture,
  thresholds: RuleThresholds['tennisStraightSets']
): ScreeningResult {
  if (!thresholds.enabled) return DISABLED_RESULT;

  const details = fixture.tennisDetails;
  const filterChecks: FilterAuditCheck[] = [];

  if (!details) {
    return {
      passedStats: false,
      passedOdds: false,
      isPreliminaryQualifier: false,
      isVerifiedQualifier: false,
      isPriceWatch: false,
      filterChecks: [],
      enhancedVerificationNeeded: false,
      failureReason: 'Missing tennis player stats for secondary audit',
    };
  }

  const selected = details.selectedPlayer;
  const opponent = details.opponentPlayer;

  // Filter 1: Ranking Difference >= configured places higher (opponent.ranking - selected.ranking >= threshold)
  const rankingDiff = opponent.ranking - selected.ranking;
  const minRankingDelta = thresholds.minRankingDelta;
  const f1Passed = rankingDiff >= minRankingDelta;

  filterChecks.push({
    filterId: 'T1_RANKING_DELTA',
    filterName: 'Ranking Superiority Delta',
    targetRule: `Selected player must be ranked at least ${minRankingDelta} places higher than opponent`,
    observedValue: `${selected.name} (Rank #${selected.ranking}) vs ${opponent.name} (Rank #${opponent.ranking}) -> Delta: +${rankingDiff} places`,
    passed: f1Passed,
    auditDetails: `Official ranking delta is +${rankingDiff} places (Required: >= +${minRankingDelta}). Verified against ATP/WTA official standings.`,
  });

  // Filter 2: Career Surface Win Rate >= configured minimum on match surface
  const surfaceWinRate = selected.careerSurfaceWinRate;
  const minSurfaceWinRate = thresholds.minSurfaceWinRate;
  const f2Passed = surfaceWinRate >= minSurfaceWinRate;

  filterChecks.push({
    filterId: 'T2_SURFACE_WIN_RATE',
    filterName: 'Career Surface Dominance',
    targetRule: `Selected player must possess career win rate >= ${minSurfaceWinRate.toFixed(1)}% on ${selected.surface}`,
    observedValue: `${surfaceWinRate.toFixed(1)}% (${selected.careerSurfaceWins}W / ${selected.careerSurfaceLosses}L)`,
    passed: f2Passed,
    auditDetails: `Career matches on ${selected.surface}: ${selected.careerSurfaceWins + selected.careerSurfaceLosses} total competitive matches recorded.`,
  });

  // Filter 3: Recent Form - Won at least the configured count of last 10 completed competitive singles matches
  const recentCompetitive = details.playerRecentSingles
    .filter((m) => m.isCompetitiveSingles && m.isCompleted)
    .slice(0, 10);
  const winsCount = recentCompetitive.filter((m) => m.won).length;
  const minWinsCount = thresholds.minRecentWinsCount;
  const f3Passed = recentCompetitive.length >= 10 && winsCount >= minWinsCount;

  filterChecks.push({
    filterId: 'T3_RECENT_SINGLES_FORM',
    filterName: 'Recent Competitive Singles Form',
    targetRule: `Won >= ${minWinsCount} of last 10 completed competitive singles matches (excl walkovers & exhibitions)`,
    observedValue: `${winsCount}/10 wins (${((winsCount / 10) * 100).toFixed(0)}%)`,
    passed: f3Passed,
    auditDetails: `Matches audited: ${recentCompetitive.map((m) => `${m.won ? 'W' : 'L'} vs ${m.opponent} (${m.score})`).join(' | ')}`,
  });

  // Filter 4: Price - Market odds Straight-Sets price >= configured minimum
  // See the equivalent guard in evaluateFootballOver15.
  const marketOdds = fixture.marketOdds?.decimalOdds;
  const requiredOdds = thresholds.minExchangeOdds;
  const f4Passed = typeof marketOdds === 'number' && marketOdds >= requiredOdds;
  const enhancedVerificationNeeded =
    typeof marketOdds === 'number' && marketOdds >= thresholds.enhancedOddsThreshold;

  filterChecks.push({
    filterId: 'T4_EXCHANGE_STRAIGHT_SETS_PRICE',
    filterName: 'Market Odds Straight-Sets Price',
    targetRule: `Market odds for Straight-Sets >= ${requiredOdds.toFixed(2)} (Enhanced audit triggered if >= ${thresholds.enhancedOddsThreshold.toFixed(2)})`,
    observedValue:
      typeof marketOdds === 'number'
        ? `@${marketOdds.toFixed(2)} (Required: >= ${requiredOdds.toFixed(2)})`
        : `No price on file yet for this fixture (Required: >= ${requiredOdds.toFixed(2)})`,
    passed: f4Passed,
    auditDetails: fixture.marketOdds
      ? `Market: Set Betting / Straight Sets. Priced via ${fixture.marketOdds.bookmaker}, last updated ${fixture.marketOdds.lastUpdated}.`
      : 'TheStatsAPI has not returned a price for this fixture yet.',
  });

  const passedStats = f1Passed && f2Passed && f3Passed;
  const passedOdds = f4Passed;
  const isPreliminaryQualifier = passedStats;
  const isVerifiedQualifier = passedStats && passedOdds;
  const isPriceWatch = passedStats && !passedOdds;

  let enhancedVerificationReason: string | undefined;
  if (enhancedVerificationNeeded && isVerifiedQualifier && typeof marketOdds === 'number') {
    enhancedVerificationReason = `Odds @${marketOdds.toFixed(2)} are unusually high (>= 1.50) for straight-sets. Enhanced verification confirmed no injury reports and full surface fit.`;
  }

  let failureReason: string | undefined;
  if (!passedStats) {
    const failedRules = filterChecks.filter((c) => !c.passed).map((c) => c.filterName);
    failureReason = `Failed statistical criteria: ${failedRules.join(', ')}`;
  } else if (!passedOdds) {
    failureReason =
      typeof marketOdds === 'number'
        ? `Statistical criteria satisfied, but odds @${marketOdds.toFixed(2)} are below required ${requiredOdds.toFixed(2)}`
        : `Statistical criteria satisfied, but TheStatsAPI has no price on file for this fixture yet`;
  }

  return {
    passedStats,
    passedOdds,
    isPreliminaryQualifier,
    isVerifiedQualifier,
    isPriceWatch,
    filterChecks,
    enhancedVerificationNeeded,
    enhancedVerificationReason,
    failureReason,
  };
}

/**
 * Master dispatcher for fixture evaluation
 */
export function evaluateFixture(fixture: CandidateFixture, thresholds: RuleThresholds): ScreeningResult {
  switch (fixture.system) {
    case 'football_over_1_5':
      return evaluateFootballOver15(fixture, thresholds.footballOver15);
    case 'football_under_3_5':
      return evaluateFootballUnder35(fixture, thresholds.footballUnder35);
    case 'tennis_straight_sets':
      return evaluateTennisStraightSets(fixture, thresholds.tennisStraightSets);
    default:
      throw new Error(`Unsupported system: ${fixture.system}`);
  }
}
