export type Sport = 'football' | 'tennis';

export type SystemType = 
  | 'football_over_1_5' 
  | 'football_under_3_5' 
  | 'tennis_straight_sets';

export type BetOutcome = 'WON' | 'LOST' | 'PENDING' | 'VOID';

// The only two providers this app actually calls (see server/providers/).
// There is no "premium" tier and no "fallback" tier — that framing belonged
// to the old Flashscore/Tennis Abstract narrative before real integration
// existed, and calling either of these two APIs a "fallback" today would be
// false: whichever one supplied a given fixture is simply the one that did.
export type DataProviderType = 'SPORTRADAR' | 'SPORTMONKS';

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

export interface BetfairExchangeMarket {
  marketId: string;
  eventId: string;
  marketType: 'OVER_UNDER_15' | 'OVER_UNDER_35' | 'SET_BETTING';
  selectionName: string;
  selectionId: number;
  decimalOdds: number;
  layOdds: number;
  liquidityMatched: number; // GBP or EUR volume
  availableBackVolume: number;
  isExchange: true; // Strictly exclude Sportsbook
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
  
  betfairAudit: {
    marketId: string;
    selection: string;
    verifiedExchangeOdds: number;
    thresholdOdds: number;
    volumeMatchedGbp: number;
    isExchangeMarket: boolean;
    liquidityApproved: boolean;
    verifiedViaCredentials?: boolean;
    appKeyMasked?: string;
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
  
  // Phase 1: Betfair Exchange integration is not yet implemented (deferred —
  // needs a certificate-based login flow). Absent until phase 2 lands; every
  // consumer must treat a missing betfairMarket as "not yet connected", not
  // as a crash or a reason to fabricate a number.
  betfairMarket?: BetfairExchangeMarket;
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
  };
  footballUnder35: {
    enabled: boolean;
    maxPrevSeasonAvgScored: number; // both teams, <
    maxPrevSeasonAvgConceded: number; // both teams, <
    minH2HUnder35Rate: number; // 0-1, over last 10 competitive meetings
    minRecentUnder35Count: number; // out of last 5 competitive matches
    minExchangeOdds: number;
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
  sportradarFootballApiKey: string;
  sportradarTennisApiKey: string;
  sportradarApiKey?: string;
  sportmonksApiKey: string;
  useFallbackProviders: boolean;
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
}

