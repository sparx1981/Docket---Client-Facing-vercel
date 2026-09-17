import { ProviderError } from './errors';

/**
 * Thin fetch wrapper shared by every provider client. Builds a URL with
 * query params, performs the request server-side (so CORS never applies and
 * the caller's key never touches a third-party origin from the browser), and
 * raises a ProviderError with the upstream status/message on any non-2xx
 * response or network/parse failure — callers must never invent a 200 with
 * placeholder data on top of this.
 *
 * Rate-limiting protection: trial-tier provider keys (Sportradar, Sportmonks)
 * are typically capped at ~1 request/second. Every provider client funnels
 * through this one function, so a single per-provider throttle here — plus a
 * bounded retry-with-backoff on 429 — covers all of them without each
 * provider file needing its own logic. When a call still fails after
 * retries, the caller's existing try/catch (see dataFeed.ts's per-fixture
 * enrichment, and the routes' handleError) is the graceful fallback: leave
 * that one piece of data missing rather than taking the whole feed down.
 */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Minimum gap between the *start* of consecutive requests to a given provider. */
function minIntervalMs(provider: string): number {
  const normalized = provider.toLowerCase();
  const envKey = normalized.includes('sportradar')
    ? 'SPORTRADAR_MIN_INTERVAL_MS'
    : normalized.includes('sportmonks')
    ? 'SPORTMONKS_MIN_INTERVAL_MS'
    : undefined;
  const fromEnv = envKey ? Number(process.env[envKey]) : NaN;
  if (Number.isFinite(fromEnv) && fromEnv > 0) return fromEnv;
  // Safe default for trial-tier keys, which are commonly limited to 1 req/sec.
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
  params: Record<string, string | undefined>
): Promise<any> {
  const fullUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      fullUrl.searchParams.set(key, value);
    }
  }

  const throttle = throttleFor(provider);
  let lastRateLimitError: ProviderError | undefined;

  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    await throttle.acquire();

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

    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const wait = retryAfterMs(response.headers.get('Retry-After')) ?? backoffMs(attempt);
      lastRateLimitError = new ProviderError(
        provider,
        429,
        `${provider} rate limit hit — retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES})`
      );
      await sleep(wait);
      continue;
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
      const status = response.status;
      throw new ProviderError(
        provider,
        status,
        status === 429
          ? `${provider} is rate-limiting requests and did not recover after ${MAX_RATE_LIMIT_RETRIES} retries. Try again shortly, or reduce how many sports/systems are enabled at once.`
          : `${provider} request failed: ${status} ${response.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ''}`
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

  // Unreachable in practice (the loop above always returns or throws), but
  // keeps TypeScript happy and gives a sane error if it ever is reached.
  throw (
    lastRateLimitError ??
    new ProviderError(provider, 429, `${provider} is rate-limiting requests.`)
  );
}
