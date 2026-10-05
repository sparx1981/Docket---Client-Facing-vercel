import express, { Request, Response, NextFunction } from 'express';
import { ProviderError } from './errors.js';
import * as thestatsapi from './providers/thestatsapi.js';
import { sendNotificationEmail } from './email.js';

/**
 * Minimal backend proxy. Its only job is to forward provider requests
 * server-to-server so a real provider key never has to leave the browser
 * toward a third-party origin, and so CORS never bites. The key itself is
 * never stored here — it travels per-request in the `x-provider-key`
 * header, exactly as the caller (the frontend, using the key it persisted
 * in localStorage via Settings) sent it.
 *
 * Football runs entirely on TheStatsAPI.com. Tennis is no longer part of
 * the product, so there are no tennis routes here.
 *
 * This module only builds and exports the Express app — it never listens.
 * server/index.ts calls app.listen() for local/non-Vercel dev; api/index.ts
 * hands this same app to Vercel's Node runtime as a serverless function.
 */

const app = express();

app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-provider-key, Authorization');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

function requireKey(req: Request, res: Response): string | null {
  const key = req.header('x-provider-key');
  if (!key || !key.trim()) {
    res.status(400).json({ error: 'Missing x-provider-key header — configure a TheStatsAPI key in Engine Configuration.' });
    return null;
  }
  return key.trim();
}

/** Inclusive list of YYYY-MM-DD strings between from and to, capped to avoid runaway fan-out. */
function dateRange(from: string, to: string, maxDays = 45): string[] {
  const start = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];
  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && days.length < maxDays) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function handleError(err: unknown, res: Response) {
  if (err instanceof ProviderError) {
    res.status(502).json({ error: err.message, provider: err.provider, upstreamStatus: err.status });
    return;
  }
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : 'Unexpected server error' });
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/* ---------------------------- Football (TheStatsAPI) ---------------------------- */

app.get('/api/football/competitions', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  try {
    res.json({ provider: 'thestatsapi', competitions: await thestatsapi.getCompetitions(key) });
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/football/fixtures', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const date = String(req.query.date || '');
  const competitionId = req.query.competitionId ? String(req.query.competitionId) : undefined;
  if (!date) return res.status(400).json({ error: 'Missing required query param: date (YYYY-MM-DD)' });

  try {
    const competitionNameById = await thestatsapi.getCompetitionNameMap(key);
    res.json({
      provider: 'thestatsapi',
      fixtures: await thestatsapi.getDailySchedule(key, date, competitionNameById, competitionId),
    });
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/football/team/:teamId', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  try {
    const competitionNameById = await thestatsapi.getCompetitionNameMap(key);
    res.json({ provider: 'thestatsapi', team: await thestatsapi.getTeamProfile(key, req.params.teamId, competitionNameById) });
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/football/market-odds/:matchId', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  try {
    res.json({ provider: 'thestatsapi', odds: await thestatsapi.getMatchOdds(key, req.params.matchId) });
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/football/h2h', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const team1 = String(req.query.team1 || '');
  const team2 = String(req.query.team2 || '');
  if (!team1 || !team2) return res.status(400).json({ error: 'Missing required query params: team1, team2' });

  try {
    const competitionNameById = await thestatsapi.getCompetitionNameMap(key);
    res.json({ provider: 'thestatsapi', h2h: await thestatsapi.getHeadToHead(key, team1, team2, competitionNameById) });
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/football/results', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const competitionId = req.query.competitionId ? String(req.query.competitionId) : undefined;
  if (!from || !to) return res.status(400).json({ error: 'Missing required query params: from, to (YYYY-MM-DD)' });

  try {
    const competitionNameById = await thestatsapi.getCompetitionNameMap(key);
    const days = dateRange(from, to);
    const perDay = await Promise.all(
      days.map((date) => thestatsapi.getResultsForDate(key, date, competitionNameById, competitionId))
    );
    res.json({ provider: 'thestatsapi', results: perDay.flat() });
  } catch (err) {
    handleError(err, res);
  }
});

/** Backtest support: most-recent finished matches for one competition (or all), capped at `limit`. */
app.get('/api/football/backtest-results', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const competitionId = req.query.competitionId ? String(req.query.competitionId) : undefined;
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));

  try {
    const competitionNameById = await thestatsapi.getCompetitionNameMap(key);
    res.json({
      provider: 'thestatsapi',
      matches: await thestatsapi.getRecentMatchesForBacktest(key, competitionId, competitionNameById, limit),
    });
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * Backtest support: the same statistical breakdown the live scan builds
 * (previous-season stats, recent form, H2H), reconstructed as it stood
 * before a specific past match, using date_to filtering and the
 * competition's previous completed season rather than a fabricated guess.
 */
app.get('/api/football/backtest-context', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const homeId = String(req.query.homeId || '');
  const awayId = String(req.query.awayId || '');
  const competitionId = String(req.query.competitionId || '');
  const seasonId = String(req.query.seasonId || '');
  const matchDate = String(req.query.date || '');
  if (!homeId || !awayId || !competitionId || !seasonId || !matchDate) {
    return res.status(400).json({ error: 'Missing required query params: homeId, awayId, competitionId, seasonId, date' });
  }

  // Collected here rather than returned by getHistoricalMatchContext itself,
  // since a rate-limit retry can fire from several of its internal calls —
  // this is the one place that sees all of them for this request.
  const notices: string[] = [];
  try {
    const competitionNameById = await thestatsapi.getCompetitionNameMap(key);
    const context = await thestatsapi.getHistoricalMatchContext(
      key,
      { homeId, awayId, competitionId, seasonId, matchDate },
      competitionNameById,
      (message) => notices.push(message)
    );
    res.json({ provider: 'thestatsapi', context, notices });
  } catch (err) {
    handleError(err, res);
  }
});

/**
 * "Send test email" button in Engine Configuration. Only a signed-in user
 * (verified Firebase ID token) may trigger it, and each user is throttled,
 * since every call sends a real email.
 */
const lastTestEmailAt = new Map<string, number>();
const TEST_EMAIL_COOLDOWN_MS = 15_000;

app.post('/api/notifications/test', async (req, res) => {
  const authHeader = req.header('authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!idToken) return res.status(401).json({ error: 'Sign in to send a test email.' });

  let uid: string;
  let email: string | undefined;
  try {
    const { verifyIdToken } = await import('./firebaseAdmin.js');
    ({ uid, email } = await verifyIdToken(idToken));
  } catch (err) {
    const { AdminSetupError } = await import('./firebaseAdmin.js');
    // The server's own credentials being wrong is a configuration problem
    // (503, with a message that says exactly what to fix); anything else is
    // the caller's token being rejected (401, with Firebase's error code).
    if (err instanceof AdminSetupError) {
      console.error('[notifications/test] server credentials problem:', err.message);
      return res.status(503).json({ error: err.message });
    }
    const code = (err as { code?: string })?.code;
    console.error('[notifications/test] ID token rejected:', code ?? err);
    return res.status(401).json({
      error: `Your sign-in could not be verified${code ? ` (${code})` : ''} — sign out and back in, then try again.`,
    });
  }

  const now = Date.now();
  const last = lastTestEmailAt.get(uid) ?? 0;
  if (now - last < TEST_EMAIL_COOLDOWN_MS) {
    return res.status(429).json({ error: 'A test email was just sent — wait a few seconds before sending another.' });
  }
  lastTestEmailAt.set(uid, now);

  try {
    // The test is the real daily-scan email (same builder), filled from the
    // user's most recent scan when one exists.
    let latestLog: any;
    let fixtures: any[] | undefined;
    try {
      const { getDb } = await import('./firebaseAdmin.js');
      const userRef = getDb().collection('users').doc(uid);
      const [userSnap, cacheSnap] = await Promise.all([userRef.get(), userRef.collection('scanCache').doc('latest').get()]);
      const logs = userSnap.data()?.syncLogs;
      latestLog = Array.isArray(logs) ? logs[0] : undefined;
      const json = cacheSnap.data()?.fixturesJson;
      fixtures = typeof json === 'string' ? JSON.parse(json) : undefined;
    } catch (err) {
      console.error('[notifications/test] could not load the latest scan, using sample rows:', err);
    }
    const { buildTestScanEmail } = await import('./cron/scanEmail.js');
    const test = buildTestScanEmail({ latestLog, fixtures, requestedBy: email ?? uid });
    const service = await sendNotificationEmail(test.subject, test.html);
    res.json({ ok: true, serviceStatus: service.status, serviceReply: service.reply, looksLikeWebPage: service.looksLikeWebPage, usedRealScan: test.usedRealScan });
  } catch (err) {
    lastTestEmailAt.delete(uid); // a failed send shouldn't lock the user out of retrying
    handleError(err, res);
  }
});

/**
 * Server-side scans, protected by CRON_SECRET (sent as `Authorization:
 * Bearer $CRON_SECRET` — Vercel Cron does this automatically when the
 * variable is set). Without the secret configured these endpoints refuse to
 * run, so nobody who finds the URL can trigger scans.
 *
 *  - /api/cron/daily-scan: called by the daily Vercel Cron job (vercel.json).
 *  - /api/cron/scan-watchdog: called every 30 minutes by the GitHub Actions
 *    workflow (.github/workflows/scan-watchdog.yml). It only acts when a
 *    scheduled scan is overdue, running it as a backup (see
 *    server/cron/schedule.ts for the rules).
 */
function cronHandler(source: 'cron' | 'watchdog') {
  return async (req: Request, res: Response) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return res.status(503).json({ error: 'CRON_SECRET is not configured — set it in the Vercel project environment variables.' });
    }
    if (req.header('authorization') !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const { runDueScans } = await import('./cron/dailyScan.js');
      const outcomes = await runDueScans(app, source);
      // A scan that threw is reported as a non-2xx so the caller (and any
      // monitoring on it) sees the failure instead of an "ok".
      const anyFailed = outcomes.some((o) => o.status === 'failed');
      res.status(anyFailed ? 500 : 200).json({ ok: !anyFailed, source, checkedAt: new Date().toISOString(), outcomes });
    } catch (err) {
      handleError(err, res);
    }
  };
}

app.get('/api/cron/daily-scan', cronHandler('cron'));
app.get('/api/cron/scan-watchdog', cronHandler('watchdog'));

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

export default app;
