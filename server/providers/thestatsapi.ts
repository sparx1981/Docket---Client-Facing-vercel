import { fetchJson } from '../httpClient';
import { ProviderError } from '../errors';
import type { NormalizedFixture, NormalizedResult, NormalizedTeamProfile, H2HMatchRecord } from '../normalized';
import type { FootballPrevSeasonStats, TeamRecentMatch } from '../../src/types';

const PROVIDER = 'TheStatsAPI';
const BASE_URL = 'https://api.thestatsapi.com/api';

/**
 * TheStatsAPI.com football client. Field names and paths below are taken
 * directly from the account's own live API reference (llms.txt, pasted in
 * full during setup) — not guessed from web search summaries, per this
 * codebase's rule against fabricating a provider contract.
 *
 * Auth is a Bearer token (not a query-string api_key like Sportradar), so
 * every call here goes through fetchJson's new `options.headers` param.
 */

function authHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

export interface Competition {
  id: string;
  name: string;
  country: string | null;
  countryCode: string | null;
  type: 'league' | 'cup' | 'tournament';
}

/**
 * Every football competition TheStatsAPI knows about, paginated to
 * completion. Used both to populate the league filter in Engine
 * Configuration and, internally, to resolve competition_id -> name for
 * matches returned without an inline competition name.
 */
export async function getCompetitions(apiKey: string): Promise<Competition[]> {
  const out: Competition[] = [];
  let page = 1;
  const perPage = 100;
  // Safety cap — real catalogs run in the low hundreds (coverage/summary
  // reports 214 leagues at the time this was written), so 20 pages is far
  // more than needed and just guards against an unbounded loop.
  for (let i = 0; i < 20; i++) {
    const data = await fetchJson(
      PROVIDER,
      `${BASE_URL}/football/competitions`,
      { page: String(page), per_page: String(perPage) },
      { headers: authHeaders(apiKey) }
    );
    const rows: any[] = data?.data || [];
    for (const c of rows) {
      if (!c?.id || !c?.name || !c?.type) continue;
      out.push({ id: c.id, name: c.name, country: c.country ?? null, countryCode: c.country_code ?? null, type: c.type });
    }
    const totalPages = data?.meta?.total_pages ?? 1;
    if (page >= totalPages || rows.length === 0) break;
    page++;
  }
  return out;
}

interface CompetitionMapCacheEntry {
  map: Map<string, string>;
  expiresAt: number;
}
let competitionMapCache: CompetitionMapCacheEntry | null = null;
const COMPETITION_MAP_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * competition_id -> name lookup, built from getCompetitions() and cached
 * for a few minutes so every route handler doesn't re-page the full
 * competitions list on every call.
 */
export async function getCompetitionNameMap(apiKey: string): Promise<Map<string, string>> {
  if (competitionMapCache && competitionMapCache.expiresAt > Date.now()) return competitionMapCache.map;
  const competitions = await getCompetitions(apiKey);
  const map = new Map(competitions.map((c) => [c.id, c.name]));
  competitionMapCache = { map, expiresAt: Date.now() + COMPETITION_MAP_CACHE_TTL_MS };
  return map;
}

function mapMatchToFixture(m: any, competitionNameById: Map<string, string>): NormalizedFixture | null {
  const home = m?.home_team;
  const away = m?.away_team;
  if (!home?.name || !away?.name || !m?.id || !m?.utc_date) return null;
  return {
    providerId: String(m.id),
    sport: 'football',
    homeOrPlayer1: home.name,
    awayOrPlayer2: away.name,
    homeId: home.id,
    awayId: away.id,
    competition: competitionNameById.get(m.competition_id) || m.competition_name || 'Unknown competition',
  matchTime: m.utc_date,
  };
}

function mapMatchToResult(m: any, competitionNameById: Map<string, string>): NormalizedResult | null {
  const home = m?.home_team;
  const away = m?.away_team;
  if (!home?.name || !away?.name || !m?.id || !m?.utc_date) return null;
  const homeScore: number | undefined = m?.score?.home;
  const awayScore: number | undefined = m?.score?.away;
  if (typeof homeScore !== 'number' || typeof awayScore !== 'number') return null;
  return {
    providerId: String(m.id),
    homeOrPlayer1: home.name,
    awayOrPlayer2: away.name,
    competition: competitionNameById.get(m.competition_id) || m.competition_name || 'Unknown competition',
    matchTime: m.utc_date,
    isCompleted: m.status === 'finished',
    homeScore,
    awayScore,
    finalScore: `${homeScore} - ${awayScore}`,
  };
}

async function listMatches(
  apiKey: string,
  params: Record<string, string | undefined>,
  maxPages = 5
): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  const perPage = 100;
  for (let i = 0; i < maxPages; i++) {
    const data = await fetchJson(
      PROVIDER,
      `${BASE_URL}/football/matches`,
      { ...params, page: String(page), per_page: String(perPage) },
      { headers: authHeaders(apiKey) }
    );
    const rows: any[] = data?.data || [];
    out.push(...rows);
    const totalPages = data?.meta?.total_pages ?? 1;
    if (page >= totalPages || rows.length === 0) break;
    page++;
  }
  return out;
}

export async function getDailySchedule(
  apiKey: string,
  date: string,
  competitionNameById: Map<string, string>,
  competitionId?: string
): Promise<NormalizedFixture[]> {
  const rows = await listMatches(apiKey, {
    date_from: date,
    date_to: date,
    status: 'scheduled',
    competition_id: competitionId,
  });
  return rows.map((m) => mapMatchToFixture(m, competitionNameById)).filter((f): f is NormalizedFixture => f !== null);
}

export async function getResultsForDate(
  apiKey: string,
  date: string,
  competitionNameById: Map<string, string>,
  competitionId?: string
): Promise<NormalizedResult[]> {
  const rows = await listMatches(apiKey, {
    date_from: date,
    date_to: date,
    status: 'finished',
    competition_id: competitionId,
  });
  return rows.map((m) => mapMatchToResult(m, competitionNameById)).filter((r): r is NormalizedResult => r !== null);
}

/**
 * Most-recent finished matches for a competition, newest first, capped at
 * `limit`. Used by the Backtest feature to pull "the past N matching
 * records" for a selected league without the caller needing to know date
 * ranges up front.
 */
export async function getRecentResultsForCompetition(
  apiKey: string,
  competitionId: string | undefined,
  competitionNameById: Map<string, string>,
  limit: number
): Promise<NormalizedResult[]> {
  const maxPages = Math.max(1, Math.ceil(limit / 100));
  const rows = await listMatches(apiKey, { competition_id: competitionId, status: 'finished' }, maxPages);
  const results = rows
    .map((m) => mapMatchToResult(m, competitionNameById))
    .filter((r): r is NormalizedResult => r !== null);
  results.sort((a, b) => new Date(b.matchTime).getTime() - new Date(a.matchTime).getTime());
  return results.slice(0, limit);
}

interface SeasonInfo {
  seasonId: string;
  seasonName: string;
  expiresAt: number;
}
const seasonCache = new Map<string, SeasonInfo>();
const SEASON_CACHE_TTL_MS = 10 * 60 * 1000;

async function getCurrentSeasonInfo(apiKey: string, competitionId: string): Promise<SeasonInfo | null> {
  const cached = seasonCache.get(competitionId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const detail = await fetchJson(
    PROVIDER,
    `${BASE_URL}/football/competitions/${competitionId}`,
    {},
    { headers: authHeaders(apiKey) }
  );
  const seasonId: string | undefined = detail?.data?.current_season_id;
  if (!seasonId) return null;

  const seasons = await fetchJson(
    PROVIDER,
    `${BASE_URL}/football/competitions/${competitionId}/seasons`,
    {},
    { headers: authHeaders(apiKey) }
  );
  const seasonRow = (seasons?.data || []).find((s: any) => s?.id === seasonId);
  const info: SeasonInfo = {
    seasonId,
    seasonName: seasonRow?.name || seasonRow?.year || seasonId,
    expiresAt: Date.now() + SEASON_CACHE_TTL_MS,
  };
  seasonCache.set(competitionId, info);
  return info;
}

/**
 * Team profile: previous/current-season aggregate stats plus recent form.
 * Built from three real calls — team detail (for its primary competition),
 * that competition's current season, and the team's season stats — never
 * padded when any of them comes back incomplete.
 */
export async function getTeamProfile(
  apiKey: string,
  teamId: string,
  competitionNameById: Map<string, string>
): Promise<NormalizedTeamProfile> {
  const teamDetail = await fetchJson(
    PROVIDER,
    `${BASE_URL}/football/teams/${teamId}`,
    {},
    { headers: authHeaders(apiKey) }
  );
  const team = teamDetail?.data;
  const teamName: string = team?.name || 'Unknown team';
  const competitionId: string | undefined = team?.primary_competition?.id;

  let prevSeason: FootballPrevSeasonStats | undefined;
  if (competitionId) {
    try {
      const season = await getCurrentSeasonInfo(apiKey, competitionId);
      if (season) {
        const statsData = await fetchJson(
          PROVIDER,
          `${BASE_URL}/football/teams/${teamId}/stats`,
          { season_id: season.seasonId },
          { headers: authHeaders(apiKey) }
        );
        const s = statsData?.data;
        if (s && typeof s.matches_played === 'number' && typeof s.goals_for === 'number' && typeof s.goals_against === 'number') {
          prevSeason = {
            team: teamName,
            season: season.seasonName,
            league: team?.primary_competition?.name || 'Unknown league',
            matchesPlayed: s.matches_played,
            goalsScored: s.goals_for,
            goalsConceded: s.goals_against,
            avgGoalsScored: s.matches_played > 0 ? s.goals_for / s.matches_played : 0,
            avgGoalsConceded: s.matches_played > 0 ? s.goals_against / s.matches_played : 0,
          };
        }
      }
    } catch (err) {
      if (err instanceof ProviderError) {
        // Leave prevSeason undefined — the rules engine treats this as
        // missing data rather than a crash.
      } else {
        throw err;
      }
    }
  }

  let recentMatches: TeamRecentMatch[] | undefined;
  try {
    const rows = await listMatches(apiKey, { team_id: teamId, status: 'finished' }, 1);
    const mapped = rows
      .map((m): TeamRecentMatch | null => {
        const home = m?.home_team;
        const away = m?.away_team;
        const homeScore: number | undefined = m?.score?.home;
        const awayScore: number | undefined = m?.score?.away;
        if (!home?.id || !away?.id || typeof homeScore !== 'number' || typeof awayScore !== 'number' || !m?.utc_date) {
          return null;
        }
        const isHome = home.id === teamId;
        const teamGoals = isHome ? homeScore : awayScore;
        const opponentGoals = isHome ? awayScore : homeScore;
        return {
          date: String(m.utc_date).slice(0, 10),
          opponent: isHome ? away.name : home.name,
          isHome,
          teamGoals,
          opponentGoals,
          totalGoals: teamGoals + opponentGoals,
          competition: competitionNameById.get(m.competition_id) || 'Unknown competition',
          scoredAtLeastOne: teamGoals > 0,
          under35Goals: teamGoals + opponentGoals < 4,
          // TheStatsAPI's competition `type` enum is league/cup/tournament —
          // it does not carry a separate "friendly" classification, so
          // every match returned here is treated as competitive.
          isCompetitive: true,
        };
      })
      .filter((m): m is TeamRecentMatch => m !== null)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (mapped.length > 0) recentMatches = mapped.slice(0, 10);
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
  }

  return { team: teamName, prevSeason, recentMatches };
}

/**
 * Head-to-head meetings between two teams. TheStatsAPI has no dedicated
 * versus/H2H endpoint — this pulls team1's finished matches (team_id is a
 * single-value filter) and keeps only the rows where team2 is the other
 * side, which is exactly what a dedicated endpoint would return anyway.
 */
export async function getHeadToHead(
  apiKey: string,
  team1Id: string,
  team2Id: string,
  competitionNameById: Map<string, string>
): Promise<H2HMatchRecord[]> {
  const rows = await listMatches(apiKey, { team_id: team1Id, status: 'finished' }, 2);
  const meetings = rows.filter((m) => m?.home_team?.id === team2Id || m?.away_team?.id === team2Id);

  return meetings
    .map((m): H2HMatchRecord | null => {
      const home = m?.home_team;
      const away = m?.away_team;
      const homeScore: number | undefined = m?.score?.home;
      const awayScore: number | undefined = m?.score?.away;
      if (!home?.name || !away?.name || typeof homeScore !== 'number' || typeof awayScore !== 'number' || !m?.utc_date) {
        return null;
      }
      return {
        date: String(m.utc_date).slice(0, 10),
        homeTeam: home.name,
        awayTeam: away.name,
        homeScore,
        awayScore,
        totalGoals: homeScore + awayScore,
        competition: competitionNameById.get(m.competition_id) || 'Unknown competition',
        isCompetitive: true,
      };
    })
    .filter((m): m is H2HMatchRecord => m !== null)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
