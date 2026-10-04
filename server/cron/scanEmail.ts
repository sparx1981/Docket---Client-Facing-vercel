import type { CandidateFixture, SyncLogRecord } from '../../src/types';
import { escapeHtml, htmlTable } from '../email.js';

const MAX_ROWS = 50;

/** Builds the daily-scan notification email (subject + HTML table markup). */
export function buildScanEmail(
  log: SyncLogRecord,
  qualifiers: CandidateFixture[],
  priceWatch: CandidateFixture[],
  backupNote?: string
): { subject: string; html: string } {
  const day = log.timestamp.slice(0, 10);
  const subject =
    qualifiers.length > 0
      ? `Docket: ${qualifiers.length} verified qualifier${qualifiers.length === 1 ? '' : 's'} — ${day}`
      : `Docket: no verified qualifiers — ${day}`;

  const summary = htmlTable(
    ['Scan summary', ''],
    [
      ['Run at (UTC)', log.timestamp.slice(0, 16).replace('T', ' ')],
      ['Matches scanned', log.totalRecordsScanned],
      ['Verified qualifiers', log.qualifiersCount],
      ['Price Watch', log.priceWatchCount],
      ['Did not qualify / not enough data', log.rejectedCount],
      ['Status', log.status],
    ]
  );

  const rows = (list: CandidateFixture[]) =>
    list.slice(0, MAX_ROWS).map((f) => [
      f.matchTitle,
      f.competition,
      f.matchTime.slice(0, 16).replace('T', ' '),
      f.betType,
      f.marketOdds ? f.marketOdds.decimalOdds.toFixed(2) : 'No price yet',
    ]);
  const headers = ['Match', 'Competition', 'Kick-off (UTC)', 'Market', 'Odds'];
  const more = (n: number) => (n > MAX_ROWS ? `<p>…and ${n - MAX_ROWS} more in the app.</p>` : '');

  const parts: string[] = [];
  if (backupNote) parts.push(`<p><strong>Backup run:</strong> ${escapeHtml(backupNote)}</p>`);
  parts.push(summary);
  parts.push(
    qualifiers.length > 0
      ? `<h3>Verified qualifiers</h3>${htmlTable(headers, rows(qualifiers))}${more(qualifiers.length)}`
      : '<p>No fixtures cleared every filter and the price requirement in this scan.</p>'
  );
  if (priceWatch.length > 0) {
    parts.push(`<h3>Price Watch (passed every statistical filter, waiting on price)</h3>${htmlTable(headers, rows(priceWatch))}${more(priceWatch.length)}`);
  }
  if (log.status !== 'SUCCEEDED') {
    parts.push(`<p><strong>Note:</strong> ${escapeHtml(log.notes)}</p>`);
  }
  return { subject, html: parts.join('\n') };
}
