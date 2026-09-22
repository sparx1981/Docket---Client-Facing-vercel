import {
  AppSettings,
  CandidateFixture,
  FeedSummaryRecord,
  FootballPrevSeasonStats,
  H2HMatchRecord,
  LeagueOption,
  RuleThresholds,
  TeamRecentMatch,
  TennisPlayerStats,
  TennisRecentMatch,
} from '../types';
import { evaluateFixture } from './rulesEngine';
import { apiGet } from './backendClient';
import { describeLeagueScope } from './filterBreakdown';

/**
 * Real fixture ingestion. Every football candidate fixture on screen now
 * comes from a live TheStatsAPI.com call, proxied through our own backend
 * (server/index.ts) — never from hardcoded seed data. Tennis has no
 * configured data supplier at all right now (Sportradar Tennis was removed
 * along with football's old providers; tennis's own migration is a later
 * phase), so tennis candidates are never fetched.
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
  tennisFeedInfo?: FeedSummaryRecord;
}

/**
 * Real-time progress event emitted while a scan is in flight, so the UI can
 * show what's actually happening (which date/sport is being requested, how
 * many records have come back so far) instead of a fixed-length animation
 * that has no relationship to the real network calls underneath it.
 */
export interface FeedProgressEvent {
  sport: 'football' | 'tennis';
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
export const MAX_ENRICHED_FIXTURES_PER_SPORT = 40;

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
      detail: `Scheduled fixtures over the next ${DAYS_AHEAD} days from ${scope}. Up to ${MAX_ENRICHED_FIXTURES_PER_SPORT} of those matches also get each team's season stats, recent form, and head-to-head history pulled in.`,
    });
  }

  if (settings.ruleThresholds.tennisStraightSets.enabled) {
    lines.push({
      label: 'Tennis — Straight Sets',
      detail: 'Enabled, but tennis has no configured data supplier yet — nothing will actually be downloaded for it.',
    });
  }

  if (!hasAnyWork && lines.length === 0) {
    lines.push({ label: 'Nothing enabled', detail: 'No systems are enabled in Filter Thresholds — this scan would download nothing.' });
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

function chooseTennisProvider(_settings: AppSettings): { key: string } | null {
  // Tennis has no configured data supplier since the Sportradar/Sportmonks
  // migration off cost-prohibitive trial tiers. It is planned to move to
  // its own new provider in a later phase, not restored to Sportradar.
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
 * different leagues, so they are no longer fetched together from one shared
 * raw fixture list — each gets its own fetch (and, for any fixture that
 * needs enrichment, its own team-stats/H2H calls), even when their league
 * selections overlap. That's a real cost increase over a single shared
 * fetch when the two rules diverge; it stays proportional (and bounded by
 * MAX_ENRICHED_FIXTURES_PER_SPORT) when they don't.
 */
async function buildFootballCandidates(
  key: string,
  dates: string[],
  system: 'football_over_1_5' | 'football_under_3_5',
  thresholds: RuleThresholds,
  selectedLeagueIds: string[],
  onProgress?: FeedProgressCallback,
  signal?: AbortSignal
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
        const body = await apiGet(`/api/football/fixtures?${qs}`, key, signal);
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
    if (i < MAX_ENRICHED_FIXTURES_PER_SPORT && fx.homeId && fx.awayId) {
      try {
        const [homeProfile, awayProfile, h2h] = await Promise.all([
          apiGet(`/api/football/team/${fx.homeId}`, key, signal),
          apiGet(`/api/football/team/${fx.awayId}`, key, signal),
          apiGet(`/api/football/h2h?team1=${fx.homeId}&team2=${fx.awayId}`, key, signal),
        ]);

        const homePrevSeason: FootballPrevSeasonStats | undefined = homeProfile?.team?.prevSeason;
        const awayPrevSeason: FootballPrevSeasonStats | undefined = awayProfile?.team?.prevSeason;
        const homeRecentMatches: TeamRecentMatch[] | undefined = homeProfile?.team?.recentMatches;
        const awayRecentMatches: TeamRecentMatch[] | undefined = awayProfile?.team?.recentMatches;
        const h2hMatches: H2HMatchRecord[] | undefined = h2h?.h2h;

        // Only build footballDetails when every field the locked rules need is
        // genuinely present — a partial dataset is left as "missing data"
        // rather than padded with anything invented.
        if (
          homePrevSeason &&
          awayPrevSeason &&
          homeRecentMatches &&
          homeRecentMatches.length > 0 &&
          awayRecentMatches &&
          awayRecentMatches.length > 0 &&
          h2hMatches &&
          h2hMatches.length > 0
        ) {
          footballDetails = {
            homePrevSeason,
            awayPrevSeason,
            h2hMatches,
            homeRecentMatches,
            awayRecentMatches,
          };
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
        // Leave footballDetails undefined — the rules engine already handles
        // that as "missing data" rather than crashing or inventing stats.
        footballDetails = undefined;
      }
    }

    candidates.push(buildFootballCandidate(system, fx, footballDetails, thresholds, rawTotal));
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
  rawTotal?: number
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
    // No Betfair Exchange integration in phase 1 (see betfairMarket, which
    // is intentionally absent below) — there is no real current price to
    // report, so this is left at 0 rather than a fabricated figure. UI
    // surfaces this via betfairMarket being undefined, not via this field.
    currentOdds: 0,
    requiredOdds,
    oddsDifference: -requiredOdds,
    status: 'FAILED',
    footballDetails,
    rawFeedTotal: rawTotal,
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

/* =============================== Tennis ================================ */

interface RawTennisFixture {
  providerId: string;
  homeOrPlayer1: string;
  awayOrPlayer2: string;
  homeId?: string;
  awayId?: string;
  competition: string;
  matchTime: string;
  venue?: string;
  surface?: 'Hard' | 'Clay' | 'Grass' | 'Carpet';
}

async function buildTennisCandidates(
  key: string,
  dates: string[],
  thresholds: RuleThresholds,
  onProgress?: FeedProgressCallback,
  signal?: AbortSignal
): Promise<{ candidates: CandidateFixture[]; rawTotal: number; partialError?: string }> {
  const allRawFixtures: RawTennisFixture[] = [];
  const dateErrors: string[] = [];
  for (const date of dates) {
    onProgress?.({
      sport: 'tennis',
      message: `Requesting tennis fixtures for ${date}…`,
      recordsSoFar: allRawFixtures.length,
    });
    try {
      const body = await apiGet(`/api/tennis/fixtures?date=${date}`, key, signal);
      const received = body?.fixtures || [];
      for (const f of received) {
        allRawFixtures.push(f);
      }
      onProgress?.({
        sport: 'tennis',
        message: `Received ${received.length} tennis fixture(s) for ${date} (${allRawFixtures.length} total so far).`,
        recordsSoFar: allRawFixtures.length,
      });
    } catch (err) {
      if (isAbortError(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      dateErrors.push(`${date}: ${msg}`);
      onProgress?.({
        sport: 'tennis',
        message: `Could not fetch tennis fixtures for ${date}: ${msg}`,
        recordsSoFar: allRawFixtures.length,
      });
    }
  }
  if (dateErrors.length === dates.length) {
    throw new Error(dateErrors.join(' · '));
  }

  const rawTotal = allRawFixtures.length;
  const candidates: CandidateFixture[] = [];
  const enrichTotal = Math.min(MAX_ENRICHED_FIXTURES_PER_SPORT, allRawFixtures.length);

  // Enrich up to MAX_ENRICHED_FIXTURES_PER_SPORT to stay within trial API rate limits,
  // while keeping ALL fixtures in the feed and CSV export so row count and record count match.
  for (let i = 0; i < allRawFixtures.length; i++) {
    const fx = allRawFixtures[i];
    let tennisDetails: CandidateFixture['tennisDetails'] | undefined;

    if (i < enrichTotal) {
      onProgress?.({
        sport: 'tennis',
        message: `Enriching tennis fixture ${i + 1} of ${enrichTotal} (${fx.homeOrPlayer1} vs ${fx.awayOrPlayer2})…`,
        recordsSoFar: rawTotal,
      });
    }

    if (i < MAX_ENRICHED_FIXTURES_PER_SPORT && fx.homeId && fx.awayId) {
      try {
        const [p1, p2] = await Promise.all([
          apiGet(`/api/tennis/player/${fx.homeId}`, key, signal),
          apiGet(`/api/tennis/player/${fx.awayId}`, key, signal),
        ]);

        const player1: TennisPlayerStats | undefined = p1?.player?.player;
        const player2: TennisPlayerStats | undefined = p2?.player?.player;
        // Judgment call: the "selected" player for the straight-sets system is
        // whichever of the two carries the better (lower) official ranking —
        // the rule requires the selection to be ranked higher than its
        // opponent, so there is no ambiguity about which side of the match we
        // are screening.
        const selected = player1 && player2 ? (player1.ranking <= player2.ranking ? player1 : player2) : undefined;
        const opponent = selected === player1 ? player2 : player1;
        const selectedRecent: TennisRecentMatch[] | undefined =
          selected === player1 ? p1?.player?.recentMatches : p2?.player?.recentMatches;

        if (selected && opponent && selectedRecent && selectedRecent.length > 0) {
          tennisDetails = {
            selectedPlayer: selected,
            opponentPlayer: opponent,
            playerRecentSingles: selectedRecent,
          };
        }
      } catch (err) {
        if (isAbortError(err)) throw err;
        tennisDetails = undefined;
      }
    }

    candidates.push(buildTennisCandidate(fx, tennisDetails, thresholds, rawTotal));
  }

  return {
    candidates,
    rawTotal,
    partialError: dateErrors.length > 0 ? `Some dates could not be fetched: ${dateErrors.join(' · ')}` : undefined,
  };
}

function buildTennisCandidate(
  fx: RawTennisFixture,
  tennisDetails: CandidateFixture['tennisDetails'] | undefined,
  thresholds: RuleThresholds,
  rawTotal?: number
): CandidateFixture {
  const requiredOdds = thresholds.tennisStraightSets.minExchangeOdds;
  const matchTitle = `${fx.homeOrPlayer1} vs ${fx.awayOrPlayer2}`;
  // Judgment call: best-of-5 (and therefore a 3-0 straight-sets line) applies
  // to men's Grand Slam singles; everything else on tour is best-of-3 (2-0).
  // The normalized fixture doesn't carry a reliable "best of" field from the
  // documented contract, so this is inferred from the competition name and
  // should be re-verified once real schedule responses are available.
  const isLikelyGrandSlam = /open|wimbledon|roland garros|french open|australian open|us open/i.test(
    fx.competition
  );
  const bestOfSets: 3 | 5 = isLikelyGrandSlam ? 5 : 3;
  const setsLabel = bestOfSets === 5 ? '3-0' : '2-0';
  const selectedEntity = tennisDetails
    ? `${tennisDetails.selectedPlayer.name} to Win in Straight Sets (${setsLabel})`
    : `${fx.homeOrPlayer1} vs ${fx.awayOrPlayer2} (Straight Sets)`;

  const candidate: CandidateFixture = {
    id: `TN-SETS-${fx.providerId}`,
    sport: 'tennis',
    system: 'tennis_straight_sets',
    matchTitle,
    homeOrPlayer1: fx.homeOrPlayer1,
    awayOrPlayer2: fx.awayOrPlayer2,
    selectedEntity,
    competition: fx.competition,
    matchTime: fx.matchTime,
    venue: fx.venue,
    surface: fx.surface || tennisDetails?.selectedPlayer.surface || 'Hard',
    bestOfSets,
    betType: `Straight Sets (${setsLabel})`,
    googleVerificationUrl: googleUrl(matchTitle, fx.competition),
    // Tennis only ever comes from Sportradar — Sportmonks has no tennis coverage.
    sourceProvider: 'SPORTRADAR',
    currentOdds: 0,
    requiredOdds,
    oddsDifference: -requiredOdds,
    status: 'FAILED',
    tennisDetails,
    rawFeedTotal: rawTotal,
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
  const tennis = chooseTennisProvider(settings);

  if (!football && !tennis) {
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
  let tennisFeedInfo: FeedSummaryRecord | undefined;

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
          signal
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

  if (!thresholds.tennisStraightSets.enabled) {
    // System disabled in Engine Configuration — skip the calls entirely.
  } else if (tennis) {
    try {
      const tnResult = await buildTennisCandidates(tennis.key, dates, thresholds, onProgress, signal);
      fixtures.push(...tnResult.candidates);
      tennisFeedInfo = {
        sport: 'tennis',
        provider: 'SPORTRADAR',
        totalRecordsReceived: tnResult.rawTotal,
        fetchedAt: new Date().toISOString(),
        queryDates: dates,
        error: tnResult.partialError,
      };
    } catch (err) {
      if (isAbortError(err)) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
      tennisFeedInfo = {
        sport: 'tennis',
        provider: 'SPORTRADAR',
        totalRecordsReceived: 0,
        fetchedAt: new Date().toISOString(),
        queryDates: dates,
        error: msg,
      };
    }
  } else {
    errors.push('Tennis has no configured data supplier yet — it is planned to move to a new provider in a later phase.');
  }

  return {
    fixtures,
    error: errors.length > 0 ? errors.join(' · ') : undefined,
    footballOver15FeedInfo,
    footballUnder35FeedInfo,
    tennisFeedInfo,
  };
}

/**
 * Fetches the live data feed directly for all systems (even if currently toggled off)
 * so that the Filter Thresholds hover popups can show accurate feed counts and filter impact
 * across all configured providers.
 */
export async function fetchLiveFeedSummary(settings: AppSettings): Promise<{
  fixtures: CandidateFixture[];
  footballOver15FeedInfo?: FeedSummaryRecord;
  footballUnder35FeedInfo?: FeedSummaryRecord;
  tennisFeedInfo?: FeedSummaryRecord;
  footballConfigured: boolean;
  tennisConfigured: boolean;
  error?: string;
}> {
  const football = choosefootballProvider(settings);
  const tennis = chooseTennisProvider(settings);
  const dates = nextDates(DAYS_AHEAD);
  const fixtures: CandidateFixture[] = [];
  const errors: string[] = [];
  let footballOver15FeedInfo: FeedSummaryRecord | undefined;
  let footballUnder35FeedInfo: FeedSummaryRecord | undefined;
  let tennisFeedInfo: FeedSummaryRecord | undefined;

  // Force systems to enabled for the live feed analysis so candidate records exist
  const forcedThresholds: RuleThresholds = {
    footballOver15: { ...settings.ruleThresholds.footballOver15, enabled: true },
    footballUnder35: { ...settings.ruleThresholds.footballUnder35, enabled: true },
    tennisStraightSets: { ...settings.ruleThresholds.tennisStraightSets, enabled: true },
  };

  if (football) {
    for (const system of ['football_over_1_5', 'football_under_3_5'] as const) {
      const systemThresholds =
        system === 'football_over_1_5' ? forcedThresholds.footballOver15 : forcedThresholds.footballUnder35;
      // Never call TheStatsAPI unscoped — a rule with no saved league
      // selection is skipped entirely rather than "forced enabled" into an
      // All-leagues request, even though this preview forces enablement for
      // every other rule so its Feed Impact card has something to show.
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
          forcedThresholds,
          systemThresholds.selectedLeagueIds
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

  if (tennis) {
    try {
      const tnResult = await buildTennisCandidates(tennis.key, dates, forcedThresholds);
      fixtures.push(...tnResult.candidates);
      tennisFeedInfo = {
        sport: 'tennis',
        provider: 'SPORTRADAR',
        totalRecordsReceived: tnResult.rawTotal,
        fetchedAt: new Date().toISOString(),
        queryDates: dates,
        error: tnResult.partialError,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Tennis feed error: ${msg}`);
      tennisFeedInfo = {
        sport: 'tennis',
        provider: 'SPORTRADAR',
        totalRecordsReceived: 0,
        fetchedAt: new Date().toISOString(),
        queryDates: dates,
        error: msg,
      };
    }
  }

  return {
    fixtures,
    footballOver15FeedInfo,
    footballUnder35FeedInfo,
    tennisFeedInfo,
    footballConfigured: !!football,
    tennisConfigured: !!tennis,
    error: errors.length > 0 ? errors.join(' · ') : undefined,
  };
}

/* ============================== Feed health check ======================= */

export interface FeedHealthResult {
  sport: 'football' | 'tennis';
  provider: 'THESTATSAPI' | 'SPORTRADAR' | 'NONE';
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
  const tennis = chooseTennisProvider(settings);
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

  if (tennis) {
    try {
      const body = await apiGet(`/api/tennis/fixtures?date=${today}`, tennis.key);
      results.push({
        sport: 'tennis',
        provider: 'SPORTRADAR',
        status: 'ok',
        recordCount: (body?.fixtures || []).length,
        checkedAt: new Date().toISOString(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        sport: 'tennis',
        provider: 'SPORTRADAR',
        status: classifyFeedError(message),
        message,
        checkedAt: new Date().toISOString(),
      });
    }
  } else {
    results.push({ sport: 'tennis', provider: 'NONE', status: 'not_configured', checkedAt: new Date().toISOString() });
  }

  return results;
}
