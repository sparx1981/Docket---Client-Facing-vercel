import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Express } from 'express';
import type { AppSettings, CandidateFixture, HistoricalBetRecord, SyncLogRecord } from '../../src/types';
import { fetchCandidateFixtures } from '../../src/services/dataFeed.js';
import { runVerificationAudit } from '../../src/services/verificationEngine.js';
import { buildHistoricalBetFromQualifier } from '../../src/services/archiveRecord.js';
import { setApiBaseUrl } from '../../src/services/backendClient.js';

/**
 * Server-side daily scan, run by the Vercel Cron job in vercel.json (via
 * GET /api/cron/daily-scan). The in-browser scheduler only ever fires while
 * the app is open in a tab, so on its own a "daily" scan silently doesn't
 * happen on days nobody opens the app. This runs the same scan code
 * (fetchCandidateFixtures + runVerificationAudit) for every user whose
 * scheduled scan is enabled and stores the results in Firestore:
 *   users/{uid}.syncLogs / lastScanTimestamp / historicalBets  (as the client does)
 *   users/{uid}/scanCache/latest                               (classified fixtures,
 *                                                               picked up on next login)
 *
 * Needs FIREBASE_SERVICE_ACCOUNT_JSON (a Firebase service-account key's JSON)
 * in the environment — Firestore security rules only let a signed-in user
 * touch their own document, so the server must use admin credentials.
 */

/** A scan newer than this is treated as "today's scan already happened" (the browser fallback may have run it). */
const MIN_HOURS_BETWEEN_SCANS = 20;
const MAX_STORED_SYNC_LOGS = 200;
/** Firestore documents are capped at 1 MiB — keep the cached fixture payload comfortably under it. */
const MAX_CACHE_JSON_CHARS = 900_000;

function loadFirebaseConfig(): { projectId?: string; firestoreDatabaseId?: string } {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), 'firebase-applet-config.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function getDb(): Firestore {
  const config = loadFirebaseConfig();
  const projectId = process.env.FIREBASE_PROJECT_ID || config.projectId;
  const databaseId = process.env.FIREBASE_DATABASE_ID || config.firestoreDatabaseId;
  if (getApps().length === 0) {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!json && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON is not configured — add a Firebase service-account key to the Vercel project environment variables so the daily scan can read users\' settings.'
      );
    }
    initializeApp({
      projectId,
      credential: json ? cert(JSON.parse(json)) : applicationDefault(),
    });
  }
  return databaseId ? getFirestore(getApps()[0], databaseId) : getFirestore(getApps()[0]);
}

function isDue(lastScanIso: string | null | undefined, now = Date.now()): boolean {
  if (!lastScanIso) return true;
  const last = new Date(lastScanIso).getTime();
  if (isNaN(last)) return true;
  return (now - last) / 3_600_000 >= MIN_HOURS_BETWEEN_SCANS;
}

export interface UserScanOutcome {
  uid: string;
  status: 'scanned' | 'skipped' | 'failed';
  reason?: string;
  qualifiers?: number;
  archived?: number;
}

async function scanOneUser(db: Firestore, uid: string, data: FirebaseFirestore.DocumentData): Promise<UserScanOutcome> {
  const settings = data.settings as AppSettings | undefined;
  if (!settings) return { uid, status: 'skipped', reason: 'no settings saved' };
  if (settings.scheduleEnabled === false) return { uid, status: 'skipped', reason: 'scheduled scan disabled' };
  if (!settings.theStatsApiKey) return { uid, status: 'skipped', reason: 'no TheStatsAPI key' };
  if (!isDue(data.lastScanTimestamp)) return { uid, status: 'skipped', reason: 'already scanned recently' };

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
      : `Server-side scheduled scan (daily cron, app did not need to be open): pulled ${total} candidate checks and ran the verification audit. ${newBets.length} qualifier(s) recorded to the Archive.`,
    dataSources: [
      {
        name: 'TheStatsAPI Football API',
        url: 'https://www.thestatsapi.com/',
        status: fetchError ? 'DEGRADED' : 'ONLINE',
        recordsSupplied: total,
      },
      { name: 'Tennis provider', url: '', status: 'OFFLINE', recordsSupplied: 0 },
    ],
    systemBreakdown: (['football_over_1_5', 'football_under_3_5', 'tennis_straight_sets'] as const).map((system) => {
      const inSystem = refreshed.filter((f) => f.system === system);
      return {
        system,
        label:
          system === 'football_over_1_5'
            ? 'Over 1.5 Goals'
            : system === 'football_under_3_5'
            ? 'Under 3.5 Goals'
            : 'Straight Sets (2-0 / 3-0)',
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

  return { uid, status: 'scanned', qualifiers: qualifiersCount, archived: newBets.length };
}

/**
 * Runs the scan for every eligible user. The shared scan code calls the
 * provider proxy over HTTP using relative `/api/...` paths, so an in-process
 * listener on an ephemeral port serves the Express app for the duration —
 * no dependence on the deployment's public URL or its deployment protection.
 */
export async function runDailyScansForAllUsers(app: Express): Promise<UserScanOutcome[]> {
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
        outcomes.push(await scanOneUser(db, doc.id, doc.data()));
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
