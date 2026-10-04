import type {
  FootballPrevSeasonStats,
  H2HMatchRecord,
  TeamRecentMatch,
} from '../src/types';

/**
 * Shapes every provider client normalizes into, before the route handlers
 * hand them back to the frontend. Kept intentionally close to (but decoupled
 * from) the domain types in src/types so a provider quirk never leaks
 * straight into the UI's data model.
 */

export interface NormalizedFixture {
  providerId: string;
  sport: 'football';
  homeOrPlayer1: string;
  awayOrPlayer2: string;
  homeId?: string;
  awayId?: string;
  competition: string;
  matchTime: string; // ISO 8601
  venue?: string;
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
  winner?: 'home' | 'away';
}

export interface NormalizedTeamProfile {
  team: string;
  prevSeason?: FootballPrevSeasonStats;
  recentMatches?: TeamRecentMatch[];
}

export type { H2HMatchRecord };
