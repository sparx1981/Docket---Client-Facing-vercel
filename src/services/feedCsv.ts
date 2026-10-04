import type { CandidateFixture, SystemFeedBreakdown } from '../types';
import {
  FOOTBALL_FILTERS,
  H2H_OVER15_WINDOW,
  H2H_UNDER35_WINDOW,
  MISSING_STATS_REASON,
  evaluateFootballOver15,
  evaluateFootballUnder35,
  footballFilterRequirements,
} from './rulesEngine.js';

/**
 * Builds the "Download Tabular CSV" export for one rule's data feed.
 *
 * Designed to be read by someone who has never seen the app's code:
 *  - one row per scanned match, best outcomes first;
 *  - a plain-English Result and Why in the first columns;
 *  - then, for every filter, three columns named exactly like the rule's
 *    fields in Engine Configuration: Result (PASS / FAIL / NO DATA), Actual
 *    (what was measured) and Required (what the rule demands).
 *
 * Every value comes from the rules engine's own evaluation of the match
 * against the thresholds the feed was screened with, so the file can never
 * disagree with why the app classified a match the way it did.
 */

type MatchResult = 'QUALIFIES' | 'PRICE WATCH' | 'DID NOT QUALIFY' | 'NOT ENOUGH DATA';

const RESULT_ORDER: Record<MatchResult, number> = {
  QUALIFIES: 0,
  'PRICE WATCH': 1,
  'DID NOT QUALIFY': 2,
  'NOT ENOUGH DATA': 3,
};

const NOT_LOADED = 'Not available — statistics could not be loaded';

/** Quotes a cell, and defuses spreadsheet formulas (a cell starting with = + - @ would otherwise be executed). */
function csvCell(value: unknown): string {
  let str = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  return `"${str.replace(/"/g, '""')}"`;
}

function formatKickoff(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 16).replace('T', ' ');
}

interface RowModel {
  result: MatchResult;
  kickoff: number;
  cells: string[];
}

export function buildFeedCsv(breakdown: SystemFeedBreakdown): string | null {
  const matches = breakdown.rawMatches ?? [];
  const thresholds = breakdown.ruleThresholds;
  if (matches.length === 0 || !thresholds) return null;
  if (breakdown.system !== 'football_over_1_5' && breakdown.system !== 'football_under_3_5') return null;

  const system = breakdown.system;
  const filters = FOOTBALL_FILTERS[system];
  const requirements = footballFilterRequirements(system, thresholds);
  const h2hWindow = system === 'football_over_1_5' ? H2H_OVER15_WINDOW : H2H_UNDER35_WINDOW;

  const headers = [
    'Result',
    'Why',
    'First filter failed',
    'Competition',
    'Kick-off (UTC)',
    'Home team',
    'Away team',
    ...filters.flatMap((f) => [`${f.label}: Result`, `${f.label}: Actual`, `${f.label}: Required`]),
    `Last ${h2hWindow} H2H meetings`,
    'Bookmaker',
    'Price checked (UTC)',
  ];

  const rows: RowModel[] = matches.map((m: CandidateFixture) => {
    const screening =
      system === 'football_over_1_5'
        ? evaluateFootballOver15(m, { ...(thresholds as any), enabled: true })
        : evaluateFootballUnder35(m, { ...(thresholds as any), enabled: true });
    const hasStats = !!m.footballDetails;

    const result: MatchResult = !hasStats
      ? 'NOT ENOUGH DATA'
      : screening.isVerifiedQualifier
      ? 'QUALIFIES'
      : screening.isPriceWatch
      ? 'PRICE WATCH'
      : 'DID NOT QUALIFY';

    let why: string;
    if (result === 'NOT ENOUGH DATA') {
      why = `${MISSING_STATS_REASON} Common causes: this match was beyond the first enriched matches in the scan, or TheStatsAPI has too little history for one of the teams.`;
    } else if (result === 'QUALIFIES') {
      why = `Passed all ${filters.length} filters.`;
    } else if (result === 'PRICE WATCH') {
      why = `${screening.failureReason}. It qualifies automatically if the price reaches the required level.`;
    } else {
      why = `${screening.failureReason}.`;
    }

    const firstFailed =
      result === 'NOT ENOUGH DATA'
        ? 'Not screened'
        : screening.filterChecks.find((c) => !c.passed)?.filterName ?? '—';

    const filterCells = filters.flatMap((f) => {
      const check = screening.filterChecks.find((c) => c.filterId === f.id);
      if (!check) return ['NO DATA', NOT_LOADED, requirements[f.id] ?? ''];
      const outcome = check.noData ? 'NO DATA' : check.passed ? 'PASS' : 'FAIL';
      return [outcome, check.actual ?? check.observedValue, check.required ?? check.targetRule];
    });

    const h2hList = m.footballDetails
      ? m.footballDetails.h2hMatches
          .filter((x) => x.isCompetitive)
          .slice(0, h2hWindow)
          .map((x) => `${x.date} ${x.homeTeam} ${x.homeScore}-${x.awayScore} ${x.awayTeam}`)
          .join(' | ') || 'No H2H meetings on record'
      : NOT_LOADED;

    const kickoffMs = new Date(m.matchTime).getTime();
    return {
      result,
      kickoff: Number.isNaN(kickoffMs) ? Number.MAX_SAFE_INTEGER : kickoffMs,
      cells: [
        result,
        why,
        firstFailed,
        m.competition,
        formatKickoff(m.matchTime),
        m.homeOrPlayer1,
        m.awayOrPlayer2,
        ...filterCells,
        h2hList,
        m.marketOdds?.bookmaker ?? (hasStats ? 'No price on file yet' : 'Not checked'),
        m.oddsCheckedAt && hasStats ? formatKickoff(m.oddsCheckedAt) : '',
      ],
    };
  });

  rows.sort((a, b) => RESULT_ORDER[a.result] - RESULT_ORDER[b.result] || a.kickoff - b.kickoff);

  // The BOM makes Excel read the file as UTF-8 so characters like — and · display correctly.
  return '﻿' + [headers, ...rows.map((r) => r.cells)].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** Triggers a browser download of the feed CSV. Returns false when there is nothing to export. */
export function downloadFeedCsv(breakdown: SystemFeedBreakdown): boolean {
  const csv = buildFeedCsv(breakdown);
  if (!csv) return false;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const slug = breakdown.system.toLowerCase().replace(/_/g, '-');
  link.href = url;
  link.download = `data-feed-${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  return true;
}
