import type {
  FootballPrevSeasonStats,
  H2HMatchRecord,
  TeamRecentMatch,
  TennisPlayerStats,
  TennisRecentMatch,
} from '../src/types';

/**
 * Shapes every provider client normalizes into, before the route handlers
 * hand them back to the frontend. Kept intentionally close to (but decoupled
 * from) the domain types in src/types so a provider quirk never leaks
 * straight into the UI's data model.
 */

export interface NormalizedFixture {
  providerId: string;
  sport: 'football' | 'tennis';
  homeOrPlayer1: string;
  awayOrPlayer2: string;
  homeId?: string;
  awayId?: string;
  competition: string;
  matchTime: string; // ISO 8601
  venue?: string;
  surface?: 'Hard' | 'Clay' | 'Grass' | 'Carpet';
}

export interface NormalizedResult {
  providerId: string;
  homeOrPlayer1: string;
  awayOrPlayer2: string;
  competition: string;
  matchTime: string;
  isCompleted: boolean;
  finalScore?: string;
  homeScore?: number;
  awayScore?: number;
  /** Tennis only: set-by-set score string, e.g. "6-4 6-2 6-3". */
  setScore?: string;
  winner?: 'home' | 'away';
}

export interface NormalizedTeamProfile {
  team: string;
  prevSeason?: FootballPrevSeasonStats;
  recentMatches?: TeamRecentMatch[];
}

export interface NormalizedTennisProfile {
  /**
   * Only populated when the provider response contained enough real data
   * (ranking + surface win/loss record) to build every required field of
   * TennisPlayerStats without fabricating a number. Undefined otherwise —
   * callers should treat that fixture as missing tennis data rather than
   * inventing a stat.
   */
  player?: TennisPlayerStats;
  recentMatches?: TennisRecentMatch[];
}

export type { H2HMatchRecord };
