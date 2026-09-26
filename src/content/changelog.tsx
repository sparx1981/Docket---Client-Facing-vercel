/**
 * One entry per day real changes ship. Newest first. When you make a change
 * on a day that already has an entry, add to that day's `items` rather than
 * creating a second entry for the same date.
 */
export interface ChangelogEntry {
  date: string; // YYYY-MM-DD
  items: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: '2026-09-26',
    items: [
      'Migrated hosting from AI Studio to Vercel, on a separate copy of the app so the original was never touched.',
      "Fixed the real bug behind missing football odds: TheStatsAPI's odds endpoint returns a nested per-bookmaker structure, not the flat list the code assumed — every match was silently coming back with zero odds.",
      'Added a version badge (build commit + time) and a Cloud/Local storage badge to every page, with hover explanations of what clearing your browser data would do.',
      'Fixed a provider status banner that permanently showed "Checking…" before the first scan of a session, regardless of whether anything was actually happening.',
      'Renamed header labels for clarity: "Auto-Scan" → "Next Scan", "Last scan" → "Last Scanned".',
      'Backtest: added a live progress bar, cached duplicate team/season lookups, merged a duplicate network call per match, and surfaced provider rate-limit waits in plain English instead of a silent stall.',
      'Backtest runs are now saved (with the exact rule thresholds used) so past runs can be reviewed and compared instead of disappearing on refresh.',
      'Daily scan: removed two real duplicate-request patterns (a repeated team match-history fetch, and a repeated fixture-list fetch when both rules share a league).',
      "Verified Qualifiers and Price Watch now persist across a refresh (auto-pruned once a fixture's kickoff passes), and a new \"Refresh Odds\" action re-checks just the market price without a full re-scan.",
      'Added a Help tab: a guided tour that navigates you through the real screens, the full in-app User Guide, and this changelog.',
      'Removed Guest Mode — it had a full backing implementation but no UI entry point, so it was unreachable dead code.',
      'Fixed several stale copy issues found during a QA pass (Price Watch and Archive tooltips referencing "connected" as if the odds integration wasn\'t live, when it is).',
      'Rewrote the e2e test suite (Firebase Auth Emulator + a test-only sign-in path) against the current app — the old suite targeted a retired app shape and was 15/22 failing.',
      'Fixed two guided tour bugs found in a manual walk-through: a step that both switched tabs and expanded a Settings section could miss the expand entirely, and the tour panel could cover its own highlighted "Save configuration" button.',
      'Redesigned the backtest result panel: a labeled stat grid instead of a cramped text line, plain-language explanation of the 60-match evaluation cap, the "Run Backtest" button moved to sit directly above its own result, and "Saved runs" is now collapsible (default collapsed).',
      'Added CSV export to backtest results and saved backtest runs, so the app\'s own numbers can be checked independently against the underlying matches.',
      'Found and fixed a real "looks live but isn\'t" bug in the email notification setting: nothing anywhere ever sends an email, but the field\'s own hint text claimed it did. Marked honestly as not-yet-implemented and disabled, rather than silently claiming to work.',
    ],
  },
];
