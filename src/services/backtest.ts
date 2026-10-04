import { AppSettings, BacktestMatchResult, BacktestRunRecord, BacktestSummary, RuleThresholds, SystemType } from '../types';
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
 * Only the statistical filters are applied. A historical market price is
 * not available per past match, so the Min. exchange odds filter is
 * deliberately NOT part of a backtest (it still applies to live scans), and
 * the result reports wins, losses and win rate only — no profit figures.
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

export interface BacktestProgressEvent {
  completed: number;
  total: number;
  /** Plain-English status for the match just processed, e.g. that TheStatsAPI's rate limit was hit and it waited before retrying automatically. Undefined when nothing noteworthy happened. */
  notice?: string;
}

export async function runBacktest(
  settings: AppSettings,
  system: Extract<SystemType, 'football_over_1_5' | 'football_under_3_5'>,
  leagueIds: string[],
  leagueLabel: string,
  sampleSize = 200,
  signal?: AbortSignal,
  onProgress?: (evt: BacktestProgressEvent) => void
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
      const body = await apiGet(`/api/football/backtest-results?${qs.toString()}`, settings.theStatsApiKey, signal);
      return (body?.matches || []) as BacktestCandidateMatch[];
    })
  );
  const candidates = candidatesByLeague
    .flat()
    .sort((a, b) => new Date(b.matchTime).getTime() - new Date(a.matchTime).getTime())
    .slice(0, sampleSize);

  const toEvaluate = candidates.slice(0, MAX_EVALUATED_MATCHES);
  const matches: BacktestMatchResult[] = [];

  onProgress?.({ completed: 0, total: toEvaluate.length });

  for (const [index, c] of toEvaluate.entries()) {
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
    let notice: string | undefined;
    try {
      const ctxBody = await apiGet(`/api/football/backtest-context?${ctxQs.toString()}`, settings.theStatsApiKey, signal);
      context = ctxBody?.context || {};
      const notices: string[] | undefined = ctxBody?.notices;
      if (Array.isArray(notices) && notices.length > 0) {
        notice =
          notices.length === 1
            ? notices[0]
            : `${notices[0]} (${notices.length} rate-limit waits for this match — still running, not stuck.)`;
      }
    } catch (err) {
      // A user-requested stop must actually stop the loop rather than being
      // swallowed as "missing data" for this one match and carrying on to
      // the next — that's how a cancelled backtest used to keep running.
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      // Leave context empty — the candidate below is then evaluated with no
      // footballDetails, which the rules engine treats as missing data
      // (never a fabricated pass), so it simply won't qualify.
    }

    onProgress?.({ completed: index + 1, total: toEvaluate.length, notice });

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

    // Only matches that pass every statistical filter count toward the
    // backtest sample — this is "how would this rule have performed", not
    // "how often do goals happen". With no historical price attached, a
    // match that clears the stats is classed PRICE_WATCH by the live rules
    // (stats passed, price unknown), so that status counts here too; only
    // FAILED (a statistical filter failed, or the data was incomplete) is
    // excluded.
    if (candidateFixture.status === 'FAILED') continue;

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

  return {
    system,
    leagueLabel,
    candidateCount: candidates.length,
    evaluatedCount: toEvaluate.length,
    sampleSize: matches.length,
    wins,
    losses,
    winRatePct: matches.length > 0 ? Number(((wins / matches.length) * 100).toFixed(1)) : 0,
    matches,
    scopeNote:
      'Each qualifying match is settled against its real final score. A backtest applies the statistical filters only: Min. exchange odds is not part of the analysis (there is no historical market price for past matches), so no profit or ROI figures are shown.',
  };
}

const SYSTEM_LABEL: Record<'football_over_1_5' | 'football_under_3_5', string> = {
  football_over_1_5: 'Football — Over 1.5 Goals',
  football_under_3_5: 'Football — Under 3.5 Goals',
};

function describeRuleSnapshot(
  system: 'football_over_1_5' | 'football_under_3_5',
  snapshot: RuleThresholds['footballOver15'] | RuleThresholds['footballUnder35']
): string {
  if (system === 'football_over_1_5') {
    const s = snapshot as RuleThresholds['footballOver15'];
    return `Min. previous-season avg goals scored >= ${s.minPrevSeasonAvgScored}; Min. H2H Over 1.5 rate >= ${Math.round(
      s.minH2HOver15Rate * 100
    )}%; Min. recent scoring count >= ${s.minRecentScoredCount} (of last 5)`;
  }
  const s = snapshot as RuleThresholds['footballUnder35'];
  return `Max. previous-season avg goals scored <= ${s.maxPrevSeasonAvgScored}; Max. previous-season avg goals conceded <= ${s.maxPrevSeasonAvgConceded}; Min. H2H Under 3.5 rate >= ${Math.round(
    s.minH2HUnder35Rate * 100
  )}%; Min. recent Under 3.5 count >= ${s.minRecentUnder35Count} (of last 5)`;
}

function csvCell(value: string | number | undefined | null): string {
  const str = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/**
 * Builds a CSV a user can independently check the app's own backtest claims
 * against: a run header block (when it ran, which rule and thresholds were
 * applied, and the summary numbers shown on screen), a blank gap, then the
 * real per-match rows the summary was computed from.
 */
export function buildBacktestCsv(run: BacktestRunRecord): string {
  const { summary, ruleSnapshot, runAt } = run;
  const system = summary.system as 'football_over_1_5' | 'football_under_3_5';

  const metaRows: (string | number)[][] = [
    ['Backtest run at', new Date(runAt).toLocaleString()],
    ['Rule', SYSTEM_LABEL[system]],
    ['League scope', summary.leagueLabel],
    ['Thresholds applied (Min. exchange odds is not used in backtests)', describeRuleSnapshot(system, ruleSnapshot)],
    ['Finished matches found', summary.candidateCount],
    ['Evaluated with full historical context', summary.evaluatedCount],
    ['Would have qualified', summary.sampleSize],
    ['Wins', summary.wins],
    ['Losses', summary.losses],
    ['Win rate %', summary.winRatePct],
    ['Scope note', summary.scopeNote],
  ];

  const headerRow = ['Date', 'Match', 'Competition', 'Final Score', 'Outcome'];
  const dataRows = summary.matches.map((m) => [m.date, m.match, m.competition, m.finalScore, m.won ? 'WON' : 'LOST']);

  const lines = [
    ...metaRows.map((r) => r.map(csvCell).join(',')),
    '',
    '',
    headerRow.map(csvCell).join(','),
    ...dataRows.map((r) => r.map(csvCell).join(',')),
  ];

  return lines.join('\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
