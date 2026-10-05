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

const SAMPLE_FIXTURE = (title: string, competition: string, odds?: number): CandidateFixture =>
  ({
    matchTitle: title,
    competition,
    matchTime: new Date(Date.now() + 26 * 3_600_000).toISOString(),
    betType: 'Over 1.5 Goals',
    marketOdds: odds ? { decimalOdds: odds } : undefined,
  }) as unknown as CandidateFixture;

/**
 * The "Send test email" message: the real daily-scan email, built by the very
 * same buildScanEmail, from the user's most recent scan when there is one
 * (otherwise clearly-labelled sample rows), with a banner saying it is a test.
 */
export function buildTestScanEmail(input: {
  latestLog?: SyncLogRecord;
  fixtures?: CandidateFixture[];
  requestedBy: string;
}): { subject: string; html: string; usedRealScan: boolean } {
  const { latestLog, fixtures, requestedBy } = input;
  const isQualifier = (f: CandidateFixture) => f.status === 'VERIFIED_QUALIFIER' && f.verificationCard?.status === 'VERIFIED';
  const isPriceWatch = (f: CandidateFixture) => f.status === 'PRICE_WATCH' || f.verificationCard?.status === 'PRICE_DEFICIT';

  const usedRealScan = !!latestLog && Array.isArray(fixtures);
  const now = new Date().toISOString();
  const qualifiers = usedRealScan ? fixtures!.filter(isQualifier) : [SAMPLE_FIXTURE('Sample FC v Example United', 'Sample League', 1.28)];
  const priceWatch = usedRealScan
    ? fixtures!.filter((f) => !isQualifier(f) && isPriceWatch(f))
    : [SAMPLE_FIXTURE('Demo Town v Placeholder Rovers', 'Sample League')];
  const log: SyncLogRecord = usedRealScan
    ? latestLog!
    : ({
        timestamp: now,
        totalRecordsScanned: 0,
        qualifiersCount: qualifiers.length,
        priceWatchCount: priceWatch.length,
        rejectedCount: 0,
        status: 'SUCCEEDED',
        notes: '',
      } as unknown as SyncLogRecord);

  const built = buildScanEmail(log, qualifiers, priceWatch);
  const banner =
    `<p style="padding:8px 12px;background:#fff7e0;border:1px solid #f0d58a;"><strong>This is a TEST of the daily scan email.</strong> ` +
    (usedRealScan
      ? `It uses the results of your most recent scan (${escapeHtml(log.timestamp.slice(0, 16).replace('T', ' '))} UTC), laid out exactly like the real email.`
      : 'No scan has run yet, so the matches below are made-up sample rows, laid out exactly like the real email.') +
    ` Requested by ${escapeHtml(requestedBy)}.</p>`;

  return { subject: `[TEST] ${built.subject}`, html: banner + built.html, usedRealScan };
}
