import { ProviderError } from './errors.js';

/**
 * Thin fetch wrapper shared by every provider client. Builds a URL with
 * query params, performs the request server-side (so CORS never applies and
 * the caller's key never touches a third-party origin from the browser), and
 * raises a ProviderError with the upstream status/message on any non-2xx
 * response or network/parse failure — callers must never invent a 200 with
 * placeholder data on top of this.
 *
 * Rate-limiting protection: every provider client funnels through this one
 * function, so a single per-provider throttle here — plus a bounded
 * retry-with-backoff on 429 — covers all of them without each provider file
 * needing its own logic. When a call still fails after retries, the
 * caller's existing try/catch (see dataFeed.ts's per-fixture enrichment,
 * and the routes' handleError) is the graceful fallback: leave that one
 * piece of data missing rather than taking the whole feed down.
 *
 * TheStatsAPI.com (the only provider left after the Sportradar/Sportmonks
 * migration) exposes its real per-minute burst and monthly quota via
 * X-RateLimit and X-Monthly-Quota response headers rather than one
 * documented constant, so the default pace below is a conservative
 * starting point — the 429 handling further down (which respects
 * Retry-After) is what actually keeps a scan inside the account's limits.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Never let a provider API key reach the console — redact it before logging a URL. */
function redactUrl(url: URL): string {
  const redacted = new URL(url.toString());
  for (const key of ['api_key', 'api_token']) {
    if (redacted.searchParams.has(key)) redacted.searchParams.set(key, '***');
  }
  return redacted.toString();
}

/** Minimum gap between the *start* of consecutive requests to a given provider. */
function minIntervalMs(provider: string): number {
  const normalized = provider.toLowerCase();
  if (normalized.includes('thestatsapi')) {
    // TheStatsAPI exposes its real per-minute burst limit via
    // X-RateLimit-* response headers (see fetchJson's 429 handling below,
    // which already respects Retry-After) rather than a single documented
    // constant — this default is a conservative starting pace, not a
    // measured ceiling.
    const fromEnv = Number(process.env.THESTATSAPI_MIN_INTERVAL_MS);
    return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 300;
  }
  // Unknown provider — fall back to the conservative 1 req/sec default.
  return 1100;
}

/**
 * Serializes calls per provider and spaces them out by minIntervalMs, so
 * concurrent enrichment calls (team profiles, H2H, player stats, fetched via
 * Promise.all per fixture) never fire in a burst that trips the upstream
 * limit in the first place.
 */
class ProviderThrottle {
  private tail: Promise<void> = Promise.resolve();
  private lastStart = 0;

  constructor(private readonly minGapMs: number) {}

  acquire(): Promise<void> {
    const turn = this.tail.then(async () => {
      const wait = this.minGapMs - (Date.now() - this.lastStart);
      if (wait > 0) await sleep(wait);
      this.lastStart = Date.now();
    });
    // Swallow so one failed turn never wedges the queue for later callers.
    this.tail = turn.catch(() => undefined);
    return turn;
  }
}

const throttles = new Map<string, ProviderThrottle>();

function throttleFor(provider: string): ProviderThrottle {
  let t = throttles.get(provider);
  if (!t) {
    t = new ProviderThrottle(minIntervalMs(provider));
    throttles.set(provider, t);
  }
  return t;
}

const MAX_RATE_LIMIT_RETRIES = 4;

// A 429 that still fails after every retry, with no Retry-After header,
// almost always means the account's real quota (not just a per-second
// pace) is exhausted — the quota state doesn't change second to second, so
// retrying the *next* call the same way just pays another ~8s of backoff
// to learn the same thing again. Once we've confirmed that for a provider,
// skip the retry dance on later calls for a short cooldown — still make
// the one real attempt (in case it already recovered), just fail fast
// instead of re-proving it's still down.
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;
const recentlyExhausted = new Map<string, number>();

/** Parses a Retry-After header (seconds, or an HTTP date) into a millisecond delay. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const asSeconds = Number(header);
  if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds * 1000);
  const asDate = Date.parse(header);
  if (!Number.isNaN(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

function backoffMs(attempt: number): number {
  // 500ms, 1s, 2s, 4s… plus jitter, capped, so simultaneous retries don't sync up.
  const base = Math.min(500 * 2 ** attempt, 8000);
  return base + Math.random() * 250;
}

export async function fetchJson(
  provider: string,
  url: string,
  params: Record<string, string | undefined>,
  options?: {
    headers?: Record<string, string>;
    /** Fired once, right when a 429 retry-wait begins, with a plain-English status line a caller can surface to the user instead of leaving them staring at a silent delay. */
    onRetryNotice?: (message: string) => void;
  }
): Promise<any> {
  const fullUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      fullUrl.searchParams.set(key, value);
    }
  }

  const throttle = throttleFor(provider);
  let lastRateLimitError: ProviderError | undefined;
  const loggedUrl = redactUrl(fullUrl);

  const breakerTrippedAt = recentlyExhausted.get(provider);
  const circuitOpen = breakerTrippedAt !== undefined && Date.now() - breakerTrippedAt < CIRCUIT_BREAKER_COOLDOWN_MS;
  const maxRetries = circuitOpen ? 0 : MAX_RATE_LIMIT_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await throttle.acquire();

    console.log(
      `[api] → ${provider} GET ${loggedUrl}${circuitOpen ? ' (skipping retries — provider still rate-limited from a recent call)' : ''}`
    );

    let response: Response;
    try {
      response = await fetch(fullUrl.toString(), {
        headers: { Accept: 'application/json', ...options?.headers },
      });
    } catch (err) {
      console.error(`[api] ✗ ${provider} network error for ${loggedUrl}:`, err);
      throw new ProviderError(
        provider,
        0,
        `Network error contacting ${provider}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (response.status === 429 && attempt < maxRetries) {
      const wait = retryAfterMs(response.headers.get('Retry-After')) ?? backoffMs(attempt);
      console.warn(`[api] ⧗ ${provider} 429 for ${loggedUrl} — retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${maxRetries})`);
      const waitLabel = wait >= 1000 ? `${Math.round(wait / 1000)}s` : `${Math.round(wait)}ms`;
      options?.onRetryNotice?.(
        `${provider}'s rate limit was reached — waiting ${waitLabel} before automatically retrying. Still running, not stuck.`
      );
      lastRateLimitError = new ProviderError(
        provider,
        429,
        `${provider} rate limit hit — retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${maxRetries})`
      );
      await sleep(wait);
      continue;
    }

    if (response.status === 429) {
      recentlyExhausted.set(provider, Date.now());
    } else if (recentlyExhausted.has(provider)) {
      // A non-429 response means the provider recovered — stop skipping
      // retries for it.
      recentlyExhausted.delete(provider);
    }

    const text = await response.text();

    if (!response.ok) {
      // Providers typically return a small JSON or plain-text error body —
      // but "message"/"error" is sometimes itself an object (e.g. a
      // validation-error payload), which would crash the .slice() calls
      // below if used as-is, so it's always normalized to a string here.
      let detail = text;
      try {
        const parsed = JSON.parse(text);
        const raw = parsed?.message ?? parsed?.error ?? text;
        detail = typeof raw === 'string' ? raw : JSON.stringify(raw);
      } catch {
        // keep raw text
      }
      const status = response.status;
      console.error(`[api] ✗ ${provider} ${status} for ${loggedUrl}${detail ? ` — ${detail.slice(0, 300)}` : ''}`);
      throw new ProviderError(
        provider,
        status,
        status === 429
          ? // Surface the provider's own error text (e.g. "Limit Exceeded")
            // rather than a generic message — repeated retries never once
            // succeeding, with no Retry-After header, usually means the
            // account's real quota (not just a per-second cap) is used up,
            // which no amount of backoff or pacing on our side can fix.
            `${provider} is still rate-limiting requests${circuitOpen ? '' : ` after ${maxRetries} retries`}${
              detail ? ` — ${detail.slice(0, 200)}` : ''
            }. If this persists across every call, the account's trial quota is likely exhausted — check the ${provider} developer dashboard for usage limits.`
          : `${provider} request failed: ${status} ${response.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
      );
    }

    if (!text) {
      console.log(`[api] ← ${provider} ${response.status} for ${loggedUrl}: empty body`);
      return null;
    }

    try {
      const data = JSON.parse(text);
      // Logging the full body (some responses, like the competitions
      // catalog, run to hundreds of KB) generates enough stdout volume to
      // risk overwhelming the host's log capture — length is enough to
      // confirm a real response came back without paying that cost.
      console.log(`[api] ← ${provider} ${response.status} for ${loggedUrl}: ${text.length} bytes`);
      return data;
    } catch (err) {
      console.error(`[api] ✗ ${provider} returned non-JSON for ${loggedUrl}`);
      throw new ProviderError(
        provider,
        response.status,
        `${provider} returned a response that could not be parsed as JSON`
      );
    }
  }

  // Unreachable in practice (the loop above always returns or throws), but
  // keeps TypeScript happy and gives a sane error if it ever is reached.
  throw (
    lastRateLimitError ??
    new ProviderError(provider, 429, `${provider} is rate-limiting requests.`)
  );
}
