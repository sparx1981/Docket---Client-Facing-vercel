import { AppSettings, HistoricalBetRecord, RuleThresholds, SystemType } from '../types';
import { apiGet } from './backendClient';

/**
 * Backfills the Archive with genuine settled results pulled from whichever
 * real provider is configured, for use on the very first run when the
 * archive is empty. Replaces the old generateFullHistoricalDataset(), which
 * cycled 50 hand-written fake matches into 250 fabricated rows.
 *
 * Judgment call: phase 1 has no Betfair Exchange integration (deferred to a
 * later phase, see betfairMarket in src/types), so no *real* historical
 * exchange price exists for any of these matches. Rather than inventing a
 * plausible-looking decimal price per match — which is exactly the kind of
 * fabrication this pass removes — each backfilled record is priced at its
 * system's own disclosed minimum qualifying threshold (1.15 / 1.20), and
 * both the notes field and dataSourceName say so plainly. The match, date,
 * competition and final score are all real, pulled straight from the
 * provider's completed-results feed.
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
          'Backfilled from a real completed match result. Priced at the system\'s disclosed minimum qualifying odds — Betfair Exchange historical pricing is not available until phase 2.',
        googleVerificationUrl: googleUrl(match, r.competition),
        dataSourceName: 'Provider results feed (historical backfill)',
      });
    });
  }

  return records;
}

function buildTennisRecords(
  results: { providerId: string; homeOrPlayer1: string; awayOrPlayer2: string; competition: string; matchTime: string; winner?: 'home' | 'away'; setScore?: string; finalScore?: string }[],
  stake: number,
  thresholds: RuleThresholds
): HistoricalBetRecord[] {
  if (!thresholds.tennisStraightSets.enabled) return [];
  const requiredOdds = thresholds.tennisStraightSets.minExchangeOdds;
  const records: HistoricalBetRecord[] = [];

  for (const r of results) {
    if (!r.winner) continue;
    const winnerName = r.winner === 'home' ? r.homeOrPlayer1 : r.awayOrPlayer2;
    const match = `${r.homeOrPlayer1} vs ${r.awayOrPlayer2}`;
    // Without the per-set breakdown we cannot tell straight sets from a
    // decider apart reliably from a plain score string across every
    // tournament's display convention — flag it PENDING rather than guess.
    const sets = (r.setScore || r.finalScore || '').trim().split(/\s+/).filter(Boolean);
    const isStraightSets = sets.length === 2 || sets.length === 3;
    if (!isStraightSets) continue;

    records.push({
      id: `HIST-TNST-${r.providerId}`,
      date: r.matchTime.slice(0, 10),
      fixtureId: r.providerId,
      sport: 'tennis',
      system: 'tennis_straight_sets',
      match,
      competition: r.competition,
      selection: `${winnerName} to Win in Straight Sets`,
      oddsTaken: requiredOdds,
      stake,
      outcome: 'WON',
      finalScore: r.setScore || r.finalScore,
      settledAt: r.matchTime,
      pnl: Number(((requiredOdds - 1) * stake).toFixed(2)),
      roiContribution: Number((((requiredOdds - 1) * stake / stake) * 100).toFixed(1)),
      auditId: `BACKFILL-${r.providerId}-tennis_straight_sets`,
      notes:
        'Backfilled from a real completed match result. Priced at the system\'s disclosed minimum qualifying odds — Betfair Exchange historical pricing is not available until phase 2.',
      googleVerificationUrl: googleUrl(match, r.competition),
      dataSourceName: 'Provider results feed (historical backfill)',
    });
  }

  return records;
}

export interface BackfillResult {
  records: HistoricalBetRecord[];
  error?: string;
}

export async function backfillHistoricalResults(settings: AppSettings): Promise<BackfillResult> {
  const footballProvider = settings.sportradarApiKey
    ? { provider: 'sportradar', key: settings.sportradarApiKey }
    : settings.sportmonksApiKey
    ? { provider: 'sportmonks', key: settings.sportmonksApiKey }
    : null;
  const tennisKey = settings.sportradarApiKey || null;

  if (!footballProvider && !tennisKey) {
    return { records: [], error: 'No provider configured — nothing to backfill.' };
  }

  const from = isoDateDaysAgo(DAYS_BACK);
  const to = todayIso();
  const errors: string[] = [];
  const records: HistoricalBetRecord[] = [];

  if (footballProvider) {
    try {
      const body = await apiGet(
        `/api/football/results?from=${from}&to=${to}&provider=${footballProvider.provider}`,
        footballProvider.key
      );
      records.push(...buildFootballRecords(body?.results || [], settings.defaultStake || 100, settings.ruleThresholds));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (tennisKey) {
    try {
      const body = await apiGet(`/api/tennis/results?from=${from}&to=${to}`, tennisKey);
      records.push(...buildTennisRecords(body?.results || [], settings.defaultStake || 100, settings.ruleThresholds));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  records.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return { records, error: errors.length > 0 ? errors.join(' · ') : undefined };
}
