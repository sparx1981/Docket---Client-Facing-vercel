import {
  AppSettings,
  CandidateFixture,
  FootballPrevSeasonStats,
  H2HMatchRecord,
  RuleThresholds,
  TeamRecentMatch,
  TennisPlayerStats,
  TennisRecentMatch,
} from '../types';
import { evaluateFixture } from './rulesEngine';
import { apiGet } from './backendClient';

/**
 * Real fixture ingestion. Every candidate fixture on screen now comes from a
 * live Sportradar or Sportmonks call, proxied through our own backend
 * (server/index.ts) — never from hardcoded seed data. When no provider key
 * is configured, or every provider call fails, this returns an empty list
 * plus a human-readable error the UI can surface, rather than falling back
 * to anything fabricated.
 */

export interface FixtureFetchResult {
  fixtures: CandidateFixture[];
  /** Set when a provider was configured but the pull failed, or none was configured at all. */
  error?: string;
}

type FootballProvider = 'sportradar' | 'sportmonks';

// Judgment call: cap how many raw fixtures we enrich with team/H2H lookups
// per sport, per scan. A real daily card can run to dozens of fixtures and
// each one needs several follow-up calls (two team profiles [+ H2H for
// football]) to classify against the locked rules — bounding this keeps a
// manual "Run Daily Scan" click from fanning out into a very large number of
// requests. Raise this once real provider rate limits are known.
const MAX_FIXTURES_PER_SPORT = 12;

// How many days ahead (including today) to pull a fixture card for.
const DAYS_AHEAD = 3;

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

function choosefootballProvider(
  settings: AppSettings
): { provider: FootballProvider; key: string } | null {
  // Mirrors the existing provider-selection logic (useFallbackProviders /
  // whichever B2B key is present) — Sportradar is tried first when both are
  // configured, Sportmonks otherwise.
  if (settings.sportradarApiKey) return { provider: 'sportradar', key: settings.sportradarApiKey };
  if (settings.sportmonksApiKey) return { provider: 'sportmonks', key: settings.sportmonksApiKey };
  return null;
}

function chooseTennisProvider(settings: AppSettings): { key: string } | null {
  // Sportmonks has no tennis coverage — Sportradar is the only option.
  if (settings.sportradarApiKey) return { key: settings.sportradarApiKey };
  return null;
}

/* ============================== Football ============================== */

interface RawFootballFixture {
  providerId: string;
  homeOrPlayer1: string;
  awayOrPlayer2: string;
  homeId?: string;
  awayId?: string;
  competition: string;
  matchTime: string;
  venue?: string;
}

async function buildFootballCandidates(
  provider: FootballProvider,
  key: string,
  dates: string[],
  thresholds: RuleThresholds
): Promise<CandidateFixture[]> {
  const rawFixtures: RawFootballFixture[] = [];
  for (const date of dates) {
    const body = await apiGet(`/api/football/fixtures?date=${date}&provider=${provider}`, key);
    for (const f of body?.fixtures || []) {
      rawFixtures.push(f);
      if (rawFixtures.length >= MAX_FIXTURES_PER_SPORT) break;
    }
    if (rawFixtures.length >= MAX_FIXTURES_PER_SPORT) break;
  }

  const candidates: CandidateFixture[] = [];

  for (const fx of rawFixtures) {
    if (!fx.homeId || !fx.awayId) continue;

    let footballDetails: CandidateFixture['footballDetails'] | undefined;
    try {
      const [homeProfile, awayProfile, h2h] = await Promise.all([
        apiGet(`/api/football/team/${fx.homeId}?provider=${provider}`, key),
        apiGet(`/api/football/team/${fx.awayId}?provider=${provider}`, key),
        apiGet(`/api/football/h2h?team1=${fx.homeId}&team2=${fx.awayId}&provider=${provider}`, key),
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
    } catch {
      // Leave footballDetails undefined — the rules engine already handles
      // that as "missing data" rather than crashing or inventing stats.
      footballDetails = undefined;
    }

    // The same fixture is screened against both football systems — a real
    // match can qualify for Over 1.5, Under 3.5, both, or neither. A system
    // disabled in Engine Configuration is skipped entirely rather than shown
    // as a permanently-failed candidate.
    if (thresholds.footballOver15.enabled) {
      candidates.push(buildFootballCandidate('football_over_1_5', fx, footballDetails, thresholds, provider));
    }
    if (thresholds.footballUnder35.enabled) {
      candidates.push(buildFootballCandidate('football_under_3_5', fx, footballDetails, thresholds, provider));
    }
  }

  return candidates;
}

function buildFootballCandidate(
  system: 'football_over_1_5' | 'football_under_3_5',
  fx: RawFootballFixture,
  footballDetails: CandidateFixture['footballDetails'] | undefined,
  thresholds: RuleThresholds,
  provider: FootballProvider
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
    sourceProvider: provider === 'sportradar' ? 'SPORTRADAR' : 'SPORTMONKS',
    // No Betfair Exchange integration in phase 1 (see betfairMarket, which
    // is intentionally absent below) — there is no real current price to
    // report, so this is left at 0 rather than a fabricated figure. UI
    // surfaces this via betfairMarket being undefined, not via this field.
    currentOdds: 0,
    requiredOdds,
    oddsDifference: -requiredOdds,
    status: 'FAILED',
    footballDetails,
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
  thresholds: RuleThresholds
): Promise<CandidateFixture[]> {
  const rawFixtures: RawTennisFixture[] = [];
  for (const date of dates) {
    const body = await apiGet(`/api/tennis/fixtures?date=${date}`, key);
    for (const f of body?.fixtures || []) {
      rawFixtures.push(f);
      if (rawFixtures.length >= MAX_FIXTURES_PER_SPORT) break;
    }
    if (rawFixtures.length >= MAX_FIXTURES_PER_SPORT) break;
  }

  const candidates: CandidateFixture[] = [];

  for (const fx of rawFixtures) {
    if (!fx.homeId || !fx.awayId) continue;

    try {
      const [p1, p2] = await Promise.all([
        apiGet(`/api/tennis/player/${fx.homeId}`, key),
        apiGet(`/api/tennis/player/${fx.awayId}`, key),
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

      if (!selected || !opponent || !selectedRecent || selectedRecent.length === 0) {
        continue; // Not enough real data to classify this match — skip it rather than guess.
      }

      candidates.push(
        buildTennisCandidate(
          fx,
          {
            selectedPlayer: selected,
            opponentPlayer: opponent,
            playerRecentSingles: selectedRecent,
          },
          thresholds
        )
      );
    } catch {
      // Skip this fixture — no fabricated tennis data.
      continue;
    }
  }

  return candidates;
}

function buildTennisCandidate(
  fx: RawTennisFixture,
  tennisDetails: NonNullable<CandidateFixture['tennisDetails']>,
  thresholds: RuleThresholds
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

  const candidate: CandidateFixture = {
    id: `TN-SETS-${fx.providerId}`,
    sport: 'tennis',
    system: 'tennis_straight_sets',
    matchTitle,
    homeOrPlayer1: fx.homeOrPlayer1,
    awayOrPlayer2: fx.awayOrPlayer2,
    selectedEntity: `${tennisDetails.selectedPlayer.name} to Win in Straight Sets (${setsLabel})`,
    competition: fx.competition,
    matchTime: fx.matchTime,
    venue: fx.venue,
    surface: fx.surface || tennisDetails.selectedPlayer.surface,
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

export async function fetchCandidateFixtures(settings: AppSettings): Promise<FixtureFetchResult> {
  const football = choosefootballProvider(settings);
  const tennis = chooseTennisProvider(settings);

  if (!football && !tennis) {
    return {
      fixtures: [],
      error:
        'No data provider configured. Add a Sportradar or Sportmonks API key in Engine Configuration to pull real fixtures.',
    };
  }

  const thresholds = settings.ruleThresholds;
  const dates = nextDates(DAYS_AHEAD);
  const errors: string[] = [];
  const fixtures: CandidateFixture[] = [];

  if (football && (thresholds.footballOver15.enabled || thresholds.footballUnder35.enabled)) {
    try {
      fixtures.push(...(await buildFootballCandidates(football.provider, football.key, dates, thresholds)));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (!thresholds.tennisStraightSets.enabled) {
    // System disabled in Engine Configuration — skip the calls entirely.
  } else if (tennis) {
    try {
      fixtures.push(...(await buildTennisCandidates(tennis.key, dates, thresholds)));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  } else {
    errors.push('Tennis fixtures require a Sportradar API key (Sportmonks does not cover tennis).');
  }

  return { fixtures, error: errors.length > 0 ? errors.join(' · ') : undefined };
}
