import { AppSettings, BacktestMatchResult, BacktestSummary, SystemType } from '../types';
import { apiGet } from './backendClient';

/**
 * Backtests a currently-configured rule (Over 1.5 / Under 3.5) against the
 * past N finished matches for a selected league (or every league, when none
 * is selected) pulled from TheStatsAPI's real results.
 *
 * Scope, disclosed in the result rather than left implicit: this settles
 * each historical match directly against its real final score at the
 * system's disclosed goal threshold. It does not replay each team's
 * pre-match form/H2H as it stood on that date — TheStatsAPI has no
 * "stats as of a past date" query — and there is no historical Betfair
 * Exchange price to test the odds filter against either. Every other filter
 * this app enforces on a live fixture (previous-season averages, H2H rate,
 * recent-form counts, exchange odds) is therefore not re-applied here; the
 * backtest answers "how often would this bet type have won for these
 * matches", which is the real, honest question a goals-line backtest can
 * answer without fabricating a stat this API doesn't expose. This mirrors
 * the same scope call already made for Archive backfill (historyBackfill.ts).
 */

const SCOPE_NOTE =
  'Settled directly against each match\'s real final score at the configured required odds. Does not replay pre-match form, H2H, or exchange odds as they stood on that historical date — TheStatsAPI has no "stats as of a past date" query, and there is no historical Betfair Exchange price to test against.';

export async function runBacktest(
  settings: AppSettings,
  system: Extract<SystemType, 'football_over_1_5' | 'football_under_3_5'>,
  leagueId: string | null,
  leagueLabel: string,
  sampleSize = 200
): Promise<BacktestSummary> {
  if (!settings.theStatsApiKey) {
    throw new Error('Add a TheStatsAPI key in Engine Configuration before running a backtest.');
  }

  const qs = new URLSearchParams({ limit: String(sampleSize) });
  if (leagueId) qs.set('competitionId', leagueId);
  const body = await apiGet(`/api/football/backtest-results?${qs.toString()}`, settings.theStatsApiKey);
  const results: {
    providerId: string;
    homeOrPlayer1: string;
    awayOrPlayer2: string;
    competition: string;
    matchTime: string;
    homeScore?: number;
    awayScore?: number;
    finalScore?: string;
  }[] = body?.results || [];

  const requiredOdds =
    system === 'football_over_1_5'
      ? settings.ruleThresholds.footballOver15.minExchangeOdds
      : settings.ruleThresholds.footballUnder35.minExchangeOdds;

  const matches: BacktestMatchResult[] = [];
  for (const r of results) {
    if (typeof r.homeScore !== 'number' || typeof r.awayScore !== 'number') continue;
    const totalGoals = r.homeScore + r.awayScore;
    const won = system === 'football_over_1_5' ? totalGoals > 1 : totalGoals < 4;
    matches.push({
      matchId: r.providerId,
      date: r.matchTime.slice(0, 10),
      match: `${r.homeOrPlayer1} vs ${r.awayOrPlayer2}`,
      competition: r.competition,
      finalScore: r.finalScore || `${r.homeScore} - ${r.awayScore}`,
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
    sampleSize: matches.length,
    wins,
    losses,
    winRatePct: matches.length > 0 ? Number(((wins / matches.length) * 100).toFixed(1)) : 0,
    requiredOdds,
    netUnitsAtRequiredOdds: Number(netUnitsAtRequiredOdds.toFixed(2)),
    roiPct: staked > 0 ? Number(((netUnitsAtRequiredOdds / staked) * 100).toFixed(1)) : 0,
    matches,
    scopeNote: SCOPE_NOTE,
  };
}
