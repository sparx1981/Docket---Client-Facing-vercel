import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { ProviderError } from './errors';
import * as thestatsapi from './providers/thestatsapi';

/**
 * Minimal backend proxy. Its only job is to forward provider requests
 * server-to-server so a real provider key never has to leave the browser
 * toward a third-party origin, and so CORS never bites. The key itself is
 * never stored here — it travels per-request in the `x-provider-key`
 * header, exactly as the caller (the frontend, using the key it persisted
 * in localStorage via Settings) sent it.
 *
 * Football now runs entirely on TheStatsAPI.com — the Sportradar/Sportmonks
 * clients (and the tennis routes, which only ever had a Sportradar Tennis
 * backend) were removed when the account migrated off both providers over
 * cost. Tennis has no data supplier configured at all right now; it is
 * planned to move to its own new provider in a later phase, not restored to
 * Sportradar.
 */

const app = express();
const PORT = Number(process.env.API_PORT) || 8787;

app.use((req: Request, res: Response, next: NextFunction) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-provider-key');
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

app.get('/api/football/odds/:matchId', async (req, res) => {
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

  try {
    const competitionNameById = await thestatsapi.getCompetitionNameMap(key);
    const context = await thestatsapi.getHistoricalMatchContext(
      key,
      { homeId, awayId, competitionId, seasonId, matchDate },
      competitionNameById
    );
    res.json({ provider: 'thestatsapi', context });
  } catch (err) {
    handleError(err, res);
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] Provider proxy listening on http://0.0.0.0:${PORT}`);
});
