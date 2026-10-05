import type {
  CandidateFixture,
  TeamRecentMatch,
  VerificationAuditCard,
  RuleThresholds,
} from '../types';
import { evaluateFixture, evaluateH2HOver15 } from './rulesEngine.js';

/** The recent-form filters look at exactly this many competitive matches per team, and need all of them on record. */
const RECENT_FORM_WINDOW = 5;

/**
 * One team's recent-form recount: how many of its matches count, out of how
 * many are actually on record. Like the rules engine, a team with fewer than
 * RECENT_FORM_WINDOW matches on record cannot pass — it has not got a full
 * sample, even if it hit the count in every match it does have.
 */
function recentFormRecount<T extends { isCompetitive: boolean }>(matches: T[], counts: (m: T) => boolean, minCount: number) {
  const window = matches.filter((m) => m.isCompetitive).slice(0, RECENT_FORM_WINDOW);
  const tally = window.filter(counts).length;
  const total = window.length;
  const hasFullWindow = total >= RECENT_FORM_WINDOW;
  return {
    window,
    tally,
    total,
    /** "4/5", or "4 of 3 on record" style text that never pretends a short sample was a full five. */
    ratio: hasFullWindow ? `${tally}/${RECENT_FORM_WINDOW}` : `${tally} of ${total}`,
    note: hasFullWindow ? '' : ` — only ${total} of ${RECENT_FORM_WINDOW} matches on record`,
    passed: hasFullWindow && tally >= minCount,
  };
}

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
 * than a caller-supplied guess.
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
  // Set when a stored average disagrees with the raw goals / matches it was
  // derived from. Kept separate from auditStatus so the final status below
  // cannot silently overwrite it.
  let integrityFailed = false;
  const hasFullEvidence = fixture.sport === 'football' && !!fixture.footballDetails;

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
      integrityFailed = true;
    }

    if (fixture.system === 'football_over_1_5') {
      const t = thresholds.footballOver15;

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
      const h2hOver15 = evaluateH2HOver15(details.h2hMatches, t.minH2HOver15Rate);
      recalculatedMetrics.push({
        ruleLabel: 'Raw H2H Over 1.5 Recalculation',
        computedMetric: `${h2hOver15.over15} of ${h2hOver15.considered} matches finished Over 1.5 (${h2hOver15.ratePercent}%)`,
        thresholdRequired: `>= ${h2hOver15.required} of 5 (${(t.minH2HOver15Rate * 100).toFixed(0)}%), 5 meetings required`,
        verifiedMatch: h2hOver15.passed,
      });

      // 3. Raw itemized recalculation of last 5 competitive form games
      const homeForm = recentFormRecount(details.homeRecentMatches, (m) => m.teamGoals > 0, t.minRecentScoredCount);
      const awayForm = recentFormRecount(details.awayRecentMatches, (m) => m.teamGoals > 0, t.minRecentScoredCount);

      recalculatedMetrics.push({
        ruleLabel: 'Raw Home Scoring Form Audit',
        computedMetric: `${homeForm.ratio} matches scored${homeForm.note} (Raw goals: ${homeForm.window.map((m) => m.teamGoals).join(',')})`,
        thresholdRequired: `>= ${t.minRecentScoredCount} of ${RECENT_FORM_WINDOW}, and ${RECENT_FORM_WINDOW} matches on record`,
        verifiedMatch: homeForm.passed,
      });
      recalculatedMetrics.push({
        ruleLabel: 'Raw Away Scoring Form Audit',
        computedMetric: `${awayForm.ratio} matches scored${awayForm.note} (Raw goals: ${awayForm.window.map((m) => m.teamGoals).join(',')})`,
        thresholdRequired: `>= ${t.minRecentScoredCount} of ${RECENT_FORM_WINDOW}, and ${RECENT_FORM_WINDOW} matches on record`,
        verifiedMatch: awayForm.passed,
      });

      rawEvidenceSummary.push(
        `Previous season: ${details.homePrevSeason.team} (${homeGoals} GF in ${homeMatches} apps), ${details.awayPrevSeason.team} (${awayGoals} GF in ${awayMatches} apps).`,
        `Head-to-head verified scores: ${h2hRaw.map((m) => `${m.homeTeam} ${m.homeScore}-${m.awayScore} ${m.awayTeam} (${m.competition})`).join('; ')}`,
        `Recent form: ${details.homePrevSeason.team} (${homeForm.ratio} matches scored${homeForm.note}), ${details.awayPrevSeason.team} (${awayForm.ratio} matches scored${awayForm.note}). TheStatsAPI does not label friendlies, so none are stripped.`
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

      const isUnder35 = (m: TeamRecentMatch) => m.teamGoals + m.opponentGoals < 4;
      const homeForm = recentFormRecount(details.homeRecentMatches, isUnder35, t.minRecentUnder35Count);
      const awayForm = recentFormRecount(details.awayRecentMatches, isUnder35, t.minRecentUnder35Count);

      recalculatedMetrics.push({
        ruleLabel: 'Raw Home Form Under 3.5 Audit',
        computedMetric: `${homeForm.ratio} games finished Under 3.5 goals${homeForm.note}`,
        thresholdRequired: `>= ${t.minRecentUnder35Count} of ${RECENT_FORM_WINDOW}, and ${RECENT_FORM_WINDOW} matches on record`,
        verifiedMatch: homeForm.passed,
      });
      recalculatedMetrics.push({
        ruleLabel: 'Raw Away Form Under 3.5 Audit',
        computedMetric: `${awayForm.ratio} games finished Under 3.5 goals${awayForm.note}`,
        thresholdRequired: `>= ${t.minRecentUnder35Count} of ${RECENT_FORM_WINDOW}, and ${RECENT_FORM_WINDOW} matches on record`,
        verifiedMatch: awayForm.passed,
      });

      rawEvidenceSummary.push(
        `Previous season bounds: ${details.homePrevSeason.team} (${recalculatedHomeAvgScored.toFixed(2)} GF / ${recalculatedHomeAvgConceded.toFixed(2)} GA), ${details.awayPrevSeason.team} (${recalculatedAwayAvgScored.toFixed(2)} GF / ${recalculatedAwayAvgConceded.toFixed(2)} GA).`,
        `10 H2H results verified: ${h2hRaw.map((m) => `${m.homeScore}-${m.awayScore}`).join(', ')} (${rawUnder35Count}/10 Under 3.5).`,
        `Recent 5 form: ${details.homePrevSeason.team} (${homeForm.ratio} Under 3.5${homeForm.note}), ${details.awayPrevSeason.team} (${awayForm.ratio} Under 3.5${awayForm.note}).`
      );
    }
  }

  // Final status, in strict order. PRICE_DEFICIT (what Price Watch reads) is
  // only reachable once every statistical filter has passed — the rules
  // engine's own verdict (screening.passedStats) is part of the gate, because
  // this audit's raw recalculation is not a stand-in for it (e.g. it does not
  // require five recent matches on record). Missing evidence stays
  // MISSING_DATA instead of being overwritten by a price-only verdict.
  const anyRecalcFailed = recalculatedMetrics.some((m) => !m.verifiedMatch);
  if (!hasFullEvidence) {
    auditStatus = 'MISSING_DATA';
    dataIntegrityScore = 0;
  } else if (integrityFailed || anyRecalcFailed || !screening.passedStats) {
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
