import { fetchJson } from '../httpClient';
import { ProviderError } from '../errors';
import type {
  NormalizedFixture,
  NormalizedResult,
  NormalizedTeamProfile,
  H2HMatchRecord,
} from '../normalized';
import type { FootballPrevSeasonStats, TeamRecentMatch } from '../../src/types';

const PROVIDER = 'Sportradar Soccer';

/**
 * Sportradar Soccer API v4. Trial and production share the same URL shape —
 * only the access-level path segment differs ("trial" vs "production").
 *
 * NOTE: field mapping below is written against Sportradar's publicly
 * documented v4 schema. It has not been exercised against a live trial
 * response (no key is available in this environment) — re-verify every
 * field name here once a real Sportradar key is configured.
 */
function baseUrl(accessLevel: string): string {
  return `https://api.sportradar.com/soccer/${accessLevel}/v4/en`;
}

function competitorName(
  competitors: any[] | undefined,
  qualifier: 'home' | 'away'
): { name?: string; id?: string } {
  let c = competitors?.find((x) => x?.qualifier === qualifier);
  if (!c && competitors && competitors.length >= 2) {
    c = qualifier === 'home' ? competitors[0] : competitors[1];
  }
  return { name: c?.name, id: c?.id };
}

export async function getDailySchedule(
  apiKey: string,
  accessLevel: string,
  date: string
): Promise<NormalizedFixture[]> {
  const data = await fetchJson(
    PROVIDER,
    `${baseUrl(accessLevel)}/schedules/${date}/schedules.json`,
    { api_key: apiKey }
  );

  // In Sportradar Soccer v4, the daily schedule feed returns either:
  // - schedules: [ { sport_event: { id, start_time, scheduled, competitors: [...] }, sport_event_status: {...} } ]
  // - sport_events: [ { id, start_time, scheduled, competitors: [...] } ]
  const rawList: any[] = data?.schedules || data?.sport_events || [];
  const events = rawList.map((item) => (item?.sport_event ? item.sport_event : item));

  return events
    .map((event): NormalizedFixture | null => {
      const home = competitorName(event?.competitors, 'home');
      const away = competitorName(event?.competitors, 'away');
      const matchTime = event?.start_time || event?.scheduled;
      if (!home.name || !away.name || !event?.id || !matchTime) return null;

      return {
        providerId: String(event.id),
        sport: 'football',
        homeOrPlayer1: home.name,
        awayOrPlayer2: away.name,
        homeId: home.id,
        awayId: away.id,
        competition:
          event?.sport_event_context?.competition?.name ||
          event?.tournament?.name ||
          'Unknown competition',
        matchTime,
        venue: event?.venue?.name,
      };
    })
    .filter((f): f is NormalizedFixture => f !== null);
}

export async function getMatchSummary(
  apiKey: string,
  accessLevel: string,
  matchId: string
): Promise<NormalizedResult> {
  const data = await fetchJson(
    PROVIDER,
    `${baseUrl(accessLevel)}/matches/${matchId}/summary.json`,
    { api_key: apiKey }
  );

  const event = data?.sport_event;
  const status = data?.sport_event_status;
  if (!event || !status) {
    throw new ProviderError(PROVIDER, 502, 'Match summary response missing sport_event_status');
  }

  const home = competitorName(event?.competitors, 'home');
  const away = competitorName(event?.competitors, 'away');
  const isCompleted = status?.status === 'closed' || status?.status === 'ended';
  const homeScore: number | undefined = status?.home_score;
  const awayScore: number | undefined = status?.away_score;

  return {
    providerId: matchId,
    homeOrPlayer1: home.name || 'Unknown',
    awayOrPlayer2: away.name || 'Unknown',
    competition: event?.sport_event_context?.competition?.name || 'Unknown competition',
    matchTime: event?.start_time,
    isCompleted,
    homeScore,
    awayScore,
    finalScore:
      typeof homeScore === 'number' && typeof awayScore === 'number'
        ? `${homeScore} - ${awayScore}`
        : undefined,
  };
}

/**
 * Results for a single date, used for settlement + historical backfill.
 * Sportradar's schedule.json embeds `sport_event_status` directly alongside
 * each event, so a completed match's score can be read without a second
 * per-match summary.json call.
 */
export async function getResultsForDate(
  apiKey: string,
  accessLevel: string,
  date: string
): Promise<NormalizedResult[]> {
  const data = await fetchJson(
    PROVIDER,
    `${baseUrl(accessLevel)}/schedules/${date}/schedules.json`,
    { api_key: apiKey }
  );

  const rawList: any[] = data?.schedules || data?.sport_events || [];
  const results: NormalizedResult[] = [];

  for (const item of rawList) {
    const event = item?.sport_event ? item.sport_event : item;
    const status = item?.sport_event_status || item?.status || event?.sport_event_status;
    const home = competitorName(event?.competitors, 'home');
    const away = competitorName(event?.competitors, 'away');
    const homeScore: number | undefined = status?.home_score;
    const awayScore: number | undefined = status?.away_score;
    const isCompleted = status?.status === 'closed' || status?.status === 'ended';
    const matchTime = event?.start_time || event?.scheduled;

    if (!home.name || !away.name || !event?.id) continue;
    if (!isCompleted || typeof homeScore !== 'number' || typeof awayScore !== 'number') continue;

    results.push({
      providerId: String(event.id),
      homeOrPlayer1: home.name,
      awayOrPlayer2: away.name,
      competition: event?.sport_event_context?.competition?.name || 'Unknown competition',
      matchTime,
      isCompleted: true,
      homeScore,
      awayScore,
      finalScore: `${homeScore} - ${awayScore}`,
    });
  }

  return results;
}

export async function getCompetitorProfile(
  apiKey: string,
  accessLevel: string,
  competitorId: string
): Promise<NormalizedTeamProfile> {
  const data = await fetchJson(
    PROVIDER,
    `${baseUrl(accessLevel)}/competitors/${competitorId}/profile.json`,
    { api_key: apiKey }
  );

  const team = data?.competitor?.name || 'Unknown team';

  // The trial tier is not guaranteed to expose full season goal aggregates.
  // Only build a FootballPrevSeasonStats when the shape is actually present;
  // otherwise leave it undefined rather than fabricating a number.
  let prevSeason: FootballPrevSeasonStats | undefined;
  const seasonStats = data?.statistics?.season ?? data?.statistics;
  if (
    seasonStats &&
    typeof seasonStats.matches_played === 'number' &&
    typeof seasonStats.goals_scored === 'number' &&
    typeof seasonStats.goals_conceded === 'number'
  ) {
    const matchesPlayed = seasonStats.matches_played;
    prevSeason = {
      team,
      season: data?.statistics?.season_name || 'Most recent completed season',
      league: data?.statistics?.competition?.name || 'Unknown league',
      matchesPlayed,
      goalsScored: seasonStats.goals_scored,
      goalsConceded: seasonStats.goals_conceded,
      avgGoalsScored: matchesPlayed > 0 ? seasonStats.goals_scored / matchesPlayed : 0,
      avgGoalsConceded: matchesPlayed > 0 ? seasonStats.goals_conceded / matchesPlayed : 0,
    };
  }

  // Recent-form results, if the profile response includes a "results" list.
  let recentMatches: TeamRecentMatch[] | undefined;
  const results: any[] = data?.results;
  if (Array.isArray(results) && results.length > 0) {
    recentMatches = results
      .map((r): TeamRecentMatch | null => {
        const home = competitorName(r?.sport_event?.competitors, 'home');
        const away = competitorName(r?.sport_event?.competitors, 'away');
        const isHome = home.id === competitorId;
        const teamGoals = isHome ? r?.sport_event_status?.home_score : r?.sport_event_status?.away_score;
        const oppGoals = isHome ? r?.sport_event_status?.away_score : r?.sport_event_status?.home_score;
        if (typeof teamGoals !== 'number' || typeof oppGoals !== 'number') return null;
        return {
          date: r?.sport_event?.start_time?.slice(0, 10) || '',
          opponent: isHome ? away.name || 'Unknown' : home.name || 'Unknown',
          isHome,
          teamGoals,
          opponentGoals: oppGoals,
          totalGoals: teamGoals + oppGoals,
          competition: r?.sport_event?.sport_event_context?.competition?.name || 'Unknown competition',
          scoredAtLeastOne: teamGoals > 0,
          under35Goals: teamGoals + oppGoals < 4,
          isCompetitive: r?.sport_event?.sport_event_context?.competition?.type !== 'friendly',
        };
      })
      .filter((m): m is TeamRecentMatch => m !== null);
  }

  return { team, prevSeason, recentMatches };
}

export async function getHeadToHead(
  apiKey: string,
  accessLevel: string,
  competitorId: string,
  competitorId2: string
): Promise<H2HMatchRecord[]> {
  const data = await fetchJson(
    PROVIDER,
    `${baseUrl(accessLevel)}/competitors/${competitorId}/versus/${competitorId2}/summaries.json`,
    { api_key: apiKey }
  );

  const meetings: any[] = data?.last_meetings || [];

  return meetings
    .map((m): H2HMatchRecord | null => {
      const home = competitorName(m?.sport_event?.competitors, 'home');
      const away = competitorName(m?.sport_event?.competitors, 'away');
      const homeScore = m?.sport_event_status?.home_score;
      const awayScore = m?.sport_event_status?.away_score;
      if (typeof homeScore !== 'number' || typeof awayScore !== 'number') return null;
      return {
        date: m?.sport_event?.start_time?.slice(0, 10) || '',
        homeTeam: home.name || 'Unknown',
        awayTeam: away.name || 'Unknown',
        homeScore,
        awayScore,
        totalGoals: homeScore + awayScore,
        competition: m?.sport_event?.sport_event_context?.competition?.name || 'Unknown competition',
        isCompetitive: m?.sport_event?.sport_event_context?.competition?.type !== 'friendly',
      };
    })
    .filter((m): m is H2HMatchRecord => m !== null);
}
