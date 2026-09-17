/**
 * Shared helper for calling our own backend (server/index.ts), which proxies
 * to the real Sportradar/Sportmonks APIs server-to-server. The provider key
 * itself lives only in this browser's localStorage (via storage.ts) and is
 * sent per-request as a header — it never reaches a third-party origin
 * directly from the browser.
 */
export async function apiGet(path: string, providerKey: string): Promise<any> {
  console.log(`[api] → GET ${path}`);

  let response: Response;
  try {
    response = await fetch(path, { headers: { 'x-provider-key': providerKey } });
  } catch (err) {
    console.error(`[api] ✗ network error for ${path}:`, err);
    throw new Error(
      `Could not reach the backend at ${path}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const rawText = await response.text();
  let body: any = null;
  let parseFailed = false;
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      parseFailed = true;
    }
  }

  if (!response.ok) {
    console.error(`[api] ✗ ${response.status} for ${path}:`, parseFailed ? rawText.slice(0, 300) : body);
    throw new Error(body?.error || `Request to ${path} failed with status ${response.status}`);
  }

  if (parseFailed) {
    // A 200 with a non-JSON body almost always means there's no real API
    // server answering this path — e.g. a dev/preview host that falls back
    // to serving the SPA's index.html for every unmatched route. Surface
    // this honestly instead of silently treating it as "0 records", which
    // has no visible cause anywhere in the UI.
    const looksLikeHtml = /^\s*<(!doctype html|html)/i.test(rawText);
    console.error(`[api] ✗ non-JSON response for ${path}:`, rawText.slice(0, 300));
    throw new Error(
      looksLikeHtml
        ? `${path} returned an HTML page instead of JSON — the backend API server (server/index.ts) doesn't appear to be running behind this URL.`
        : `${path} returned a response that could not be parsed as JSON.`
    );
  }

  console.log(`[api] ← ${response.status} for ${path}:`, body);
  return body;
}
