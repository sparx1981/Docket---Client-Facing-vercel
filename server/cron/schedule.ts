/**
 * Pure scheduling decisions for the server-side daily scan, kept free of
 * Firestore/Express so the rules can be tested directly.
 *
 * Vocabulary:
 *  - slot: the most recent moment (at or before now) at which a user's
 *    configured daily scan time (HH:MM UTC) occurred. A scan is "owed" for a
 *    slot until one has completed successfully at or after it.
 *  - source: who is asking. The daily Vercel cron ("cron") acts as soon as a
 *    scan is owed. The 30-minute watchdog ("watchdog") is the backup: it
 *    only acts once a scan is overdue by more than WATCHDOG_GRACE_MINUTES,
 *    i.e. the normal run did not happen when it should have.
 */

export type ScanSource = 'cron' | 'watchdog';

export const WATCHDOG_GRACE_MINUTES = 30;
/** A scan marked "running" for longer than this is assumed to have died (a serverless function is capped at 300s). */
export const RUN_STALE_MINUTES = 12;
/** After a failed/dead attempt, wait at least this long before trying again for the same slot. */
export const RETRY_COOLDOWN_MINUTES = 20;
/** Attempts per slot before giving up (and raising an alert). */
export const MAX_ATTEMPTS_PER_SLOT = 3;

export interface ScanState {
  status?: 'running' | 'idle';
  startedAt?: string;
  /** ISO of the slot the attempts below belong to. */
  slot?: string;
  attempts?: number;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  /** Slot for which the "gave up" alert email has already been sent. */
  alertedSlot?: string;
}

export type ScanDecision =
  | { action: 'scan'; slot: string; attempt: number; overdueMinutes: number }
  | { action: 'skip'; reason: string; needsGiveUpAlert?: boolean; slot?: string };

/** The latest occurrence of HH:MM UTC at or before `now`. Falls back to 06:00 for an unparseable time. */
export function latestSlot(now: Date, scheduleUtc: string): Date {
  const m = /^(\d{1,2}):(\d{2})$/.exec((scheduleUtc || '').trim());
  const hours = m ? Math.min(23, Number(m[1])) : 6;
  const minutes = m ? Math.min(59, Number(m[2])) : 0;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hours, minutes));
  if (today.getTime() > now.getTime()) today.setUTCDate(today.getUTCDate() - 1);
  return today;
}

const minutesBetween = (later: Date, earlier: Date) => (later.getTime() - earlier.getTime()) / 60_000;

export function decideScan(input: {
  now: Date;
  scheduleUtc: string;
  /** Latest time a scan for this user completed without outright failing (server run or browser run). */
  lastSuccessAt: Date | null;
  state: ScanState;
  source: ScanSource;
}): ScanDecision {
  const { now, scheduleUtc, lastSuccessAt, state, source } = input;
  const slot = latestSlot(now, scheduleUtc);
  const slotIso = slot.toISOString();

  if (lastSuccessAt && lastSuccessAt.getTime() >= slot.getTime()) {
    return { action: 'skip', reason: 'scan for the latest scheduled time already completed', slot: slotIso };
  }

  const overdueMinutes = Math.floor(minutesBetween(now, slot));
  if (source === 'watchdog' && overdueMinutes < WATCHDOG_GRACE_MINUTES) {
    return {
      action: 'skip',
      reason: `scheduled scan is only ${overdueMinutes} min late — within the ${WATCHDOG_GRACE_MINUTES} min grace period`,
      slot: slotIso,
    };
  }

  if (state.status === 'running' && state.startedAt) {
    const runningFor = minutesBetween(now, new Date(state.startedAt));
    if (runningFor < RUN_STALE_MINUTES) {
      return { action: 'skip', reason: `a scan is already running (started ${Math.floor(runningFor)} min ago)`, slot: slotIso };
    }
  }

  const sameSlot = state.slot === slotIso;
  const attemptsSoFar = sameSlot ? state.attempts ?? 0 : 0;
  if (attemptsSoFar >= MAX_ATTEMPTS_PER_SLOT) {
    return {
      action: 'skip',
      reason: `gave up after ${attemptsSoFar} attempts for this scheduled time`,
      needsGiveUpAlert: state.alertedSlot !== slotIso,
      slot: slotIso,
    };
  }

  if (sameSlot && state.lastAttemptAt && state.status !== 'running') {
    const since = minutesBetween(now, new Date(state.lastAttemptAt));
    if (since < RETRY_COOLDOWN_MINUTES) {
      return { action: 'skip', reason: `retrying in ${Math.ceil(RETRY_COOLDOWN_MINUTES - since)} min (last attempt ${Math.floor(since)} min ago)`, slot: slotIso };
    }
  }

  return { action: 'scan', slot: slotIso, attempt: attemptsSoFar + 1, overdueMinutes };
}

/** The newest time a scan completed without failing, from the stored sync logs (newest first) and the server's own state. */
export function latestSuccessfulScan(
  syncLogs: { timestamp?: string; status?: string }[] | undefined,
  state: ScanState
): Date | null {
  const candidates: number[] = [];
  const fromLogs = (Array.isArray(syncLogs) ? syncLogs : []).find((l) => l?.status && l.status !== 'FAILED' && l.timestamp);
  if (fromLogs?.timestamp) candidates.push(new Date(fromLogs.timestamp).getTime());
  if (state.lastSuccessAt) candidates.push(new Date(state.lastSuccessAt).getTime());
  const valid = candidates.filter((n) => Number.isFinite(n));
  return valid.length > 0 ? new Date(Math.max(...valid)) : null;
}
