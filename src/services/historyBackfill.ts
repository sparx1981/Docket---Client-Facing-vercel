import { AppSettings, HistoricalBetRecord, RuleThresholds, SystemType } from '../types';
import { apiGet } from './backendClient';

/**
 * Backfills the Archive with genuine settled results pulled from whichever
 * real provider is configured, for use on the very first run when the
 * archive is empty. Replaces the old generateFullHistoricalDataset(), which
 * cycled 50 hand-written fake matches into 250 fabricated rows.
 *
 * Judgment call: this backfill does not re-query TheStatsAPI's odds
 * endpoint (see marketOdds in src/types) for each historical match, so no
 * *real* historical price exists for any of these backfilled records.
 * Rather than inventing a plausible-looking decimal price per match — which
 * is exactly the kind of fabrication this pass removes — each backfilled
 * record is priced at its system's own disclosed minimum qualifying
 * threshold (1.15 / 1.20), and both the notes field and dataSourceName say
 * so plainly. The match, date, competition and final score are all real,
 * pulled straight from the provider's completed-results feed.
 *
 * This also does not re-run the full statistical qualification criteria
 * against each historical match (that would need each team's/player's
 * pre-match form and season stats on that exact date, which the documented
 * provider contracts do not offer a clean "as of" query for). Instead every
 * completed match in the window is settled directly against its system's
 * pass/fail line on the real final score — an intentional scope reduction
 * for phase 1, called out here rather than silently assumed.
 */

const DAYS_BACK = 30;

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function googleUrl(match: string, competition: string): string {
  return (
    'https://www.google.com/search?q=' +
    encodeURIComponent(`${match} ${competition} result score`)
  );
}

function buildFootballRecords(
  results: { providerId: string; homeOrPlayer1: string; awayOrPlayer2: string; competition: string; matchTime: string; homeScore?: number; awayScore?: number; finalScore?: string }[],
  stake: number,
  thresholds: RuleThresholds
): HistoricalBetRecord[] {
  const records: HistoricalBetRecord[] = [];

  for (const r of results) {
    if (typeof r.homeScore !== 'number' || typeof r.awayScore !== 'number') continue;
    const totalGoals = r.homeScore + r.awayScore;
    const match = `${r.homeOrPlayer1} vs ${r.awayOrPlayer2}`;

    (
      [
        { system: 'football_over_1_5' as SystemType, selection: 'Over 1.5 Goals', requiredOdds: thresholds.footballOver15.minExchangeOdds, enabled: thresholds.footballOver15.enabled, won: totalGoals > 1 },
        { system: 'football_under_3_5' as SystemType, selection: 'Under 3.5 Goals', requiredOdds: thresholds.footballUnder35.minExchangeOdds, enabled: thresholds.footballUnder35.enabled, won: totalGoals < 4 },
      ] as const
    ).forEach((line) => {
      if (!line.enabled) return;
      const outcome = line.won ? 'WON' : 'LOST';
      const pnl = line.won ? Number(((line.requiredOdds - 1) * stake).toFixed(2)) : -stake;
      records.push({
        id: `HIST-${line.system === 'football_over_1_5' ? 'OV15' : 'UN35'}-${r.providerId}`,
        date: r.matchTime.slice(0, 10),
        fixtureId: r.providerId,
        sport: 'football',
        system: line.system,
        match,
        competition: r.competition,
        selection: line.selection,
        oddsTaken: line.requiredOdds,
        stake,
        outcome,
        finalScore: r.finalScore || `${r.homeScore} - ${r.awayScore}`,
        settledAt: r.matchTime,
        pnl,
        roiContribution: Number(((pnl / stake) * 100).toFixed(1)),
        auditId: `BACKFILL-${r.providerId}-${line.system}`,
        notes:
          'Backfilled from a real completed match result. Priced at the system\'s disclosed minimum qualifying odds — historical market pricing for this match was not re-queried.',
        googleVerificationUrl: googleUrl(match, r.competition),
        dataSourceName: 'Provider results feed (historical backfill)',
      });
    });
  }

  return records;
}

export interface BackfillResult {
  records: HistoricalBetRecord[];
  error?: string;
}

export async function backfillHistoricalResults(settings: AppSettings): Promise<BackfillResult> {
  // Tennis has no configured data supplier since the Sportradar/Sportmonks
  // migration — only football (TheStatsAPI) can be backfilled right now.
  if (!settings.theStatsApiKey) {
    return { records: [], error: 'No provider configured — add a TheStatsAPI key in Engine Configuration to backfill.' };
  }

  // No TheStatsAPI endpoint beyond the competitions listing (needed to
  // populate the league picker itself) may be called until the user has
  // saved a specific league selection — an empty selection means "All
  // leagues", the unscoped, expensive default this guard exists to prevent.
  const leagueIds = Array.from(
    new Set([
      ...settings.ruleThresholds.footballOver15.selectedLeagueIds,
      ...settings.ruleThresholds.footballUnder35.selectedLeagueIds,
    ])
  );
  if (leagueIds.length === 0) {
    return {
      records: [],
      error: 'No leagues selected — choose and save at least one league in Engine Configuration before backfilling.',
    };
  }

  const from = isoDateDaysAgo(DAYS_BACK);
  const to = todayIso();
  const errors: string[] = [];
  const records: HistoricalBetRecord[] = [];

  // One call per selected league — never the unscoped "every league"
  // request the old version made.
  await Promise.all(
    leagueIds.map(async (competitionId) => {
      try {
        const qs = new URLSearchParams({ from, to, competitionId });
        const body = await apiGet(`/api/football/results?${qs.toString()}`, settings.theStatsApiKey);
        records.push(...buildFootballRecords(body?.results || [], settings.defaultStake || 100, settings.ruleThresholds));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    })
  );

  records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return { records, error: errors.length > 0 ? errors.join(' · ') : undefined };
}
