import React from 'react';
import {
  Check,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  Info,
  Radio,
  Sliders,
  TrendingDown,
  X,
} from 'lucide-react';
import { AppSettings, CandidateFixture } from '../types';
import { Chip, EmptyState, Plate, PlateHeader, PriceTag } from './ui';

interface PriceWatchTableProps {
  items: CandidateFixture[];
  onSelectFixture: (fixture: CandidateFixture) => void;
  /** Set when no fixtures could be loaded at all (no provider key, or the last pull failed). */
  loadError?: string | null;
  settings: AppSettings;
}

const googleUrl = (f: CandidateFixture) =>
  f.googleVerificationUrl ||
  `https://www.google.com/search?q=${encodeURIComponent(
    `${f.matchTitle} ${f.competition} fixture date time`
  )}`;

const formatKickoff = (iso: string) => {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString([], {
      day: 'numeric',
      month: 'short',
    })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return iso;
  }
};

/* How far the price has to travel, drawn rather than described. */
const GapBar: React.FC<{ current: number; required: number }> = ({
  current,
  required,
}) => {
  const progress = Math.max(0, Math.min(1, current / required));
  return (
    <div className="w-full">
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-warn transition-[width] duration-500"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
      <div className="mt-1 font-mono text-[10px] text-text-3">
        {Math.round(progress * 100)}% of required price
      </div>
    </div>
  );
};

/* Exchange odds are absent until phase 2 (Betfair) lands — say so plainly rather than showing a number. */
const NotYetConnected: React.FC = () => (
  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-warn-ink">
    Not yet connected — exchange odds integration pending
  </span>
);

export const PriceWatchTable: React.FC<PriceWatchTableProps> = ({
  items,
  onSelectFixture,
  loadError,
  settings,
}) => {
  const [filterPopoverOpen, setFilterPopoverOpen] = React.useState(false);
  const t = settings.ruleThresholds;
  const pct = (rate: number) => `${Math.round(rate * 100)}%`;

  return (
    <div id="price-watch-view" className="space-y-5">
      {/* ---- Explanation strip ---- */}
      <div className="relative flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-warn-line bg-warn-soft px-4 py-3">
        <Radio className="mt-0.5 h-4 w-4 shrink-0 text-warn-ink" strokeWidth={2.5} />
        <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-text-2">
          <span className="font-bold text-warn-ink">
            Statistics passed, price short.
          </span>{' '}
          These fixtures satisfied every domestic, head-to-head and recent-form{' '}
          <span
            className="group relative inline-block cursor-help font-bold text-warn-ink underline decoration-warn-line decoration-dashed underline-offset-4 hover:text-brand-ink"
            onMouseEnter={() => setFilterPopoverOpen(true)}
            onMouseLeave={() => setFilterPopoverOpen(false)}
            // Deliberately "open", not a toggle: a mouse click fires
            // mouseenter (opening it) immediately before the click handler
            // runs, so a toggle here would instantly re-close it on every
            // click — the popover could never actually be opened by
            // clicking, only by hovering. This also gives touch/keyboard
            // activation (which never fires mouseenter) a way in.
            onClick={() => setFilterPopoverOpen(true)}
            tabIndex={0}
            role="button"
            aria-haspopup="dialog"
            aria-expanded={filterPopoverOpen}
          >
            filter
            <Info className="ml-0.5 inline h-3 w-3 align-baseline opacity-70" />

            {/* Hover popup with applied filter conditions */}
            {filterPopoverOpen && (
              <div
                className="absolute left-1/2 top-full z-50 mt-2 w-[340px] -translate-x-1/2 rounded-xl border border-line-strong bg-surface p-4 text-left shadow-modal sm:w-[420px]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-2.5 flex items-center justify-between border-b border-line pb-2">
                  <div className="flex items-center gap-1.5">
                    <Sliders className="h-4 w-4 text-brand-ink" strokeWidth={2.5} />
                    <span className="text-[13px] font-extrabold text-text">
                      Screening Filter Conditions
                    </span>
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">
                    Editable in Settings
                  </span>
                </div>

                <div className="space-y-2.5 text-[11px] text-text-2">
                  {/* Rule A: Football Over 1.5 Goals */}
                  <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                    <div className="flex items-center justify-between font-bold text-text">
                      <span>Football: Over 1.5 Goals</span>
                      <span className="font-mono text-[10px] text-brand-ink font-semibold">
                        {t.footballOver15.enabled ? `min @${t.footballOver15.minExchangeOdds.toFixed(2)}` : 'disabled'}
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-1 text-text-2">
                      <li className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
                        <span>Both teams avg &ge; {t.footballOver15.minPrevSeasonAvgScored.toFixed(2)} goals scored/match last season</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
                        <span>&ge;{pct(t.footballOver15.minH2HOver15Rate)} of last 5 head-to-head meetings Over 1.5 goals</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
                        <span>Each team scored in &ge;{t.footballOver15.minRecentScoredCount} of last 5 competitive matches</span>
                      </li>
                    </ul>
                  </div>

                  {/* Rule B: Football Under 3.5 Goals */}
                  <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                    <div className="flex items-center justify-between font-bold text-text">
                      <span>Football: Under 3.5 Goals</span>
                      <span className="font-mono text-[10px] text-brand-ink font-semibold">
                        {t.footballUnder35.enabled ? `min @${t.footballUnder35.minExchangeOdds.toFixed(2)}` : 'disabled'}
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-1 text-text-2">
                      <li className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
                        <span>Both teams avg &lt; {t.footballUnder35.maxPrevSeasonAvgScored.toFixed(2)} scored AND &lt; {t.footballUnder35.maxPrevSeasonAvgConceded.toFixed(2)} conceded last season</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
                        <span>&ge;{pct(t.footballUnder35.minH2HUnder35Rate)} of last 10 head-to-head meetings Under 3.5 goals</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
                        <span>Each team independently &ge;{t.footballUnder35.minRecentUnder35Count} of last 5 matches Under 3.5</span>
                      </li>
                    </ul>
                  </div>

                  {/* Rule C: Tennis Straight Sets */}
                  <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                    <div className="flex items-center justify-between font-bold text-text">
                      <span>Tennis: Straight Sets (2–0 / 3–0)</span>
                      <span className="font-mono text-[10px] text-brand-ink font-semibold">
                        {t.tennisStraightSets.enabled ? `min @${t.tennisStraightSets.minExchangeOdds.toFixed(2)}` : 'disabled'}
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-1 text-text-2">
                      <li className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
                        <span>Selected player ranked &ge;{t.tennisStraightSets.minRankingDelta} places higher than opponent</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
                        <span>Career surface win rate &ge;{t.tennisStraightSets.minSurfaceWinRate.toFixed(1)}%</span>
                      </li>
                      <li className="flex items-start gap-1.5">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-ok-ink" strokeWidth={3} />
                        <span>Won &ge;{t.tennisStraightSets.minRecentWinsCount} of last 10 completed competitive singles</span>
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2 font-mono text-[10px] text-text-3">
                  <span>Holds candidates until Exchange back price meets minimum.</span>
                  <span className="text-brand-ink font-semibold">From Engine Configuration</span>
                </div>
              </div>
            )}
          </span>
          . Some are waiting on a real exchange price below the required minimum; others are
          waiting because Betfair Exchange integration itself is not yet connected (phase 2). Both
          are promoted automatically the next time a scan runs and a qualifying price is present.
        </p>
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
          <span>Re-checked on the next scan</span>
        </div>
      </div>

      {items.length === 0 ? (
        <Plate>
          <EmptyState
            icon={<TrendingDown className="h-6 w-6" strokeWidth={1.75} />}
            title={loadError ? 'No fixtures loaded' : 'Nothing on price watch'}
            body={
              loadError ||
              'Every qualifying candidate either meets its required price already or failed an earlier statistical bound.'
            }
          />
        </Plate>
      ) : (
        <Plate>
          <PlateHeader
            title="Monitored candidates"
            icon={<TrendingDown className="h-4 w-4" strokeWidth={2.5} />}
            meta={`${items.length} held`}
          />

          {/* ---- Desktop ledger ---- */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th className="rule-head px-4 py-2.5">Fixture</th>
                  <th className="rule-head px-4 py-2.5">Selection</th>
                  <th className="rule-head px-4 py-2.5 text-right">Current</th>
                  <th className="rule-head px-4 py-2.5 text-right">Required</th>
                  <th className="rule-head px-4 py-2.5 text-right">Shortfall</th>
                  <th className="rule-head px-4 py-2.5 w-[180px]">Progress</th>
                  <th className="rule-head px-4 py-2.5 text-right">
                    <span className="sr-only">Open audit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const current = item.betfairMarket?.decimalOdds;
                  const required = item.requiredOdds;
                  const deficit = typeof current === 'number' ? current - required : undefined;

                  return (
                    <tr
                      key={item.id}
                      id={`price-watch-row-${item.id}`}
                      onClick={() => onSelectFixture(item)}
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                      className="animate-file-in group cursor-pointer border-b border-line transition-colors duration-200 last:border-b-0 hover:bg-surface-2"
                    >
                      <td className="px-4 py-3.5 align-top">
                        <div className="text-[14px] font-bold text-text transition-colors duration-200 group-hover:text-warn-ink">
                          {item.matchTitle}
                        </div>
                        <div className="mt-0.5 text-[11px] text-text-2">
                          {item.competition}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-text-3">
                          {formatKickoff(item.matchTime)}
                        </div>
                        <a
                          id={`btn-pw-verify-google-${item.id}`}
                          href={googleUrl(item)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1.5 inline-flex items-center gap-1 rounded border border-info-line bg-info-soft px-1.5 py-0.5 text-[10px] font-bold text-info-ink"
                        >
                          Check Google
                          <ExternalLink className="h-2.5 w-2.5" strokeWidth={2.5} />
                        </a>
                      </td>

                      <td className="px-4 py-3.5 align-top font-mono text-[13px] font-bold text-text">
                        {item.betType}
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        {typeof current === 'number' && item.betfairMarket ? (
                          <PriceTag
                            odds={current}
                            tone="warn"
                            size="md"
                            sub={`£${item.betfairMarket.liquidityMatched.toLocaleString()} matched`}
                          />
                        ) : (
                          <NotYetConnected />
                        )}
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <PriceTag
                          odds={required}
                          tone="neutral"
                          size="md"
                          sub="minimum lock"
                        />
                      </td>

                      <td className="px-4 py-3.5 text-right align-top">
                        {typeof deficit === 'number' ? (
                          <Chip
                            tone="bad"
                            icon={<TrendingDown className="h-3 w-3" strokeWidth={2.5} />}
                          >
                            {deficit.toFixed(2)}
                          </Chip>
                        ) : (
                          <Chip tone="neutral">—</Chip>
                        )}
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        {typeof current === 'number' ? (
                          <>
                            <GapBar current={current} required={required} />
                            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-2">
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn animate-pulse-ring" />
                              Promotes at @{required.toFixed(2)}
                            </div>
                          </>
                        ) : (
                          <div className="text-[11px] text-text-3">
                            Will show progress once a real exchange price is connected.
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 text-right align-top">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectFixture(item);
                          }}
                          className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 text-[12px] font-bold text-text transition-all duration-200 hover:border-warn-line hover:text-warn-ink"
                        >
                          Audit
                          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ---- Mobile slips ---- */}
          <ul className="divide-y divide-line lg:hidden">
            {items.map((item, i) => {
              const current = item.betfairMarket?.decimalOdds;
              const required = item.requiredOdds;
              const deficit = typeof current === 'number' ? current - required : undefined;

              return (
                <li key={item.id} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} className="animate-file-in">
                  <button
                    onClick={() => onSelectFixture(item)}
                    className="w-full px-4 py-4 text-left transition-colors duration-200 active:bg-surface-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-[15px] font-bold leading-snug text-text">
                          {item.matchTitle}
                        </div>
                        <div className="mt-0.5 text-[12px] text-text-2">
                          {item.competition}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] text-text-3">
                          {formatKickoff(item.matchTime)}
                        </div>
                      </div>
                      {typeof deficit === 'number' ? (
                        <Chip
                          tone="bad"
                          icon={<TrendingDown className="h-3 w-3" strokeWidth={2.5} />}
                        >
                          {deficit.toFixed(2)}
                        </Chip>
                      ) : (
                        <Chip tone="neutral">—</Chip>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3">
                      <div>
                        <div className="rule-head mb-1">Current</div>
                        {typeof current === 'number' ? (
                          <PriceTag odds={current} tone="warn" size="md" align="left" />
                        ) : (
                          <NotYetConnected />
                        )}
                      </div>
                      <div>
                        <div className="rule-head mb-1">Required</div>
                        <PriceTag odds={required} tone="neutral" size="md" align="left" />
                      </div>
                    </div>

                    <div className="mt-3">
                      {typeof current === 'number' ? (
                        <GapBar current={current} required={required} />
                      ) : (
                        <div className="text-[11px] text-text-3">
                          Will show progress once a real exchange price is connected.
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5">
                      <span className="truncate font-mono text-[12px] font-bold text-text">
                        {item.betType}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-bold text-warn-ink">
                        Audit
                        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Plate>
      )}
    </div>
  );
};
