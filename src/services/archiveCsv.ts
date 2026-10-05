import type { HistoricalBetRecord } from '../types';

const csvCell = (value: string | number | undefined): string => {
  const str = value === undefined || value === null ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

/**
 * The Archive log as CSV text. One definition shared by the Archive page's
 * "Export CSV" button and the "Reset data" screen's "download your Archive
 * first" option, so both produce exactly the same file.
 */
export function buildArchiveCsv(bets: HistoricalBetRecord[]): string {
  const headers = [
    'Date',
    'Match',
    'Competition',
    'System',
    'Selection',
    'Odds Taken',
    'Stake',
    'Outcome',
    'Final Score',
    'P&L',
    'ROI %',
    'Settled At',
    'Audit ID',
    'Data Source',
    'Notes',
  ];
  const rows = bets.map((b) => [
    csvCell(b.date),
    csvCell(b.match),
    csvCell(b.competition),
    csvCell(b.system),
    csvCell(b.selection),
    csvCell(b.oddsTaken),
    csvCell(b.stake),
    csvCell(b.outcome),
    csvCell(b.finalScore),
    csvCell(b.pnl),
    csvCell(b.roiContribution),
    csvCell(b.settledAt),
    csvCell(b.auditId),
    csvCell(b.dataSourceName),
    csvCell(b.notes),
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}
