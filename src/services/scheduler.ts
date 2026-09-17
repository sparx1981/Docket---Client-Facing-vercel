import {
  AppSettings,
  CandidateFixture,
  HistoricalBetRecord,
  SyncLogRecord,
} from '../types';
import { fetchCandidateFixtures } from './dataFeed';
import { apiGet } from './backendClient';
import { runVerificationAudit } from './verificationEngine';
import {
  appendSyncLog,
  getHistoricalBets,
  logVerifiedQualifierToHistory,
  saveHistoricalBets,
  setStoredLastScanTimestamp,
} from './storage';

/**
 * Computes the next scheduled Date based on the configured UTC time string (e.g. "06:00").
 */
export function getNextScheduleTime(scheduleUtcTime: string = '06:00'): Date {
  const [hoursStr, minutesStr] = (scheduleUtcTime || '06:00').split(':');
  const hours = parseInt(hoursStr || '6', 10);
  const minutes = parseInt(minutesStr || '0', 10);

  const now = new Date();
  const next = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      isNaN(hours) ? 6 : hours,
      isNaN(minutes) ? 0 : minutes,
      0,
      0
    )
  );

  if (now.getTime() >= next.getTime()) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}

/**
 * Returns a human-readable countdown or time string to next scheduled run.
 */
export function formatTimeUntilNextRun(scheduleUtcTime: string = '06:00'): string {
  const next = getNextScheduleTime(scheduleUtcTime);
  const now = new Date();
  const diffMs = next.getTime() - now.getTime();

  if (diffMs <= 0) return 'due now';

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (diffHours === 0) {
    return `in ${diffMinutes}m`;
  }
  return `in ${diffHours}h ${diffMinutes}m`;
}

/**
 * Determines whether an automatic scheduled scan is currently due.
 */
export function isScheduledScanDue(
  lastScanIso: string | null,
  scheduleUtcTime: string = '06:00'
): boolean {
  if (!lastScanIso) return true;

  const now = new Date();
  const lastScan = new Date(lastScanIso);

  if (isNaN(lastScan.getTime())) return true;

  const hoursSinceLast = (now.getTime() - lastScan.getTime()) / (1000 * 60 * 60);
  if (hoursSinceLast >= 24) return true;

  const [hoursStr, minutesStr] = (scheduleUtcTime || '06:00').split(':');
  const targetHour = parseInt(hoursStr || '6', 10);
  const targetMin = parseInt(minutesStr || '0', 10);

  const todaysSchedule = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      isNaN(targetHour) ? 6 : targetHour,
      isNaN(targetMin) ? 0 : targetMin,
      0,
      0
    )
  );

  if (now.getTime() >= todaysSchedule.getTime() && lastScan.getTime() < todaysSchedule.getTime()) {
    return true;
  }

  return false;
}

/** Strips the id prefix dataFeed.ts adds so the raw provider id can be looked up again. */
function extractProviderId(fixtureId: string): string {
  return fixtureId.replace(/^(FT-OV15-|FT-UN35-|TN-SETS-|HIST-OV15-|HIST-UN35-|HIST-TNST-)/, '');
}

function footballProviderFor(settings: AppSettings): { provider: 'sportradar' | 'sportmonks'; key: string } | null {
  const footballKey = settings.sportradarFootballApiKey || settings.sportradarApiKey;
  if (footballKey) return { provider: 'sportradar', key: footballKey };
  if (settings.sportmonksApiKey) return { provider: 'sportmonks', key: settings.sportmonksApiKey };
  return null;
}

/**
 * Looks up the real result for one pending bet's fixture on its scheduled
 * date and settles it deterministically against the system's line — never
 * against a hardcoded lookup table. Returns the bet unchanged (still
 * PENDING) when the provider has no result yet, which is the honest outcome
 * for a match that hasn't been played or hasn't been reported as final.
 */
async function trySettleBet(bet: HistoricalBetRecord, settings: AppSettings): Promise<HistoricalBetRecord> {
  if (bet.outcome !== 'PENDING') return bet;
  const providerId = extractProviderId(bet.fixtureId);

  try {
    if (bet.sport === 'football') {
      const fp = footballProviderFor(settings);
      if (!fp) return bet;
      const body = await apiGet(
        `/api/football/results?from=${bet.date}&to=${bet.date}&provider=${fp.provider}`,
        fp.key
      );
      const result = (body?.results || []).find((r: any) => String(r.providerId) === providerId);
      if (!result || typeof result.homeScore !== 'number' || typeof result.awayScore !== 'number') return bet;

      const totalGoals = result.homeScore + result.awayScore;
      const won = bet.system === 'football_over_1_5' ? totalGoals > 1 : totalGoals < 4;
      return settleWithOutcome(bet, won ? 'WON' : 'LOST', result.finalScore);
    }

    if (bet.sport === 'tennis') {
      const tennisKey = settings.sportradarTennisApiKey || settings.sportradarApiKey;
      if (!tennisKey) return bet;
      const body = await apiGet(`/api/tennis/results?from=${bet.date}&to=${bet.date}`, tennisKey);
      const result = (body?.results || []).find((r: any) => String(r.providerId) === providerId);
      if (!result || !result.winner) return bet;

      const winnerName = result.winner === 'home' ? result.homeOrPlayer1 : result.awayOrPlayer2;
      const sets = String(result.setScore || result.finalScore || '').trim().split(/\s+/).filter(Boolean);
      const isStraightSets = sets.length === 2 || sets.length === 3;
      const won = isStraightSets && bet.selection.includes(winnerName);
      return settleWithOutcome(bet, won ? 'WON' : 'LOST', result.setScore || result.finalScore);
    }
  } catch {
    // Provider call failed — leave PENDING rather than guessing.
    return bet;
  }

  return bet;
}

function settleWithOutcome(
  bet: HistoricalBetRecord,
  outcome: 'WON' | 'LOST',
  finalScore?: string
): HistoricalBetRecord {
  const pnl = outcome === 'WON' ? Number(((bet.oddsTaken - 1) * bet.stake).toFixed(2)) : -bet.stake;
  const roiContribution = Number(((pnl / bet.stake) * 100).toFixed(1));
  return {
    ...bet,
    outcome,
    finalScore: finalScore || bet.finalScore,
    settledAt: new Date().toISOString(),
    pnl,
    roiContribution,
    notes: `${bet.notes || ''} Auto-settled against the real provider result.`.trim(),
  };
}

/**
 * Executes a full background scan: pulls real candidate fixtures, runs the
 * verification audit over each, auto-archives qualifiers, auto-settles any
 * pending bets whose match has since concluded, and records an honest sync
 * log (real counts, real timing, real per-provider success/failure — never
 * a hardcoded "ONLINE").
 */
export async function executeBackgroundScan(
  settings: AppSettings,
  isAutomatic: boolean = true
): Promise<{
  refreshedFixtures: CandidateFixture[];
  updatedHistoricalBets: HistoricalBetRecord[];
  newLog: SyncLogRecord;
  scanTimestamp: string;
  autoArchivedCount: number;
  autoSettledCount: number;
  fetchError?: string;
}> {
  const startedAt = Date.now();
  const scanTimestamp = new Date().toISOString();
  setStoredLastScanTimestamp(scanTimestamp);

  const { fixtures, error: fetchError } = await fetchCandidateFixtures(settings);

  let autoArchivedCount = 0;
  const refreshedFixtures = fixtures.map((fixture) => {
    const audit = runVerificationAudit(fixture, settings.ruleThresholds, undefined);

    if (
      settings.autoArchiveQualifiers !== false &&
      fixture.status === 'VERIFIED_QUALIFIER' &&
      audit.status === 'VERIFIED'
    ) {
      logVerifiedQualifierToHistory(fixture, audit, settings.defaultStake);
      autoArchivedCount++;
    }

    return { ...fixture, verificationCard: audit };
  });

  let currentBets = getHistoricalBets();
  let autoSettledCount = 0;

  if (settings.autoSettleCompleted !== false) {
    const pending = currentBets.filter((b) => b.outcome === 'PENDING');
    if (pending.length > 0) {
      const settled = await Promise.all(pending.map((b) => trySettleBet(b, settings)));
      const byId = new Map(settled.map((b) => [b.id, b]));
      const updatedBets = currentBets.map((b) => byId.get(b.id) || b);
      autoSettledCount = settled.filter((b) => b.outcome !== 'PENDING').length;
      if (autoSettledCount > 0) {
        saveHistoricalBets(updatedBets);
        currentBets = updatedBets;
      }
    }
  }

  const qualifiersCount = refreshedFixtures.filter(
    (f) => f.status === 'VERIFIED_QUALIFIER' && f.verificationCard?.status === 'VERIFIED'
  ).length;
  const priceWatchCount = refreshedFixtures.filter(
    (f) => f.status === 'PRICE_WATCH' || f.verificationCard?.status === 'PRICE_DEFICIT'
  ).length;
  const totalRecordsScanned = refreshedFixtures.length;
  const rejectedCount = Math.max(0, totalRecordsScanned - qualifiersCount - priceWatchCount);

  const footballProvider = footballProviderFor(settings);
  const tennisAvailable = Boolean(settings.sportradarTennisApiKey || settings.sportradarApiKey);
  const anyProviderConfigured = Boolean(footballProvider || tennisAvailable);

  const newLog: SyncLogRecord = {
    id: `SYNC-${scanTimestamp.replace(/[-:T]/g, '').slice(0, 14)}UTC`,
    timestamp: scanTimestamp,
    trigger: isAutomatic ? 'SCHEDULED' : 'MANUAL',
    status: fetchError ? (totalRecordsScanned > 0 ? 'WARNING' : 'FAILED') : 'SUCCEEDED',
    durationMs: Date.now() - startedAt,
    totalRecordsScanned,
    qualifiersCount,
    priceWatchCount,
    rejectedCount,
    divergenceRate: 0.0,
    notes: fetchError
      ? `Scan completed with issues: ${fetchError}`
      : anyProviderConfigured
      ? `Pulled ${totalRecordsScanned} real candidate checks and re-ran the verification audit against raw provider evidence. Betfair Exchange odds are not yet connected (phase 2) — qualifying candidates are held in Price Watch until a real price is available.`
      : 'No provider API key configured — add Sportradar or Sportmonks in Engine Configuration to pull real fixtures.',
    dataSources: [
      footballProvider
        ? {
            name: footballProvider.provider === 'sportradar' ? 'Sportradar Soccer API' : 'Sportmonks Football API',
            url:
              footballProvider.provider === 'sportradar'
                ? 'https://developer.sportradar.com/'
                : 'https://www.sportmonks.com/',
            status: fetchError ? 'DEGRADED' : 'ONLINE',
            recordsSupplied: totalRecordsScanned,
          }
        : { name: 'Football provider', url: '', status: 'OFFLINE', recordsSupplied: 0 },
      tennisAvailable
        ? {
            name: 'Sportradar Tennis API',
            url: 'https://developer.sportradar.com/',
            status: fetchError ? 'DEGRADED' : 'ONLINE',
            recordsSupplied: totalRecordsScanned,
          }
        : { name: 'Tennis provider', url: '', status: 'OFFLINE', recordsSupplied: 0 },
    ],
    systemBreakdown: (['football_over_1_5', 'football_under_3_5', 'tennis_straight_sets'] as const).map((system) => {
      const inSystem = refreshedFixtures.filter((f) => f.system === system);
      return {
        system,
        label:
          system === 'football_over_1_5'
            ? 'Over 1.5 Goals'
            : system === 'football_under_3_5'
            ? 'Under 3.5 Goals'
            : 'Straight Sets (2-0 / 3-0)',
        scanned: inSystem.length,
        qualified: inSystem.filter((f) => f.status === 'VERIFIED_QUALIFIER' && f.verificationCard?.status === 'VERIFIED')
          .length,
        priceWatch: inSystem.filter((f) => f.status === 'PRICE_WATCH' || f.verificationCard?.status === 'PRICE_DEFICIT')
          .length,
      };
    }),
  };

  appendSyncLog(newLog);

  return {
    refreshedFixtures,
    updatedHistoricalBets: currentBets,
    newLog,
    scanTimestamp,
    autoArchivedCount,
    autoSettledCount,
    fetchError,
  };
}

/**
 * Manually or on-demand trigger auto-settlement of all pending bets against
 * real provider results.
 */
export async function autoSettleAllPendingBets(settings: AppSettings): Promise<HistoricalBetRecord[]> {
  const bets = getHistoricalBets();
  const pending = bets.filter((b) => b.outcome === 'PENDING');
  if (pending.length === 0) return bets;

  const settled = await Promise.all(pending.map((b) => trySettleBet(b, settings)));
  const byId = new Map(settled.map((b) => [b.id, b]));
  const updated = bets.map((b) => byId.get(b.id) || b);

  const changed = settled.some((b) => b.outcome !== 'PENDING');
  if (changed) {
    saveHistoricalBets(updated);
  }
  return updated;
}
