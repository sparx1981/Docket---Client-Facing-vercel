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
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    console.error(`[api] ✗ ${response.status} for ${path}:`, body);
    throw new Error(body?.error || `Request to ${path} failed with status ${response.status}`);
  }
  console.log(`[api] ← ${response.status} for ${path}:`, body);
  return body;
}
