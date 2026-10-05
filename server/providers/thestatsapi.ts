import { fetchJson } from '../httpClient.js';
import { ProviderError } from '../errors.js';
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
  maxPages = 5,
  onNotice?: (message: string) => void
): Promise<any[]> {
  const out: any[] = [];
  let page = 1;
  const perPage = 100;
  for (let i = 0; i < maxPages; i++) {
    const data = await fetchJson(
      PROVIDER,
      `${BASE_URL}/football/matches`,
      { ...params, page: String(page), per_page: String(perPage) },
      { headers: authHeaders(apiKey), onRetryNotice: onNotice }
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

export interface BacktestCandidateMatch {
  providerId: string;
  homeId: string;
  awayId: string;
  homeOrPlayer1: string;
  awayOrPlayer2: string;
  competitionId: string;
  competition: string;
  seasonId: string;
  matchTime: string;
  homeScore: number;
  awayScore: number;
  finalScore: string;
}

/**
 * Most-recent finished matches for a competition (or every competition,
 * when none is given), newest first, capped at `limit` — with the team and
 * season ids the Backtest feature needs to reconstruct each match's real
 * pre-match context via getHistoricalMatchContext.
 */
export async function getRecentMatchesForBacktest(
  apiKey: string,
  competitionId: string | undefined,
  competitionNameById: Map<string, string>,
  limit: number
): Promise<BacktestCandidateMatch[]> {
  const maxPages = Math.max(1, Math.ceil(limit / 100));
  const rows = await listMatches(apiKey, { competition_id: competitionId, status: 'finished' }, maxPages);
  const matches: BacktestCandidateMatch[] = [];
  for (const m of rows) {
    const home = m?.home_team;
    const away = m?.away_team;
    const homeScore: number | undefined = m?.score?.home;
    const awayScore: number | undefined = m?.score?.away;
    if (
      !home?.id ||
      !away?.id ||
      !m?.id ||
      !m?.competition_id ||
      !m?.season_id ||
      !m?.utc_date ||
      typeof homeScore !== 'number' ||
      typeof awayScore !== 'number'
    ) {
      continue;
    }
    matches.push({
      providerId: String(m.id),
      homeId: home.id,
      awayId: away.id,
      homeOrPlayer1: home.name,
      awayOrPlayer2: away.name,
      competitionId: m.competition_id,
      competition: competitionNameById.get(m.competition_id) || 'Unknown competition',
      seasonId: m.season_id,
      matchTime: m.utc_date,
      homeScore,
      awayScore,
      finalScore: `${homeScore} - ${awayScore}`,
    });
  }
  matches.sort((a, b) => new Date(b.matchTime).getTime() - new Date(a.matchTime).getTime());
  return matches.slice(0, limit);
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

  const seasonRow = (await getSeasonList(apiKey, competitionId)).find((s) => s.id === seasonId);
  const info: SeasonInfo = {
    seasonId,
    seasonName: seasonRow?.name || seasonRow?.year || seasonId,
    expiresAt: Date.now() + SEASON_CACHE_TTL_MS,
  };
  seasonCache.set(competitionId, info);
  return info;
}

interface SeasonListEntry {
  id: string;
  name: string;
  year: string;
  startYear: number | null;
}
interface SeasonListCacheEntry {
  seasons: SeasonListEntry[];
  expiresAt: number;
}
const seasonListCache = new Map<string, SeasonListCacheEntry>();

/** All seasons for a competition, newest first — as TheStatsAPI itself returns them. */
async function getSeasonList(
  apiKey: string,
  competitionId: string,
  onNotice?: (message: string) => void
): Promise<SeasonListEntry[]> {
  const cached = seasonListCache.get(competitionId);
  if (cached && cached.expiresAt > Date.now()) return cached.seasons;

  const data = await fetchJson(
    PROVIDER,
    `${BASE_URL}/football/competitions/${competitionId}/seasons`,
    {},
    { headers: authHeaders(apiKey), onRetryNotice: onNotice }
  );
  const seasons: SeasonListEntry[] = (data?.data || [])
    .filter((s: any) => s?.id)
    .map((s: any) => ({ id: s.id, name: s.name || s.year || s.id, year: s.year || '', startYear: s.start_year ?? null }));
  seasonListCache.set(competitionId, { seasons, expiresAt: Date.now() + SEASON_CACHE_TTL_MS });
  return seasons;
}

/**
 * The season that finished immediately before `referenceSeasonId` for the
 * same competition — what "previous season" means for a match played
 * during `referenceSeasonId`. Returns null when the competition has no
 * earlier season on record (a newly-tracked competition, or the oldest
 * season TheStatsAPI holds for it).
 */
async function getPreviousSeasonInfo(
  apiKey: string,
  competitionId: string,
  referenceSeasonId: string,
  onNotice?: (message: string) => void
): Promise<SeasonInfo | null> {
  const seasons = await getSeasonList(apiKey, competitionId, onNotice);
  const index = seasons.findIndex((s) => s.id === referenceSeasonId);
  // Seasons are returned newest-first, so the previous (older) season sits
  // at the next index along.
  if (index === -1 || index + 1 >= seasons.length) return null;
  const prev = seasons[index + 1];
  return { seasonId: prev.id, seasonName: prev.name, expiresAt: Date.now() + SEASON_CACHE_TTL_MS };
}

/**
 * Backtest evaluates dozens of historical matches that constantly repeat
 * the same teams (a league backtest samples that league's own fixture
 * list, so the same clubs recur) and often the same historical cutoff date
 * (several candidate matches share a matchday). A team's previous-season
 * aggregate is a fixed historical fact once that season is over — caching
 * it here removes real duplicate calls to TheStatsAPI across one backtest
 * run, rather than just squeezing the rate-limit pacing tighter. Same TTL
 * shape as the season caches above, and safe across warm serverless
 * invocations the same way those already are.
 */
const seasonStatsCache = new Map<string, { value: FootballPrevSeasonStats | undefined; expiresAt: number }>();

async function fetchSeasonStats(
  apiKey: string,
  teamId: string,
  teamName: string,
  leagueName: string,
  season: SeasonInfo,
  onNotice?: (message: string) => void
): Promise<FootballPrevSeasonStats | undefined> {
  const cacheKey = `${teamId}:${season.seasonId}`;
  const cached = seasonStatsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const statsData = await fetchJson(
    PROVIDER,
    `${BASE_URL}/football/teams/${teamId}/stats`,
    { season_id: season.seasonId },
    { headers: authHeaders(apiKey), onRetryNotice: onNotice }
  );
  const s = statsData?.data;
  if (!s || typeof s.matches_played !== 'number' || typeof s.goals_for !== 'number' || typeof s.goals_against !== 'number') {
    seasonStatsCache.set(cacheKey, { value: undefined, expiresAt: Date.now() + SEASON_CACHE_TTL_MS });
    return undefined;
  }
  const result: FootballPrevSeasonStats = {
    team: teamName,
    season: season.seasonName,
    league: leagueName,
    matchesPlayed: s.matches_played,
    goalsScored: s.goals_for,
    goalsConceded: s.goals_against,
    avgGoalsScored: s.matches_played > 0 ? s.goals_for / s.matches_played : 0,
    avgGoalsConceded: s.matches_played > 0 ? s.goals_against / s.matches_played : 0,
  };
  seasonStatsCache.set(cacheKey, { value: result, expiresAt: Date.now() + SEASON_CACHE_TTL_MS });
  return result;
}

function mapTeamRecentMatch(m: any, teamId: string, competitionNameById: Map<string, string>): TeamRecentMatch | null {
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
    // TheStatsAPI's competition `type` enum is league/cup/tournament — it
    // does not carry a separate "friendly" classification, so every match
    // returned here is treated as competitive.
    isCompetitive: true,
  };
}

/** One day before `dateIso` (YYYY-MM-DD), for an exclusive "before this date" filter via date_to. */
function dayBefore(dateIso: string): string {
  const d = new Date(dateIso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * A live scan's per-fixture enrichment calls getTeamProfile(homeId),
 * getTeamProfile(awayId) and getHeadToHead(homeId, awayId) — but
 * getTeamProfile's own recent-form lookup and getHeadToHead's meeting
 * search both fetch the SAME team's finished-match list (team_id filter,
 * status: finished, no date bound), differing only in page cap (1 vs 2).
 * That was two real, separate network calls for identical data on every
 * single enriched fixture. This single cached fetch (at the larger page
 * cap) backs both call sites instead. A short TTL is enough — this is
 * "current form as of now", not a historical reconstruction, so it should
 * pick up a newly-finished match reasonably promptly, unlike the
 * season-scoped caches above which cover data that never changes mid-run.
 */
const teamFinishedMatchesCache = new Map<string, { value: any[]; expiresAt: number }>();
const TEAM_FINISHED_MATCHES_CACHE_TTL_MS = 5 * 60 * 1000;

async function finishedMatchesForTeam(apiKey: string, teamId: string): Promise<any[]> {
  const cached = teamFinishedMatchesCache.get(teamId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const rows = await listMatches(apiKey, { team_id: teamId, status: 'finished' }, 2);
  teamFinishedMatchesCache.set(teamId, { value: rows, expiresAt: Date.now() + TEAM_FINISHED_MATCHES_CACHE_TTL_MS });
  return rows;
}

/**
 * Team profile: the previous season's aggregate stats plus recent form, as
 * of *now* — used for live fixture enrichment (the daily scan), where
 * "recent form" genuinely means the present. The season aggregate is the
 * previous completed season of the team's primary competition (matching the
 * "previous-season" filters and the backtest). Built from real calls only —
 * team detail, the competition's seasons, and the team's stats for the
 * previous season — never padded when any of them comes back incomplete.
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

  // The "previous season" the filters are named after: the season that
  // finished immediately before the competition's current one — the same
  // meaning the backtest uses (getPreviousSeasonInfo relative to the match's
  // season). `prevSeasonNote` says why it is missing when it is, so the
  // scan can report the exact gap instead of a generic "no data".
  const leagueName: string = team?.primary_competition?.name || 'Unknown league';
  let prevSeason: FootballPrevSeasonStats | undefined;
  let prevSeasonNote: string | undefined;
  if (!competitionId) {
    prevSeasonNote = `TheStatsAPI lists no primary competition for ${teamName}, so there is no season to read statistics from`;
  } else {
    let seasonLabel = 'the previous season';
    try {
      const current = await getCurrentSeasonInfo(apiKey, competitionId);
      if (!current) {
        prevSeasonNote = `TheStatsAPI lists no current season for ${leagueName}, so its previous season can't be determined`;
      } else {
        const previous = await getPreviousSeasonInfo(apiKey, competitionId, current.seasonId);
        if (!previous) {
          prevSeasonNote = `TheStatsAPI holds no earlier season for ${leagueName} (only ${current.seasonName}), so there is no previous season to read statistics from`;
        } else {
          seasonLabel = previous.seasonName;
          prevSeason = await fetchSeasonStats(apiKey, teamId, teamName, leagueName, previous);
          if (!prevSeason) prevSeasonNote = `TheStatsAPI returned incomplete statistics for ${teamName} in ${seasonLabel} — this can happen when a team is new to the league (for example newly promoted)`;
        }
      }
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      prevSeasonNote =
        err.status === 404
          ? `TheStatsAPI has no statistics for ${teamName} in ${seasonLabel} (${leagueName}) — this can happen when a team is new to the league (for example newly promoted)`
          : `Statistics for ${teamName} could not be loaded (${err.message})`;
    }
  }

  let recentMatches: TeamRecentMatch[] | undefined;
  try {
    const rows = await finishedMatchesForTeam(apiKey, teamId);
    const mapped = rows
      .map((m) => mapTeamRecentMatch(m, teamId, competitionNameById))
      .filter((m): m is TeamRecentMatch => m !== null)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    if (mapped.length > 0) recentMatches = mapped.slice(0, 10);
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
  }

  return { team: teamName, prevSeason, prevSeasonNote, recentMatches };
}

export interface HistoricalMatchContext {
  homePrevSeason?: FootballPrevSeasonStats;
  awayPrevSeason?: FootballPrevSeasonStats;
  homeRecentMatches?: TeamRecentMatch[];
  awayRecentMatches?: TeamRecentMatch[];
  h2hMatches?: H2HMatchRecord[];
}

/**
 * The same statistical breakdown the live scan builds (prevSeason, recent
 * form, H2H) but reconstructed as it genuinely stood *before* a past
 * match — using the competition's previous completed season for the
 * season-aggregate stats, and `date_to` filtering on the matches endpoint
 * for recent form and head-to-head, both bounded to the day before the
 * match. Used by the Backtest feature to replay a rule's real statistical
 * filters against history, not just settle final scores.
 */
/** A team's name is a fixed fact — cached indefinitely (process lifetime) rather than TTL'd, since it never legitimately changes mid-run. */
const teamNameCache = new Map<string, string>();
/**
 * Raw finished-match rows for one team up to an "as of" cutoff date. Keyed
 * by teamId + that exact date, since several backtest candidates commonly
 * share a matchday. Both a team's own recent-form list and (for the home
 * team) the head-to-head meeting search used to issue two near-identical
 * listMatches calls for this same team/date — this single cache backs
 * both, cutting one real duplicate network call per match.
 */
const teamMatchesBeforeDateCache = new Map<string, { value: any[]; expiresAt: number }>();

export async function getHistoricalMatchContext(
  apiKey: string,
  params: { homeId: string; awayId: string; competitionId: string; seasonId: string; matchDate: string },
  competitionNameById: Map<string, string>,
  /** Fired with a plain-English status line whenever a call in this context hits TheStatsAPI's rate limit and is waiting before an automatic retry — lets the caller surface real-time expectations instead of a silent multi-second wait. */
  onNotice?: (message: string) => void
): Promise<HistoricalMatchContext> {
  const { homeId, awayId, competitionId, seasonId, matchDate } = params;
  const beforeDate = dayBefore(matchDate);
  const leagueName = competitionNameById.get(competitionId) || 'Unknown league';
  const context: HistoricalMatchContext = {};

  const previousSeason = await getPreviousSeasonInfo(apiKey, competitionId, seasonId, onNotice).catch((err) => {
    if (err instanceof ProviderError) return null;
    throw err;
  });

  async function teamName(teamId: string): Promise<string> {
    const cached = teamNameCache.get(teamId);
    if (cached) return cached;
    try {
      const detail = await fetchJson(
        PROVIDER,
        `${BASE_URL}/football/teams/${teamId}`,
        {},
        { headers: authHeaders(apiKey), onRetryNotice: onNotice }
      );
      const name = detail?.data?.name || 'Unknown team';
      teamNameCache.set(teamId, name);
      return name;
    } catch {
      return 'Unknown team';
    }
  }

  async function matchesBeforeTeamDate(teamId: string): Promise<any[]> {
    const cacheKey = `${teamId}:${beforeDate}`;
    const cached = teamMatchesBeforeDateCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    // Page cap of 2 covers both this function's callers: a team's last-10
    // recent-form slice needs only page 1, but the head-to-head search
    // below needs page 2 as well — fetching the larger cap once here means
    // whichever caller runs first already has what the other one needs.
    const rows = await listMatches(apiKey, { team_id: teamId, status: 'finished', date_to: beforeDate }, 2, onNotice);
    teamMatchesBeforeDateCache.set(cacheKey, { value: rows, expiresAt: Date.now() + SEASON_CACHE_TTL_MS });
    return rows;
  }

  async function recentBefore(teamId: string): Promise<TeamRecentMatch[] | undefined> {
    try {
      const rows = await matchesBeforeTeamDate(teamId);
      const mapped = rows
        .map((m) => mapTeamRecentMatch(m, teamId, competitionNameById))
        .filter((m): m is TeamRecentMatch => m !== null)
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      return mapped.length > 0 ? mapped.slice(0, 10) : undefined;
    } catch (err) {
      if (err instanceof ProviderError) return undefined;
      throw err;
    }
  }

  if (previousSeason) {
    const [homeName, awayName] = await Promise.all([teamName(homeId), teamName(awayId)]);
    const [homePrevSeason, awayPrevSeason] = await Promise.all([
      fetchSeasonStats(apiKey, homeId, homeName, leagueName, previousSeason, onNotice).catch((err) => {
        if (err instanceof ProviderError) return undefined;
        throw err;
      }),
      fetchSeasonStats(apiKey, awayId, awayName, leagueName, previousSeason, onNotice).catch((err) => {
        if (err instanceof ProviderError) return undefined;
        throw err;
      }),
    ]);
    context.homePrevSeason = homePrevSeason;
    context.awayPrevSeason = awayPrevSeason;
  }

  const [homeRecentMatches, awayRecentMatches] = await Promise.all([recentBefore(homeId), recentBefore(awayId)]);
  context.homeRecentMatches = homeRecentMatches;
  context.awayRecentMatches = awayRecentMatches;

  try {
    const rows = await matchesBeforeTeamDate(homeId);
    const meetings = rows.filter((m) => m?.home_team?.id === awayId || m?.away_team?.id === awayId);
    const h2h = meetings
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
    if (h2h.length > 0) context.h2hMatches = h2h;
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
  }

  return context;
}

export interface MatchOddsEntry {
  bookmaker: string;
  marketType: 'OVER_UNDER_15' | 'OVER_UNDER_35' | 'SET_BETTING';
  selectionName: string;
  decimalOdds: number;
  lastUpdated: string;
}

/**
 * Real odds for a single match, from TheStatsAPI's own odds endpoint. The
 * live response shape (confirmed against production logs) is:
 *   { data: { bookmakers: [ { bookmaker, markets: { total_goals: {
 *     "1.5": { over: { opening, last_seen }, under: {...} },
 *     "3.5": { over: {...}, under: {...} }, ... } } } ] } }
 * — a per-bookmaker markets object keyed by line, not a flat row list.
 * Only the two lines the app's rule systems actually use are extracted:
 * Over 1.5 (football_over_1_5) and Under 3.5 (football_under_3_5). Price
 * is the current market price (last_seen), not the opening line.
 */
export async function getMatchOdds(apiKey: string, matchId: string): Promise<MatchOddsEntry[]> {
  const data = await fetchJson(
    PROVIDER,
    `${BASE_URL}/football/matches/${matchId}/odds`,
    {},
    { headers: authHeaders(apiKey) }
  );
  const bookmakers: any[] = Array.isArray(data?.data?.bookmakers) ? data.data.bookmakers : [];
  const out: MatchOddsEntry[] = [];
  for (const bm of bookmakers) {
    const bookmaker: string | undefined = bm?.bookmaker;
    const totalGoals = bm?.markets?.total_goals;
    if (!bookmaker || !totalGoals) continue;

    const over15Price = Number(totalGoals['1.5']?.over?.last_seen ?? totalGoals['1.5']?.over?.opening);
    if (Number.isFinite(over15Price)) {
      out.push({
        bookmaker,
        marketType: 'OVER_UNDER_15',
        selectionName: 'Over 1.5',
        decimalOdds: over15Price,
        lastUpdated: new Date().toISOString(),
      });
    }

    const under35Price = Number(totalGoals['3.5']?.under?.last_seen ?? totalGoals['3.5']?.under?.opening);
    if (Number.isFinite(under35Price)) {
      out.push({
        bookmaker,
        marketType: 'OVER_UNDER_35',
        selectionName: 'Under 3.5',
        decimalOdds: under35Price,
        lastUpdated: new Date().toISOString(),
      });
    }
  }
  return out;
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
  const rows = await finishedMatchesForTeam(apiKey, team1Id);
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
