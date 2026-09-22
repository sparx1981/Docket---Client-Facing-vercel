import { AppSettings, BacktestMatchResult, BacktestSummary, SystemType } from '../types';
import { apiGet } from './backendClient';
import { buildFootballCandidate } from './dataFeed';

/**
 * Backtests a currently-configured rule (Over 1.5 / Under 3.5) against the
 * past N finished matches for a selected league (or every league, when none
 * is selected), replaying the exact same statistical filters the live scan
 * applies — previous-season averages, H2H rate, recent-form counts — using
 * genuinely historical data: TheStatsAPI's `date_to` filter on `/matches`
 * and the competition's previous completed season (via `/seasons`) give a
 * real "as of that date" reconstruction, not a same-day snapshot. Each
 * qualifying match's win/loss comes from its real final score.
 *
 * The one thing this cannot replay is a historical market odds price —
 * TheStatsAPI's odds endpoint is not re-queried per historical match here —
 * so a qualifying match is priced at the system's configured required odds
 * rather than a real historical market price, the same convention already
 * used for Archive backfill (historyBackfill.ts). That is disclosed in the
 * result's scopeNote rather than left implicit.
 *
 * Full context reconstruction costs several real calls per match (team
 * detail, previous-season stats x2, recent-form x2, H2H), so the number of
 * candidate matches actually evaluated is capped — reported honestly as
 * `evaluatedCount` alongside the total `candidateCount` found, the same
 * "raw vs enriched" transparency the live scan already uses.
 */

const MAX_EVALUATED_MATCHES = 60;

interface BacktestCandidateMatch {
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

export async function runBacktest(
  settings: AppSettings,
  system: Extract<SystemType, 'football_over_1_5' | 'football_under_3_5'>,
  leagueIds: string[],
  leagueLabel: string,
  sampleSize = 200
): Promise<BacktestSummary> {
  if (!settings.theStatsApiKey) {
    throw new Error('Add a TheStatsAPI key in Engine Configuration before running a backtest.');
  }

  // Empty selection means "All" — one call. A specific multi-league
  // selection means one call per league (TheStatsAPI's competition_id
  // filter only takes a single value), merged and re-capped afterwards.
  const leagueIdsToQuery = leagueIds.length > 0 ? leagueIds : [undefined];
  const candidatesByLeague = await Promise.all(
    leagueIdsToQuery.map(async (leagueId) => {
      const qs = new URLSearchParams({ limit: String(sampleSize) });
      if (leagueId) qs.set('competitionId', leagueId);
      const body = await apiGet(`/api/football/backtest-results?${qs.toString()}`, settings.theStatsApiKey);
      return (body?.matches || []) as BacktestCandidateMatch[];
    })
  );
  const candidates = candidatesByLeague
    .flat()
    .sort((a, b) => new Date(b.matchTime).getTime() - new Date(a.matchTime).getTime())
    .slice(0, sampleSize);

  const requiredOdds =
    system === 'football_over_1_5'
      ? settings.ruleThresholds.footballOver15.minExchangeOdds
      : settings.ruleThresholds.footballUnder35.minExchangeOdds;

  const toEvaluate = candidates.slice(0, MAX_EVALUATED_MATCHES);
  const matches: BacktestMatchResult[] = [];

  for (const c of toEvaluate) {
    const ctxQs = new URLSearchParams({
      homeId: c.homeId,
      awayId: c.awayId,
      competitionId: c.competitionId,
      seasonId: c.seasonId,
      date: c.matchTime.slice(0, 10),
    });
    let context: {
      homePrevSeason?: any;
      awayPrevSeason?: any;
      homeRecentMatches?: any[];
      awayRecentMatches?: any[];
      h2hMatches?: any[];
    } = {};
    try {
      const ctxBody = await apiGet(`/api/football/backtest-context?${ctxQs.toString()}`, settings.theStatsApiKey);
      context = ctxBody?.context || {};
    } catch {
      // Leave context empty — the candidate below is then evaluated with no
      // footballDetails, which the rules engine treats as missing data
      // (never a fabricated pass), so it simply won't qualify.
    }

    const footballDetails =
      context.homePrevSeason &&
      context.awayPrevSeason &&
      context.homeRecentMatches &&
      context.homeRecentMatches.length > 0 &&
      context.awayRecentMatches &&
      context.awayRecentMatches.length > 0 &&
      context.h2hMatches &&
      context.h2hMatches.length > 0
        ? {
            homePrevSeason: context.homePrevSeason,
            awayPrevSeason: context.awayPrevSeason,
            h2hMatches: context.h2hMatches,
            homeRecentMatches: context.homeRecentMatches,
            awayRecentMatches: context.awayRecentMatches,
          }
        : undefined;

    const candidateFixture = buildFootballCandidate(
      system,
      {
        providerId: c.providerId,
        homeOrPlayer1: c.homeOrPlayer1,
        awayOrPlayer2: c.awayOrPlayer2,
        homeId: c.homeId,
        awayId: c.awayId,
        competition: c.competition,
        matchTime: c.matchTime,
      },
      footballDetails,
      settings.ruleThresholds
    );

    // Only matches the rule's real statistical filters would have flagged
    // as a preliminary qualifier count toward the backtest sample — this is
    // "how would this rule have performed", not "how often do goals happen".
    if (candidateFixture.status !== 'PRELIMINARY_QUALIFIER' && candidateFixture.status !== 'VERIFIED_QUALIFIER') {
      continue;
    }

    const totalGoals = c.homeScore + c.awayScore;
    const won = system === 'football_over_1_5' ? totalGoals > 1 : totalGoals < 4;
    matches.push({
      matchId: c.providerId,
      date: c.matchTime.slice(0, 10),
      match: `${c.homeOrPlayer1} vs ${c.awayOrPlayer2}`,
      competition: c.competition,
      finalScore: c.finalScore,
      system,
      won,
    });
  }

  const wins = matches.filter((m) => m.won).length;
  const losses = matches.length - wins;
  const stake = 1;
  const netUnitsAtRequiredOdds = wins * (requiredOdds - 1) * stake - losses * stake;
  const staked = matches.length * stake;

  return {
    system,
    leagueLabel,
    candidateCount: candidates.length,
    evaluatedCount: toEvaluate.length,
    sampleSize: matches.length,
    wins,
    losses,
    winRatePct: matches.length > 0 ? Number(((wins / matches.length) * 100).toFixed(1)) : 0,
    requiredOdds,
    netUnitsAtRequiredOdds: Number(netUnitsAtRequiredOdds.toFixed(2)),
    roiPct: staked > 0 ? Number(((netUnitsAtRequiredOdds / staked) * 100).toFixed(1)) : 0,
    matches,
    scopeNote:
      'Each qualifying match is settled against its real final score. Backtest does not re-query TheStatsAPI\'s odds endpoint per historical match, so every qualifying match here is priced at this rule\'s configured required odds rather than a real historical market price.',
  };
}
