import { fetchJson } from '../httpClient';
import { ProviderError } from '../errors';
import type { NormalizedFixture, NormalizedResult, NormalizedTennisProfile, H2HMatchRecord } from '../normalized';
import type { TennisRecentMatch } from '../../src/types';

const PROVIDER = 'Sportradar Tennis';

/**
 * Sportradar Tennis API v3. Sportmonks does not cover tennis, so this is the
 * only tennis provider in phase 1.
 *
 * NOTE: as with the soccer client, field names below follow Sportradar's
 * publicly documented v3 schema and have not been exercised against a real
 * trial response. Re-verify once a key is available — in particular the
 * shape of surface-specific career records, which the trial tier may not
 * expose at all (in which case leave TennisPlayerStats fields undefined
 * rather than approximating them).
 */
function baseUrl(accessLevel: string): string {
  return `https://api.sportradar.com/tennis/${accessLevel}/v3/en`;
}

function competitorName(
  competitors: any[] | undefined,
  qualifier: 'competitor1' | 'competitor2'
): { name?: string; id?: string } {
  // Sportradar tennis uses competitor1/competitor2 rather than home/away qualifiers.
  const idx = qualifier === 'competitor1' ? 0 : 1;
  const c = competitors?.[idx];
  return { name: c?.name, id: c?.id };
}

export async function getDailySchedule(
  apiKey: string,
  accessLevel: string,
  date: string
): Promise<NormalizedFixture[]> {
  const data = await fetchJson(
    PROVIDER,
    `${baseUrl(accessLevel)}/schedules/${date}/summaries.json`,
    { api_key: apiKey }
  );

  const summaries: any[] = data?.summaries || [];

  return summaries
    .map((s): NormalizedFixture | null => {
      const event = s?.sport_event;
      const p1 = competitorName(event?.competitors, 'competitor1');
      const p2 = competitorName(event?.competitors, 'competitor2');
      if (!p1.name || !p2.name || !event?.id || !event?.start_time) return null;

      const surfaceRaw: string | undefined = event?.sport_event_context?.surface;
      const surface = normalizeSurface(surfaceRaw);

      return {
        providerId: String(event.id),
        sport: 'tennis',
        homeOrPlayer1: p1.name,
        awayOrPlayer2: p2.name,
        homeId: p1.id,
        awayId: p2.id,
        competition: event?.sport_event_context?.competition?.name || 'Unknown tournament',
        matchTime: event.start_time,
        venue: event?.venue?.name,
        surface,
      };
    })
    .filter((f): f is NormalizedFixture => f !== null);
}

function normalizeSurface(raw?: string): 'Hard' | 'Clay' | 'Grass' | 'Carpet' | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes('hard')) return 'Hard';
  if (lower.includes('clay')) return 'Clay';
  if (lower.includes('grass')) return 'Grass';
  if (lower.includes('carpet')) return 'Carpet';
  return undefined;
}

/**
 * Results for a single date, used for settlement + historical backfill.
 * The daily summaries.json feed embeds `sport_event_status` (winner_id,
 * game_score_display) alongside each match, so no per-match call is needed.
 */
export async function getResultsForDate(
  apiKey: string,
  accessLevel: string,
  date: string
): Promise<NormalizedResult[]> {
  const data = await fetchJson(
    PROVIDER,
    `${baseUrl(accessLevel)}/schedules/${date}/summaries.json`,
    { api_key: apiKey }
  );

  const summaries: any[] = data?.summaries || [];
  const results: NormalizedResult[] = [];

  for (const s of summaries) {
    const event = s?.sport_event;
    const status = s?.sport_event_status;
    const p1 = competitorName(event?.competitors, 'competitor1');
    const p2 = competitorName(event?.competitors, 'competitor2');
    const winnerId: string | undefined = status?.winner_id;
    const isCompleted = status?.status === 'closed' || status?.status === 'ended';

    if (!p1.name || !p2.name || !event?.id || !isCompleted || !winnerId) continue;

    results.push({
      providerId: String(event.id),
      homeOrPlayer1: p1.name,
      awayOrPlayer2: p2.name,
      competition: event?.sport_event_context?.competition?.name || 'Unknown tournament',
      matchTime: event.start_time,
      isCompleted: true,
      setScore: status?.game_score_display,
      finalScore: status?.game_score_display,
      winner: winnerId === p1.id ? 'home' : 'away',
    });
  }

  return results;
}

export async function getMatchSummary(
  apiKey: string,
  accessLevel: string,
  matchId: string
): Promise<NormalizedResult> {
  // Tennis has no dedicated "summary.json" per the documented contract; the
  // daily summaries endpoint is used for both scheduling and completed
  // results, so results.ts filters that same feed by date range instead of
  // calling a per-match endpoint. This function is kept for API symmetry
  // with the soccer client but is not currently wired to a route.
  throw new ProviderError(
    PROVIDER,
    501,
    'Per-match tennis summary is not part of the documented v3 contract — use the daily schedule/results endpoint instead.'
  );
}

export async function getCompetitorProfile(
  apiKey: string,
  accessLevel: string,
  competitorId: string
): Promise<NormalizedTennisProfile> {
  const data = await fetchJson(
    PROVIDER,
    `${baseUrl(accessLevel)}/competitors/${competitorId}/profile.json`,
    { api_key: apiKey }
  );

  const name = data?.competitor?.name || 'Unknown player';
  const ranking: number | undefined = data?.competitor_rankings?.[0]?.rank;

  // Surface career win/loss is not guaranteed on the trial tier. Only build
  // TennisPlayerStats when both the ranking and a surface record are real.
  let player: NormalizedTennisProfile['player'];
  const periods: any[] = data?.periods || [];
  const surfaceRecord = periods.find((p) => p?.surface && typeof p?.competitor?.matches_won === 'number');

  if (typeof ranking === 'number' && surfaceRecord) {
    const wins = surfaceRecord.competitor.matches_won;
    const losses = surfaceRecord.competitor.matches_played - wins;
    player = {
      name,
      ranking,
      surface: normalizeSurface(surfaceRecord.surface) || 'Hard',
      careerSurfaceWins: wins,
      careerSurfaceLosses: losses,
      careerSurfaceWinRate:
        surfaceRecord.competitor.matches_played > 0
          ? (wins / surfaceRecord.competitor.matches_played) * 100
          : 0,
    };
  }

  let recentMatches: TennisRecentMatch[] | undefined;
  const results: any[] = data?.results;
  if (Array.isArray(results) && results.length > 0) {
    recentMatches = results
      .map((r): TennisRecentMatch | null => {
        const event = r?.sport_event;
        const p1 = competitorName(event?.competitors, 'competitor1');
        const p2 = competitorName(event?.competitors, 'competitor2');
        const isP1 = p1.id === competitorId;
        const opponent = isP1 ? p2.name : p1.name;
        const winnerId = r?.sport_event_status?.winner_id;
        if (!opponent || !winnerId) return null;
        return {
          date: event?.start_time?.slice(0, 10) || '',
          opponent,
          opponentRank: r?.opponent_rank ?? 9999,
          score: r?.sport_event_status?.game_score_display || '',
          won: winnerId === competitorId,
          tournament: event?.sport_event_context?.competition?.name || 'Unknown tournament',
          surface: normalizeSurface(event?.sport_event_context?.surface) || 'Hard',
          isCompleted: r?.sport_event_status?.status === 'closed',
          isCompetitiveSingles:
            event?.sport_event_context?.mode?.name !== 'doubles' &&
            r?.sport_event_status?.status !== 'walkover',
        };
      })
      .filter((m): m is TennisRecentMatch => m !== null);
  }

  return { player, recentMatches };
}

export async function getHeadToHead(
  apiKey: string,
  accessLevel: string,
  competitorId: string,
  competitorId2: string
): Promise<H2HMatchRecord[]> {
  // Tennis H2H is used only for informational purposes today — the locked
  // straight-sets rules use ranking delta + surface win rate + recent form,
  // not head-to-head — but the endpoint is wired for completeness and any
  // future rule that wants it.
  const data = await fetchJson(
    PROVIDER,
    `${baseUrl(accessLevel)}/competitors/${competitorId}/versus/${competitorId2}/summaries.json`,
    { api_key: apiKey }
  );

  const meetings: any[] = data?.last_meetings || [];
  return meetings
    .map((m): H2HMatchRecord | null => {
      const event = m?.sport_event;
      const p1 = competitorName(event?.competitors, 'competitor1');
      const p2 = competitorName(event?.competitors, 'competitor2');
      const winnerId = m?.sport_event_status?.winner_id;
      if (!p1.name || !p2.name || !winnerId) return null;
      return {
        date: event?.start_time?.slice(0, 10) || '',
        homeTeam: p1.name,
        awayTeam: p2.name,
        homeScore: winnerId === p1.id ? 1 : 0,
        awayScore: winnerId === p2.id ? 1 : 0,
        totalGoals: 1,
        competition: event?.sport_event_context?.competition?.name || 'Unknown tournament',
        isCompetitive: true,
      };
    })
    .filter((m): m is H2HMatchRecord => m !== null);
}
