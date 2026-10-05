import type {
  CandidateFixture,
  FilterAuditCheck,
  FootballPrevSeasonStats,
  FootballStatsInput,
  H2HMatchRecord,
  TeamRecentMatch,
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
  /** At least one statistical filter was checked and failed. */
  hardFailed: boolean;
  /** At least one statistical filter could not be checked because its data is missing. */
  missingData: boolean;
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
  hardFailed: false,
  missingData: false,
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
  F4_EXCHANGE_PRICE: 'Min. bookmaker odds',
  F1_PREV_SEASON_SCORED_U35: 'Max. previous-season avg goals scored',
  F2_PREV_SEASON_CONCEDED_U35: 'Max. previous-season avg goals conceded',
  F3_H2H_UNDER35: 'Min. H2H Under 3.5 rate',
  F4_RECENT_FORM_UNDER35: 'Min. recent Under 3.5 count',
  F5_EXCHANGE_PRICE_U35: 'Min. bookmaker odds',
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

const isStatCheck = (c: FilterAuditCheck) => !/EXCHANGE_PRICE/.test(c.filterId);

/**
 * Plain-English sentence for a match that did not qualify, from its checks:
 * the filters it failed (actual vs required), and separately the filters
 * that could not be checked because data was missing.
 */
function describeProblems(checks: FilterAuditCheck[]): string {
  const stat = checks.filter(isStatCheck);
  const failed = checks.filter((c) => !c.passed && !c.noData);
  const unknown = stat.filter((c) => c.noData);
  const parts: string[] = [];
  if (failed.length > 0) {
    parts.push(
      `Failed ${failed.length === 1 ? '1 filter' : `${failed.length} filters`}. ` +
        failed
          .map((c, i) => `(${i + 1}) ${c.filterName} — actual: ${c.actual ?? c.observedValue}; required: ${c.required ?? c.targetRule}`)
          .join('. ')
    );
  }
  if (unknown.length > 0) {
    parts.push(
      `${failed.length > 0 ? 'Also could' : 'Could'} not check ${unknown.length === 1 ? '1 filter' : `${unknown.length} filters`} because data is missing. ` +
        unknown.map((c, i) => `(${i + 1}) ${c.filterName} — ${c.actual ?? c.observedValue}; required: ${c.required ?? c.targetRule}`).join('. ')
    );
  }
  return parts.join(' ');
}

function describePriceShortfall(marketOdds: number | undefined, requiredOdds: number): string {
  return typeof marketOdds === 'number'
    ? `Passed every statistical filter, but Min. bookmaker odds failed: TheStatsAPI price @${marketOdds.toFixed(2)} is below the required >= ${requiredOdds.toFixed(2)}`
    : 'Passed every statistical filter, but Min. bookmaker odds could not be checked: TheStatsAPI has no price on file for this match yet';
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
    targetRule: `Bookmaker odds (TheStatsAPI) for ${marketLabel} >= ${requiredOdds.toFixed(2)}${extraRule}`,
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

/** A filter that must hold for BOTH teams. One team failing decides it (FAIL) even if the other team's data is missing. */
function bothTeamsCheck(o: {
  id: string;
  targetRule: string;
  required: string;
  auditDetails: string;
  home: { name: string; value?: number; gap: string };
  away: { name: string; value?: number; gap: string };
  passes: (v: number) => boolean;
  format: (v: number) => string;
}): FilterAuditCheck {
  const sides = [o.home, o.away];
  const anyFailed = sides.some((s) => s.value !== undefined && !o.passes(s.value));
  const anyMissing = sides.some((s) => s.value === undefined);
  const describe = (s: (typeof sides)[number]) => (s.value !== undefined ? `${s.name} ${o.format(s.value)}` : `${s.name} not available`);
  const gaps = sides.filter((s) => s.value === undefined).map((s) => s.gap);
  const actual = `${describe(o.home)} · ${describe(o.away)}${gaps.length > 0 ? ` (${gaps.join('; ')})` : ''}`;
  return {
    filterId: o.id,
    filterName: FILTER_LABELS[o.id as keyof typeof FILTER_LABELS],
    targetRule: o.targetRule,
    observedValue: actual,
    passed: !anyFailed && !anyMissing,
    auditDetails: o.auditDetails,
    actual,
    required: o.required,
    noData: anyMissing && !anyFailed,
  };
}

/** Per-team "count out of the last 5" filter with the same fail-beats-missing rule as bothTeamsCheck. */
function recentFormCheck(o: {
  id: string;
  targetRule: string;
  required: string;
  minCount: number;
  noun: string;
  auditDetails: string;
  home: { name: string; matches?: TeamRecentMatch[]; gap: string };
  away: { name: string; matches?: TeamRecentMatch[]; gap: string };
  counts: (m: TeamRecentMatch) => boolean;
}): FilterAuditCheck {
  const read = (s: { matches?: TeamRecentMatch[] }) => {
    if (!s.matches) return undefined;
    const window = s.matches.filter((m) => m.isCompetitive).slice(0, 5);
    return { count: window.filter(o.counts).length, total: window.length };
  };
  const sides = [
    { ...o.home, r: read(o.home) },
    { ...o.away, r: read(o.away) },
  ];
  const anyFailed = sides.some((s) => s.r && (s.r.total < 5 || s.r.count < o.minCount));
  const anyMissing = sides.some((s) => !s.r);
  const describe = (s: (typeof sides)[number]) => (s.r ? `${s.name} ${o.noun} ${s.r.count}/${s.r.total}` : `${s.name} not available`);
  const notes: string[] = [];
  sides.forEach((s) => {
    if (!s.r) notes.push(s.gap);
    else if (s.r.total < 5) notes.push(`fewer than 5 recent competitive matches on record for ${s.name}`);
  });
  const actual = `${describe(sides[0])} · ${describe(sides[1])}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`;
  return {
    filterId: o.id,
    filterName: FILTER_LABELS[o.id as keyof typeof FILTER_LABELS],
    targetRule: o.targetRule,
    observedValue: actual,
    passed: !anyFailed && !anyMissing,
    auditDetails: o.auditDetails,
    actual,
    required: o.required,
    noData: anyMissing && !anyFailed,
  };
}

/** Combines a rule's checks into the screening outcome flags shared by both football rules. */
function summarize(checks: FilterAuditCheck[]) {
  const stat = checks.filter(isStatCheck);
  return {
    passedStats: stat.every((c) => c.passed),
    hardFailed: stat.some((c) => !c.passed && !c.noData),
    missingData: stat.some((c) => c.noData),
  };
}

/** Why a piece of data is missing, falling back to the match-level note (e.g. beyond the enrichment cap). */
function gapReason(fixture: CandidateFixture, stats: FootballStatsInput | undefined, piece: keyof NonNullable<FootballStatsInput['gaps']>, fallback: string): string {
  return stats?.gaps?.[piece] ?? fixture.enrichmentNote ?? fallback;
}

/**
 * System A: Football Over 1.5 Goals
 * - Filter 1: Previous season average goals scored >= configured minimum for BOTH teams.
 * - Filter 2: In the last 5 competitive meetings (all 5 must exist), at least the configured rate must finish with Over 1.5 Goals.
 * - Filter 3: Each team must score at least one goal in the configured count of their last 5 competitive matches. TheStatsAPI does not label friendlies, so every match it returns counts as competitive (see isCompetitive in thestatsapi.ts).
 * - Filter 4: Bookmaker odds (TheStatsAPI) Over 1.5 Goals decimal price >= configured minimum. Prices above the configured threshold are flagged for enhanced verification (a manual flag — no automated secondary audit runs).
 * All thresholds are editable in Engine Configuration (AppSettings.ruleThresholds.footballOver15).
 *
 * Each filter is evaluated from whatever data loaded: a filter whose data is
 * missing is reported as "no data" (with the reason), never silently dropped,
 * and a match is only ever "not enough data" when nothing it did have already
 * failed a filter.
 */
export function evaluateFootballOver15(
  fixture: CandidateFixture,
  thresholds: RuleThresholds['footballOver15']
): ScreeningResult {
  if (!thresholds.enabled) return DISABLED_RESULT;

  const stats: FootballStatsInput | undefined = fixture.footballDetails ?? fixture.partialStats;
  const filterChecks: FilterAuditCheck[] = [];
  const homeTeam = fixture.homeOrPlayer1;
  const awayTeam = fixture.awayOrPlayer2;
  const req = footballFilterRequirements('football_over_1_5', thresholds);
  const none = 'statistics could not be loaded for this match';

  // Filter 1: Previous Season Average Goals Scored >= configured minimum for BOTH teams
  const minScored = thresholds.minPrevSeasonAvgScored;
  filterChecks.push(
    bothTeamsCheck({
      id: 'F1_PREV_SEASON_SCORED',
      targetRule: `Both teams >= ${minScored.toFixed(2)} goals scored / match in previous domestic season`,
      required: req.F1_PREV_SEASON_SCORED,
      auditDetails: [stats?.homePrevSeason, stats?.awayPrevSeason]
        .filter((p): p is FootballPrevSeasonStats => !!p)
        .map((p) => `${p.team} scored ${p.goalsScored} in ${p.matchesPlayed} games (${p.season}).`)
        .join(' ') || 'Season statistics were not available.',
      home: { name: homeTeam, value: stats?.homePrevSeason?.avgGoalsScored, gap: gapReason(fixture, stats, 'homePrevSeason', none) },
      away: { name: awayTeam, value: stats?.awayPrevSeason?.avgGoalsScored, gap: gapReason(fixture, stats, 'awayPrevSeason', none) },
      passes: (v) => v >= minScored,
      format: (v) => v.toFixed(2),
    })
  );

  // Filter 2: Head-to-Head - Last 5 competitive meetings, at least the configured rate Over 1.5 Goals
  if (stats?.h2hMatches) {
    const h2h = evaluateH2HOver15(stats.h2hMatches, thresholds.minH2HOver15Rate);
    const competitiveH2H = stats.h2hMatches.filter((m) => m.isCompetitive).slice(0, H2H_OVER15_WINDOW);
    filterChecks.push({
      filterId: 'F2_H2H_OVER15',
      filterName: FILTER_LABELS.F2_H2H_OVER15,
      targetRule: `Last ${H2H_OVER15_WINDOW} competitive H2H meetings >= ${h2h.required} (${pctLabel(thresholds.minH2HOver15Rate)}) Over 1.5 Goals`,
      observedValue: `${h2h.over15}/${h2h.considered} matches (${h2h.ratePercent}%)${h2h.hasFullWindow ? '' : ` — needs ${H2H_OVER15_WINDOW} meetings`}`,
      passed: h2h.passed,
      auditDetails: `Recent competitive scores: ${competitiveH2H.map((m) => `${m.homeScore}-${m.awayScore} (${m.date})`).join(', ')}`,
      actual: h2h.summary,
      required: req.F2_H2H_OVER15,
    });
  } else {
    const reason = `Not available — ${gapReason(fixture, stats, 'h2h', none)}`;
    filterChecks.push({
      filterId: 'F2_H2H_OVER15',
      filterName: FILTER_LABELS.F2_H2H_OVER15,
      targetRule: `Last ${H2H_OVER15_WINDOW} competitive H2H meetings Over 1.5 Goals`,
      observedValue: reason,
      passed: false,
      auditDetails: reason,
      actual: reason,
      required: req.F2_H2H_OVER15,
      noData: true,
    });
  }

  // Filter 3: Recent Form - Each team scored at least 1 goal in the configured count of their last 5 competitive matches
  const minScoredCount = thresholds.minRecentScoredCount;
  filterChecks.push(
    recentFormCheck({
      id: 'F3_RECENT_FORM_SCORED',
      targetRule: `Each team scored >= 1 goal in at least ${minScoredCount} of their last 5 competitive matches`,
      required: req.F3_RECENT_FORM_SCORED,
      minCount: minScoredCount,
      noun: 'scored in',
      auditDetails: `Each team's five most recent finished matches on record at TheStatsAPI were inspected. TheStatsAPI does not label friendlies, so none are excluded.`,
      home: { name: homeTeam, matches: stats?.homeRecentMatches, gap: gapReason(fixture, stats, 'homeRecent', none) },
      away: { name: awayTeam, matches: stats?.awayRecentMatches, gap: gapReason(fixture, stats, 'awayRecent', none) },
      counts: (m) => m.scoredAtLeastOne,
    })
  );

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
    ` (Flag for enhanced verification if > ${thresholds.enhancedOddsThreshold.toFixed(2)})`
  );
  filterChecks.push(priceFilter);

  const { passedStats, hardFailed, missingData } = summarize(filterChecks);
  const passedOdds = priceFilter.passed;
  const isPreliminaryQualifier = passedStats;
  const isVerifiedQualifier = passedStats && passedOdds;
  const isPriceWatch = passedStats && !passedOdds;

  let enhancedVerificationReason: string | undefined;
  if (enhancedVerificationNeeded && isVerifiedQualifier && typeof marketOdds === 'number') {
    enhancedVerificationReason = `Odds @${marketOdds.toFixed(2)} exceed the enhanced-verification threshold (> ${thresholds.enhancedOddsThreshold.toFixed(2)}). Flagged for manual checking — no automated liquidity or line-up audit is run.`;
  }

  let failureReason: string | undefined;
  if (!passedStats) failureReason = describeProblems(filterChecks);
  else if (!passedOdds) failureReason = describePriceShortfall(marketOdds, requiredOdds);

  return {
    passedStats,
    passedOdds,
    isPreliminaryQualifier,
    isVerifiedQualifier,
    isPriceWatch,
    hardFailed,
    missingData,
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
 * Missing data is handled per filter exactly as in evaluateFootballOver15.
 */
export function evaluateFootballUnder35(
  fixture: CandidateFixture,
  thresholds: RuleThresholds['footballUnder35']
): ScreeningResult {
  if (!thresholds.enabled) return DISABLED_RESULT;

  const stats: FootballStatsInput | undefined = fixture.footballDetails ?? fixture.partialStats;
  const filterChecks: FilterAuditCheck[] = [];
  const homeTeam = fixture.homeOrPlayer1;
  const awayTeam = fixture.awayOrPlayer2;
  const req = footballFilterRequirements('football_under_3_5', thresholds);
  const none = 'statistics could not be loaded for this match';

  const seasonAudit =
    [stats?.homePrevSeason, stats?.awayPrevSeason]
      .filter((p): p is FootballPrevSeasonStats => !!p)
      .map((p) => `${p.team} (${p.goalsScored} GF / ${p.goalsConceded} GA in ${p.matchesPlayed} games).`)
      .join(' ') || 'Season statistics were not available.';
  const maxScored = thresholds.maxPrevSeasonAvgScored;
  const maxConceded = thresholds.maxPrevSeasonAvgConceded;
  const homeGap = gapReason(fixture, stats, 'homePrevSeason', none);
  const awayGap = gapReason(fixture, stats, 'awayPrevSeason', none);

  filterChecks.push(
    bothTeamsCheck({
      id: 'F1_PREV_SEASON_SCORED_U35',
      targetRule: `Both teams avg < ${maxScored.toFixed(2)} goals scored / match in domestic season`,
      required: req.F1_PREV_SEASON_SCORED_U35,
      auditDetails: seasonAudit,
      home: { name: homeTeam, value: stats?.homePrevSeason?.avgGoalsScored, gap: homeGap },
      away: { name: awayTeam, value: stats?.awayPrevSeason?.avgGoalsScored, gap: awayGap },
      passes: (v) => v < maxScored,
      format: (v) => v.toFixed(2),
    }),
    bothTeamsCheck({
      id: 'F2_PREV_SEASON_CONCEDED_U35',
      targetRule: `Both teams avg < ${maxConceded.toFixed(2)} goals conceded / match in domestic season`,
      required: req.F2_PREV_SEASON_CONCEDED_U35,
      auditDetails: seasonAudit,
      home: { name: homeTeam, value: stats?.homePrevSeason?.avgGoalsConceded, gap: homeGap },
      away: { name: awayTeam, value: stats?.awayPrevSeason?.avgGoalsConceded, gap: awayGap },
      passes: (v) => v < maxConceded,
      format: (v) => v.toFixed(2),
    })
  );

  // Filter 3: Head-to-Head - Last 10 competitive meetings, at least the configured rate Under 3.5 Goals
  if (stats?.h2hMatches) {
    const h2h = evaluateH2HUnder35(stats.h2hMatches, thresholds.minH2HUnder35Rate);
    filterChecks.push({
      filterId: 'F3_H2H_UNDER35',
      filterName: FILTER_LABELS.F3_H2H_UNDER35,
      targetRule: `Last ${H2H_UNDER35_WINDOW} competitive meetings >= ${pctLabel(thresholds.minH2HUnder35Rate)} Under 3.5 Goals`,
      observedValue: `${h2h.under35}/${h2h.considered} matches (${h2h.ratePercent}%)`,
      passed: h2h.passed,
      auditDetails: `Checked ${h2h.considered} verified competitive meetings: ${h2h.under35} finished Under 3.5 Goals.`,
      actual: h2h.summary,
      required: req.F3_H2H_UNDER35,
    });
  } else {
    const reason = `Not available — ${gapReason(fixture, stats, 'h2h', none)}`;
    filterChecks.push({
      filterId: 'F3_H2H_UNDER35',
      filterName: FILTER_LABELS.F3_H2H_UNDER35,
      targetRule: `Last ${H2H_UNDER35_WINDOW} competitive meetings Under 3.5 Goals`,
      observedValue: reason,
      passed: false,
      auditDetails: reason,
      actual: reason,
      required: req.F3_H2H_UNDER35,
      noData: true,
    });
  }

  // Filter 4: Recent Form - For each team independently, >= configured count of last 5 competitive matches Under 3.5
  const minU35Count = thresholds.minRecentUnder35Count;
  filterChecks.push(
    recentFormCheck({
      id: 'F4_RECENT_FORM_UNDER35',
      targetRule: `Each team independently has >= ${minU35Count} of last 5 competitive matches Under 3.5 Goals`,
      required: req.F4_RECENT_FORM_UNDER35,
      minCount: minU35Count,
      noun: 'Under 3.5 in',
      auditDetails: `Each club's five most recent finished matches on record at TheStatsAPI were evaluated. TheStatsAPI does not label friendlies, so none are excluded.`,
      home: { name: homeTeam, matches: stats?.homeRecentMatches, gap: gapReason(fixture, stats, 'homeRecent', none) },
      away: { name: awayTeam, matches: stats?.awayRecentMatches, gap: gapReason(fixture, stats, 'awayRecent', none) },
      counts: (m) => m.under35Goals,
    })
  );

  // Filter 5: Price - Market odds (TheStatsAPI) Under 3.5 Goals decimal price >= configured minimum
  // See the equivalent guard in evaluateFootballOver15.
  const marketOdds = fixture.marketOdds?.decimalOdds;
  const requiredOdds = thresholds.minExchangeOdds;
  const priceFilter = priceCheck(fixture, 'F5_EXCHANGE_PRICE_U35', 'Under 3.5 Goals', requiredOdds);
  filterChecks.push(priceFilter);

  const { passedStats, hardFailed, missingData } = summarize(filterChecks);
  const passedOdds = priceFilter.passed;
  const isPreliminaryQualifier = passedStats;
  const isVerifiedQualifier = passedStats && passedOdds;
  const isPriceWatch = passedStats && !passedOdds;

  let failureReason: string | undefined;
  if (!passedStats) failureReason = describeProblems(filterChecks);
  else if (!passedOdds) failureReason = describePriceShortfall(marketOdds, requiredOdds);

  return {
    passedStats,
    passedOdds,
    isPreliminaryQualifier,
    isVerifiedQualifier,
    isPriceWatch,
    hardFailed,
    missingData,
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
