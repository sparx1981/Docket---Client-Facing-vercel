import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import { ProviderError } from './errors';
import * as sportradarSoccer from './providers/sportradarSoccer';
import * as sportradarTennis from './providers/sportradarTennis';
import * as sportmonks from './providers/sportmonks';

/**
 * Minimal backend proxy. Its only job is to forward provider requests
 * server-to-server so a real Sportradar/Sportmonks key never has to leave
 * the browser toward a third-party origin, and so CORS never bites. The key
 * itself is never stored here — it travels per-request in the
 * `x-provider-key` header, exactly as the caller (the frontend, using the
 * key it persisted in localStorage via Settings) sent it.
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
    res.status(400).json({ error: 'Missing x-provider-key header — configure a provider API key in Engine Configuration.' });
    return null;
  }
  return key.trim();
}

function accessLevel(req: Request): string {
  const v = String(req.query.accessLevel || 'trial');
  return v === 'production' ? 'production' : 'trial';
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

/* ---------------------------- Football ---------------------------- */

app.get('/api/football/fixtures', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const date = String(req.query.date || '');
  const provider = String(req.query.provider || '');
  if (!date) return res.status(400).json({ error: 'Missing required query param: date (YYYY-MM-DD)' });

  try {
    if (provider === 'sportradar') {
      res.json({ provider, fixtures: await sportradarSoccer.getDailySchedule(key, accessLevel(req), date) });
    } else if (provider === 'sportmonks') {
      res.json({ provider, fixtures: await sportmonks.getFixturesByDate(key, date) });
    } else {
      res.status(400).json({ error: 'provider must be "sportradar" or "sportmonks"' });
    }
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/football/team/:teamId', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const provider = String(req.query.provider || '');
  try {
    if (provider === 'sportradar') {
      res.json({ provider, team: await sportradarSoccer.getCompetitorProfile(key, accessLevel(req), req.params.teamId) });
    } else if (provider === 'sportmonks') {
      res.json({ provider, team: await sportmonks.getTeamStats(key, req.params.teamId) });
    } else {
      res.status(400).json({ error: 'provider must be "sportradar" or "sportmonks"' });
    }
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/football/h2h', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const provider = String(req.query.provider || '');
  const team1 = String(req.query.team1 || '');
  const team2 = String(req.query.team2 || '');
  if (!team1 || !team2) return res.status(400).json({ error: 'Missing required query params: team1, team2' });

  try {
    if (provider === 'sportradar') {
      res.json({ provider, h2h: await sportradarSoccer.getHeadToHead(key, accessLevel(req), team1, team2) });
    } else if (provider === 'sportmonks') {
      res.json({ provider, h2h: await sportmonks.getHeadToHead(key, team1, team2) });
    } else {
      res.status(400).json({ error: 'provider must be "sportradar" or "sportmonks"' });
    }
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/football/results', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const provider = String(req.query.provider || '');
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!from || !to) return res.status(400).json({ error: 'Missing required query params: from, to (YYYY-MM-DD)' });
  if (provider !== 'sportradar' && provider !== 'sportmonks') {
    return res.status(400).json({ error: 'provider must be "sportradar" or "sportmonks"' });
  }

  try {
    const days = dateRange(from, to);
    const perDay = await Promise.all(
      days.map((date) =>
        provider === 'sportradar'
          ? sportradarSoccer.getResultsForDate(key, accessLevel(req), date)
          : sportmonks.getResultsForDate(key, date)
      )
    );
    res.json({ provider, results: perDay.flat() });
  } catch (err) {
    handleError(err, res);
  }
});

/* ----------------------------- Tennis ------------------------------ */
/* Sportradar only — Sportmonks does not cover tennis. */

app.get('/api/tennis/fixtures', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const date = String(req.query.date || '');
  if (!date) return res.status(400).json({ error: 'Missing required query param: date (YYYY-MM-DD)' });

  try {
    res.json({ provider: 'sportradar', fixtures: await sportradarTennis.getDailySchedule(key, accessLevel(req), date) });
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/tennis/player/:playerId', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  try {
    res.json({ provider: 'sportradar', player: await sportradarTennis.getCompetitorProfile(key, accessLevel(req), req.params.playerId) });
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/tennis/h2h', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const player1 = String(req.query.player1 || '');
  const player2 = String(req.query.player2 || '');
  if (!player1 || !player2) return res.status(400).json({ error: 'Missing required query params: player1, player2' });

  try {
    res.json({ provider: 'sportradar', h2h: await sportradarTennis.getHeadToHead(key, accessLevel(req), player1, player2) });
  } catch (err) {
    handleError(err, res);
  }
});

app.get('/api/tennis/results', async (req, res) => {
  const key = requireKey(req, res);
  if (!key) return;
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  if (!from || !to) return res.status(400).json({ error: 'Missing required query params: from, to (YYYY-MM-DD)' });

  try {
    const days = dateRange(from, to);
    const perDay = await Promise.all(days.map((date) => sportradarTennis.getResultsForDate(key, accessLevel(req), date)));
    res.json({ provider: 'sportradar', results: perDay.flat() });
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
