import { getCurrentIdToken } from './firebase';

export interface TestEmailResult {
  ok: boolean;
  message: string;
}

/** Asks our backend to send a test email through the notification email endpoint. */
export async function sendTestEmail(): Promise<TestEmailResult> {
  const token = await getCurrentIdToken();
  if (!token) return { ok: false, message: 'Sign in first — test emails can only be sent by a signed-in user.' };

  try {
    const response = await fetch('/api/notifications/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => null);
    if (response.ok) {
      const reply = body?.serviceReply ? `“${body.serviceReply}”` : 'an empty reply';
      const caution = body?.looksLikeWebPage
        ? ' That looks like a web page, not a confirmation, so the email service may be blocking or rejecting the request.'
        : '';
      return {
        ok: true,
        message: `The request was accepted (HTTP ${body?.serviceStatus ?? response.status}). The email service replied with ${reply}.${caution} Check your inbox and spam folder; if nothing arrives within a few minutes, the problem is in the email service, not in Docket.`,
      };
    }
    return { ok: false, message: body?.error || `The test email failed (status ${response.status}).` };
  } catch (err) {
    return { ok: false, message: `Could not reach the backend: ${err instanceof Error ? err.message : String(err)}` };
  }
}
