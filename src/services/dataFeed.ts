import type {
  AppSettings,
  CandidateFixture,
  FeedSummaryRecord,
  FootballPrevSeasonStats,
  FootballStatsInput,
  H2HMatchRecord,
  LeagueOption,
  MatchOddsData,
  RuleThresholds,
  TeamRecentMatch,
} from '../types';
import { evaluateFixture } from './rulesEngine.js';
import { apiGet, sleep } from './backendClient.js';
import { describeLeagueScope } from './filterBreakdown.js';

/**
 * Real fixture ingestion. Every football candidate fixture on screen now
 * comes from a live TheStatsAPI.com call, proxied through our own backend
 * (server/index.ts) — never from hardcoded seed data.
 *
 * When no TheStatsAPI key is configured, or the pull fails, this returns an
 * empty list plus a human-readable error the UI can surface, rather than
 * falling back to anything fabricated.
 */

export interface FixtureFetchResult {
  fixtures: CandidateFixture[];
  /** Set when a provider was configured but the pull failed, or none was configured at all. */
  error?: string;
  /** Over 1.5 and Under 3.5 can target different leagues, so each gets its own feed summary. */
  footballOver15FeedInfo?: FeedSummaryRecord;
  footballUnder35FeedInfo?: FeedSummaryRecord;
}

/**
 * Real-time progress event emitted while a scan is in flight, so the UI can
 * show what's actually happening (which date/sport is being requested, how
 * many records have come back so far) instead of a fixed-length animation
 * that has no relationship to the real network calls underneath it.
 */
export interface FeedProgressEvent {
  sport: 'football';
  message: string;
  /** Running total of raw fixtures received for this sport so far. */
  recordsSoFar: number;
}

export type FeedProgressCallback = (event: FeedProgressEvent) => void;

// Bounded enrichment: how many fixtures we enrich with team/player/H2H lookups
// per sport, per scan. In order to accurately report the total records received
// in the live data feed (for the Filter Thresholds popups and feed analysis),
// we capture the full count of raw fixtures returned by the daily schedule API.
// We then enrich up to MAX_ENRICHED_FIXTURES_PER_SPORT fixtures to keep requests
// responsive and avoid tripping trial tier rate limits.
export const MAX_ENRICHED_FIXTURES_PER_SPORT = 200;

// A small pause between each enriched fixture's own burst of calls (3-4 for
// football) — with none, up to 200 fixtures fire their calls
// back-to-back as fast as the event loop allows, which has been observed to
// destabilize the backend/proxy partway through a scan (calls that succeeded
// at the start start timing out or hitting "still starting" placeholders
// later on) — very plausibly the trial-tier rate limit noted above being
// tripped by the burst rate rather than the total count. This trades a few
// extra seconds across a whole scan for not hammering it.
const ENRICHMENT_PACING_MS = 250;

// Over 1.5 and Under 3.5 each enrich fixtures independently (see the comment
// on buildFootballCandidates), which doubles team/H2H/odds calls to the same
// matches whenever the two rules' league selections overlap — a likely
// contributor to the backend exhausting its "still starting" retry budget
// under load. This cache is created fresh per fetchCandidateFixtures call and
// shared across both systems' calls to buildFootballCandidates, so the same
// team/H2H/odds request made twice in one scan reuses the first result
// (or its failure) instead of hitting the backend again.
type EnrichmentCache = Map<string, Promise<any>>;

function cachedApiGet(cache: EnrichmentCache | undefined, path: string, key: string, signal?: AbortSignal): Promise<any> {
  if (!cache) return apiGet(path, key, signal);
  let pending = cache.get(path);
  if (!pending) {
    pending = apiGet(path, key, signal);
    cache.set(path, pending);
  }
  return pending;
}

// How many days ahead (including today) to pull a fixture card for.
export const DAYS_AHEAD = 3;

export interface ScanPlanLine {
  label: string;
  detail: string;
}

/**
 * Plain-language summary of what a scan is actually about to download,
 * built from the current settings rather than a generic description — so
 * the confirmation prompt in front of "Run Daily Scan" reflects exactly
 * what will happen for this configuration (which rules, which leagues, how
 * many days, how deep the enrichment goes) instead of a vague disclaimer.
 */
export function describeScanPlan(settings: AppSettings): { lines: ScanPlanLine[]; hasAnyWork: boolean } {
  const lines: ScanPlanLine[] = [];

  if (!settings.theStatsApiKey) {
    return {
      lines: [{ label: 'Nothing configured', detail: 'No TheStatsAPI key is set in Engine Configuration — this scan would download nothing.' }],
      hasAnyWork: false,
    };
  }

  const rules: { key: 'footballOver15' | 'footballUnder35'; title: string }[] = [
    { key: 'footballOver15', title: 'Football — Over 1.5 Goals' },
    { key: 'footballUnder35', title: 'Football — Under 3.5 Goals' },
  ];

  let hasAnyWork = false;
  for (const rule of rules) {
    const thresholds = settings.ruleThresholds[rule.key];
    if (!thresholds.enabled) continue;
    hasAnyWork = true;
    const scope = describeLeagueScope(thresholds.selectedLeagueIds, settings.leagueCatalog);
    lines.push({
      label: rule.title,
      detail: `Download: every scheduled fixture over the next ${DAYS_AHEAD} days from ${scope}. Enrich: up to ${MAX_ENRICHED_FIXTURES_PER_SPORT} of those matches also get each team's season stats, recent form, and head-to-head history pulled in. Filter: every one of those fixtures — enriched or not — is then screened against this rule's own odds, form, and H2H thresholds; only the ones that pass become a Verified Qualifier or Price Watch entry.`,
    });
  }

  if (!hasAnyWork) {
    lines.push({
      label: 'Start scan disabled',
      detail: 'No football rule is enabled in Filter Thresholds — there is nothing this scan could download. Enable Over 1.5 Goals or Under 3.5 Goals to proceed.',
    });
  }

  return { lines, hasAnyWork };
}

/** True for a fetch/apiGet rejection caused by the user cancelling the scan, never a real provider failure. */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

function nextDates(count: number): string[] {
  const dates: string[] = [];
  const cursor = new Date();
  for (let i = 0; i < count; i++) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function googleUrl(matchTitle: string, competition: string): string {
  return (
    'https://www.google.com/search?q=' +
    encodeURIComponent(`${matchTitle} ${competition} fixture date time`)
  );
}

function choosefootballProvider(settings: AppSettings): { key: string } | null {
  if (settings.theStatsApiKey) return { key: settings.theStatsApiKey };
  return null;
}

/** Fetches every football competition the account's TheStatsAPI key can see. */
export async function fetchLeagues(settings: AppSettings): Promise<LeagueOption[]> {
  const football = choosefootballProvider(settings);
  if (!football) return [];
  const body = await apiGet('/api/football/competitions', football.key);
  const rows: any[] = body?.competitions || [];
  return rows.map((c) => ({ id: c.id, name: c.name, country: c.country ?? null, type: c.type }));
}

/* ============================== Football ============================== */

export interface RawFootballFixture {
  providerId: string;
  homeOrPlayer1: string;
  awayOrPlayer2: string;
  homeId?: string;
  awayId?: string;
  competition: string;
  matchTime: string;
  venue?: string;
}

/**
 * Fetches and screens fixtures for exactly one football system, scoped to
 * that system's own league selection. Over 1.5 and Under 3.5 can target
 * different leagues, so the raw fixture list itself is still fetched
 * separately per system. Team/H2H/odds enrichment calls, however, are keyed
 * by team/match id through the optional `enrichmentCache` — when the caller
 * shares one cache across both systems' calls (fetchCandidateFixtures does),
 * a fixture that appears in both systems' fixture lists (the common case
 * when their league selections overlap) is only enriched once.
 */
async function buildFootballCandidates(
  key: string,
  dates: string[],
  system: 'football_over_1_5' | 'football_under_3_5',
  thresholds: RuleThresholds,
  selectedLeagueIds: string[],
  onProgress?: FeedProgressCallback,
  signal?: AbortSignal,
  enrichmentCache?: EnrichmentCache
): Promise<{ candidates: CandidateFixture[]; rawTotal: number; partialError?: string }> {
  const allRawFixtures: RawFootballFixture[] = [];
  const dateErrors: string[] = [];
  // Empty selection means "All" — one call per date. Otherwise TheStatsAPI's
  // competition_id filter only takes a single value, so a specific league
  // selection means one call per (date, league) pair.
  const leagueIdsToQuery = selectedLeagueIds.length > 0 ? selectedLeagueIds : [undefined];

  for (const date of dates) {
    onProgress?.({
      sport: 'football',
      message: `Requesting football fixtures for ${date}…`,
      recordsSoFar: allRawFixtures.length,
    });
    let dateFailed = 0;
    for (const leagueId of leagueIdsToQuery) {
      try {
        const qs = leagueId ? `date=${date}&competitionId=${leagueId}` : `date=${date}`;
        // Over 1.5 and Under 3.5 each call this per system — when their league
        // selections overlap (a common setup), both would otherwise issue the
        // exact same date+league fixture-list request twice in one scan. This
        // is the same shared cache already used for team/H2H/odds enrichment.
        const body = await cachedApiGet(enrichmentCache, `/api/football/fixtures?${qs}`, key, signal);
        const received = body?.fixtures || [];
        for (const f of received) {
          allRawFixtures.push(f);
        }
        onProgress?.({
          sport: 'football',
          message: `Received ${received.length} football fixture(s) for ${date} (${allRawFixtures.length} total so far).`,
          recordsSoFar: allRawFixtures.length,
        });
      } catch (err) {
        if (isAbortError(err)) throw err;
        // A single day/league schedule call failing (rate limit exhausted,
        // transient upstream error) shouldn't blank out the whole feed —
        // keep whatever else succeeded and surface this as a partial-data note.
        const msg = err instanceof Error ? err.message : String(err);
        dateFailed++;
        dateErrors.push(`${date}${leagueId ? ` (${leagueId})` : ''}: ${msg}`);
        onProgress?.({
          sport: 'football',
          message: `Could not fetch football fixtures for ${date}: ${msg}`,
          recordsSoFar: allRawFixtures.length,
        });
      }
    }
    if (dateFailed === leagueIdsToQuery.length && leagueIdsToQuery.length > 0) {
      // Every league query for this date failed — nothing usable came back
      // for it, already recorded above.
    }
  }
  if (dateErrors.length === dates.length * leagueIdsToQuery.length) {
    throw new Error(dateErrors.join(' · '));
  }

  const rawTotal = allRawFixtures.length;
  const candidates: CandidateFixture[] = [];
  const enrichTotal = Math.min(MAX_ENRICHED_FIXTURES_PER_SPORT, allRawFixtures.length);

  // We enrich up to MAX_ENRICHED_FIXTURES_PER_SPORT with full historical/H2H stats
  // to stay within trial API rate limits, while keeping ALL fixtures in the feed
  // and CSV export so the record count and export row count match exactly.
  for (let i = 0; i < allRawFixtures.length; i++) {
    const fx = allRawFixtures[i];
    if (i < enrichTotal) {
      onProgress?.({
        sport: 'football',
        message: `Enriching football fixture ${i + 1} of ${enrichTotal} (${fx.homeOrPlayer1} vs ${fx.awayOrPlayer2})…`,
        recordsSoFar: rawTotal,
      });
    }
    let footballDetails: CandidateFixture['footballDetails'] | undefined;
    let partialStats: FootballStatsInput | undefined;
    let enrichmentNote: string | undefined;
    let matchOdds: MatchOddsData[] = [];
    if (i >= MAX_ENRICHED_FIXTURES_PER_SPORT) {
      enrichmentNote = `Not screened: this was match ${i + 1} of ${rawTotal} in the feed, and only the first ${MAX_ENRICHED_FIXTURES_PER_SPORT} are enriched with statistics per scan`;
    } else if (!fx.homeId || !fx.awayId) {
      enrichmentNote = 'Not screened: TheStatsAPI did not supply team IDs for this match, so no team statistics could be looked up';
    }
    if (i < MAX_ENRICHED_FIXTURES_PER_SPORT && fx.homeId && fx.awayId) {
      if (i > 0) await sleep(ENRICHMENT_PACING_MS, signal);

      // Each lookup is settled on its own, so one failing (or one team having
      // no statistics) never discards what the others returned.
      const settle = async <T,>(promise: Promise<T>): Promise<{ value?: T; error?: string }> => {
        try {
          return { value: await promise };
        } catch (err) {
          if (isAbortError(err)) throw err;
          return { error: err instanceof Error ? err.message : String(err) };
        }
      };
      const [homeRes, awayRes, h2hRes] = await Promise.all([
        settle(cachedApiGet(enrichmentCache, `/api/football/team/${fx.homeId}`, key, signal)),
        settle(cachedApiGet(enrichmentCache, `/api/football/team/${fx.awayId}`, key, signal)),
        settle(cachedApiGet(enrichmentCache, `/api/football/h2h?team1=${fx.homeId}&team2=${fx.awayId}`, key, signal)),
      ]);

      const gaps: NonNullable<FootballStatsInput['gaps']> = {};
      const teamPieces = (res: typeof homeRes, name: string, side: 'home' | 'away') => {
        const prev: FootballPrevSeasonStats | undefined = res.value?.team?.prevSeason;
        const recent: TeamRecentMatch[] | undefined = res.value?.team?.recentMatches;
        if (res.error) {
          gaps[`${side}PrevSeason`] = `${name}: team data could not be loaded (${res.error})`;
          gaps[`${side}Recent`] = `${name}: team data could not be loaded (${res.error})`;
        } else {
          if (!prev) gaps[`${side}PrevSeason`] = `TheStatsAPI has no season statistics for ${name}`;
          if (!recent || recent.length === 0) gaps[`${side}Recent`] = `TheStatsAPI has no recent matches on record for ${name}`;
        }
        return { prev, recent: recent && recent.length > 0 ? recent : undefined };
      };
      const home = teamPieces(homeRes, fx.homeOrPlayer1, 'home');
      const away = teamPieces(awayRes, fx.awayOrPlayer2, 'away');
      const h2hMatches: H2HMatchRecord[] | undefined = h2hRes.error ? undefined : h2hRes.value?.h2h ?? [];
      if (h2hRes.error) gaps.h2h = `head-to-head history could not be loaded (${h2hRes.error})`;

      if (home.prev && away.prev && home.recent && away.recent && h2hMatches && h2hMatches.length > 0) {
        footballDetails = {
          homePrevSeason: home.prev,
          awayPrevSeason: away.prev,
          h2hMatches,
          homeRecentMatches: home.recent,
          awayRecentMatches: away.recent,
        };
      } else {
        // Keep whatever did load; the rules engine checks each filter from
        // these pieces and reports the missing ones as "no data" with the
        // reason, rather than discarding the match. Two teams with no
        // recorded meetings is not missing data: h2hMatches stays [] and the
        // H2H filter fails on its own.
        partialStats = {
          homePrevSeason: home.prev,
          awayPrevSeason: away.prev,
          h2hMatches,
          homeRecentMatches: home.recent,
          awayRecentMatches: away.recent,
          gaps,
        };
      }

      try {
        const oddsBody = await cachedApiGet(enrichmentCache, `/api/football/market-odds/${fx.providerId}`, key, signal);
        matchOdds = Array.isArray(oddsBody?.odds) ? oddsBody.odds : [];
      } catch (err) {
        if (isAbortError(err)) throw err;
        matchOdds = [];
      }

      onProgress?.({
        sport: 'football',
        message: footballDetails
          ? `✓ Enriched ${fx.homeOrPlayer1} vs ${fx.awayOrPlayer2}${matchOdds.length === 0 ? ' (no odds returned)' : ''}.`
          : `✗ Incomplete data for ${fx.homeOrPlayer1} vs ${fx.awayOrPlayer2} — ${Object.values(partialStats?.gaps ?? {}).join('; ') || 'no meetings on record'}.`,
        recordsSoFar: rawTotal,
      });
    }

    const marketTypeOver15 = matchOdds.find((o) => o.marketType === 'OVER_UNDER_15');
    const marketTypeUnder35 = matchOdds.find((o) => o.marketType === 'OVER_UNDER_35');
    const marketOdds = system === 'football_over_1_5' ? marketTypeOver15 : marketTypeUnder35;

    candidates.push(buildFootballCandidate(system, fx, footballDetails, thresholds, rawTotal, marketOdds, { partialStats, enrichmentNote }));
  }

  return {
    candidates,
    rawTotal,
    partialError: dateErrors.length > 0 ? `Some dates could not be fetched: ${dateErrors.join(' · ')}` : undefined,
  };
}

export function buildFootballCandidate(
  system: 'football_over_1_5' | 'football_under_3_5',
  fx: RawFootballFixture,
  footballDetails: CandidateFixture['footballDetails'] | undefined,
  thresholds: RuleThresholds,
  rawTotal?: number,
  marketOdds?: CandidateFixture['marketOdds'],
  extra?: { partialStats?: FootballStatsInput; enrichmentNote?: string }
): CandidateFixture {
  const requiredOdds =
    system === 'football_over_1_5'
      ? thresholds.footballOver15.minExchangeOdds
      : thresholds.footballUnder35.minExchangeOdds;
  const betType = system === 'football_over_1_5' ? 'Over 1.5 Goals' : 'Under 3.5 Goals';
  const matchTitle = `${fx.homeOrPlayer1} vs ${fx.awayOrPlayer2}`;
  const idPrefix = system === 'football_over_1_5' ? 'FT-OV15' : 'FT-UN35';

  const candidate: CandidateFixture = {
    id: `${idPrefix}-${fx.providerId}`,
    providerId: fx.providerId,
    sport: 'football',
    system,
    matchTitle,
    homeOrPlayer1: fx.homeOrPlayer1,
    awayOrPlayer2: fx.awayOrPlayer2,
    selectedEntity: `${fx.homeOrPlayer1} & ${fx.awayOrPlayer2} (${betType})`,
    competition: fx.competition,
    matchTime: fx.matchTime,
    venue: fx.venue,
    betType,
    googleVerificationUrl: googleUrl(matchTitle, fx.competition),
    sourceProvider: 'THESTATSAPI',
    // Priced from TheStatsAPI's own odds endpoint when a matching-market
    // entry came back for this fixture; left at 0 (not a fabricated
    // figure) when it didn't. UI surfaces this via marketOdds being
    // undefined, not via this field.
    currentOdds: marketOdds?.decimalOdds ?? 0,
    requiredOdds,
    oddsDifference: (marketOdds?.decimalOdds ?? 0) - requiredOdds,
    status: 'FAILED',
    footballDetails,
    partialStats: extra?.partialStats,
    enrichmentNote: extra?.enrichmentNote,
    marketOdds,
    rawFeedTotal: rawTotal,
    oddsCheckedAt: new Date().toISOString(),
  };

  const screening = evaluateFixture(candidate, thresholds);
  candidate.status = screening.isVerifiedQualifier
    ? 'VERIFIED_QUALIFIER'
    : screening.isPriceWatch
    ? 'PRICE_WATCH'
    : screening.isPreliminaryQualifier
    ? 'PRELIMINARY_QUALIFIER'
    : 'FAILED';
  candidate.failureReason = screening.failureReason;

  return candidate;
}

/* =============================== Entry point ============================ */

export async function fetchCandidateFixtures(
  settings: AppSettings,
  onProgress?: FeedProgressCallback,
  signal?: AbortSignal
): Promise<FixtureFetchResult> {
  const football = choosefootballProvider(settings);

  if (!football) {
    return {
      fixtures: [],
      error: 'No data provider configured. Add a TheStatsAPI key in Engine Configuration to pull real football fixtures.',
    };
  }

  const thresholds = settings.ruleThresholds;
  const dates = nextDates(DAYS_AHEAD);
  const errors: string[] = [];
  const fixtures: CandidateFixture[] = [];
  let footballOver15FeedInfo: FeedSummaryRecord | undefined;
  let footballUnder35FeedInfo: FeedSummaryRecord | undefined;
  const footballEnrichmentCache: EnrichmentCache = new Map();

  if (football) {
    for (const system of ['football_over_1_5', 'football_under_3_5'] as const) {
      const systemThresholds = system === 'football_over_1_5' ? thresholds.footballOver15 : thresholds.footballUnder35;
      if (!systemThresholds.enabled) continue;
      // Belt-and-braces: Engine Configuration won't let a rule be saved as
      // enabled with no league selection, but this guards the actual
      // network call itself against ever going out unscoped regardless of
      // how that combination arrived (an older save, another device, a
      // direct data edit) — never trust the UI alone to prevent this.
      if (systemThresholds.selectedLeagueIds.length === 0) {
        errors.push(
          `${system === 'football_over_1_5' ? 'Over 1.5 Goals' : 'Under 3.5 Goals'}: no leagues selected — skipped rather than pulling every league.`
        );
        continue;
      }
      try {
        const fbResult = await buildFootballCandidates(
          football.key,
          dates,
          system,
          thresholds,
          systemThresholds.selectedLeagueIds,
          onProgress,
          signal,
          footballEnrichmentCache
        );
        fixtures.push(...fbResult.candidates);
        const info: FeedSummaryRecord = {
          sport: 'football',
          provider: 'THESTATSAPI',
          totalRecordsReceived: fbResult.rawTotal,
          fetchedAt: new Date().toISOString(),
          queryDates: dates,
          error: fbResult.partialError,
        };
        if (system === 'football_over_1_5') footballOver15FeedInfo = info;
        else footballUnder35FeedInfo = info;
      } catch (err) {
        if (isAbortError(err)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(msg);
        const info: FeedSummaryRecord = {
          sport: 'football',
          provider: 'THESTATSAPI',
          totalRecordsReceived: 0,
          fetchedAt: new Date().toISOString(),
          queryDates: dates,
          error: msg,
        };
        if (system === 'football_over_1_5') footballOver15FeedInfo = info;
        else footballUnder35FeedInfo = info;
      }
    }
  }

  return {
    fixtures,
    error: errors.length > 0 ? errors.join(' · ') : undefined,
    footballOver15FeedInfo,
    footballUnder35FeedInfo,
  };
}

/**
 * Plain-language summary of what "Refresh Feed & Impact Numbers" is
 * actually about to download — the confirmation prompt in front of that
 * button, mirroring describeScanPlan above. Only a rule that's currently
 * enabled gets fetched (same as a real scan), and it reflects the
 * currently-edited draft, not the last-saved settings — worth spelling out
 * explicitly rather than leaving the user to assume it behaves like the
 * daily scan.
 */
export function describeLiveFeedPreviewPlan(settings: AppSettings): { lines: ScanPlanLine[]; hasAnyWork: boolean } {
  const lines: ScanPlanLine[] = [];

  if (!settings.theStatsApiKey) {
    return {
      lines: [{ label: 'Nothing configured', detail: 'No TheStatsAPI key is set in Engine Configuration — this would download nothing.' }],
      hasAnyWork: false,
    };
  }

  const rules: { key: 'footballOver15' | 'footballUnder35'; title: string }[] = [
    { key: 'footballOver15', title: 'Football — Over 1.5 Goals' },
    { key: 'footballUnder35', title: 'Football — Under 3.5 Goals' },
  ];

  let hasAnyWork = false;
  for (const rule of rules) {
    const thresholds = settings.ruleThresholds[rule.key];
    if (!thresholds.enabled) {
      lines.push({
        label: rule.title,
        detail: 'Not enabled — nothing will be fetched for it. Enable this rule to include it here.',
      });
      continue;
    }
    if (thresholds.selectedLeagueIds.length === 0) {
      lines.push({
        label: rule.title,
        detail: 'No leagues currently selected for this rule — nothing will be fetched for it until at least one league is picked below.',
      });
      continue;
    }
    hasAnyWork = true;
    const scope = describeLeagueScope(thresholds.selectedLeagueIds, settings.leagueCatalog);
    lines.push({
      label: rule.title,
      detail: `Download: every scheduled fixture over the next ${DAYS_AHEAD} days from ${scope}. Enrich: up to ${MAX_ENRICHED_FIXTURES_PER_SPORT} of those matches also get each team's season stats, recent form, and head-to-head history pulled in. Filter: every one of those fixtures is then screened against this rule's own current (unsaved) thresholds, so the Filter & Impact numbers below reflect it.`,
    });
  }

  return { lines, hasAnyWork };
}

export interface OddsRefreshProgressEvent {
  completed: number;
  total: number;
}

/**
 * Re-checks only the market odds for a set of already-enriched fixtures.
 * Team stats, H2H and recent form are untouched and reused as-is — those
 * are slow-moving historical facts, unlike odds, which move constantly
 * (TheStatsAPI's own opening vs last_seen prices differ on nearly every
 * match). A full re-scan costs ~4 provider calls per fixture (two team
 * profiles, H2H, odds); this costs one (the odds endpoint alone), deduped
 * across the Over 1.5 / Under 3.5 pair when both track the same match —
 * exactly the check Price Watch's own description already implies
 * happens ("re-checked on the next scan"), just without needing a full one.
 */
export async function refreshOddsForFixtures(
  fixtures: CandidateFixture[],
  settings: AppSettings,
  onProgress?: (event: OddsRefreshProgressEvent) => void,
  signal?: AbortSignal
): Promise<CandidateFixture[]> {
  const football = choosefootballProvider(settings);
  if (!football) return fixtures;

  const now = Date.now();
  const refreshableIds = Array.from(
    new Set(
      fixtures
        .filter((f) => f.sport === 'football' && new Date(f.matchTime).getTime() > now)
        .map((f) => f.providerId)
    )
  );

  const oddsByProviderId = new Map<string, MatchOddsData[]>();
  onProgress?.({ completed: 0, total: refreshableIds.length });

  for (const [index, providerId] of refreshableIds.entries()) {
    if (index > 0) await sleep(ENRICHMENT_PACING_MS, signal);
    try {
      const oddsBody = await apiGet(`/api/football/market-odds/${providerId}`, football.key, signal);
      oddsByProviderId.set(providerId, Array.isArray(oddsBody?.odds) ? oddsBody.odds : []);
    } catch (err) {
      if (isAbortError(err)) throw err;
      // Leave this match's odds untouched on a failed re-check — a
      // transient error here should never blank out a price that was
      // already confirmed on the last real scan.
    }
    onProgress?.({ completed: index + 1, total: refreshableIds.length });
  }

  const checkedAt = new Date().toISOString();
  return fixtures.map((f) => {
    if (f.sport !== 'football' || !oddsByProviderId.has(f.providerId)) return f;
    const matchOdds = oddsByProviderId.get(f.providerId)!;
    const marketOdds =
      f.system === 'football_over_1_5'
        ? matchOdds.find((o) => o.marketType === 'OVER_UNDER_15')
        : matchOdds.find((o) => o.marketType === 'OVER_UNDER_35');
    const updated: CandidateFixture = {
      ...f,
      currentOdds: marketOdds?.decimalOdds ?? 0,
      oddsDifference: (marketOdds?.decimalOdds ?? 0) - f.requiredOdds,
      marketOdds,
      oddsCheckedAt: checkedAt,
    };
    const screening = evaluateFixture(updated, settings.ruleThresholds);
    updated.status = screening.isVerifiedQualifier
      ? 'VERIFIED_QUALIFIER'
      : screening.isPriceWatch
      ? 'PRICE_WATCH'
      : screening.isPreliminaryQualifier
      ? 'PRELIMINARY_QUALIFIER'
      : 'FAILED';
    updated.failureReason = screening.failureReason;
    return updated;
  });
}

/**
 * Fetches the live data feed for every currently-enabled system, so the
 * Filter Thresholds hover popups can show accurate feed counts and filter
 * impact from real data. A disabled rule is skipped entirely — same as a
 * real scan would skip it — rather than forced on just to give its popup
 * something to show.
 */
export async function fetchLiveFeedSummary(
  settings: AppSettings,
  onProgress?: FeedProgressCallback,
  signal?: AbortSignal
): Promise<{
  fixtures: CandidateFixture[];
  footballOver15FeedInfo?: FeedSummaryRecord;
  footballUnder35FeedInfo?: FeedSummaryRecord;
  footballConfigured: boolean;
  error?: string;
}> {
  const football = choosefootballProvider(settings);
  const dates = nextDates(DAYS_AHEAD);
  const fixtures: CandidateFixture[] = [];
  const errors: string[] = [];
  let footballOver15FeedInfo: FeedSummaryRecord | undefined;
  let footballUnder35FeedInfo: FeedSummaryRecord | undefined;
  const footballEnrichmentCache: EnrichmentCache = new Map();

  if (football) {
    for (const system of ['football_over_1_5', 'football_under_3_5'] as const) {
      const systemThresholds =
        system === 'football_over_1_5' ? settings.ruleThresholds.footballOver15 : settings.ruleThresholds.footballUnder35;
      // Only preview a rule that's actually enabled — this used to force
      // every rule "on" regardless of its real toggle so the Feed & Impact
      // panel always had something to show, but that meant clicking refresh
      // made real, rate-limited provider calls for a rule you'd deliberately
      // switched off, with nothing downloaded actually reflecting what the
      // app would do. A disabled rule downloads nothing here either, same as
      // a real scan would skip it.
      if (!systemThresholds.enabled) {
        const info: FeedSummaryRecord = {
          sport: 'football',
          provider: 'THESTATSAPI',
          totalRecordsReceived: 0,
          fetchedAt: new Date().toISOString(),
          queryDates: dates,
          error: 'This rule is not enabled — nothing is fetched for it until it is.',
        };
        if (system === 'football_over_1_5') footballOver15FeedInfo = info;
        else footballUnder35FeedInfo = info;
        continue;
      }
      // Never call TheStatsAPI unscoped — a rule with no saved league
      // selection is skipped entirely rather than pulling every league.
      if (systemThresholds.selectedLeagueIds.length === 0) {
        const info: FeedSummaryRecord = {
          sport: 'football',
          provider: 'THESTATSAPI',
          totalRecordsReceived: 0,
          fetchedAt: new Date().toISOString(),
          queryDates: dates,
          error: 'No leagues selected for this rule — choose and save at least one league to preview its live feed.',
        };
        if (system === 'football_over_1_5') footballOver15FeedInfo = info;
        else footballUnder35FeedInfo = info;
        continue;
      }
      try {
        const fbResult = await buildFootballCandidates(
          football.key,
          dates,
          system,
          settings.ruleThresholds,
          systemThresholds.selectedLeagueIds,
          onProgress,
          signal,
          footballEnrichmentCache
        );
        fixtures.push(...fbResult.candidates);
        const info: FeedSummaryRecord = {
          sport: 'football',
          provider: 'THESTATSAPI',
          totalRecordsReceived: fbResult.rawTotal,
          fetchedAt: new Date().toISOString(),
          queryDates: dates,
          error: fbResult.partialError,
        };
        if (system === 'football_over_1_5') footballOver15FeedInfo = info;
        else footballUnder35FeedInfo = info;
      } catch (err) {
        // A user-requested stop must actually stop this preview, not be
        // recorded as if the provider itself had failed for this system.
        if (isAbortError(err)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`Football feed error: ${msg}`);
        const info: FeedSummaryRecord = {
          sport: 'football',
          provider: 'THESTATSAPI',
          totalRecordsReceived: 0,
          fetchedAt: new Date().toISOString(),
          queryDates: dates,
          error: msg,
        };
        if (system === 'football_over_1_5') footballOver15FeedInfo = info;
        else footballUnder35FeedInfo = info;
      }
    }
  }

  return {
    fixtures,
    footballOver15FeedInfo,
    footballUnder35FeedInfo,
    footballConfigured: !!football,
    error: errors.length > 0 ? errors.join(' · ') : undefined,
  };
}

/* ============================== Feed health check ======================= */

export interface FeedHealthResult {
  sport: 'football';
  provider: 'THESTATSAPI' | 'NONE';
  status: 'ok' | 'rate_limited' | 'error' | 'not_configured' | 'leagues_not_selected';
  /** Real error text from the failed call, when status isn't 'ok'. */
  message?: string;
  /** Raw fixture count for today, when status is 'ok'. */
  recordCount?: number;
  /** Which league this particular check was scoped to — football only ever checks selected leagues, never "All". */
  leagueLabel?: string;
  checkedAt: string;
}

function classifyFeedError(message: string): 'rate_limited' | 'error' {
  return /rate[\s-]?limit|429|quota|limit exceeded/i.test(message) ? 'rate_limited' : 'error';
}

/**
 * A single cheap call per configured feed (today's date only, no
 * enrichment) so the user can see which providers are healthy — or
 * already rate-limited/quota-exhausted — before committing to a full
 * multi-minute scan that would burn through dozens of calls per sport.
 */
export async function checkFeedHealth(settings: AppSettings): Promise<FeedHealthResult[]> {
  const football = choosefootballProvider(settings);
  const today = nextDates(1)[0];
  const results: FeedHealthResult[] = [];

  if (football) {
    // Never an unscoped "every league" call — one cheap call per league the
    // user has actually selected and saved on either rule. If neither rule
    // has a saved selection, this doesn't call TheStatsAPI at all.
    const leagueIds = Array.from(
      new Set([
        ...settings.ruleThresholds.footballOver15.selectedLeagueIds,
        ...settings.ruleThresholds.footballUnder35.selectedLeagueIds,
      ])
    );
    if (leagueIds.length === 0) {
      results.push({
        sport: 'football',
        provider: 'THESTATSAPI',
        status: 'leagues_not_selected',
        message: 'No leagues selected — choose and save at least one league in Engine Configuration before testing feeds.',
        checkedAt: new Date().toISOString(),
      });
    } else {
      for (const leagueId of leagueIds) {
        const league = settings.leagueCatalog.find((l) => l.id === leagueId);
        const leagueLabel = league?.name || leagueId;
        try {
          const body = await apiGet(`/api/football/fixtures?date=${today}&competitionId=${leagueId}`, football.key);
          results.push({
            sport: 'football',
            provider: 'THESTATSAPI',
            status: 'ok',
            recordCount: (body?.fixtures || []).length,
            leagueLabel,
            checkedAt: new Date().toISOString(),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({
            sport: 'football',
            provider: 'THESTATSAPI',
            status: classifyFeedError(message),
            message,
            leagueLabel,
            checkedAt: new Date().toISOString(),
          });
        }
      }
    }
  } else {
    results.push({ sport: 'football', provider: 'NONE', status: 'not_configured', checkedAt: new Date().toISOString() });
  }

  return results;
}
