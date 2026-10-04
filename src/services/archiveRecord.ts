import type { CandidateFixture, HistoricalBetRecord, VerificationAuditCard } from '../types';

/**
 * Builds the Archive ledger entry for a verified qualifier. Pure (no
 * storage access) so the browser's auto-archive and the server-side daily
 * scan cron produce identical records.
 */
export function buildHistoricalBetFromQualifier(
  fixture: CandidateFixture,
  auditCard: VerificationAuditCard,
  stake: number = 100
): HistoricalBetRecord {
  return {
    id: `HIST-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`,
    date: new Date().toISOString().split('T')[0],
    fixtureId: fixture.id,
    sport: fixture.sport,
    system: fixture.system,
    match: fixture.matchTitle,
    competition: fixture.competition,
    selection: fixture.betType,
    // Fall back to the system's disclosed minimum qualifying price rather
    // than a fabricated figure when no real market price has been attached
    // yet (TheStatsAPI has no odds on file for this fixture).
    oddsTaken: fixture.marketOdds?.decimalOdds ?? fixture.requiredOdds,
    stake,
    outcome: 'PENDING',
    pnl: 0,
    roiContribution: 0,
    auditId: auditCard.auditId,
    notes: `Logged automatically from Daily Scan. Audit integrity: ${auditCard.dataIntegrityScore}%.`,
    googleVerificationUrl:
      fixture.googleVerificationUrl ||
      `https://www.google.com/search?q=${encodeURIComponent(
        `${fixture.matchTitle} ${fixture.competition} ${fixture.betType} result score`
      )}`,
    flashscoreUrl: `https://www.flashscore.com/search/?q=${encodeURIComponent(fixture.matchTitle)}`,
    dataSourceName: 'Flashscore Telemetry',
  };
}
