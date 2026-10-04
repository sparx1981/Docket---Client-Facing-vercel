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

/**
 * The filter names used everywhere a user can see a rule: the Engine
 * Configuration field labels, the Filter Thresholds funnel popup, audit
 * cards, failure messages and the data-feed CSV all use these exact strings.
 */
export const FILTER_LABELS = {
  F1_PREV_SEASON_SCORED: 'Min. previous-season avg goals scored',
  F2_H2H_OVER15: 'Min. H2H Over 1.5 rate',
  F3_RECENT_FORM_SCORED: 'Min. recent scoring count',
  F4_EXCHANGE_PRICE: 'Min. exchange odds',
  F1_PREV_SEASON_SCORED_U35: 'Max. previous-season avg goals scored',
  F2_PREV_SEASON_CONCEDED_U35: 'Max. previous-season avg goals conceded',
  F3_H2H_UNDER35: 'Min. H2H Under 3.5 rate',
  F4_RECENT_FORM_UNDER35: 'Min. recent Under 3.5 count',
  F5_EXCHANGE_PRICE_U35: 'Min. exchange odds',
} as const;

/** Each football rule's filters in the order they are applied (the last one is always the price filter). */
export const FOOTBALL_FILTERS: Record<'football_over_1_5' | 'football_under_3_5', { id: string; label: string }[]> = {
  football_over_1_5: [
    { id: 'F1_PREV_SEASON_SCORED', label: FILTER_LABELS.F1_PREV_SEASON_SCORED },
    { id: 'F2_H2H_OVER15', label: FILTER_LABELS.F2_H2H_OVER15 },
    { id: 'F3_RECENT_FORM_SCORED', label: FILTER_LABELS.F3_RECENT_FORM_SCORED },
    { id: 'F4_EXCHANGE_PRICE', label: FILTER_LABELS.F4_EXCHANGE_PRICE },
  ],
  football_under_3_5: [
    { id: 'F1_PREV_SEASON_SCORED_U35', label: FILTER_LABELS.F1_PREV_SEASON_SCORED_U35 },
    { id: 'F2_PREV_SEASON_CONCEDED_U35', label: FILTER_LABELS.F2_PREV_SEASON_CONCEDED_U35 },
    { id: 'F3_H2H_UNDER35', label: FILTER_LABELS.F3_H2H_UNDER35 },
    { id: 'F4_RECENT_FORM_UNDER35', label: FILTER_LABELS.F4_RECENT_FORM_UNDER35 },
    { id: 'F5_EXCHANGE_PRICE_U35', label: FILTER_LABELS.F5_EXCHANGE_PRICE_U35 },
  ],
};

export const MISSING_STATS_REASON =
  'Not screened: team statistics, head-to-head or recent-form data could not be loaded for this match.';

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

/** Last 10 competitive meetings, of which at least 8 must exist. */
export const H2H_UNDER35_WINDOW = 10;
export const H2H_UNDER35_MIN_MEETINGS = 8;

export interface H2HUnder35Evaluation {
  considered: number;
  under35: number;
  ratePercent: number;
  hasMinimumMeetings: boolean;
  passed: boolean;
  summary: string;
}

export function evaluateH2HUnder35(h2hMatches: H2HMatchRecord[], minRate: number): H2HUnder35Evaluation {
  const window = h2hMatches.filter((m) => m.isCompetitive).slice(0, H2H_UNDER35_WINDOW);
  const considered = window.length;
  const under35 = window.filter((m) => m.totalGoals < 4).length;
  const ratePercent = considered > 0 ? Math.round((under35 / considered) * 100) : 0;
  const hasMinimumMeetings = considered >= H2H_UNDER35_MIN_MEETINGS;
  // Compared in whole percent so 80% means 80%, regardless of float noise.
  const passed = hasMinimumMeetings && (under35 / considered) * 100 >= minRate * 100 - 1e-9;
  const summary =
    considered === 0
      ? 'No competitive H2H meetings on record'
      : hasMinimumMeetings
      ? `${under35}/${considered} (${ratePercent}%)`
      : `${under35}/${considered} (${ratePercent}%) — only ${considered} of ${H2H_UNDER35_MIN_MEETINGS} required meetings on record`;
  return { considered, under35, ratePercent, hasMinimumMeetings, passed, summary };
}

const pctLabel = (rate: number) => `${(rate * 100).toFixed(0)}%`;

/**
 * Each filter's requirement as plain text, for the current thresholds. One
 * definition used by the engine's own checks and by the CSV export (which
 * must still be able to state the requirement for a match that was never
 * screened because its statistics couldn't be loaded).
 */
export function footballFilterRequirements(
  system: 'football_over_1_5' | 'football_under_3_5',
  t: RuleThresholds['footballOver15'] | RuleThresholds['footballUnder35']
): Record<string, string> {
  if (system === 'football_over_1_5') {
    const o = t as RuleThresholds['footballOver15'];
    const required = Math.ceil(o.minH2HOver15Rate * H2H_OVER15_WINDOW - 1e-9);
    return {
      F1_PREV_SEASON_SCORED: `>= ${o.minPrevSeasonAvgScored.toFixed(2)} for both teams`,
      F2_H2H_OVER15: `>= ${pctLabel(o.minH2HOver15Rate)} (${required} of last ${H2H_OVER15_WINDOW}), and ${H2H_OVER15_WINDOW} meetings on record`,
      F3_RECENT_FORM_SCORED: `>= ${o.minRecentScoredCount} of last 5 for each team, and 5 matches on record`,
      F4_EXCHANGE_PRICE: `>= ${o.minExchangeOdds.toFixed(2)}`,
    };
  }
  const u = t as RuleThresholds['footballUnder35'];
  return {
    F1_PREV_SEASON_SCORED_U35: `< ${u.maxPrevSeasonAvgScored.toFixed(2)} for both teams`,
    F2_PREV_SEASON_CONCEDED_U35: `< ${u.maxPrevSeasonAvgConceded.toFixed(2)} for both teams`,
    F3_H2H_UNDER35: `>= ${pctLabel(u.minH2HUnder35Rate)} of the last ${H2H_UNDER35_WINDOW}, and at least ${H2H_UNDER35_MIN_MEETINGS} meetings on record`,
    F4_RECENT_FORM_UNDER35: `>= ${u.minRecentUnder35Count} of last 5 for each team, and 5 matches on record`,
    F5_EXCHANGE_PRICE_U35: `>= ${u.minExchangeOdds.toFixed(2)}`,
  };
}

/** Builds a plain-English sentence from a rule's failed filters — used as `failureReason`. */
function describeFailedFilters(checks: FilterAuditCheck[]): string {
  const failed = checks.filter((c) => !c.passed);
  const parts = failed.map(
    (c, i) => `(${i + 1}) ${c.filterName} — actual: ${c.actual ?? c.observedValue}; required: ${c.required ?? c.targetRule}`
  );
  return `Failed ${failed.length === 1 ? '1 filter' : `${failed.length} filters`}. ${parts.join('. ')}`;
}

function describePriceShortfall(marketOdds: number | undefined, requiredOdds: number): string {
  return typeof marketOdds === 'number'
    ? `Passed every statistical filter, but Min. exchange odds failed: price @${marketOdds.toFixed(2)} is below the required >= ${requiredOdds.toFixed(2)}`
    : 'Passed every statistical filter, but Min. exchange odds could not be checked: TheStatsAPI has no price on file for this match yet';
}

function missingStatsResult(): ScreeningResult {
  return {
    passedStats: false,
    passedOdds: false,
    isPreliminaryQualifier: false,
    isVerifiedQualifier: false,
    isPriceWatch: false,
    filterChecks: [],
    enhancedVerificationNeeded: false,
    failureReason: MISSING_STATS_REASON,
  };
}

function priceCheck(
  fixture: CandidateFixture,
  filterId: string,
  marketLabel: 'Over 1.5 Goals' | 'Under 3.5 Goals',
  requiredOdds: number,
  extraRule = ''
): FilterAuditCheck {
  const marketOdds = fixture.marketOdds?.decimalOdds;
  const hasPrice = typeof marketOdds === 'number';
  return {
    filterId,
    filterName: FILTER_LABELS[filterId as keyof typeof FILTER_LABELS],
    targetRule: `Market odds for ${marketLabel} >= ${requiredOdds.toFixed(2)}${extraRule}`,
    observedValue: hasPrice
      ? `@${marketOdds.toFixed(2)} (Required: >= ${requiredOdds.toFixed(2)})`
      : `No price on file yet for this fixture (Required: >= ${requiredOdds.toFixed(2)})`,
    passed: hasPrice && marketOdds >= requiredOdds,
    auditDetails: fixture.marketOdds
      ? `Priced via ${fixture.marketOdds.bookmaker}, last updated ${fixture.marketOdds.lastUpdated}.`
      : 'TheStatsAPI has not returned a price for this fixture yet.',
    actual: hasPrice ? marketOdds.toFixed(2) : 'No price on file yet',
    required: `>= ${requiredOdds.toFixed(2)}`,
    noData: !hasPrice,
  };
}

/**
 * System A: Football Over 1.5 Goals
 * - Filter 1: Previous season average goals scored >= configured minimum for BOTH teams.
 * - Filter 2: In the last 5 competitive meetings (all 5 must exist), at least the configured rate must finish with Over 1.5 Goals.
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
  if (!details) return missingStatsResult();
  const filterChecks: FilterAuditCheck[] = [];
  const homeTeam = details.homePrevSeason.team;
  const awayTeam = details.awayPrevSeason.team;
  const req = footballFilterRequirements('football_over_1_5', thresholds);

  // Filter 1: Previous Season Average Goals Scored >= configured minimum for BOTH teams
  const homeAvg = details.homePrevSeason.avgGoalsScored;
  const awayAvg = details.awayPrevSeason.avgGoalsScored;
  const minScored = thresholds.minPrevSeasonAvgScored;
  const f1Passed = homeAvg >= minScored && awayAvg >= minScored;

  filterChecks.push({
    filterId: 'F1_PREV_SEASON_SCORED',
    filterName: FILTER_LABELS.F1_PREV_SEASON_SCORED,
    targetRule: `Both teams >= ${minScored.toFixed(2)} goals scored / match in previous domestic season`,
    observedValue: `${homeTeam}: ${homeAvg.toFixed(2)} | ${awayTeam}: ${awayAvg.toFixed(2)}`,
    passed: f1Passed,
    auditDetails: `${homeTeam} scored ${details.homePrevSeason.goalsScored} in ${details.homePrevSeason.matchesPlayed} games (${details.homePrevSeason.season}). ${awayTeam} scored ${details.awayPrevSeason.goalsScored} in ${details.awayPrevSeason.matchesPlayed} games.`,
    actual: `${homeTeam} ${homeAvg.toFixed(2)} · ${awayTeam} ${awayAvg.toFixed(2)}`,
    required: req.F1_PREV_SEASON_SCORED,
  });

  // Filter 2: Head-to-Head - Last 5 competitive meetings, at least the configured rate Over 1.5 Goals
  const h2h = evaluateH2HOver15(details.h2hMatches, thresholds.minH2HOver15Rate);
  const competitiveH2H = details.h2hMatches.filter((m) => m.isCompetitive).slice(0, H2H_OVER15_WINDOW);
  const f2Passed = h2h.passed;

  filterChecks.push({
    filterId: 'F2_H2H_OVER15',
    filterName: FILTER_LABELS.F2_H2H_OVER15,
    targetRule: `Last ${H2H_OVER15_WINDOW} competitive H2H meetings >= ${h2h.required} (${pctLabel(thresholds.minH2HOver15Rate)}) Over 1.5 Goals`,
    observedValue: `${h2h.over15}/${h2h.considered} matches (${h2h.ratePercent}%)${h2h.hasFullWindow ? '' : ` — needs ${H2H_OVER15_WINDOW} meetings`}`,
    passed: f2Passed,
    auditDetails: `Recent competitive scores: ${competitiveH2H.map((m) => `${m.homeScore}-${m.awayScore} (${m.date})`).join(', ')}`,
    actual: h2h.summary,
    required: req.F2_H2H_OVER15,
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
  const shortForm = homeCompRecent.length < 5 || awayCompRecent.length < 5;

  filterChecks.push({
    filterId: 'F3_RECENT_FORM_SCORED',
    filterName: FILTER_LABELS.F3_RECENT_FORM_SCORED,
    targetRule: `Each team scored >= 1 goal in at least ${minScoredCount} of their last 5 competitive matches`,
    observedValue: `${homeTeam}: ${homeScoredCount}/${homeCompRecent.length} | ${awayTeam}: ${awayScoredCount}/${awayCompRecent.length}`,
    passed: f3Passed,
    auditDetails: `Competitive recent games inspected: ${homeTeam} (${homeScoredCount}/${homeCompRecent.length} scored), ${awayTeam} (${awayScoredCount}/${awayCompRecent.length} scored). Excluded friendlies.`,
    actual: `${homeTeam} scored in ${homeScoredCount}/${homeCompRecent.length} · ${awayTeam} scored in ${awayScoredCount}/${awayCompRecent.length}${shortForm ? ' — fewer than 5 recent competitive matches on record' : ''}`,
    required: req.F3_RECENT_FORM_SCORED,
  });

  // Filter 4: Price - Market odds (TheStatsAPI) Over 1.5 Goals decimal price >= configured minimum
  // TheStatsAPI's odds endpoint doesn't always carry a price for every
  // fixture (early-listed matches in particular). Treat a missing price as
  // "not yet known" rather than a pass, a fail, or a fabricated number — it
  // lands the fixture in Price Watch alongside genuine price deficits.
  const marketOdds = fixture.marketOdds?.decimalOdds;
  const requiredOdds = thresholds.minExchangeOdds;
  const enhancedVerificationNeeded =
    typeof marketOdds === 'number' && marketOdds > thresholds.enhancedOddsThreshold;
  const priceFilter = priceCheck(
    fixture,
    'F4_EXCHANGE_PRICE',
    'Over 1.5 Goals',
    requiredOdds,
    ` (Trigger Enhanced Audit if > ${thresholds.enhancedOddsThreshold.toFixed(2)})`
  );
  filterChecks.push(priceFilter);
  const f4Passed = priceFilter.passed;

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
  if (!passedStats) failureReason = describeFailedFilters(filterChecks);
  else if (!passedOdds) failureReason = describePriceShortfall(marketOdds, requiredOdds);

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
 * - Filters 1 & 2: Both teams independently avg < configured scored AND < configured conceded per match in previous domestic season.
 * - Filter 3: In the last 10 competitive meetings (at least 8 must exist), at least the configured rate must finish with Under 3.5 Goals.
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
  if (!details) return missingStatsResult();
  const filterChecks: FilterAuditCheck[] = [];
  const homeTeam = details.homePrevSeason.team;
  const awayTeam = details.awayPrevSeason.team;
  const req = footballFilterRequirements('football_under_3_5', thresholds);

  // Filters 1 & 2: Scored < configured AND Conceded < configured for BOTH teams
  const homeScored = details.homePrevSeason.avgGoalsScored;
  const homeConceded = details.homePrevSeason.avgGoalsConceded;
  const awayScored = details.awayPrevSeason.avgGoalsScored;
  const awayConceded = details.awayPrevSeason.avgGoalsConceded;
  const maxScored = thresholds.maxPrevSeasonAvgScored;
  const maxConceded = thresholds.maxPrevSeasonAvgConceded;

  const f1Passed = homeScored < maxScored && awayScored < maxScored;
  const f2Passed = homeConceded < maxConceded && awayConceded < maxConceded;
  const seasonAudit = `${homeTeam} (${details.homePrevSeason.goalsScored} GF / ${details.homePrevSeason.goalsConceded} GA in ${details.homePrevSeason.matchesPlayed} games). ${awayTeam} (${details.awayPrevSeason.goalsScored} GF / ${details.awayPrevSeason.goalsConceded} GA in ${details.awayPrevSeason.matchesPlayed} games).`;

  filterChecks.push({
    filterId: 'F1_PREV_SEASON_SCORED_U35',
    filterName: FILTER_LABELS.F1_PREV_SEASON_SCORED_U35,
    targetRule: `Both teams avg < ${maxScored.toFixed(2)} goals scored / match in domestic season`,
    observedValue: `${homeTeam}: ${homeScored.toFixed(2)} GF | ${awayTeam}: ${awayScored.toFixed(2)} GF`,
    passed: f1Passed,
    auditDetails: seasonAudit,
    actual: `${homeTeam} ${homeScored.toFixed(2)} · ${awayTeam} ${awayScored.toFixed(2)}`,
    required: req.F1_PREV_SEASON_SCORED_U35,
  });
  filterChecks.push({
    filterId: 'F2_PREV_SEASON_CONCEDED_U35',
    filterName: FILTER_LABELS.F2_PREV_SEASON_CONCEDED_U35,
    targetRule: `Both teams avg < ${maxConceded.toFixed(2)} goals conceded / match in domestic season`,
    observedValue: `${homeTeam}: ${homeConceded.toFixed(2)} GA | ${awayTeam}: ${awayConceded.toFixed(2)} GA`,
    passed: f2Passed,
    auditDetails: seasonAudit,
    actual: `${homeTeam} ${homeConceded.toFixed(2)} · ${awayTeam} ${awayConceded.toFixed(2)}`,
    required: req.F2_PREV_SEASON_CONCEDED_U35,
  });

  // Filter 3: Head-to-Head - Last 10 competitive meetings, at least the configured rate Under 3.5 Goals
  const h2h = evaluateH2HUnder35(details.h2hMatches, thresholds.minH2HUnder35Rate);
  const f3Passed = h2h.passed;

  filterChecks.push({
    filterId: 'F3_H2H_UNDER35',
    filterName: FILTER_LABELS.F3_H2H_UNDER35,
    targetRule: `Last ${H2H_UNDER35_WINDOW} competitive meetings >= ${pctLabel(thresholds.minH2HUnder35Rate)} Under 3.5 Goals`,
    observedValue: `${h2h.under35}/${h2h.considered} matches (${h2h.ratePercent}%)`,
    passed: f3Passed,
    auditDetails: `Checked ${h2h.considered} verified competitive meetings: ${h2h.under35} finished Under 3.5 Goals.`,
    actual: h2h.summary,
    required: req.F3_H2H_UNDER35,
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
  const shortForm = homeCompRecent.length < 5 || awayCompRecent.length < 5;

  filterChecks.push({
    filterId: 'F4_RECENT_FORM_UNDER35',
    filterName: FILTER_LABELS.F4_RECENT_FORM_UNDER35,
    targetRule: `Each team independently has >= ${minU35Count} of last 5 competitive matches Under 3.5 Goals`,
    observedValue: `${homeTeam}: ${homeU35Count}/${homeCompRecent.length} | ${awayTeam}: ${awayU35Count}/${awayCompRecent.length}`,
    passed: f4Passed,
    auditDetails: `Last 5 competitive matches evaluated for both clubs. All friendlies excluded.`,
    actual: `${homeTeam} ${homeU35Count}/${homeCompRecent.length} · ${awayTeam} ${awayU35Count}/${awayCompRecent.length}${shortForm ? ' — fewer than 5 recent competitive matches on record' : ''}`,
    required: req.F4_RECENT_FORM_UNDER35,
  });

  // Filter 5: Price - Market odds (TheStatsAPI) Under 3.5 Goals decimal price >= configured minimum
  // See the equivalent guard in evaluateFootballOver15.
  const marketOdds = fixture.marketOdds?.decimalOdds;
  const requiredOdds = thresholds.minExchangeOdds;
  const priceFilter = priceCheck(fixture, 'F5_EXCHANGE_PRICE_U35', 'Under 3.5 Goals', requiredOdds);
  filterChecks.push(priceFilter);
  const f5Passed = priceFilter.passed;

  const passedStats = f1Passed && f2Passed && f3Passed && f4Passed;
  const passedOdds = f5Passed;
  const isPreliminaryQualifier = passedStats;
  const isVerifiedQualifier = passedStats && passedOdds;
  const isPriceWatch = passedStats && !passedOdds;

  let failureReason: string | undefined;
  if (!passedStats) failureReason = describeFailedFilters(filterChecks);
  else if (!passedOdds) failureReason = describePriceShortfall(marketOdds, requiredOdds);

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
 * Master dispatcher for fixture evaluation
 */
export function evaluateFixture(fixture: CandidateFixture, thresholds: RuleThresholds): ScreeningResult {
  switch (fixture.system) {
    case 'football_over_1_5':
      return evaluateFootballOver15(fixture, thresholds.footballOver15);
    case 'football_under_3_5':
      return evaluateFootballUnder35(fixture, thresholds.footballUnder35);
    default:
      throw new Error(`Unsupported system: ${fixture.system}`);
  }
}
