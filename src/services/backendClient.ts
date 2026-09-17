/**
 * Shared helper for calling our own backend (server/index.ts), which proxies
 * to the real Sportradar/Sportmonks APIs server-to-server. The provider key
 * itself lives only in this browser's localStorage (via storage.ts) and is
 * sent per-request as a header — it never reaches a third-party origin
 * directly from the browser.
 */

/** Rejects with an AbortError immediately if the signal fires during the wait, so a user-requested stop is never stuck behind a retry backoff. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

// Some dev/preview hosts (e.g. an AI Studio container whose backend process
// is still booting or has just restarted) answer every path with a 200
// "Starting Server..." placeholder page instead of a real response, for a
// few seconds at a time. That's transient — worth a few short retries
// before treating it as "no backend here at all".
const MAX_STARTING_SERVER_RETRIES = 5;
const STARTING_SERVER_RETRY_DELAY_MS = 1500;

function looksLikeStartingServerPage(text: string): boolean {
  return /<title>\s*starting server/i.test(text);
}

function looksLikeHtml(text: string): boolean {
  return /^\s*<(!doctype html|html)/i.test(text);
}

export async function apiGet(path: string, providerKey: string, signal?: AbortSignal): Promise<any> {
  for (let attempt = 0; attempt <= MAX_STARTING_SERVER_RETRIES; attempt++) {
    console.log(`[api] → GET ${path}`);

    let response: Response;
    try {
      response = await fetch(path, { headers: { 'x-provider-key': providerKey }, signal });
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.log(`[api] ⏹ cancelled ${path}`);
        throw err;
      }
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
      if (looksLikeStartingServerPage(rawText) && attempt < MAX_STARTING_SERVER_RETRIES) {
        console.warn(
          `[api] ⧗ backend still starting for ${path} — retrying in ${STARTING_SERVER_RETRY_DELAY_MS}ms (attempt ${attempt + 1}/${MAX_STARTING_SERVER_RETRIES})`
        );
        await sleep(STARTING_SERVER_RETRY_DELAY_MS, signal);
        continue;
      }

      // A 200 with a non-JSON body almost always means there's no real API
      // server answering this path — e.g. a dev/preview host that falls back
      // to serving a placeholder or the SPA's index.html for every unmatched
      // route. Surface this honestly instead of silently treating it as
      // "0 records", which has no visible cause anywhere in the UI.
      console.error(`[api] ✗ non-JSON response for ${path}:`, rawText.slice(0, 300));
      throw new Error(
        looksLikeStartingServerPage(rawText)
          ? `${path} — the backend API server is still starting and didn't come up after ${MAX_STARTING_SERVER_RETRIES} retries. Try running the scan again shortly.`
          : looksLikeHtml(rawText)
          ? `${path} returned an HTML page instead of JSON — the backend API server (server/index.ts) doesn't appear to be running behind this URL.`
          : `${path} returned a response that could not be parsed as JSON.`
      );
    }

    console.log(`[api] ← ${response.status} for ${path}:`, body);
    return body;
  }

  // Unreachable — the loop above always returns or throws.
  throw new Error(`${path}: exhausted retries waiting for the backend to start.`);
}
