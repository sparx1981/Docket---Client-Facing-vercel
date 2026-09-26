export type Sport = 'football' | 'tennis';

export type SystemType = 
  | 'football_over_1_5' 
  | 'football_under_3_5' 
  | 'tennis_straight_sets';

export type BetOutcome = 'WON' | 'LOST' | 'PENDING' | 'VOID';

// TheStatsAPI.com is the only live data supplier football fixtures come
// from now (see server/providers/thestatsapi.ts). SPORTRADAR/SPORTMONKS are
// kept in the union purely so archived pre-migration records (Analytics,
// the Archive ledger) still display the provider that actually supplied
// them at the time — no new fixture is ever tagged with either value.
export type DataProviderType = 'THESTATSAPI' | 'SPORTRADAR' | 'SPORTMONKS';

export interface FootballPrevSeasonStats {
  team: string;
  season: string;
  league: string;
  matchesPlayed: number;
  goalsScored: number;
  goalsConceded: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
}

export interface H2HMatchRecord {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  totalGoals: number;
  competition: string;
  isCompetitive: boolean; // Excludes friendlies
}

export interface TeamRecentMatch {
  date: string;
  opponent: string;
  isHome: boolean;
  teamGoals: number;
  opponentGoals: number;
  totalGoals: number;
  competition: string;
  scoredAtLeastOne: boolean;
  under35Goals: boolean;
  isCompetitive: boolean; // Excludes friendlies
}

export interface TennisPlayerStats {
  name: string;
  ranking: number;
  surface: 'Hard' | 'Clay' | 'Grass' | 'Carpet';
  careerSurfaceWins: number;
  careerSurfaceLosses: number;
  careerSurfaceWinRate: number; // 0-100 percentage
}

export interface TennisRecentMatch {
  date: string;
  opponent: string;
  opponentRank: number;
  score: string;
  won: boolean;
  tournament: string;
  surface: string;
  isCompleted: boolean;
  isCompetitiveSingles: boolean; // strictly excl walkovers, friendlies, exhibitions
}

// Odds for a fixture, pulled directly from TheStatsAPI's own
// GET /football/matches/{match_id}/odds endpoint — whichever bookmaker(s)
// that endpoint returns, not limited to any single exchange or sportsbook.
export interface MatchOddsData {
  bookmaker: string;
  marketType: 'OVER_UNDER_15' | 'OVER_UNDER_35' | 'SET_BETTING';
  selectionName: string;
  decimalOdds: number;
  lastUpdated: string;
}

export interface FilterAuditCheck {
  filterId: string;
  filterName: string;
  targetRule: string;
  observedValue: string;
  passed: boolean;
  auditDetails: string;
}

export interface VerificationAuditCard {
  auditId: string;
  generatedAt: string;
  status: 'VERIFIED' | 'FAILED_RECALC' | 'PRICE_DEFICIT' | 'MISSING_DATA';
  enhancedVerification: boolean; // Over 1.5 > 1.25 or Tennis Straight-Sets >= 1.50
  enhancedVerificationReason?: string;
  providerUsed: DataProviderType;
  dataIntegrityScore: number; // e.g. 100% when independently recalculated
  rawEvidenceSummary: string[];
  filterChecks: FilterAuditCheck[];
  
  // Secondary raw audit recalculation payloads
  recalculatedMetrics: {
    ruleLabel: string;
    computedMetric: string;
    thresholdRequired: string;
    verifiedMatch: boolean;
  }[];
  
  oddsAudit: {
    bookmaker: string;
    selection: string;
    verifiedOdds: number;
    thresholdOdds: number;
    oddsConfirmed: boolean; // true once TheStatsAPI has returned a real price for this fixture
  };
}

export interface CandidateFixture {
  id: string;
  sport: Sport;
  system: SystemType;
  matchTitle: string;
  homeOrPlayer1: string;
  awayOrPlayer2: string;
  selectedEntity: string; // The team or player being backed
  competition: string;
  matchTime: string; // ISO or human readable
  venue?: string;
  surface?: 'Hard' | 'Clay' | 'Grass' | 'Carpet';
  bestOfSets?: 3 | 5; // for tennis straight sets (2-0 vs 3-0)
  betType: string; // e.g. "Over 1.5 Goals", "Under 3.5 Goals", "Straight Sets (2-0)"
  googleVerificationUrl: string; // Link to Google searching fixture confirmation on date/time
  // Which real provider actually supplied this specific fixture's data —
  // football and tennis can come from different providers in the same scan,
  // so this is set per-fixture rather than assumed for the whole batch.
  sourceProvider: DataProviderType;

  // Odds comparison
  currentOdds: number;
  requiredOdds: number;
  oddsDifference: number; // currentOdds - requiredOdds
  
  // Status categorization
  status: 'VERIFIED_QUALIFIER' | 'PRICE_WATCH' | 'PRELIMINARY_QUALIFIER' | 'FAILED';
  failureReason?: string;
  
  // Detailed data source for recalculation
  footballDetails?: {
    homePrevSeason: FootballPrevSeasonStats;
    awayPrevSeason: FootballPrevSeasonStats;
    h2hMatches: H2HMatchRecord[]; // Last 5 or 10
    homeRecentMatches: TeamRecentMatch[]; // Last 5
    awayRecentMatches: TeamRecentMatch[]; // Last 5
  };
  
  tennisDetails?: {
    selectedPlayer: TennisPlayerStats;
    opponentPlayer: TennisPlayerStats;
    playerRecentSingles: TennisRecentMatch[]; // Last 10 completed competitive
  };
  
  // Fetched from TheStatsAPI's own odds endpoint (GET
  // /football/matches/{match_id}/odds) alongside the rest of a fixture's
  // enrichment. Absent when the provider has no odds on file for this match
  // yet — every consumer must treat a missing marketOdds as "not priced
  // yet", not as a crash or a reason to fabricate a number.
  marketOdds?: MatchOddsData;
  verificationCard?: VerificationAuditCard;
  /** Total count of raw records received from the relevant provider API in this scan */
  rawFeedTotal?: number;
}

export interface HistoricalBetRecord {
  id: string;
  date: string;
  fixtureId: string;
  sport: Sport;
  system: SystemType;
  match: string;
  competition: string;
  selection: string;
  oddsTaken: number;
  stake: number;
  outcome: BetOutcome;
  finalScore?: string;
  settledAt?: string;
  pnl: number;
  roiContribution: number;
  auditId: string;
  notes?: string;
  googleVerificationUrl?: string;
  flashscoreUrl?: string;
  dataSourceName?: string;
}

export type SyncStatus = 'SUCCEEDED' | 'FAILED' | 'WARNING';

export interface SyncLogRecord {
  id: string;
  timestamp: string; // ISO string
  trigger: 'SCHEDULED' | 'MANUAL';
  status: SyncStatus;
  durationMs: number;
  totalRecordsScanned: number;
  qualifiersCount: number;
  priceWatchCount: number;
  rejectedCount: number;
  dataSources: {
    name: string;
    url: string;
    status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
    recordsSupplied: number;
  }[];
  systemBreakdown: {
    system: SystemType;
    label: string;
    scanned: number;
    qualified: number;
    priceWatch: number;
  }[];
  divergenceRate: number; // e.g. 0.0 (%)
  notes: string;
}

export interface SystemAnalytics {
  totalBets: number;
  settledBets: number;
  wonBets: number;
  lostBets: number;
  pendingBets: number;
  voidBets: number;
  winRate: number; // percentage (Won / (Won + Lost))
  strikeRate: number; // percentage (Won / Total)
  totalStaked: number;
  netProfit: number;
  roiPercentage: number;
  avgOdds: number;
}

export interface RuleThresholds {
  footballOver15: {
    enabled: boolean;
    minPrevSeasonAvgScored: number; // both teams, >=
    minH2HOver15Rate: number; // 0-1, over last 5 competitive meetings
    minRecentScoredCount: number; // out of last 5 competitive matches
    minExchangeOdds: number;
    enhancedOddsThreshold: number; // odds above this trigger enhanced verification
    /**
     * Football competition IDs (TheStatsAPI `comp_...` ids) this rule's
     * fixture pulls and backtests are scoped to. An empty array means "All"
     * — every competition the account's TheStatsAPI key can see. Kept
     * per-rule (not global) since Over 1.5 and Under 3.5 can legitimately
     * target different leagues.
     */
    selectedLeagueIds: string[];
  };
  footballUnder35: {
    enabled: boolean;
    maxPrevSeasonAvgScored: number; // both teams, <
    maxPrevSeasonAvgConceded: number; // both teams, <
    minH2HUnder35Rate: number; // 0-1, over last 10 competitive meetings
    minRecentUnder35Count: number; // out of last 5 competitive matches
    minExchangeOdds: number;
    /** See footballOver15.selectedLeagueIds. */
    selectedLeagueIds: string[];
  };
  tennisStraightSets: {
    enabled: boolean;
    minRankingDelta: number; // selected player must rank at least this many places higher
    minSurfaceWinRate: number; // percent, 0-100
    minRecentWinsCount: number; // out of last 10 completed competitive singles
    minExchangeOdds: number;
    enhancedOddsThreshold: number; // odds above this trigger enhanced verification
  };
}

export interface AppSettings {
  flashscoreApiKey: string;
  tennisAbstractApiKey: string;
  betfairAppKey: string;
  betfairSessionToken: string;
  theStatsApiKey: string;
  dailyScanScheduleUtc: string; // e.g., "06:00"
  scheduleEnabled: boolean;
  notificationEmail: string;
  emailNotificationsEnabled: boolean;
  currencySymbol: string;
  defaultStake: number;
  showPreliminaryQualifiers: boolean;
  autoArchiveQualifiers?: boolean; // automatically record verified qualifiers to archive ledger
  autoSettleCompleted?: boolean; // automatically resolve outcomes for concluded matches
  ruleThresholds: RuleThresholds;
  /**
   * The full catalog of football competitions TheStatsAPI returned the last
   * time "Load Leagues" was run — persisted (not just in-memory) so it
   * survives a reload and syncs across devices via the same Firestore
   * document as the rest of settings, and so each rule's league selection
   * (RuleThresholds.football*.selectedLeagueIds) always has real names to
   * resolve against instead of losing its picks on every refresh.
   */
  leagueCatalog: LeagueOption[];
  /** When leagueCatalog was last refreshed from TheStatsAPI. */
  leagueCatalogUpdatedAt?: string;
  /**
   * A curated subset of leagueCatalog, picked once in the "Leagues" section
   * instead of every rule choosing straight from the full (often huge) raw
   * provider catalog. When non-empty, each rule's own League picker offers
   * only these; when empty, no shortlist has been set yet and every rule's
   * picker falls back to the full raw catalog, so existing saved
   * configurations keep working unchanged.
   */
  leagueShortlistIds: string[];
}

/** One TheStatsAPI football competition, as shown in a rule's league selector. */
export interface LeagueOption {
  id: string;
  name: string;
  country: string | null;
  type: 'league' | 'cup' | 'tournament';
}

export interface BacktestMatchResult {
  matchId: string;
  date: string;
  match: string;
  competition: string;
  finalScore: string;
  system: SystemType;
  won: boolean;
}

export interface BacktestSummary {
  system: SystemType;
  leagueLabel: string;
  /** Finished matches actually found for the selected league/window. */
  candidateCount: number;
  /** Of those, how many had a real historical context (previous-season stats, recent form, H2H) reconstructed and evaluated. */
  evaluatedCount: number;
  /** Of the evaluated matches, how many would have passed the rule's real statistical filters (a "preliminary qualifier"). */
  sampleSize: number;
  wins: number;
  losses: number;
  winRatePct: number;
  requiredOdds: number;
  /** P&L for a flat stake of 1 unit per qualifying match, at the configured required odds. */
  netUnitsAtRequiredOdds: number;
  roiPct: number;
  matches: BacktestMatchResult[];
  /**
   * Each qualifying match's win/loss is the real final score against the
   * system's goal line. Backtest does not re-query TheStatsAPI's odds
   * endpoint per historical match (see marketOdds in CandidateFixture for
   * the live-scan equivalent) — every qualifying match here is priced at
   * the system's configured required odds, the same convention already
   * used for Archive backfill (see historyBackfill.ts), rather than a real
   * historical market price.
   */
  scopeNote: string;
}

/**
 * One saved backtest run, so a user trying several rule configurations can
 * come back later and compare which setup actually performed best — rather
 * than the result vanishing the moment they navigate away or refresh.
 * ruleSnapshot freezes the exact thresholds in effect at run time, since
 * Engine Configuration can change afterwards and would otherwise make an
 * old run's result impossible to attribute to a specific setup.
 */
export interface BacktestRunRecord {
  id: string;
  runAt: string; // ISO timestamp
  system: Extract<SystemType, 'football_over_1_5' | 'football_under_3_5'>;
  ruleSnapshot: RuleThresholds['footballOver15'] | RuleThresholds['footballUnder35'];
  summary: BacktestSummary;
}

export interface FeedSummaryRecord {
  sport: Sport;
  provider: DataProviderType;
  totalRecordsReceived: number;
  fetchedAt: string;
  queryDates: string[];
  error?: string;
}

export interface FilterReductionStep {
  filterId: string;
  filterName: string;
  targetRule: string;
  targetValue: string;
  /** Number of matches in the feed that pass this filter independently */
  standalonePassedCount: number;
  /** Number of matches in the feed eliminated by this filter independently */
  standaloneEliminatedCount: number;
  /** Reduction percentage in feed when evaluated standalone */
  standaloneReductionPct: number;
  /** Cumulative matches remaining in pipeline after applying this step */
  pipelineRemainingCount: number;
  /** Matches eliminated at this step in the sequential pipeline */
  pipelineEliminatedCount: number;
  /** Cumulative reduction from initial feed count */
  cumulativeReductionPct: number;
}

export interface SystemFeedBreakdown {
  sport: Sport;
  system: SystemType;
  ruleTitle: string;
  /** Human-readable summary of this rule's own league scope, e.g. "All leagues" or "Premier League, La Liga". */
  leagueScopeLabel: string;
  provider: DataProviderType | 'NONE';
  isConfigured: boolean;
  isLoading: boolean;
  error?: string;
  totalFeedRecords: number;
  enrichedRecordsCount: number;
  incompleteDataCount: number;
  filterSteps: FilterReductionStep[];
  preliminaryQualifiersCount: number;
  verifiedQualifiersCount: number;
  priceWatchCount: number;
  fetchedAt?: string;
  rawMatches?: CandidateFixture[];
}

