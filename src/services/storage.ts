import {
  AppSettings,
  CandidateFixture,
  HistoricalBetRecord,
  SystemAnalytics,
  Sport,
  SystemType,
  VerificationAuditCard,
  SyncLogRecord,
  RuleThresholds,
  BacktestRunRecord,
} from '../types';
import { backfillHistoricalResults } from './historyBackfill';
import { buildHistoricalBetFromQualifier } from './archiveRecord';
import {
  fetchUserCloudData,
  fetchLatestScanCache,
  persistUserSettingsToCloud,
  persistUserHistoricalBetsToCloud,
  persistUserSyncDataToCloud,
  persistUserBacktestRunsToCloud,
} from './firebase';

export interface ActiveUserContext {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

let activeUserContext: ActiveUserContext | null = null;

export function setActiveUserContext(user: ActiveUserContext | null): void {
  activeUserContext = user;
}

export function getActiveUserContext(): ActiveUserContext | null {
  return activeUserContext;
}

const SETTINGS_KEY = 'sports_selection_settings_v2';
const HISTORICAL_BETS_KEY = 'sports_selection_historical_v2';
const ARCHIVED_QUALIFIERS_KEY = 'sports_selection_archived_qualifiers_v2';
const LAST_SCAN_KEY = 'sports_selection_last_scan_v2';
const SYNC_LOGS_KEY = 'sports_selection_sync_logs_v2';
const BACKTEST_RUNS_KEY = 'sports_selection_backtest_runs_v1';
/** Keeps the saved list from growing unbounded across many experimental configs. */
const MAX_STORED_BACKTEST_RUNS = 100;
const FIXTURES_KEY = 'sports_selection_fixtures_v1';
const BACKFILL_ATTEMPTED_KEY = 'sports_selection_backfill_attempted_v1';
const LEGACY_PURGE_KEY = 'sports_selection_legacy_purge_v1';

// Ids exclusively produced by the old synthetic generators
// (src/services/historicalDataset.ts, removed) and the old hardcoded
// SEED_SYNC_LOGS — never produced by real backfilled/logged data (see the
// id formats in historyBackfill.ts and logVerifiedQualifierToHistory below).
const LEGACY_HIST_ID = /^HIST-\d{1,3}$/;
const LEGACY_FIXTURE_ID = /^FX-HIST-/;
const LEGACY_SYNC_LOG_IDS = new Set([
  'SYNC-20260911-0600UTC',
  'SYNC-20260910-0600UTC',
  'SYNC-20260909-0600UTC',
]);

/**
 * One-time cleanup for browsers that already had the old fabricated seed
 * data (250 synthetic archive rows, 3 fake sync logs) cached in
 * localStorage from before real provider integration existed. Runs once per
 * browser; afterwards, an empty archive stays empty until real data is
 * pulled in — nothing here re-seeds anything.
 */
function purgeLegacyFakeData(): void {
  try {
    if (localStorage.getItem(LEGACY_PURGE_KEY) === 'true') return;

    const rawBets = localStorage.getItem(HISTORICAL_BETS_KEY);
    if (rawBets) {
      const parsed = JSON.parse(rawBets);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter(
          (b: HistoricalBetRecord) =>
            !LEGACY_HIST_ID.test(b.id || '') && !LEGACY_FIXTURE_ID.test(b.fixtureId || '')
        );
        localStorage.setItem(HISTORICAL_BETS_KEY, JSON.stringify(cleaned));
      }
    }

    const rawLogs = localStorage.getItem(SYNC_LOGS_KEY);
    if (rawLogs) {
      const parsed = JSON.parse(rawLogs);
      if (Array.isArray(parsed)) {
        const cleaned = parsed.filter((l: SyncLogRecord) => !LEGACY_SYNC_LOG_IDS.has(l.id));
        localStorage.setItem(SYNC_LOGS_KEY, JSON.stringify(cleaned));
      }
    }

    localStorage.setItem(LEGACY_PURGE_KEY, 'true');
  } catch (err) {
    console.error('Failed to purge legacy fake data', err);
  }
}

purgeLegacyFakeData();

// Mirrors the values that were previously hardcoded directly in
// rulesEngine.ts / verificationEngine.ts — the locked-rules product spec's
// original numbers, now the editable defaults in Engine Configuration.
export const DEFAULT_RULE_THRESHOLDS: RuleThresholds = {
  footballOver15: {
    enabled: true,
    minPrevSeasonAvgScored: 1.0,
    minH2HOver15Rate: 0.8,
    minRecentScoredCount: 4,
    minExchangeOdds: 1.15,
    enhancedOddsThreshold: 1.25,
    selectedLeagueIds: [],
  },
  footballUnder35: {
    enabled: true,
    maxLast5AvgScored: 1.0,
    maxLast5AvgConceded: 1.8,
    maxLast10AvgTotalGoals: 2.0,
    minExchangeOdds: 1.2,
    selectedLeagueIds: [],
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  flashscoreApiKey: '',
  betfairAppKey: '',
  betfairSessionToken: '',
  theStatsApiKey: '',
  dailyScanScheduleUtc: '06:00',
  scheduleEnabled: true,
  notificationEmail: 'craigtrickett@gmail.com',
  emailNotificationsEnabled: true,
  currencySymbol: '£',
  defaultStake: 100,
  showPreliminaryQualifiers: false,
  autoArchiveQualifiers: true,
  autoSettleCompleted: true,
  ruleThresholds: DEFAULT_RULE_THRESHOLDS,
  leagueCatalog: [],
  leagueShortlistIds: [],
};

/**
 * Older settings blobs stored one global `selectedLeagueIds` array rather
 * than a per-rule one. When migrating those, apply the old global selection
 * to both football rules — a one-time compatibility shim, not something new
 * saves ever write.
 */
function migrateLegacyGlobalLeagueSelection(parsed: any, ruleThresholds: RuleThresholds): RuleThresholds {
  const legacyGlobal = Array.isArray(parsed?.selectedLeagueIds) ? parsed.selectedLeagueIds : null;
  if (!legacyGlobal || legacyGlobal.length === 0) return ruleThresholds;
  return {
    ...ruleThresholds,
    footballOver15: {
      ...ruleThresholds.footballOver15,
      selectedLeagueIds: parsed?.ruleThresholds?.footballOver15?.selectedLeagueIds ?? legacyGlobal,
    },
    footballUnder35: {
      ...ruleThresholds.footballUnder35,
      selectedLeagueIds: parsed?.ruleThresholds?.footballUnder35?.selectedLeagueIds ?? legacyGlobal,
    },
  };
}

export function getStoredSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const ruleThresholds = migrateLegacyGlobalLeagueSelection(parsed, {
      // Deep-merge one level so a settings blob saved before this feature
      // existed (or missing a newly-added sub-field) still gets sane
      // defaults for whichever systems it doesn't have an override for.
      footballOver15: { ...DEFAULT_RULE_THRESHOLDS.footballOver15, ...parsed?.ruleThresholds?.footballOver15 },
      footballUnder35: { ...DEFAULT_RULE_THRESHOLDS.footballUnder35, ...parsed?.ruleThresholds?.footballUnder35 },
    });
    delete parsed.tennisAbstractApiKey; // tennis was removed from the product
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      leagueCatalog: Array.isArray(parsed?.leagueCatalog) ? parsed.leagueCatalog : [],
      leagueShortlistIds: Array.isArray(parsed?.leagueShortlistIds) ? parsed.leagueShortlistIds : [],
      ruleThresholds,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveStoredSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    if (activeUserContext) {
      persistUserSettingsToCloud(activeUserContext.uid, settings, activeUserContext).catch((err) =>
        console.error('Failed to sync settings to Firestore in background:', err)
      );
    }
  } catch (err) {
    console.error('Failed to save settings to localStorage', err);
  }
}

export function getHistoricalBets(): HistoricalBetRecord[] {
  try {
    const raw = localStorage.getItem(HISTORICAL_BETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Tennis was removed from the product; drop any leftover tennis records.
    return Array.isArray(parsed) ? parsed.filter((b: any) => b?.sport !== 'tennis') : [];
  } catch {
    return [];
  }
}

/** True the very first time this device would show an empty archive — used to gate the one-shot backfill. */
export function hasAttemptedHistoricalBackfill(): boolean {
  try {
    return localStorage.getItem(BACKFILL_ATTEMPTED_KEY) === 'true';
  } catch {
    return true; // fail safe: never loop retrying if localStorage is unavailable
  }
}

export function markHistoricalBackfillAttempted(): void {
  try {
    localStorage.setItem(BACKFILL_ATTEMPTED_KEY, 'true');
  } catch {
    // ignore — worst case the backfill is retried once more on the next load
  }
}

/**
 * Pulls real settled results from whichever provider is configured and
 * merges them into the archive, keeping any pending bets already logged.
 * Used both for the one-shot first-run backfill and for the manual
 * "Pull historical records" action in the UI.
 */
export async function syncPastHistoricalRecords(
  settings: AppSettings
): Promise<{ bets: HistoricalBetRecord[]; error?: string }> {
  const { records, error } = await backfillHistoricalResults(settings);
  const currentBets = getHistoricalBets();
  const existingIds = new Set(currentBets.map((b) => b.id));
  const merged = [...currentBets];
  for (const item of records) {
    if (!existingIds.has(item.id)) {
      merged.push(item);
      existingIds.add(item.id);
    }
  }
  merged.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  saveHistoricalBets(merged);
  return { bets: merged, error };
}

export function saveHistoricalBets(bets: HistoricalBetRecord[]): void {
  try {
    localStorage.setItem(HISTORICAL_BETS_KEY, JSON.stringify(bets));
    if (activeUserContext) {
      persistUserHistoricalBetsToCloud(activeUserContext.uid, bets).catch((err) =>
        console.error('Failed to sync historical bets to Firestore in background:', err)
      );
    }
  } catch (err) {
    console.error('Failed to save historical bets', err);
  }
}

export function logVerifiedQualifierToHistory(
  fixture: CandidateFixture,
  auditCard: VerificationAuditCard,
  stake: number = 100
): HistoricalBetRecord {
  const currentBets = getHistoricalBets();
  
  // Check if already logged for this fixture and market
  const existing = currentBets.find((b) => b.fixtureId === fixture.id);
  if (existing) return existing;

  const newBet = buildHistoricalBetFromQualifier(fixture, auditCard, stake);

  const updated = [newBet, ...currentBets];
  saveHistoricalBets(updated);
  return newBet;
}

export function settleBet(
  betId: string,
  outcome: 'WON' | 'LOST' | 'VOID',
  finalScore: string = ''
): HistoricalBetRecord[] {
  const bets = getHistoricalBets();
  const updated = bets.map((b) => {
    if (b.id !== betId) return b;
    let pnl = 0;
    if (outcome === 'WON') {
      pnl = Number(((b.oddsTaken - 1) * b.stake).toFixed(2));
    } else if (outcome === 'LOST') {
      pnl = -b.stake;
    } else if (outcome === 'VOID') {
      pnl = 0;
    }
    const roiContribution = Number(((pnl / b.stake) * 100).toFixed(1));
    return {
      ...b,
      outcome,
      finalScore: finalScore || b.finalScore,
      settledAt: new Date().toISOString(),
      pnl,
      roiContribution,
    };
  });
  saveHistoricalBets(updated);
  return updated;
}

/**
 * Calculates long-term win rate, strike rate, total stake, PnL, and ROI%
 * for Football or Combined
 */
export function calculateSystemAnalytics(
  bets: HistoricalBetRecord[],
  filterSport?: Sport,
  filterSystem?: SystemType
): SystemAnalytics {
  let filtered = bets;
  if (filterSport) {
    filtered = filtered.filter((b) => b.sport === filterSport);
  }
  if (filterSystem) {
    filtered = filtered.filter((b) => b.system === filterSystem);
  }

  const settled = filtered.filter((b) => b.outcome === 'WON' || b.outcome === 'LOST');
  const won = filtered.filter((b) => b.outcome === 'WON').length;
  const lost = filtered.filter((b) => b.outcome === 'LOST').length;
  const pending = filtered.filter((b) => b.outcome === 'PENDING').length;
  const voidCount = filtered.filter((b) => b.outcome === 'VOID').length;

  const totalBets = filtered.length;
  const totalStaked = settled.reduce((acc, b) => acc + b.stake, 0);
  const netProfit = settled.reduce((acc, b) => acc + b.pnl, 0);
  
  const winRate = settled.length > 0 ? Number(((won / settled.length) * 100).toFixed(1)) : 0;
  const strikeRate = totalBets > 0 ? Number(((won / totalBets) * 100).toFixed(1)) : 0;
  const roiPercentage = totalStaked > 0 ? Number(((netProfit / totalStaked) * 100).toFixed(1)) : 0;
  
  const avgOdds =
    filtered.length > 0
      ? Number((filtered.reduce((acc, b) => acc + b.oddsTaken, 0) / filtered.length).toFixed(2))
      : 0;

  return {
    totalBets,
    settledBets: settled.length,
    wonBets: won,
    lostBets: lost,
    pendingBets: pending,
    voidBets: voidCount,
    winRate,
    strikeRate,
    totalStaked,
    netProfit: Number(netProfit.toFixed(2)),
    roiPercentage,
    avgOdds,
  };
}

export function getStoredLastScanTimestamp(): string | null {
  return localStorage.getItem(LAST_SCAN_KEY);
}

export function setStoredLastScanTimestamp(iso: string): void {
  localStorage.setItem(LAST_SCAN_KEY, iso);
  if (activeUserContext) {
    persistUserSyncDataToCloud(activeUserContext.uid, getStoredSyncLogs(), iso).catch((err) =>
      console.error('Failed to sync last scan timestamp to Firestore:', err)
    );
  }
}

export function getStoredSyncLogs(): SyncLogRecord[] {
  try {
    const raw = localStorage.getItem(SYNC_LOGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredSyncLogs(logs: SyncLogRecord[]): void {
  try {
    localStorage.setItem(SYNC_LOGS_KEY, JSON.stringify(logs));
    if (activeUserContext) {
      persistUserSyncDataToCloud(activeUserContext.uid, logs, getStoredLastScanTimestamp()).catch(
        (err) => console.error('Failed to sync logs to Firestore in background:', err)
      );
    }
  } catch (err) {
    console.error('Failed to save sync logs to localStorage', err);
  }
}

export function appendSyncLog(log: SyncLogRecord): SyncLogRecord[] {
  const current = getStoredSyncLogs();
  const updated = [log, ...current];
  saveStoredSyncLogs(updated);
  return updated;
}

export function getStoredBacktestRuns(): BacktestRunRecord[] {
  try {
    const raw = localStorage.getItem(BACKTEST_RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBacktestRuns(runs: BacktestRunRecord[]): void {
  try {
    localStorage.setItem(BACKTEST_RUNS_KEY, JSON.stringify(runs));
    if (activeUserContext) {
      persistUserBacktestRunsToCloud(activeUserContext.uid, runs).catch((err) =>
        console.error('Failed to sync backtest runs to Firestore in background:', err)
      );
    }
  } catch (err) {
    console.error('Failed to save backtest runs to localStorage', err);
  }
}

/** Saves a completed backtest run, newest first, capped at MAX_STORED_BACKTEST_RUNS. */
export function logBacktestRun(run: BacktestRunRecord): BacktestRunRecord[] {
  const current = getStoredBacktestRuns();
  const updated = [run, ...current].slice(0, MAX_STORED_BACKTEST_RUNS);
  saveBacktestRuns(updated);
  return updated;
}

export function deleteBacktestRun(id: string): BacktestRunRecord[] {
  const updated = getStoredBacktestRuns().filter((r) => r.id !== id);
  saveBacktestRuns(updated);
  return updated;
}

/** True once a fixture's own kickoff/start time has passed — a stale Verified Qualifier or Price Watch entry should never be shown as if the match hasn't happened yet. */
function hasKickedOff(fixture: CandidateFixture): boolean {
  const t = new Date(fixture.matchTime).getTime();
  return !Number.isFinite(t) || t <= Date.now();
}

/**
 * The last scan's classified fixtures (Verified Qualifiers / Price Watch),
 * persisted so a refresh doesn't wipe them back to empty. Deliberately
 * localStorage only, not Firestore — this is a live-data cache tied to
 * this device's last real scan, not a durable record like settings or the
 * Archive ledger, and doesn't need cross-device sync. Any fixture whose
 * kickoff time has already passed is pruned on read, so a stale entry is
 * never shown as if the match hasn't happened yet.
 */
export function getStoredFixtures(): CandidateFixture[] {
  try {
    const raw = localStorage.getItem(FIXTURES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const fresh = parsed.filter((f: CandidateFixture) => !hasKickedOff(f));
    if (fresh.length !== parsed.length) {
      localStorage.setItem(FIXTURES_KEY, JSON.stringify(fresh));
    }
    return fresh;
  } catch {
    return [];
  }
}

export function saveStoredFixtures(fixtures: CandidateFixture[]): void {
  try {
    localStorage.setItem(FIXTURES_KEY, JSON.stringify(fixtures));
  } catch (err) {
    console.error('Failed to save fixtures to localStorage', err);
  }
}

/**
 * Hydrates local state from user's remote Firestore document upon login.
 * If user has no existing Firestore data, uploads current local configuration
 * and archive so work is preserved and linked to their account.
 */
export async function hydrateUserDataFromCloud(
  userId: string,
  userProfile?: { email?: string | null; displayName?: string | null; photoURL?: string | null }
): Promise<{
  settings: AppSettings;
  historicalBets: HistoricalBetRecord[];
  syncLogs: SyncLogRecord[];
  lastScanTimestamp: string | null;
  backtestRuns: BacktestRunRecord[];
  /** Fixtures from a newer server-side (cron) scan than this device has seen, if any. */
  cronFixtures?: CandidateFixture[];
}> {
  try {
    const previousLocalScan = getStoredLastScanTimestamp();
    const cloudData = await fetchUserCloudData(userId);

    if (!cloudData || !cloudData.settings) {
      // First-time login for this Google account: persist existing local state to Firestore
      const currentSettings = getStoredSettings();
      const currentBets = getHistoricalBets();
      const currentLogs = getStoredSyncLogs();
      const currentLastScan = getStoredLastScanTimestamp();
      const currentBacktestRuns = getStoredBacktestRuns();

      await persistUserSettingsToCloud(userId, currentSettings, userProfile);
      if (currentBets.length > 0) {
        await persistUserHistoricalBetsToCloud(userId, currentBets);
      }
      if (currentLogs.length > 0 || currentLastScan) {
        await persistUserSyncDataToCloud(userId, currentLogs, currentLastScan);
      }
      if (currentBacktestRuns.length > 0) {
        await persistUserBacktestRunsToCloud(userId, currentBacktestRuns);
      }

      return {
        settings: currentSettings,
        historicalBets: currentBets,
        syncLogs: currentLogs,
        lastScanTimestamp: currentLastScan,
        backtestRuns: currentBacktestRuns,
      };
    }

    // Hydrate state from Firestore document
    const cloudRuleThresholds = migrateLegacyGlobalLeagueSelection(cloudData.settings, {
      footballOver15: {
        ...DEFAULT_RULE_THRESHOLDS.footballOver15,
        ...cloudData.settings?.ruleThresholds?.footballOver15,
      },
      footballUnder35: {
        ...DEFAULT_RULE_THRESHOLDS.footballUnder35,
        ...cloudData.settings?.ruleThresholds?.footballUnder35,
      },
    });
    const cloudSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...cloudData.settings,
      leagueCatalog: Array.isArray(cloudData.settings?.leagueCatalog) ? cloudData.settings.leagueCatalog : [],
      leagueShortlistIds: Array.isArray(cloudData.settings?.leagueShortlistIds)
        ? cloudData.settings.leagueShortlistIds
        : [],
      ruleThresholds: cloudRuleThresholds,
    };

    const cloudBets = Array.isArray(cloudData.historicalBets) ? cloudData.historicalBets : [];
    const cloudLogs = Array.isArray(cloudData.syncLogs) ? cloudData.syncLogs : [];
    const cloudLastScan = cloudData.lastScanTimestamp || null;
    const cloudBacktestRuns = Array.isArray(cloudData.backtestRuns) ? cloudData.backtestRuns : [];

    // Cache locally for instantaneous rendering & resilience
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cloudSettings));
    localStorage.setItem(HISTORICAL_BETS_KEY, JSON.stringify(cloudBets));
    localStorage.setItem(SYNC_LOGS_KEY, JSON.stringify(cloudLogs));
    if (cloudLastScan) {
      localStorage.setItem(LAST_SCAN_KEY, cloudLastScan);
    }
    localStorage.setItem(BACKTEST_RUNS_KEY, JSON.stringify(cloudBacktestRuns));

    // A server-side daily scan stores its classified fixtures alongside the
    // sync log. If it ran after this device's own last scan, show its results
    // instead of an empty Qualifiers page.
    let cronFixtures: CandidateFixture[] | undefined;
    if (cloudLastScan && (!previousLocalScan || cloudLastScan > previousLocalScan)) {
      const cache = await fetchLatestScanCache(userId);
      if (cache && cache.scannedAt === cloudLastScan) {
        cronFixtures = cache.fixtures.filter((f) => !hasKickedOff(f));
        saveStoredFixtures(cronFixtures);
      }
    }

    return {
      settings: cloudSettings,
      historicalBets: cloudBets,
      syncLogs: cloudLogs,
      lastScanTimestamp: cloudLastScan,
      backtestRuns: cloudBacktestRuns,
      cronFixtures,
    };
  } catch (err) {
    console.error('Error hydrating user cloud data from Firestore:', err);
    return {
      settings: getStoredSettings(),
      historicalBets: getHistoricalBets(),
      syncLogs: getStoredSyncLogs(),
      lastScanTimestamp: getStoredLastScanTimestamp(),
      backtestRuns: getStoredBacktestRuns(),
    };
  }
}
