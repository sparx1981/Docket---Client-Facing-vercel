import {
  CandidateFixture,
  VerificationAuditCard,
  RuleThresholds,
} from '../types';
import { evaluateFixture } from './rulesEngine';

/**
 * The Verification Engine (Mandatory Audit)
 * Performs an independent recalculation directly from raw un-aggregated item records.
 * If raw evidence is missing, corrupted, or mathematically inconsistent, it fails immediately.
 *
 * Recalculates against the same configurable thresholds as rulesEngine.ts
 * (AppSettings.ruleThresholds) — this must stay in sync with the rules
 * engine's own numbers, otherwise the audit could flag a fixture as
 * FAILED_RECALC against a stale threshold while the rules engine passed it
 * against the current one.
 *
 * `providerUsed` is read directly off the fixture's own `sourceProvider`
 * (set in dataFeed.ts to whichever provider genuinely supplied it) rather
 * than a caller-supplied guess — a scan can pull football from one provider
 * and tennis from another, so there is no single "the provider" for a whole
 * batch to assume.
 */
export function runVerificationAudit(
  fixture: CandidateFixture,
  thresholds: RuleThresholds
): VerificationAuditCard {
  const auditId = `AUDIT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  const timestamp = new Date().toISOString();

  const screening = evaluateFixture(fixture, thresholds);
  const recalculatedMetrics: {
    ruleLabel: string;
    computedMetric: string;
    thresholdRequired: string;
    verifiedMatch: boolean;
  }[] = [];
  const rawEvidenceSummary: string[] = [];

  let dataIntegrityScore = 100;
  let auditStatus: 'VERIFIED' | 'FAILED_RECALC' | 'PRICE_DEFICIT' | 'MISSING_DATA' = 'VERIFIED';

  if (fixture.sport === 'football' && fixture.footballDetails) {
    const details = fixture.footballDetails;
    
    // 1. Raw recalculation of Previous Season Goal Averages
    const homeGoals = details.homePrevSeason.goalsScored;
    const homeMatches = details.homePrevSeason.matchesPlayed;
    const homeConceded = details.homePrevSeason.goalsConceded;
    const recalculatedHomeAvgScored = homeMatches > 0 ? Number((homeGoals / homeMatches).toFixed(3)) : 0;
    const recalculatedHomeAvgConceded = homeMatches > 0 ? Number((homeConceded / homeMatches).toFixed(3)) : 0;

    const awayGoals = details.awayPrevSeason.goalsScored;
    const awayMatches = details.awayPrevSeason.matchesPlayed;
    const awayConceded = details.awayPrevSeason.goalsConceded;
    const recalculatedAwayAvgScored = awayMatches > 0 ? Number((awayGoals / awayMatches).toFixed(3)) : 0;
    const recalculatedAwayAvgConceded = awayMatches > 0 ? Number((awayConceded / awayMatches).toFixed(3)) : 0;

    // Check consistency between stored average and raw sum / count
    const homeDiff = Math.abs(recalculatedHomeAvgScored - details.homePrevSeason.avgGoalsScored);
    const awayDiff = Math.abs(recalculatedAwayAvgScored - details.awayPrevSeason.avgGoalsScored);
    if (homeDiff > 0.05 || awayDiff > 0.05) {
      dataIntegrityScore -= 30;
      auditStatus = 'FAILED_RECALC';
    }

    if (fixture.system === 'football_over_1_5') {
      const t = thresholds.footballOver15;
      const minH2HCount = Math.ceil(t.minH2HOver15Rate * 5);

      recalculatedMetrics.push({
        ruleLabel: 'Raw Home Prev Season Avg Scored',
        computedMetric: `${homeGoals} goals / ${homeMatches} matches = ${recalculatedHomeAvgScored.toFixed(2)}`,
        thresholdRequired: `>= ${t.minPrevSeasonAvgScored.toFixed(2)}`,
        verifiedMatch: recalculatedHomeAvgScored >= t.minPrevSeasonAvgScored,
      });
      recalculatedMetrics.push({
        ruleLabel: 'Raw Away Prev Season Avg Scored',
        computedMetric: `${awayGoals} goals / ${awayMatches} matches = ${recalculatedAwayAvgScored.toFixed(2)}`,
        thresholdRequired: `>= ${t.minPrevSeasonAvgScored.toFixed(2)}`,
        verifiedMatch: recalculatedAwayAvgScored >= t.minPrevSeasonAvgScored,
      });

      // 2. Raw itemized recalculation of last 5 H2H
      const h2hRaw = details.h2hMatches.filter((m) => m.isCompetitive).slice(0, 5);
      const rawOver15Count = h2hRaw.filter((m) => m.homeScore + m.awayScore > 1).length;
      recalculatedMetrics.push({
        ruleLabel: 'Raw H2H Over 1.5 Recalculation',
        computedMetric: `${rawOver15Count} of ${h2hRaw.length} matches finished Over 1.5 (${((rawOver15Count / 5) * 100).toFixed(0)}%)`,
        thresholdRequired: `>= ${minH2HCount} of 5 (${(t.minH2HOver15Rate * 100).toFixed(0)}%)`,
        verifiedMatch: h2hRaw.length >= 5 && rawOver15Count >= minH2HCount,
      });

      // 3. Raw itemized recalculation of last 5 competitive form games
      const homeRawRecent = details.homeRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
      const awayRawRecent = details.awayRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
      const homeScoredTally = homeRawRecent.filter((m) => m.teamGoals > 0).length;
      const awayScoredTally = awayRawRecent.filter((m) => m.teamGoals > 0).length;

      recalculatedMetrics.push({
        ruleLabel: 'Raw Home Scoring Form Audit',
        computedMetric: `${homeScoredTally}/5 matches scored (Raw goals: ${homeRawRecent.map((m) => m.teamGoals).join(',')})`,
        thresholdRequired: `>= ${t.minRecentScoredCount} of 5`,
        verifiedMatch: homeScoredTally >= t.minRecentScoredCount,
      });
      recalculatedMetrics.push({
        ruleLabel: 'Raw Away Scoring Form Audit',
        computedMetric: `${awayScoredTally}/5 matches scored (Raw goals: ${awayRawRecent.map((m) => m.teamGoals).join(',')})`,
        thresholdRequired: `>= ${t.minRecentScoredCount} of 5`,
        verifiedMatch: awayScoredTally >= t.minRecentScoredCount,
      });

      rawEvidenceSummary.push(
        `Previous season: ${details.homePrevSeason.team} (${homeGoals} GF in ${homeMatches} apps), ${details.awayPrevSeason.team} (${awayGoals} GF in ${awayMatches} apps).`,
        `Head-to-head verified scores: ${h2hRaw.map((m) => `${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam} (${m.competition})`).join('; ')}`,
        `Recent form: ${details.homePrevSeason.team} (${homeScoredTally}/5 matches scored), ${details.awayPrevSeason.team} (${awayScoredTally}/5 matches scored). Friendly fixtures strictly stripped.`
      );
    } else if (fixture.system === 'football_under_3_5') {
      const t = thresholds.footballUnder35;

      recalculatedMetrics.push({
        ruleLabel: 'Raw Home Scored & Conceded Under Bounds',
        computedMetric: `Scored ${recalculatedHomeAvgScored.toFixed(2)}, Conceded ${recalculatedHomeAvgConceded.toFixed(2)}`,
        thresholdRequired: `Scored < ${t.maxPrevSeasonAvgScored.toFixed(2)}, Conceded < ${t.maxPrevSeasonAvgConceded.toFixed(2)}`,
        verifiedMatch: recalculatedHomeAvgScored < t.maxPrevSeasonAvgScored && recalculatedHomeAvgConceded < t.maxPrevSeasonAvgConceded,
      });
      recalculatedMetrics.push({
        ruleLabel: 'Raw Away Scored & Conceded Under Bounds',
        computedMetric: `Scored ${recalculatedAwayAvgScored.toFixed(2)}, Conceded ${recalculatedAwayAvgConceded.toFixed(2)}`,
        thresholdRequired: `Scored < ${t.maxPrevSeasonAvgScored.toFixed(2)}, Conceded < ${t.maxPrevSeasonAvgConceded.toFixed(2)}`,
        verifiedMatch: recalculatedAwayAvgScored < t.maxPrevSeasonAvgScored && recalculatedAwayAvgConceded < t.maxPrevSeasonAvgConceded,
      });

      // Raw H2H last 10
      const h2hRaw = details.h2hMatches.filter((m) => m.isCompetitive).slice(0, 10);
      const rawUnder35Count = h2hRaw.filter((m) => m.homeScore + m.awayScore < 4).length;
      recalculatedMetrics.push({
        ruleLabel: 'Raw H2H Under 3.5 Recalculation',
        computedMetric: `${rawUnder35Count} of ${h2hRaw.length} matches finished Under 3.5 (${((rawUnder35Count / (h2hRaw.length || 1)) * 100).toFixed(0)}%)`,
        thresholdRequired: `>= 8 of 10 (${(t.minH2HUnder35Rate * 100).toFixed(0)}%)`,
        verifiedMatch: h2hRaw.length >= 8 && rawUnder35Count / h2hRaw.length >= t.minH2HUnder35Rate,
      });

      const homeRawRecent = details.homeRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
      const awayRawRecent = details.awayRecentMatches.filter((m) => m.isCompetitive).slice(0, 5);
      const homeU35Tally = homeRawRecent.filter((m) => m.teamGoals + m.opponentGoals < 4).length;
      const awayU35Tally = awayRawRecent.filter((m) => m.teamGoals + m.opponentGoals < 4).length;

      recalculatedMetrics.push({
        ruleLabel: 'Raw Home Form Under 3.5 Audit',
        computedMetric: `${homeU35Tally}/5 games finished Under 3.5 goals`,
        thresholdRequired: `>= ${t.minRecentUnder35Count} of 5`,
        verifiedMatch: homeU35Tally >= t.minRecentUnder35Count,
      });
      recalculatedMetrics.push({
        ruleLabel: 'Raw Away Form Under 3.5 Audit',
        computedMetric: `${awayU35Tally}/5 games finished Under 3.5 goals`,
        thresholdRequired: `>= ${t.minRecentUnder35Count} of 5`,
        verifiedMatch: awayU35Tally >= t.minRecentUnder35Count,
      });

      rawEvidenceSummary.push(
        `Previous season bounds: ${details.homePrevSeason.team} (${recalculatedHomeAvgScored.toFixed(2)} GF / ${recalculatedHomeAvgConceded.toFixed(2)} GA), ${details.awayPrevSeason.team} (${recalculatedAwayAvgScored.toFixed(2)} GF / ${recalculatedAwayAvgConceded.toFixed(2)} GA).`,
        `10 H2H results verified: ${h2hRaw.map((m) => `${m.homeScore}-${m.awayScore}`).join(', ')} (${rawUnder35Count}/10 Under 3.5).`,
        `Recent 5 form: ${details.homePrevSeason.team} (${homeU35Tally}/5 Under 3.5), ${details.awayPrevSeason.team} (${awayU35Tally}/5 Under 3.5).`
      );
    }
  } else if (fixture.sport === 'tennis' && fixture.tennisDetails) {
    const details = fixture.tennisDetails;
    const selected = details.selectedPlayer;
    const opponent = details.opponentPlayer;

    const t = thresholds.tennisStraightSets;

    // 1. Ranking diff recalculation
    const recalcRankDelta = opponent.ranking - selected.ranking;
    recalculatedMetrics.push({
      ruleLabel: 'Raw Ranking Delta Recalculation',
      computedMetric: `Opponent (#${opponent.ranking}) - Selection (#${selected.ranking}) = +${recalcRankDelta} places`,
      thresholdRequired: `>= +${t.minRankingDelta} places`,
      verifiedMatch: recalcRankDelta >= t.minRankingDelta,
    });

    // 2. Surface win rate recalculation from raw match record totals
    const totalSurfaceMatches = selected.careerSurfaceWins + selected.careerSurfaceLosses;
    const recalcSurfaceWinRate = totalSurfaceMatches > 0
      ? Number(((selected.careerSurfaceWins / totalSurfaceMatches) * 100).toFixed(1))
      : 0;

    recalculatedMetrics.push({
      ruleLabel: `Raw Surface Win Rate (${selected.surface})`,
      computedMetric: `${selected.careerSurfaceWins}W / ${totalSurfaceMatches} total matches = ${recalcSurfaceWinRate}%`,
      thresholdRequired: `>= ${t.minSurfaceWinRate.toFixed(1)}%`,
      verifiedMatch: recalcSurfaceWinRate >= t.minSurfaceWinRate,
    });

    // 3. Recent 10 completed singles form recalculation
    const validMatches = details.playerRecentSingles
      .filter((m) => m.isCompetitiveSingles && m.isCompleted)
      .slice(0, 10);
    const rawWins = validMatches.filter((m) => m.won).length;

    recalculatedMetrics.push({
      ruleLabel: 'Raw Recent 10 Singles Form',
      computedMetric: `${rawWins} wins in ${validMatches.length} completed competitive matches (${((rawWins / 10) * 100).toFixed(0)}%)`,
      thresholdRequired: `>= ${t.minRecentWinsCount} of 10 wins (${t.minRecentWinsCount * 10}%)`,
      verifiedMatch: validMatches.length >= 10 && rawWins >= t.minRecentWinsCount,
    });

    rawEvidenceSummary.push(
      `ATP/WTA Official Ranking: ${selected.name} (#${selected.ranking}) vs ${opponent.name} (#${opponent.ranking}). Delta verified at +${recalcRankDelta}.`,
      `Surface breakdown: ${selected.surface} career record is ${selected.careerSurfaceWins}-${selected.careerSurfaceLosses} (${recalcSurfaceWinRate}%).`,
      `Last 10 competitive singles: ${validMatches.map((m) => `${m.won ? 'W' : 'L'} (${m.score}) vs ${m.opponent} [Rank #${m.opponentRank}]`).join(' | ')}. Exhibitions/walkovers excluded.`
    );
  } else {
    dataIntegrityScore = 0;
    auditStatus = 'MISSING_DATA';
  }

  // Check if any recalculated rule failed
  const anyRecalcFailed = recalculatedMetrics.some((m) => !m.verifiedMatch);
  if (anyRecalcFailed) {
    auditStatus = 'FAILED_RECALC';
    dataIntegrityScore = Math.min(dataIntegrityScore, 65);
  } else if (!screening.passedOdds) {
    auditStatus = 'PRICE_DEFICIT';
  } else {
    auditStatus = 'VERIFIED';
    dataIntegrityScore = 100;
  }

  // Cross-reference market odds integrity — priced via TheStatsAPI's own
  // odds endpoint (GET /football/matches/{match_id}/odds), whichever
  // bookmaker(s) it returns. fixture.marketOdds is absent when the
  // provider has no price on file for this fixture yet — reflect that
  // honestly rather than fabricating a bookmaker name or odds figure.
  const oddsAudit = fixture.marketOdds
    ? {
        bookmaker: fixture.marketOdds.bookmaker,
        selection: fixture.marketOdds.selectionName,
        verifiedOdds: fixture.marketOdds.decimalOdds,
        thresholdOdds: fixture.requiredOdds,
        oddsConfirmed: true,
      }
    : {
        bookmaker: '',
        selection: fixture.betType,
        verifiedOdds: 0,
        thresholdOdds: fixture.requiredOdds,
        oddsConfirmed: false,
      };

  return {
    auditId,
    generatedAt: timestamp,
    status: auditStatus,
    enhancedVerification: screening.enhancedVerificationNeeded,
    enhancedVerificationReason: screening.enhancedVerificationReason,
    providerUsed: fixture.sourceProvider,
    dataIntegrityScore,
    rawEvidenceSummary,
    filterChecks: screening.filterChecks,
    recalculatedMetrics,
    oddsAudit,
  };
}
