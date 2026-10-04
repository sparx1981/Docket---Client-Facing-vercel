import { ProviderError } from './errors.js';

/**
 * Sends a notification email through the project's own email endpoint
 * (default https://www.reps.co.uk/docket/). The endpoint accepts two POST
 * variables — `subject` and `data` (an HTML table / markup) — injects the
 * data into its template and sends it. It has no recipient field: who
 * receives it is decided by the endpoint's template, not by this app.
 */
const DEFAULT_ENDPOINT = 'https://www.reps.co.uk/docket/';
const TIMEOUT_MS = 20_000;

export async function sendNotificationEmail(subject: string, html: string): Promise<void> {
  const endpoint = process.env.EMAIL_ENDPOINT_URL || DEFAULT_ENDPOINT;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ subject, data: html }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new ProviderError('email', 0, `Could not reach the email endpoint (${reason}).`);
  }

  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 200);
    throw new ProviderError('email', response.status, `The email endpoint answered ${response.status}${body ? `: ${body}` : '.'}`);
  }
}

export const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A simple, email-client-safe HTML table (inline styles only). */
export function htmlTable(headers: string[], rows: (string | number)[][]): string {
  const th = headers
    .map((h) => `<th align="left" style="padding:6px 10px;border:1px solid #d0d5dd;background:#f2f4f7;">${escapeHtml(h)}</th>`)
    .join('');
  const body = rows
    .map(
      (r) =>
        `<tr>${r.map((c) => `<td style="padding:6px 10px;border:1px solid #d0d5dd;">${escapeHtml(c)}</td>`).join('')}</tr>`
    )
    .join('');
  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;"><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}
