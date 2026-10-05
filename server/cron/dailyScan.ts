import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Firestore } from 'firebase-admin/firestore';
import type { Express } from 'express';
import type { AppSettings, CandidateFixture, HistoricalBetRecord, SyncLogRecord } from '../../src/types';
import { fetchCandidateFixtures } from '../../src/services/dataFeed.js';
import { runVerificationAudit } from '../../src/services/verificationEngine.js';
import { buildHistoricalBetFromQualifier } from '../../src/services/archiveRecord.js';
import { setApiBaseUrl } from '../../src/services/backendClient.js';
import { getDb } from '../firebaseAdmin.js';
import { escapeHtml, htmlTable, sendNotificationEmail } from '../email.js';
import { buildScanEmail } from './scanEmail.js';
import {
  MAX_ATTEMPTS_PER_SLOT,
  decideScan,
  latestSuccessfulScan,
  type ScanSource,
  type ScanState,
} from './schedule.js';

/**
 * Server-side daily scan. Two things call it (see server/app.ts):
 *  - the daily Vercel Cron job (GET /api/cron/daily-scan), and
 *  - a 30-minute watchdog (GET /api/cron/scan-watchdog, called by the
 *    GitHub Actions workflow), which exists to catch a scan that did not
 *    start (or died) and run it as a backup instead of failing silently.
 * Both use the same rules (server/cron/schedule.ts): a user is owed a scan
 * for their configured daily time until one completes after that time.
 *
 * The in-browser scheduler only fires while the app is open in a tab, so on
 * its own a "daily" scan silently doesn't happen on days nobody opens the
 * app. This runs the same scan code (fetchCandidateFixtures +
 * runVerificationAudit) and stores the results in Firestore:
 *   users/{uid}.syncLogs / lastScanTimestamp / historicalBets  (as the client does)
 *   users/{uid}/scanCache/latest                               (classified fixtures,
 *                                                               picked up on next login)
 *   users/{uid}/scanState/current                              (running/attempt bookkeeping)
 *
 * Needs FIREBASE_SERVICE_ACCOUNT_JSON (a Firebase service-account key's JSON)
 * in the environment — Firestore security rules only let a signed-in user
 * touch their own document, so the server must use admin credentials.
 */

const MAX_STORED_SYNC_LOGS = 200;
/** Firestore documents are capped at 1 MiB — keep the cached fixture payload comfortably under it. */
const MAX_CACHE_JSON_CHARS = 900_000;

export interface UserScanOutcome {
  uid: string;
  status: 'scanned' | 'skipped' | 'failed';
  reason?: string;
  qualifiers?: number;
  archived?: number;
  /** Set when email notifications are on: whether the scan summary email went out. */
  emailed?: boolean;
  emailError?: string;
}

interface ScanContext {
  source: ScanSource;
  attempt: number;
  /** Minutes past the user's scheduled time when this run started. */
  overdueMinutes: number;
  scheduleUtc: string;
}

/** What the notification email should say about why/how this scan ran, or undefined for an on-time run. */
function describeBackupRun(ctx: ScanContext): string | undefined {
  if (ctx.source !== 'watchdog' && ctx.attempt === 1) return undefined;
  const parts: string[] = [];
  if (ctx.source === 'watchdog') {
    parts.push(
      `The scheduled ${ctx.scheduleUtc} UTC scan had not completed ${ctx.overdueMinutes} minutes after its scheduled time, so the 30-minute backup check started this one.`
    );
  }
  if (ctx.attempt > 1) parts.push(`This was attempt ${ctx.attempt} of ${MAX_ATTEMPTS_PER_SLOT} for today's scan.`);
  return parts.join(' ');
}

async function runScanForUser(
  db: Firestore,
  uid: string,
  data: FirebaseFirestore.DocumentData,
  settings: AppSettings,
  ctx: ScanContext
): Promise<{ outcome: UserScanOutcome; succeeded: boolean }> {
  const startedAt = Date.now();
  const scanTimestamp = new Date().toISOString();
  const { fixtures, error: fetchError } = await fetchCandidateFixtures(settings);

  const existingBets: HistoricalBetRecord[] = Array.isArray(data.historicalBets) ? data.historicalBets : [];
  const knownFixtureIds = new Set(existingBets.map((b) => b.fixtureId));
  const newBets: HistoricalBetRecord[] = [];

  const refreshed: CandidateFixture[] = fixtures.map((fixture) => {
    const audit = runVerificationAudit(fixture, settings.ruleThresholds);
    if (
      settings.autoArchiveQualifiers !== false &&
      fixture.status === 'VERIFIED_QUALIFIER' &&
      audit.status === 'VERIFIED' &&
      !knownFixtureIds.has(fixture.id)
    ) {
      knownFixtureIds.add(fixture.id);
      newBets.push(buildHistoricalBetFromQualifier(fixture, audit, settings.defaultStake));
    }
    return { ...fixture, verificationCard: audit };
  });

  const isQualifier = (f: CandidateFixture) => f.status === 'VERIFIED_QUALIFIER' && f.verificationCard?.status === 'VERIFIED';
  const isPriceWatch = (f: CandidateFixture) => f.status === 'PRICE_WATCH' || f.verificationCard?.status === 'PRICE_DEFICIT';
  const qualifiersCount = refreshed.filter(isQualifier).length;
  const priceWatchCount = refreshed.filter(isPriceWatch).length;
  const total = refreshed.length;

  const log: SyncLogRecord = {
    id: `SYNC-${scanTimestamp.replace(/[-:T]/g, '').slice(0, 14)}UTC`,
    timestamp: scanTimestamp,
    trigger: 'SCHEDULED',
    status: fetchError ? (total > 0 ? 'WARNING' : 'FAILED') : 'SUCCEEDED',
    durationMs: Date.now() - startedAt,
    totalRecordsScanned: total,
    qualifiersCount,
    priceWatchCount,
    rejectedCount: Math.max(0, total - qualifiersCount - priceWatchCount),
    divergenceRate: 0,
    notes: fetchError
      ? `Server-side scheduled scan completed with issues: ${fetchError}`
      : `Server-side scheduled scan${ctx.source === 'watchdog' ? ' (started by the 30-minute backup check)' : ''} — the app did not need to be open: pulled ${total} candidate checks and ran the verification audit. ${newBets.length} qualifier(s) recorded to the Archive.`,
    dataSources: [
      {
        name: 'TheStatsAPI Football API',
        url: 'https://www.thestatsapi.com/',
        status: fetchError ? 'DEGRADED' : 'ONLINE',
        recordsSupplied: total,
      },
    ],
    systemBreakdown: (['football_over_1_5', 'football_under_3_5'] as const).map((system) => {
      const inSystem = refreshed.filter((f) => f.system === system);
      return {
        system,
        label:
          system === 'football_over_1_5'
            ? 'Over 1.5 Goals'
            : 'Under 3.5 Goals',
        scanned: inSystem.length,
        qualified: inSystem.filter(isQualifier).length,
        priceWatch: inSystem.filter(isPriceWatch).length,
      };
    }),
  };

  // Cache the classified fixtures so the app can show them on next open.
  // Failed fixtures are dropped first if the payload would exceed Firestore's
  // document size limit.
  let cached = refreshed;
  let fixturesJson = JSON.stringify(cached);
  if (fixturesJson.length > MAX_CACHE_JSON_CHARS) {
    cached = refreshed.filter((f) => f.status !== 'FAILED');
    fixturesJson = JSON.stringify(cached);
  }
  if (fixturesJson.length > MAX_CACHE_JSON_CHARS) fixturesJson = JSON.stringify(refreshed.filter((f) => isQualifier(f) || isPriceWatch(f)));

  const existingLogs: SyncLogRecord[] = Array.isArray(data.syncLogs) ? data.syncLogs : [];
  await db
    .collection('users')
    .doc(uid)
    .set(
      {
        syncLogs: [log, ...existingLogs].slice(0, MAX_STORED_SYNC_LOGS),
        lastScanTimestamp: scanTimestamp,
        historicalBets: [...newBets, ...existingBets],
        updatedAt: scanTimestamp,
      },
      { merge: true }
    );
  await db.collection('users').doc(uid).collection('scanCache').doc('latest').set({ scannedAt: scanTimestamp, fixturesJson });

  const outcome: UserScanOutcome = { uid, status: 'scanned', qualifiers: qualifiersCount, archived: newBets.length };

  // The scan's results are already saved above, so a failed email must never
  // fail (or re-run) the scan — it is only reported in the outcome.
  if (settings.emailNotificationsEnabled !== false) {
    try {
      const email = buildScanEmail(log, refreshed.filter(isQualifier), describeBackupRun(ctx));
      await sendNotificationEmail(email.subject, email.html);
      outcome.emailed = true;
    } catch (err) {
      outcome.emailed = false;
      outcome.emailError = err instanceof Error ? err.message : String(err);
      console.error(`[cron] notification email failed for user ${uid}:`, err);
    }
  }
  return { outcome, succeeded: log.status !== 'FAILED' };
}

const stateRef = (db: Firestore, uid: string) => db.collection('users').doc(uid).collection('scanState').doc('current');

async function sendGiveUpAlert(settings: AppSettings, state: ScanState, scheduleUtc: string): Promise<void> {
  const html =
    `<p><strong>The scheduled daily scan did not complete.</strong> Docket tried ${MAX_ATTEMPTS_PER_SLOT} times for the ${escapeHtml(scheduleUtc)} UTC scan and has stopped retrying for today.</p>` +
    htmlTable(
      ['Detail', 'Value'],
      [
        ['Last attempt (UTC)', (state.lastAttemptAt ?? '').slice(0, 16).replace('T', ' ')],
        ['Last error', state.lastError ?? 'The run did not report an error (it may have timed out).'],
      ]
    ) +
    '<p>Open Docket and use <em>Run Daily Scan</em> to run it manually, and check the Vercel function logs for details.</p>';
  await sendNotificationEmail('Docket: daily scan FAILED — action needed', html);
}

/**
 * Decides (inside a transaction, so the daily cron and the watchdog can
 * never both start the same scan) whether this user needs a scan right now,
 * and if so marks it running and counts the attempt.
 */
export async function processUser(
  db: Firestore,
  uid: string,
  data: FirebaseFirestore.DocumentData,
  source: ScanSource
): Promise<UserScanOutcome> {
  const settings = data.settings as AppSettings | undefined;
  if (!settings) return { uid, status: 'skipped', reason: 'no settings saved' };
  if (settings.scheduleEnabled === false) return { uid, status: 'skipped', reason: 'scheduled scan disabled' };
  if (!settings.theStatsApiKey) return { uid, status: 'skipped', reason: 'no TheStatsAPI key' };

  const scheduleUtc = settings.dailyScanScheduleUtc || '06:00';
  const ref = stateRef(db, uid);
  const now = new Date();

  const claim = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const state = (snap.exists ? snap.data() : {}) as ScanState;
    const decision = decideScan({
      now,
      scheduleUtc,
      lastSuccessAt: latestSuccessfulScan(data.syncLogs, state),
      state,
      source,
    });
    if (decision.action === 'scan') {
      tx.set(
        ref,
        {
          ...state,
          status: 'running',
          startedAt: now.toISOString(),
          lastAttemptAt: now.toISOString(),
          slot: decision.slot,
          attempts: decision.attempt,
          lastError: null,
        },
        { merge: true }
      );
    } else if (decision.needsGiveUpAlert && decision.slot) {
      tx.set(ref, { alertedSlot: decision.slot }, { merge: true });
    }
    return { decision, state };
  });

  const { decision, state } = claim;
  if (decision.action === 'skip') {
    if (decision.needsGiveUpAlert && settings.emailNotificationsEnabled !== false) {
      try {
        await sendGiveUpAlert(settings, state, scheduleUtc);
      } catch (err) {
        console.error(`[cron] give-up alert email failed for user ${uid}:`, err);
      }
    }
    return { uid, status: 'skipped', reason: decision.reason };
  }

  try {
    const { outcome, succeeded } = await runScanForUser(db, uid, data, settings, {
      source,
      attempt: decision.attempt,
      overdueMinutes: decision.overdueMinutes,
      scheduleUtc,
    });
    await ref.set(
      {
        status: 'idle',
        lastFinishedAt: new Date().toISOString(),
        ...(succeeded ? { lastSuccessAt: new Date().toISOString(), lastError: null } : { lastError: 'The scan finished but reported a failure (see the sync log).' }),
      },
      { merge: true }
    );
    return outcome;
  } catch (err) {
    await ref
      .set(
        { status: 'idle', lastFinishedAt: new Date().toISOString(), lastError: err instanceof Error ? err.message : String(err) },
        { merge: true }
      )
      .catch(() => {});
    throw err;
  }
}

/**
 * Runs whatever scans are owed right now. The shared scan code calls the
 * provider proxy over HTTP using relative `/api/...` paths, so an in-process
 * listener on an ephemeral port serves the Express app for the duration —
 * no dependence on the deployment's public URL or its deployment protection.
 */
export async function runDueScans(app: Express, source: ScanSource): Promise<UserScanOutcome[]> {
  const db = getDb();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  setApiBaseUrl(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);

  const outcomes: UserScanOutcome[] = [];
  try {
    const users = await db.collection('users').get();
    // Sequential on purpose: every user's scan already paces its own provider calls.
    for (const doc of users.docs) {
      try {
        outcomes.push(await processUser(db, doc.id, doc.data(), source));
      } catch (err) {
        console.error(`[cron] scan failed for user ${doc.id}:`, err);
        outcomes.push({ uid: doc.id, status: 'failed', reason: err instanceof Error ? err.message : String(err) });
      }
    }
  } finally {
    server.close();
    setApiBaseUrl('');
  }
  return outcomes;
}
