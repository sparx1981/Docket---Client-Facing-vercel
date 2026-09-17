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
} from '../types';
import { backfillHistoricalResults } from './historyBackfill';
import {
  fetchUserCloudData,
  persistUserSettingsToCloud,
  persistUserHistoricalBetsToCloud,
  persistUserSyncDataToCloud,
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
  },
  footballUnder35: {
    enabled: true,
    maxPrevSeasonAvgScored: 1.5,
    maxPrevSeasonAvgConceded: 1.5,
    minH2HUnder35Rate: 0.8,
    minRecentUnder35Count: 4,
    minExchangeOdds: 1.2,
  },
  tennisStraightSets: {
    enabled: true,
    minRankingDelta: 50,
    minSurfaceWinRate: 70.0,
    minRecentWinsCount: 8,
    minExchangeOdds: 1.2,
    enhancedOddsThreshold: 1.5,
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  flashscoreApiKey: '',
  tennisAbstractApiKey: '',
  betfairAppKey: '',
  betfairSessionToken: '',
  sportradarFootballApiKey: '',
  sportradarTennisApiKey: '',
  sportradarApiKey: '',
  sportmonksApiKey: '',
  useFallbackProviders: true,
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
};

export function getStoredSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    const footballKey = parsed?.sportradarFootballApiKey || parsed?.sportradarApiKey || '';
    const tennisKey = parsed?.sportradarTennisApiKey || parsed?.sportradarApiKey || '';
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      sportradarFootballApiKey: footballKey,
      sportradarTennisApiKey: tennisKey,
      sportradarApiKey: footballKey || tennisKey || '',
      // Deep-merge one level so a settings blob saved before this feature
      // existed (or missing a newly-added sub-field) still gets sane
      // defaults for whichever systems it doesn't have an override for.
      ruleThresholds: {
        footballOver15: { ...DEFAULT_RULE_THRESHOLDS.footballOver15, ...parsed?.ruleThresholds?.footballOver15 },
        footballUnder35: { ...DEFAULT_RULE_THRESHOLDS.footballUnder35, ...parsed?.ruleThresholds?.footballUnder35 },
        tennisStraightSets: { ...DEFAULT_RULE_THRESHOLDS.tennisStraightSets, ...parsed?.ruleThresholds?.tennisStraightSets },
      },
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
    return Array.isArray(parsed) ? parsed : [];
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

  const newBet: HistoricalBetRecord = {
    id: `HIST-${Date.now().toString(36).toUpperCase()}`,
    date: new Date().toISOString().split('T')[0],
    fixtureId: fixture.id,
    sport: fixture.sport,
    system: fixture.system,
    match: fixture.matchTitle,
    competition: fixture.competition,
    selection: fixture.betType,
    // Phase 1 has no Betfair Exchange integration — fall back to the
    // system's disclosed minimum qualifying price rather than a fabricated
    // figure when no real market price has been attached yet.
    oddsTaken: fixture.betfairMarket?.decimalOdds ?? fixture.requiredOdds,
    stake,
    outcome: 'PENDING',
    pnl: 0,
    roiContribution: 0,
    auditId: auditCard.auditId,
    notes: `Logged automatically from Daily Scan. Audit integrity: ${auditCard.dataIntegrityScore}%.`,
    googleVerificationUrl:
      fixture.googleVerificationUrl ||
      `https://www.google.com/search?q=${encodeURIComponent(
        `${fixture.matchTitle} ${fixture.competition} ${fixture.betType} result score`
      )}`,
    flashscoreUrl: `https://www.flashscore.com/search/?q=${encodeURIComponent(
      fixture.matchTitle
    )}`,
    dataSourceName:
      fixture.sport === 'tennis'
        ? 'Tennis Abstract Engine'
        : 'Flashscore Telemetry',
  };

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
 * for Football, Tennis, or Combined
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
}> {
  try {
    const cloudData = await fetchUserCloudData(userId);

    if (!cloudData || !cloudData.settings) {
      // First-time login for this Google account: persist existing local state to Firestore
      const currentSettings = getStoredSettings();
      const currentBets = getHistoricalBets();
      const currentLogs = getStoredSyncLogs();
      const currentLastScan = getStoredLastScanTimestamp();

      await persistUserSettingsToCloud(userId, currentSettings, userProfile);
      if (currentBets.length > 0) {
        await persistUserHistoricalBetsToCloud(userId, currentBets);
      }
      if (currentLogs.length > 0 || currentLastScan) {
        await persistUserSyncDataToCloud(userId, currentLogs, currentLastScan);
      }

      return {
        settings: currentSettings,
        historicalBets: currentBets,
        syncLogs: currentLogs,
        lastScanTimestamp: currentLastScan,
      };
    }

    // Hydrate state from Firestore document
    const cloudFootballKey =
      cloudData.settings?.sportradarFootballApiKey || cloudData.settings?.sportradarApiKey || '';
    const cloudTennisKey =
      cloudData.settings?.sportradarTennisApiKey || cloudData.settings?.sportradarApiKey || '';
    const cloudSettings: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...cloudData.settings,
      sportradarFootballApiKey: cloudFootballKey,
      sportradarTennisApiKey: cloudTennisKey,
      sportradarApiKey: cloudFootballKey || cloudTennisKey || '',
      ruleThresholds: {
        footballOver15: {
          ...DEFAULT_RULE_THRESHOLDS.footballOver15,
          ...cloudData.settings?.ruleThresholds?.footballOver15,
        },
        footballUnder35: {
          ...DEFAULT_RULE_THRESHOLDS.footballUnder35,
          ...cloudData.settings?.ruleThresholds?.footballUnder35,
        },
        tennisStraightSets: {
          ...DEFAULT_RULE_THRESHOLDS.tennisStraightSets,
          ...cloudData.settings?.ruleThresholds?.tennisStraightSets,
        },
      },
    };

    const cloudBets = Array.isArray(cloudData.historicalBets) ? cloudData.historicalBets : [];
    const cloudLogs = Array.isArray(cloudData.syncLogs) ? cloudData.syncLogs : [];
    const cloudLastScan = cloudData.lastScanTimestamp || null;

    // Cache locally for instantaneous rendering & resilience
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(cloudSettings));
    localStorage.setItem(HISTORICAL_BETS_KEY, JSON.stringify(cloudBets));
    localStorage.setItem(SYNC_LOGS_KEY, JSON.stringify(cloudLogs));
    if (cloudLastScan) {
      localStorage.setItem(LAST_SCAN_KEY, cloudLastScan);
    }

    return {
      settings: cloudSettings,
      historicalBets: cloudBets,
      syncLogs: cloudLogs,
      lastScanTimestamp: cloudLastScan,
    };
  } catch (err) {
    console.error('Error hydrating user cloud data from Firestore:', err);
    return {
      settings: getStoredSettings(),
      historicalBets: getHistoricalBets(),
      syncLogs: getStoredSyncLogs(),
      lastScanTimestamp: getStoredLastScanTimestamp(),
    };
  }
}
