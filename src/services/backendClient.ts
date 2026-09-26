/**
 * Shared helper for calling our own backend (server/index.ts), which proxies
 * to the real TheStatsAPI.com API server-to-server. The provider key
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
// "Starting Server..." placeholder page instead of a real response. This has
// been observed taking well over 10 seconds in practice, so a handful of
// quick retries isn't enough — back off with increasing delays and allow up
// to roughly a minute of total patience before giving up.
const MAX_STARTING_SERVER_RETRIES = 10;
const STARTING_SERVER_RETRY_BASE_MS = 1500;
const STARTING_SERVER_RETRY_MAX_MS = 6000;

function startingServerRetryDelay(attempt: number): number {
  return Math.min(STARTING_SERVER_RETRY_BASE_MS * (attempt + 1), STARTING_SERVER_RETRY_MAX_MS);
}

function looksLikeStartingServerPage(text: string): boolean {
  return /<title>\s*starting server/i.test(text);
}

function looksLikeHtml(text: string): boolean {
  return /^\s*<(!doctype html|html)/i.test(text);
}

// Every path this client ever requests is a real route registered in
// server/index.ts, and our own handleError (see server/index.ts) only ever
// answers with 502 or 500 — never 404 — so this exact 404 body can only come
// from something in front of our Express app (the dev/preview host's own
// proxy). It was first assumed to be the same transient "still starting"
// race the HTML placeholder page (below) recovers from, and retried with
// that same ~48s budget — but observed evidence for the odds endpoint
// specifically showed all 10 retries failing identically for the same
// match id, never once recovering. That means it isn't a startup race for
// this route, and burning the full budget on it was pure wasted time during
// enrichment. One quick, cheap retry (in case it's ever a genuine one-off
// blip) is all this gets before failing fast.
const MAX_PROXY_404_RETRIES = 1;
const PROXY_404_RETRY_DELAY_MS = 400;

function looksLikeTransientProxy404(status: number, body: any): boolean {
  return status === 404 && body?.error === 'API route not found';
}

async function performApiGet(path: string, providerKey: string, signal?: AbortSignal): Promise<any> {
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
      if (!parseFailed && looksLikeTransientProxy404(response.status, body) && attempt < MAX_PROXY_404_RETRIES) {
        console.warn(
          `[api] ⧗ proxy 404 for ${path} — retrying once in ${PROXY_404_RETRY_DELAY_MS}ms before giving up (this route doesn't recover from repeated retries)`
        );
        await sleep(PROXY_404_RETRY_DELAY_MS, signal);
        continue;
      }
      console.error(`[api] ✗ ${response.status} for ${path}:`, parseFailed ? rawText.slice(0, 300) : body);
      throw new Error(
        looksLikeTransientProxy404(response.status, body)
          ? `${path} — the hosting proxy doesn't route this endpoint right now (not a backend startup issue — retrying further wouldn't help).`
          : body?.error || `Request to ${path} failed with status ${response.status}`
      );
    }

    if (parseFailed) {
      if (looksLikeStartingServerPage(rawText) && attempt < MAX_STARTING_SERVER_RETRIES) {
        const wait = startingServerRetryDelay(attempt);
        console.warn(
          `[api] ⧗ backend still starting for ${path} — retrying in ${wait}ms (attempt ${attempt + 1}/${MAX_STARTING_SERVER_RETRIES})`
        );
        await sleep(wait, signal);
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

// Different call sites can legitimately want the exact same data at the
// same time — e.g. the app's own fixture load and Settings' "Live Data Feed
// Impact" preview both requesting today's football fixtures on mount. Left
// alone, that doubles real load against a rate-limited (or still-booting)
// backend for no benefit, since the answer is identical either way. The
// first caller for a given (path, key) becomes the "owner" of the real
// fetch; later callers for the same in-flight request just await its
// result — and can still bail out early via their own AbortSignal without
// disturbing the owner's request.
const inFlight = new Map<string, Promise<any>>();

export function apiGet(path: string, providerKey: string, signal?: AbortSignal): Promise<any> {
  const key = `${path}::${providerKey}`;
  const existing = inFlight.get(key);

  if (!existing) {
    const owned = performApiGet(path, providerKey, signal);
    inFlight.set(key, owned);
    // .finally() returns its own derived promise — if left unassigned, that
    // promise rejects right along with `owned` (e.g. on an abort) with
    // nothing ever observing it, which the console flags as a second
    // "Uncaught (in promise)" alongside the real one. Chaining a no-op
    // .catch() onto it (not onto `owned` itself) silences that specific
    // orphan without affecting the real rejection any caller receives from
    // `owned`.
    owned
      .finally(() => {
        if (inFlight.get(key) === owned) inFlight.delete(key);
      })
      .catch(() => {});
    // Callers commonly Promise.all() three of these together (team, team,
    // h2h) — if two reject, only one becomes the Promise.all rejection the
    // caller actually catches, and the other is otherwise left unobserved,
    // which the console flags as "Uncaught (in promise)" even though
    // nothing is actually broken. This no-op catch marks it handled without
    // affecting the real rejection any caller receives from `owned` itself.
    owned.catch(() => {});
    return owned;
  }

  console.log(`[api] ⇄ reusing in-flight request for ${path}`);
  if (!signal) return existing;

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    existing.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}
