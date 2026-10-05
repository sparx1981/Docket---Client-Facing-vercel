import React from 'react';
import {
  ShieldCheck,
  TrendingDown,
  BarChart3,
  X,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Layers,
  Check,
  Database,
  Info,
} from 'lucide-react';
import { TabKey } from './AppShell';
import { AppSettings, RuleThresholds } from '../types';

interface SectionInfoModalProps {
  section: TabKey | null;
  isOpen: boolean;
  onClose: () => void;
  settings: AppSettings;
}

interface SectionDetails {
  title: string;
  badge: string;
  strap: string;
  icon: React.ReactNode;
  summary: string | React.ReactNode;
  datasources: {
    name: string;
    purpose: string;
    url: string;
  }[];
  filtersExplanation: string;
  criteriaList: {
    rule: string;
    description: string;
  }[];
  included: string[];
  notIncluded: string[];
}

const SECTION_CONTENT: Record<Extract<TabKey, 'verified' | 'pricewatch' | 'analytics'>, SectionDetails> = {
  verified: {
    title: 'Verified Qualifiers',
    badge: "Today's Selections",
    strap: 'High-probability fixtures that cleared every locked filter and the market odds threshold',
    icon: <ShieldCheck className="h-6 w-6 text-brand-ink" strokeWidth={2.5} />,
    summary:
      'This section presents selections that have passed every single locked mathematical rule (domestic form, head-to-head consistency, and goal distributions) AND whose live market odds price is currently high enough to offer genuine statistical value.',
    datasources: [
      {
        name: 'Flashscore B2B Telemetry',
        purpose: 'Official kickoff times, verified lineups, domestic tables, and exact scores from the last 10 competitive matches.',
        url: 'https://www.flashscore.com/',
      },
      {
        name: 'TheStatsAPI Odds Endpoint',
        purpose: 'Real decimal odds pulled directly from TheStatsAPI for this fixture, whichever bookmaker(s) it returns.',
        url: 'https://www.thestatsapi.com/',
      },
    ],
    filtersExplanation:
      'Every candidate fixture is evaluated against the statistical filters configured in Engine Configuration → Filter Thresholds. There is zero manual discretion or gut feeling — but the numbers below are whatever is currently configured, not a fixed constant.',
    // Populated at render time from the live AppSettings.ruleThresholds — see
    // buildVerifiedCriteria below. Left empty here so there is no stale
    // fallback text that could drift from the real configured values.
    criteriaList: [],
    included: [
      'Genuine upcoming competitive fixtures scheduled in the next 24 to 48 hours.',
      'Only fixtures with a confirmed market price on file from TheStatsAPI\'s odds endpoint.',
      'Selections whose live market odds price meets or exceeds the required minimum hurdle right now.',
      'Fixtures with 100% data integrity verified across multiple independent data providers with 0% divergence.',
    ],
    notIncluded: [
      'Fixtures with no price on file yet from TheStatsAPI\'s odds endpoint.',
      'Matches that passed the stats but whose market odds are currently too short (those are held in Price Watch).',
      'Fixtures from competitions you have not selected. TheStatsAPI does not label friendlies, so a friendly can still appear in a team\'s recent form or head-to-head history.',
      'Unverified markets or fixtures where official kickoff schedules cannot be independently confirmed.',
    ],
  },
  pricewatch: {
    title: 'Price Watch',
    badge: 'Awaiting Market Price',
    strap: 'Statistically clean fixtures waiting for a market odds price to reach our minimum requirement',
    icon: <TrendingDown className="h-6 w-6 text-brand-ink" strokeWidth={2.5} />,
    summary:
      'This section acts as an automated holding room. These fixtures have cleared 100% of our domestic, head-to-head, and form criteria, but their current market odds are either too low or not yet on file to provide sufficient value over the long term.',
    datasources: [
      {
        name: 'Flashscore',
        purpose: 'Provide the verified historical form, league tables, and surface records that these fixtures have already 100% passed.',
        url: 'https://www.flashscore.com/',
      },
      {
        name: 'TheStatsAPI Odds Endpoint',
        purpose: 'Provides whatever market price(s) it currently has on file for this fixture. As a price appears or drifts up to our required minimum, the selection is automatically promoted.',
        url: 'https://www.thestatsapi.com/',
      },
    ],
    filtersExplanation:
      'Why odds matter: Even when a team has a very high chance of winning, backing them at odds of @1.10 or @1.14 is mathematically negative over hundreds of bets. We require a disciplined minimum price hurdle. As match time nears, market prices fluctuate and frequently drift into qualifying range.',
    criteriaList: [
      {
        rule: 'Statistical Integrity Cleared',
        description:
          'The match has already passed every single statistical check required for its sport. There are no form, defensive, or injury disqualifications.',
      },
      {
        rule: 'Current Odds Deficit',
        description:
          'The market odds price is currently sitting below our cutoff (e.g. @1.17 vs @1.20 required) or has no price on file yet. The table clearly displays this odds deficit.',
      },
      {
        rule: 'Automated Promotion Trigger',
        description:
          'If a fresh price appears at or above the required threshold prior to kickoff, the engine automatically moves the fixture to Verified Qualifiers.',
      },
    ],
    included: [
      'Fixtures that satisfied 100% of our statistical, head-to-head, and recent-form filters.',
      'Upcoming matches with market odds currently below the minimum cutoff, or with no price on file yet (with live deficit tracking where a price exists).',
      'Fixtures where a price is actively appearing or moving before kickoff.',
    ],
    notIncluded: [
      'Fixtures that failed any statistical or head-to-head tests (those are disqualified permanently).',
      'Suspended, closed, or illiquid betting markets.',
      'Selections that have already reached their qualifying price (those appear on the Verified Qualifiers tab).',
    ],
  },
  analytics: {
    title: 'Archive & Performance',
    badge: 'Audited Ledger',
    strap: 'A permanent, unalterable historical log of every verified selection, final score, and profit/loss',
    icon: <BarChart3 className="h-6 w-6 text-brand-ink" strokeWidth={2.5} />,
    summary: (
      <div className="space-y-3 text-[13px] leading-relaxed text-text-2">
        <div className="text-[14px] font-extrabold text-text">
          Archive &amp; Performance: Data Origin Clarified &amp; Unified
        </div>
        <p>
          <strong className="text-text">How Archive Data Works:</strong> &ldquo;Archive &amp; Performance&rdquo; maintains a permanent audit trail of selections and their settled profit/loss.
        </p>
        <div className="space-y-1.5">
          <div className="font-bold text-text">Both Automated &amp; User-Directed:</div>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              When automated scheduled daily scans run, qualified selections that meet the rules and price threshold are automatically logged into the Archive without requiring you to manually click anything.
            </li>
            <li>
              You can also manually audit any individual match from the drawer and click File to archive ledger.
            </li>
            <li>
              Historical fixtures are backed by verified match scores with direct links to official data feeds (Flashscore and TheStatsAPI).
            </li>
          </ul>
        </div>
        <p>
          <strong className="text-text">Automated Score Settlement:</strong> An auto-settlement engine checks when match kick-off/start times have elapsed, looks up the official final score, and auto-settles pending picks to WON or LOST, updating the cumulative P&amp;L curve automatically. You can also trigger an instant auto-settle via the banner in Archive &amp; Performance.
        </p>
      </div>
    ),
    datasources: [
      {
        name: 'Official League & Grand Slam Scoreboards',
        purpose: 'Confirmed full-time scores from Premier League, Bundesliga, Serie A, and ATP/WTA Grand Slams.',
        url: 'https://www.flashscore.com/',
      },
      {
        name: 'TheStatsAPI Odds Endpoint',
        purpose: 'Where a real price was available, records the entry odds a settled selection was priced at.',
        url: 'https://www.thestatsapi.com/',
      },
      {
        name: 'Independent Audit Engines',
        purpose: 'Cross-verifies every settled match against Google search and Flashscore records to guarantee zero score discrepancies.',
        url: 'https://www.google.com/',
      },
    ],
    filtersExplanation:
      'Performance metrics are calculated honestly with fixed staking to ensure results cannot be obscured or inflated.',
    criteriaList: [
      {
        rule: 'Flat Staking Discipline',
        description:
          'Every selection is tracked with a consistent £100 stake (or custom user-defined stake) so that a winning streak on a small bet cannot mask a loss on a large bet.',
      },
      {
        rule: 'Win Rate & Strike Rate',
        description:
          'Win Rate represents the exact percentage of settled selections that won (Wins ÷ [Wins + Losses]). Strike Rate accounts for all logged selections.',
      },
      {
        rule: 'Return on Investment (ROI)',
        description:
          'Net profit or loss divided by total money staked across all settled bets, expressed as a clean percentage.',
      },
    ],
    included: [
      'Every verified selection logged by the daily scan routine.',
      'Both winning and losing selections — zero cherry-picking or deleted losses.',
      'Verified final scorelines with direct one-click verification links to confirm each match on Google and Flashscore.',
      'Cumulative profit and loss trajectory curve showing the long-term equity growth.',
    ],
    notIncluded: [
      'Simulated or paper bets that were not genuinely qualified by the system rules on the day.',
      'Pending or in-play matches (only fully settled matches are factored into win rate and profit calculations).',
      'Distorted staking systems (such as Martingale or variable loss chasing).',
    ],
  },
};

const pct = (rate: number) => `${Math.round(rate * 100)}%`;

/**
 * Builds the "Selection Criteria & Rules" list for Verified Qualifiers from
 * whatever is actually configured in Engine Configuration → Filter
 * Thresholds, rather than a hardcoded copy of the numbers that could drift
 * out of sync the moment someone changes a threshold.
 */
function buildVerifiedCriteria(t: RuleThresholds): SectionDetails['criteriaList'] {
  return [
    {
      rule: 'Football: Over 1.5 Goals',
      description: t.footballOver15.enabled
        ? `Both teams must average ≥${t.footballOver15.minPrevSeasonAvgScored.toFixed(2)} goals scored per match last season, ≥${pct(t.footballOver15.minH2HOver15Rate)} of their last 5 head-to-head meetings must have finished Over 1.5 goals, each team must have scored in ≥${t.footballOver15.minRecentScoredCount} of their last 5 competitive matches, and the market odds price must be at least ${t.footballOver15.minExchangeOdds.toFixed(2)} (enhanced verification triggers above ${t.footballOver15.enhancedOddsThreshold.toFixed(2)}).`
        : 'Currently disabled in Engine Configuration — no fixtures are screened against this system.',
    },
    {
      rule: 'Football: Under 3.5 Goals',
      description: t.footballUnder35.enabled
        ? `Both teams must average below ${t.footballUnder35.maxPrevSeasonAvgScored.toFixed(2)} scored AND below ${t.footballUnder35.maxPrevSeasonAvgConceded.toFixed(2)} conceded per match last season, ≥${pct(t.footballUnder35.minH2HUnder35Rate)} of their last 10 head-to-head meetings must have finished Under 3.5 goals, each team must independently have ≥${t.footballUnder35.minRecentUnder35Count} of their last 5 matches finish Under 3.5, and the market odds price must be at least ${t.footballUnder35.minExchangeOdds.toFixed(2)}.`
        : 'Currently disabled in Engine Configuration — no fixtures are screened against this system.',
    },
  ];
}

export const SectionInfoModal: React.FC<SectionInfoModalProps> = ({
  section,
  isOpen,
  onClose,
  settings,
}) => {
  if (!isOpen || !section || section === 'settings') return null;

  const content = SECTION_CONTENT[section];
  if (!content) return null;

  const criteriaList =
    section === 'verified' ? buildVerifiedCriteria(settings.ruleThresholds) : content.criteriaList;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="info-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        aria-hidden="true"
      />

      {/* Modal Container */}
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-surface shadow-plate overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-surface-2 px-6 py-4.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-line bg-brand-soft">
              {content.icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="info-modal-title"
                  className="text-[17px] font-extrabold text-text tracking-tight sm:text-[19px]"
                >
                  {content.title}
                </h2>
                <span className="rounded-md border border-brand-line bg-brand-soft px-2 py-0.5 font-mono text-[10px] font-bold text-brand-ink uppercase tracking-wider">
                  {content.badge}
                </span>
              </div>
              <p className="text-[12px] text-text-2">{content.strap}</p>
            </div>
          </div>

          <button
            id="btn-close-section-info"
            onClick={onClose}
            aria-label="Close information modal"
            className="rounded-lg border border-line bg-surface p-1.5 text-text-3 transition-colors hover:border-brand hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Summary */}
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-text mb-1.5">
              <Info className="h-4 w-4 text-brand-ink" />
              Overview
            </h3>
            {typeof content.summary === 'string' ? (
              <p className="text-[13px] leading-relaxed text-text-2">
                {content.summary}
              </p>
            ) : (
              content.summary
            )}
          </div>

          {/* Data Sources */}
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-extrabold text-text mb-3">
              <Database className="h-4 w-4 text-brand-ink" />
              Connected Data Sources
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {content.datasources.map((src) => (
                <div
                  key={src.name}
                  className="flex flex-col justify-between rounded-xl border border-line bg-surface-2 p-3.5"
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="text-[12px] font-bold text-text">
                        {src.name}
                      </span>
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-3 hover:text-brand-ink transition-colors"
                        title={`Visit ${src.name}`}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <p className="text-[11px] leading-relaxed text-text-2">
                      {src.purpose}
                    </p>
                  </div>
                  <div className="mt-2.5 flex items-center gap-1 text-[10px] font-mono text-ok-ink">
                    <Check className="h-3 w-3 stroke-[2.5]" />
                    <span>Real-time verified</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Criteria / Filters */}
          <div>
            <h3 className="flex items-center gap-2 text-[14px] font-extrabold text-text mb-1.5">
              <Layers className="h-4 w-4 text-brand-ink" />
              Selection Criteria &amp; Rules
            </h3>
            <p className="text-[12px] text-text-2 mb-3">
              {content.filtersExplanation}
            </p>
            <div className="space-y-2.5">
              {criteriaList.map((crit) => (
                <div
                  key={crit.rule}
                  className="rounded-xl border border-line bg-surface-2 p-3.5"
                >
                  <div className="text-[12px] font-bold text-text mb-1">
                    {crit.rule}
                  </div>
                  <p className="text-[12px] leading-relaxed text-text-2">
                    {crit.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* What is Included & What is NOT Included */}
          <div className="grid gap-4 sm:grid-cols-2 pt-1">
            {/* What is Included */}
            <div className="rounded-xl border border-ok-line bg-ok-soft/30 p-4">
              <h4 className="flex items-center gap-1.5 text-[13px] font-bold text-ok-ink mb-3">
                <CheckCircle2 className="h-4 w-4" />
                What IS Included
              </h4>
              <ul className="space-y-2.5 text-[12px] text-text leading-relaxed">
                {content.included.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ok text-white">
                      <Check className="h-2.5 w-2.5 stroke-[3]" />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* What is NOT Included */}
            <div className="rounded-xl border border-bad-line bg-bad-soft/30 p-4">
              <h4 className="flex items-center gap-1.5 text-[13px] font-bold text-bad-ink mb-3">
                <XCircle className="h-4 w-4" />
                What is NOT Included
              </h4>
              <ul className="space-y-2.5 text-[12px] text-text leading-relaxed">
                {content.notIncluded.map((item, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-bad text-white">
                      <X className="h-2.5 w-2.5 stroke-[3]" />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-line bg-surface-2 px-6 py-3.5">
          <button
            id="btn-got-it-section-info"
            onClick={onClose}
            className="rounded-lg bg-brand px-4 py-2 text-[12px] font-bold text-white transition-opacity hover:opacity-90 cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
