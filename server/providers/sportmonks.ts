import { fetchJson } from '../httpClient';
import type { NormalizedFixture, NormalizedResult, NormalizedTeamProfile, H2HMatchRecord } from '../normalized';
import type { FootballPrevSeasonStats, TeamRecentMatch } from '../../src/types';

const PROVIDER = 'Sportmonks';
const BASE = 'https://api.sportmonks.com/v3/football';

/**
 * Sportmonks Football API v3. Football only — no tennis coverage, so this
 * client is never used for the tennis system.
 *
 * NOTE: field mapping follows Sportmonks' publicly documented v3 response
 * envelope ({ data: [...] }, participants with meta.location, scores with
 * description "CURRENT"/"FT"). Not exercised against a live response — the
 * exact score "description" value used for the full-time score in
 * particular should be re-verified once a key is available.
 */

function participant(
  participants: any[] | undefined,
  location: 'home' | 'away'
): { name?: string; id?: string } {
  const p = participants?.find((x) => x?.meta?.location === location);
  return { name: p?.name, id: p?.id !== undefined ? String(p.id) : undefined };
}

function fullTimeScore(scores: any[] | undefined, participantId: string | undefined): number | undefined {
  if (!scores || !participantId) return undefined;
  const entry = scores.find(
    (s) =>
      String(s?.participant_id) === participantId &&
      (s?.description === 'CURRENT' || s?.description === 'FT' || s?.description === 'FULLTIME')
  );
  return entry?.score?.goals;
}

export async function getFixturesByDate(apiToken: string, date: string): Promise<NormalizedFixture[]> {
  const data = await fetchJson(PROVIDER, `${BASE}/fixtures/date/${date}`, {
    api_token: apiToken,
    include: 'participants;scores;league',
  });

  const fixtures: any[] = data?.data || [];

  return fixtures
    .map((f): NormalizedFixture | null => {
      const home = participant(f?.participants, 'home');
      const away = participant(f?.participants, 'away');
      if (!home.name || !away.name || !f?.id || !f?.starting_at) return null;
      return {
        providerId: String(f.id),
        sport: 'football',
        homeOrPlayer1: home.name,
        awayOrPlayer2: away.name,
        homeId: home.id,
        awayId: away.id,
        competition: f?.league?.name || 'Unknown competition',
        // Sportmonks starting_at is "YYYY-MM-DD HH:mm:ss" in UTC; normalize to ISO.
        matchTime: f.starting_at.replace(' ', 'T') + 'Z',
        venue: f?.venue?.name,
      };
    })
    .filter((f): f is NormalizedFixture => f !== null);
}

/**
 * Results for a single date, used for settlement + historical backfill.
 * The fixtures/date endpoint already embeds scores, so no per-fixture call
 * is needed to know whether a match finished and what the score was.
 */
export async function getResultsForDate(apiToken: string, date: string): Promise<NormalizedResult[]> {
  const data = await fetchJson(PROVIDER, `${BASE}/fixtures/date/${date}`, {
    api_token: apiToken,
    include: 'participants;scores;league;state',
  });

  const fixtures: any[] = data?.data || [];
  const results: NormalizedResult[] = [];

  for (const f of fixtures) {
    const home = participant(f?.participants, 'home');
    const away = participant(f?.participants, 'away');
    const homeScore = fullTimeScore(f?.scores, home.id);
    const awayScore = fullTimeScore(f?.scores, away.id);
    const isCompleted = f?.state?.state === 'FT' || f?.state?.short_name === 'FT';

    if (!home.name || !away.name || !f?.id) continue;
    if (!isCompleted || typeof homeScore !== 'number' || typeof awayScore !== 'number') continue;

    results.push({
      providerId: String(f.id),
      homeOrPlayer1: home.name,
      awayOrPlayer2: away.name,
      competition: f?.league?.name || 'Unknown competition',
      matchTime: f?.starting_at ? f.starting_at.replace(' ', 'T') + 'Z' : '',
      isCompleted: true,
      homeScore,
      awayScore,
      finalScore: `${homeScore} - ${awayScore}`,
    });
  }

  return results;
}

export async function getFixtureById(apiToken: string, fixtureId: string): Promise<NormalizedResult> {
  const data = await fetchJson(PROVIDER, `${BASE}/fixtures/${fixtureId}`, {
    api_token: apiToken,
    include: 'participants;scores;statistics',
  });

  const f = data?.data;
  const home = participant(f?.participants, 'home');
  const away = participant(f?.participants, 'away');
  const homeScore = fullTimeScore(f?.scores, home.id);
  const awayScore = fullTimeScore(f?.scores, away.id);

  return {
    providerId: fixtureId,
    homeOrPlayer1: home.name || 'Unknown',
    awayOrPlayer2: away.name || 'Unknown',
    competition: f?.league?.name || 'Unknown competition',
    matchTime: f?.starting_at ? f.starting_at.replace(' ', 'T') + 'Z' : '',
    isCompleted: typeof homeScore === 'number' && typeof awayScore === 'number' && f?.state?.state === 'FT',
    homeScore,
    awayScore,
    finalScore:
      typeof homeScore === 'number' && typeof awayScore === 'number'
        ? `${homeScore} - ${awayScore}`
        : undefined,
  };
}

export async function getTeamStats(apiToken: string, teamId: string): Promise<NormalizedTeamProfile> {
  const data = await fetchJson(PROVIDER, `${BASE}/teams/${teamId}`, {
    api_token: apiToken,
    include: 'statistics.season',
  });

  const team = data?.data?.name || 'Unknown team';

  let prevSeason: FootballPrevSeasonStats | undefined;
  const seasonStats: any[] = data?.data?.statistics;
  // Most recent completed season entry; Sportmonks nests goal counts under
  // `details` keyed by a numeric type id in the raw API, which is not
  // stable enough to hardcode here without a live response to confirm
  // against — so only build this when a simpler aggregate shape is present.
  const latest = Array.isArray(seasonStats) ? seasonStats[0] : undefined;
  if (
    latest &&
    typeof latest.matches_played === 'number' &&
    typeof latest.goals_scored === 'number' &&
    typeof latest.goals_conceded === 'number'
  ) {
    prevSeason = {
      team,
      season: latest.season?.name || 'Most recent completed season',
      league: latest.league?.name || 'Unknown league',
      matchesPlayed: latest.matches_played,
      goalsScored: latest.goals_scored,
      goalsConceded: latest.goals_conceded,
      avgGoalsScored: latest.matches_played > 0 ? latest.goals_scored / latest.matches_played : 0,
      avgGoalsConceded: latest.matches_played > 0 ? latest.goals_conceded / latest.matches_played : 0,
    };
  }

  let recentMatches: TeamRecentMatch[] | undefined;
  const recent: any[] = data?.data?.latest;
  if (Array.isArray(recent) && recent.length > 0) {
    recentMatches = recent
      .map((r): TeamRecentMatch | null => {
        const home = participant(r?.participants, 'home');
        const away = participant(r?.participants, 'away');
        const isHome = home.id === teamId;
        const teamGoals = fullTimeScore(r?.scores, teamId);
        const oppId = isHome ? away.id : home.id;
        const oppGoals = fullTimeScore(r?.scores, oppId);
        if (typeof teamGoals !== 'number' || typeof oppGoals !== 'number') return null;
        return {
          date: r?.starting_at ? r.starting_at.slice(0, 10) : '',
          opponent: (isHome ? away.name : home.name) || 'Unknown',
          isHome,
          teamGoals,
          opponentGoals: oppGoals,
          totalGoals: teamGoals + oppGoals,
          competition: r?.league?.name || 'Unknown competition',
          scoredAtLeastOne: teamGoals > 0,
          under35Goals: teamGoals + oppGoals < 4,
          isCompetitive: r?.league?.sub_type !== 'friendly',
        };
      })
      .filter((m): m is TeamRecentMatch => m !== null);
  }

  return { team, prevSeason, recentMatches };
}

export async function getHeadToHead(
  apiToken: string,
  team1Id: string,
  team2Id: string
): Promise<H2HMatchRecord[]> {
  const data = await fetchJson(PROVIDER, `${BASE}/fixtures/head-to-head/${team1Id}/${team2Id}`, {
    api_token: apiToken,
  });

  const fixtures: any[] = data?.data || [];

  return fixtures
    .map((f): H2HMatchRecord | null => {
      const home = participant(f?.participants, 'home');
      const away = participant(f?.participants, 'away');
      const homeScore = fullTimeScore(f?.scores, home.id);
      const awayScore = fullTimeScore(f?.scores, away.id);
      if (typeof homeScore !== 'number' || typeof awayScore !== 'number') return null;
      return {
        date: f?.starting_at ? f.starting_at.slice(0, 10) : '',
        homeTeam: home.name || 'Unknown',
        awayTeam: away.name || 'Unknown',
        homeScore,
        awayScore,
        totalGoals: homeScore + awayScore,
        competition: f?.league?.name || 'Unknown competition',
        isCompetitive: f?.league?.sub_type !== 'friendly',
      };
    })
    .filter((m): m is H2HMatchRecord => m !== null);
}
