import { ProviderError } from './errors';

/**
 * Thin fetch wrapper shared by every provider client. Builds a URL with
 * query params, performs the request server-side (so CORS never applies and
 * the caller's key never touches a third-party origin from the browser), and
 * raises a ProviderError with the upstream status/message on any non-2xx
 * response or network/parse failure — callers must never invent a 200 with
 * placeholder data on top of this.
 */
export async function fetchJson(
  provider: string,
  url: string,
  params: Record<string, string | undefined>
): Promise<any> {
  const fullUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      fullUrl.searchParams.set(key, value);
    }
  }

  let response: Response;
  try {
    response = await fetch(fullUrl.toString(), {
      headers: { Accept: 'application/json' },
    });
  } catch (err) {
    throw new ProviderError(
      provider,
      0,
      `Network error contacting ${provider}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const text = await response.text();

  if (!response.ok) {
    // Providers typically return a small JSON or plain-text error body.
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed?.message || parsed?.error || text;
    } catch {
      // keep raw text
    }
    throw new ProviderError(
      provider,
      response.status,
      `${provider} request failed: ${response.status} ${response.statusText}${
        detail ? ` — ${detail.slice(0, 300)}` : ''
      }`
    );
  }

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new ProviderError(
      provider,
      response.status,
      `${provider} returned a response that could not be parsed as JSON`
    );
  }
}
