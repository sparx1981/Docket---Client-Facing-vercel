import type { CandidateFixture, SyncLogRecord } from '../../src/types';
import { escapeHtml, htmlTable } from '../email.js';

const MAX_ROWS = 50;

/** Where the "Open Docket" button points. Override with the APP_URL environment variable. */
const APP_URL = process.env.APP_URL || 'https://docket-client-facing.vercel.app';

const openAppButton = () =>
  `<p style="margin:16px 0;"><a href="${escapeHtml(APP_URL)}" style="display:inline-block;padding:10px 18px;background:#107a4f;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:bold;font-family:Arial,sans-serif;font-size:14px;">Open Docket</a></p>`;

/**
 * Builds the daily-scan notification email (subject + HTML table markup):
 * an "Open Docket" button, a short scan summary, and the verified
 * qualifiers. Price Watch is deliberately not part of the email — it stays
 * in the app.
 */
export function buildScanEmail(
  log: SyncLogRecord,
  qualifiers: CandidateFixture[],
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
      ['Verified qualifiers', qualifiers.length],
      ['Status', log.status],
    ]
  );

  const rows = qualifiers.slice(0, MAX_ROWS).map((f) => [
    f.matchTitle,
    f.competition,
    f.matchTime.slice(0, 16).replace('T', ' '),
    f.betType,
    f.marketOdds ? f.marketOdds.decimalOdds.toFixed(2) : 'No price yet',
  ]);
  const more = qualifiers.length > MAX_ROWS ? `<p>…and ${qualifiers.length - MAX_ROWS} more in the app.</p>` : '';

  const parts: string[] = [];
  if (backupNote) parts.push(`<p><strong>Backup run:</strong> ${escapeHtml(backupNote)}</p>`);
  parts.push(openAppButton());
  parts.push(summary);
  parts.push(
    qualifiers.length > 0
      ? `<h3>Verified qualifiers</h3>${htmlTable(['Match', 'Competition', 'Kick-off (UTC)', 'Market', 'Odds'], rows)}${more}`
      : '<p>No fixtures cleared every filter and the price requirement in this scan.</p>'
  );
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

  const usedRealScan = !!latestLog && Array.isArray(fixtures);
  const now = new Date().toISOString();
  const qualifiers = usedRealScan ? fixtures!.filter(isQualifier) : [SAMPLE_FIXTURE('Sample FC v Example United', 'Sample League', 1.28)];
  const log: SyncLogRecord = usedRealScan
    ? latestLog!
    : ({
        timestamp: now,
        totalRecordsScanned: 0,
        qualifiersCount: qualifiers.length,
        rejectedCount: 0,
        status: 'SUCCEEDED',
        notes: '',
      } as unknown as SyncLogRecord);

  const built = buildScanEmail(log, qualifiers);
  const banner =
    `<p style="padding:8px 12px;background:#fff7e0;border:1px solid #f0d58a;"><strong>This is a TEST of the daily scan email.</strong> ` +
    (usedRealScan
      ? `It uses the results of your most recent scan (${escapeHtml(log.timestamp.slice(0, 16).replace('T', ' '))} UTC), laid out exactly like the real email.`
      : 'No scan has run yet, so the matches below are made-up sample rows, laid out exactly like the real email.') +
    ` Requested by ${escapeHtml(requestedBy)}.</p>`;

  return { subject: `[TEST] ${built.subject}`, html: banner + built.html, usedRealScan };
}
