import React from 'react';

/**
 * Single source of truth for both the in-app User Guide page (HelpView)
 * and the standalone downloadable PDF — so the two never drift apart the
 * way the old standalone PDF drifted from the app after the TheStatsAPI
 * migration, the backtest persistence feature, and the storage-badge work.
 */

export interface GuideTableRow {
  label: string;
  browser: string;
  cloud: string;
}

export interface GuideSection {
  id: string;
  heading: string;
  paragraphs?: string[];
  table?: { columns: [string, string, string]; rows: GuideTableRow[] };
  bullets?: string[];
  endpointsCalled?: string;
}

export const GUIDE_UPDATED_AT = '2026-09-26';

export const USER_GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'what-this-app-does',
    heading: 'What This App Does',
    paragraphs: [
      'The Docket scans real football fixtures against a fixed set of statistical rules, and tells you when a match meets every condition. It never guesses or invents numbers — every figure you see (goals scored, head-to-head record, exchange price) is either a genuine figure pulled from TheStatsAPI, or clearly marked as missing.',
      'This guide walks through exactly what happens, step by step, each time you use the app: what gets downloaded, what gets checked, and where your data lives. It\'s written for a user of the app, not a developer — no code, just what happens and why.',
      'The short version: you tell the app which leagues you care about (Engine Configuration → Leagues), the app only ever downloads data for those leagues, and it screens every upcoming match in that window against your rules. Matches that pass every statistical check and have an acceptable price show up as Verified Qualifiers. Matches that pass the stats but not the price show up in Price Watch. Everything that\'s actually been settled — win or lose — lives in Archive & Performance. Backtest is a separate, on-demand "what if" tool that replays history rather than tracking real bets.',
    ],
  },
  {
    id: 'where-your-data-lives',
    heading: 'Where Your Data Lives',
    paragraphs: [
      'The app keeps two separate copies of most of your data: one in your browser (so the app works instantly, and survives a refresh) and one in the cloud database (so it follows you across devices, once you sign in with Google — the app requires a Google sign-in to use).',
      'Every page heading carries a small badge — Cloud, Browser, or Local — telling you exactly which of these applies to that page. Hover the badge for a plain-English explanation of what happens to that data if you clear your browser\'s cache or site data.',
    ],
    table: {
      columns: ['Data', 'Browser', 'Cloud database'],
      rows: [
        {
          label: 'Engine Configuration (leagues, thresholds, schedule, API key)',
          browser: 'Yes — localStorage',
          cloud: 'Yes — synced on every save',
        },
        {
          label: 'League catalogue (the full list of competitions loaded from the provider)',
          browser: 'Yes — persists across reloads',
          cloud: 'Yes — synced',
        },
        {
          label: "Today's scan results (Verified Qualifiers / Price Watch)",
          browser: "Yes — persists across a refresh until a fixture's kickoff time passes, at which point it's automatically dropped",
          cloud: 'No — a live snapshot, not stored history',
        },
        {
          label: 'Archive & Performance (settled bets)',
          browser: 'Yes',
          cloud: 'Yes — synced',
        },
        {
          label: 'Sync / scan logs',
          browser: 'Yes',
          cloud: 'Yes — synced',
        },
        {
          label: 'Saved backtest runs',
          browser: 'Yes',
          cloud: 'Yes — synced, so past runs are comparable across devices',
        },
      ],
    },
  },
  {
    id: 'scheduled-scan',
    heading: 'When a Scheduled Data Scan Runs',
    paragraphs: [
      "Every 30 seconds, the app quietly checks whether it's time to run the scan you scheduled in Engine Configuration — either because 24 hours have passed since the last scan, or because today's scheduled time has arrived and the last scan happened before it. When it's due, the scan starts automatically, with no confirmation prompt (you already set the schedule deliberately).",
      "What it downloads: the scan only ever looks at the leagues you've selected and saved against each rule (Over 1.5, Under 3.5). If a rule is switched on but has no leagues selected, that rule is skipped entirely with an error rather than falling back to \"all leagues.\" For each selected league, the app calls TheStatsAPI's fixtures endpoint filtered by that competition and a 3-day-ahead date window — never an unfiltered, all-competitions request. When Over 1.5 and Under 3.5 share a league, the identical fixture-list request is only ever made once and reused, not fetched twice.",
      "What it checks: from the fixtures returned, up to 40 per rule are enriched with real supporting data — each team's profile and season stats, recent form, and head-to-head history. This cap exists to keep the scan fast and the provider calls proportionate; if more than 40 candidate fixtures come back, the extra ones are left unscreened for that run. Every enriched fixture is then run through your rule thresholds (previous-season scoring/conceding averages, head-to-head rate, recent-form scoring, and exchange price).",
      "What gets stored: the results — today's Verified Qualifiers and Price Watch lists — are saved in your browser so they survive a refresh, and are pruned automatically once a fixture's kickoff time passes. They are not written to the cloud database as a dated snapshot; a fresh scan replaces them. Anything that is later settled against a real final score (see Archive & Performance below) is what actually gets saved long-term.",
      "Occasionally you may see a message that TheStatsAPI's own rate limit was reached and the app is waiting before automatically retrying. This is expected behaviour under a constrained plan, not a failure — the scan is still running, just paced to the provider's real limit.",
    ],
    endpointsCalled:
      "GET /football/matches (params: competition_id, date_from, date_to, status) for fixtures · GET /football/teams/{id} and GET /football/teams/{id}/stats (param: season_id) plus a head-to-head lookup for each enriched fixture · GET /football/matches/{match_id}/odds for pricing — all scoped to your selected leagues, capped at 40 enriched fixtures per rule.",
  },
  {
    id: 'manual-scan',
    heading: 'When You Run a Manual Scan',
    paragraphs: [
      'Clicking "Run Daily Scan" does not immediately start downloading anything. It first opens a confirmation modal that spells out, in plain language, exactly what\'s about to happen — which leagues are in scope, roughly how many fixtures that covers, and that it\'s the same 3-day-ahead window and rule thresholds as a scheduled scan. This exists so you can\'t accidentally trigger a large, expensive scan without seeing what it will pull first.',
      'Only once you click "Start scan" in that modal does the app actually begin. From that point on, a manual scan behaves identically to a scheduled one — same league-scoped fixture calls, same 40-fixture enrichment cap per rule, same rule evaluation, same storage behaviour. The only difference is who triggered it and when.',
      'The header also shows "Next Scan: HH:MM UTC" (your configured daily schedule time) and "Last Scanned HH:MM" (when the most recent scan — scheduled or manual — actually finished), so you always know where things stand without opening Sync History.',
    ],
    endpointsCalled: 'Identical to a scheduled scan (see above) — no additional endpoints are called just because it was triggered manually.',
  },
  {
    id: 'refresh-odds',
    heading: 'Refreshing Just the Odds',
    paragraphs: [
      'A full scan re-checks everything — team stats, head-to-head, recent form, and price — for up to 40 fixtures per rule. But between scans, the only thing that actually moves is the market price; the underlying stats are slow-moving historical facts that don\'t change within hours.',
      'The "Refresh Odds" button in the header (next to "Run Daily Scan") re-checks only the market price for the fixtures currently on screen, leaving everything else untouched — one provider call per match instead of the roughly four a full scan costs. The button shows "Odds as of HH:MM," the oldest (least-recently-checked) odds timestamp among your held fixtures, so you always know how stale the least-fresh price actually is before deciding whether to refresh.',
      'A fixture whose price moves into range after a Refresh Odds is promoted from Price Watch to Verified Qualifiers immediately, the same way it would be after a full scan.',
    ],
    endpointsCalled: 'GET /football/matches/{match_id}/odds — one call per currently-held fixture, deduped when Over 1.5 and Under 3.5 both track the same match.',
  },
  {
    id: 'feed-impact-popups',
    heading: 'Hovering the Feed / Impact Popups',
    paragraphs: [
      "Within Filter Thresholds, hovering the small badge next to a rule opens a popup explaining that rule's data pipeline: which league(s) are currently selected for it, roughly how many fixtures were pulled in the last scan, how many were enriched with team/H2H data (subject to the 40-fixture cap), and how many ultimately passed or failed each individual filter.",
      "This popup makes no network calls of its own — it is a read-only display built entirely from the results of the most recent scan already sitting in the browser. Hovering it as many times as you like costs nothing against your provider allowance. If you haven't run a scan yet in this session, or the feed came back with 0 records, the individual per-field badges are hidden rather than repeating the same not-yet-available message on every single field.",
    ],
    endpointsCalled: 'None — this is a purely read-only view of data already sitting in the browser from the last scan.',
  },
  {
    id: 'backtest',
    heading: 'Running a Backtest',
    paragraphs: [
      'Each rule card has its own "Run Backtest" button, below that rule\'s threshold fields, directly above its result. Clicking it asks TheStatsAPI for that rule\'s selected league(s) worth of genuinely completed historical matches (one call per league, merged together), then samples up to 200 of them.',
      "For up to 60 of those sampled matches, the app then reconstructs exactly what your rule would have seen before kickoff on that historical date — not a same-day snapshot. That cap exists because reconstructing full context (team form, season averages, head-to-head) costs several live provider calls per match; when a run finds more than 60 finished matches, the result panel says so explicitly rather than silently evaluating fewer than it found. It does this by calling the provider with a cutoff set to the match date and the correct historical season, so team form and season averages reflect only what had actually happened by that point in time. Each match is then run through the identical rule engine used for live scans, so a backtest match either qualifies or doesn't for exactly the same reasons a live one would. Team names, season stats, and recent-form lookups are cached and reused across matches that share a team or a date within the same run, so a backtest costs fewer real provider calls than evaluating each match in isolation would.",
      "While it runs, a progress bar shows \"match X of Y,\" and if TheStatsAPI's own rate limit is hit partway through, a plain-English note explains that the run is still going, just waiting before an automatic retry — never a silent stall with no explanation.",
      'Every qualifying match is then settled against its real final score, and the result shows as a labeled grid — wins, losses, win rate, required odds, net units and ROI at that required price. Limitation: Backtest does not re-query TheStatsAPI\'s odds endpoint for each historical match, so backtest results are priced at your configured minimum-odds threshold rather than a real historical market price — the statistical qualification is real, the price is a stated assumption.',
      'Every result — the one just run, or any saved run underneath it — has its own "Export CSV" button. The file opens with a header block confirming when the backtest ran, which rule and thresholds were applied, and the same summary numbers shown on screen, then a blank gap, then a header row and one row per real match evaluated — so you can independently check the app\'s own claims against the underlying matches.',
    ],
    endpointsCalled:
      '/api/football/backtest-results (one call per league) · /api/football/backtest-context (per evaluated match, capped at 60) — all scoped to the rule\'s selected league(s).',
  },
  {
    id: 'saved-backtest-runs',
    heading: 'Saved Backtest Runs',
    paragraphs: [
      "Every completed backtest is automatically saved — to your browser and, if you're signed in, synced to the cloud — instead of disappearing the moment you navigate away or refresh the page. Each saved run freezes the exact rule thresholds that were in effect when you ran it, so if you tweak Engine Configuration afterwards, an old run still shows exactly what setup produced that result.",
      'A "Saved runs" list appears under each rule\'s backtest card — collapsed by default so it doesn\'t crowd the result you just ran, expand it to see run time, ROI, win rate, net units, sample size, and the key thresholds tested — sortable by most-recent or best-ROI, so if you try several different configurations you can quickly find which one actually performed best. Each saved run has its own Export CSV button, and can be deleted individually; the list is capped at 100 saved runs.',
    ],
  },
  {
    id: 'verified-qualifiers',
    heading: 'Verified Qualifiers',
    paragraphs: [
      'What it\'s for: this is the headline list — fixtures from your latest scan that passed every condition of a rule: the statistical filters (previous-season form, head-to-head history, recent scoring/conceding form) and the price filter (a live market odds price, from TheStatsAPI\'s own odds endpoint, at or above your configured minimum). Anything here has cleared the full bar with no compromises.',
      "Limitation: Verified Qualifiers depends on TheStatsAPI having a market price on file for a fixture at scan time — whichever bookmaker(s) it returns, not limited to any single exchange or sportsbook. Fixtures listed well ahead of kickoff sometimes have no price yet; those show up as statistically qualifying but land in Price Watch until a price appears, not because anything failed.",
    ],
    endpointsCalled:
      "None directly — this tab displays fixtures from the most recent scan (or the most recent Refresh Odds), held in your browser.",
  },
  {
    id: 'price-watch',
    heading: 'Price Watch',
    paragraphs: [
      "What it's for: fixtures that passed every statistical filter for a rule but not the price filter — i.e. the match itself looks right, but the required market odds price either wasn't on file yet or wasn't good enough. This is where you'd normally keep an eye on a match as kickoff approaches, in case the price moves into range — either by waiting for the next scan, or by clicking Refresh Odds for an immediate, lightweight re-check.",
      "Limitation: a fixture lands here for one of two reasons — its market odds price is below your configured minimum, or TheStatsAPI has no price on file for it yet at scan time. The table doesn't currently distinguish the two cases in the list view (open a fixture's audit card to see which applies). Both are promoted automatically to Verified Qualifiers the next time a price check runs and a qualifying price is present.",
    ],
    endpointsCalled: 'None directly — same as Verified Qualifiers, this tab displays fixtures already held in your browser.',
  },
  {
    id: 'archive-performance',
    heading: 'Archive & Performance',
    paragraphs: [
      "What it's for: this is your real, running record — every bet that has actually been logged and settled against a genuine final score, with running P&L, win rate and ROI. Records get in here two ways: automatically, from a one-off 30-day historical backfill the first time the app runs, and manually, whenever you log a fixture from the Verification Drawer after reviewing its audit. Pending logged bets are settled automatically as soon as the provider confirms a final score.",
      'Limitation: Archive does not re-query TheStatsAPI\'s odds endpoint for historical matches — backfilled and logged records are priced at each rule\'s disclosed minimum qualifying odds, not a real historical market price, and this is stated plainly in each record\'s notes.',
      'Why this is different from Backtest: Backtest is a simulation — you pick a league scope, and it re-runs the rule engine on demand against a sample of real historical matches to ask "how would this rule have performed?" Archive & Performance is not a simulation — it\'s the actual ledger of bets this app has identified and logged, kept permanently, synced to the cloud, and built up over time as real scans and real settlements happen. Put simply: Backtest asks "what if," Archive & Performance records "what actually happened."',
    ],
    endpointsCalled:
      'GET /api/football/results (params: from, to, competitionId) — one call per selected league, used for the one-time 30-day historical backfill on first run and for ongoing settlement of pending logged bets against real final scores.',
  },
  {
    id: 'glossary',
    heading: 'Glossary',
    bullets: [
      "League scope — the specific competition(s) you've selected and saved for a rule. Every provider call that rule makes is limited to those leagues only.",
      'Qualifier — a fixture that has passed a rule\'s statistical filters (form, head-to-head, recent results).',
      "Verified Qualifier — a qualifier that has also passed the price filter, checked against a live price from TheStatsAPI's own odds endpoint.",
      "Price Watch — a qualifier that passed the stats but not (yet, or currently ever) the price filter.",
      'Refresh Odds — a lightweight, on-demand re-check of just the market price for fixtures already on screen, without re-running the rest of the scan.',
      'Enrichment — the step where a raw fixture is topped up with real team profile, season-stats and head-to-head data so the rule engine has enough to evaluate it. Capped at 40 fixtures per rule per scan.',
      'Backtest — an on-demand simulation that replays real historical matches through the same rule engine to show how a rule would have performed.',
      'Saved backtest run — a backtest\'s result, saved with the exact rule thresholds used, so it can be reviewed and compared later.',
      'Archive & Performance — the permanent, real record of bets this app has actually logged and settled.',
      'Scan — the process of downloading current fixtures for your selected leagues and screening them against your rules. Can be scheduled (automatic) or manual (button + confirmation).',
      'Storage badge — the Cloud / Browser / Local indicator on every page heading, showing where that page\'s data actually lives, and what clearing your browser data would do to it.',
    ],
  },
];
