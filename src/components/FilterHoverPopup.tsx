import React, { useState, useRef, useEffect } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  CheckCircle2,
  Database,
  Download,
  Filter,
  Info,
  KeyRound,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { SystemFeedBreakdown } from '../types';

const csvEscape = (val: unknown): string => {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
};

export function exportDataFeedCsv(breakdown: SystemFeedBreakdown) {
  const matches = breakdown.rawMatches || [];
  if (matches.length === 0) return;

  const isFootball = breakdown.sport === 'football';

  const headers = isFootball
    ? [
        'ID',
        'System',
        'Sport',
        'Competition',
        'Match Time',
        'Match Title',
        'Home Team',
        'Away Team',
        'Selection',
        'Bet Type',
        'Status',
        'Filter Evaluation / Failure Reason',
        'Provider',
        'Exchange Odds',
        'Required Odds',
        'Enriched Stats Status',
        'Home Prev Season Scored',
        'Away Prev Season Scored',
        'H2H Over 1.5 Rate',
        'Venue',
      ]
    : [
        'ID',
        'System',
        'Sport',
        'Competition',
        'Match Time',
        'Match Title',
        'Player 1',
        'Player 2',
        'Selection',
        'Bet Type',
        'Status',
        'Filter Evaluation / Failure Reason',
        'Provider',
        'Exchange Odds',
        'Required Odds',
        'Enriched Stats Status',
        'Selected Player Ranking',
        'Opponent Ranking',
        'Ranking Delta',
        'Surface',
        'Venue',
      ];

  const rows = matches.map((m) => {
    if (isFootball) {
      const fb = m.footballDetails;
      const h2hOver15 =
        fb?.h2hMatches && fb.h2hMatches.length > 0
          ? `${(
              (fb.h2hMatches.filter((x) => x.totalGoals > 1).length /
                fb.h2hMatches.length) *
              100
            ).toFixed(0)}%`
          : 'N/A';
      return [
        csvEscape(m.id),
        csvEscape(breakdown.ruleTitle),
        csvEscape(m.sport),
        csvEscape(m.competition),
        csvEscape(m.matchTime),
        csvEscape(m.matchTitle),
        csvEscape(m.homeOrPlayer1),
        csvEscape(m.awayOrPlayer2),
        csvEscape(m.selectedEntity),
        csvEscape(m.betType),
        csvEscape(m.status),
        csvEscape(m.failureReason || 'Passed all active thresholds'),
        csvEscape(m.sourceProvider),
        csvEscape(m.currentOdds || 'N/A'),
        csvEscape(m.requiredOdds || 'N/A'),
        csvEscape(fb ? 'Enriched' : 'Pending / Partial'),
        csvEscape(fb?.homePrevSeason?.avgGoalsScored?.toFixed(2) ?? 'N/A'),
        csvEscape(fb?.awayPrevSeason?.avgGoalsScored?.toFixed(2) ?? 'N/A'),
        csvEscape(h2hOver15),
        csvEscape(m.venue || 'N/A'),
      ].join(',');
    } else {
      const tn = m.tennisDetails;
      const delta =
        tn && tn.opponentPlayer && tn.selectedPlayer
          ? `${tn.opponentPlayer.ranking - tn.selectedPlayer.ranking}`
          : 'N/A';
      return [
        csvEscape(m.id),
        csvEscape(breakdown.ruleTitle),
        csvEscape(m.sport),
        csvEscape(m.competition),
        csvEscape(m.matchTime),
        csvEscape(m.matchTitle),
        csvEscape(m.homeOrPlayer1),
        csvEscape(m.awayOrPlayer2),
        csvEscape(m.selectedEntity),
        csvEscape(m.betType),
        csvEscape(m.status),
        csvEscape(m.failureReason || 'Passed all active thresholds'),
        csvEscape(m.sourceProvider),
        csvEscape(m.currentOdds || 'N/A'),
        csvEscape(m.requiredOdds || 'N/A'),
        csvEscape(tn ? 'Enriched' : 'Pending / Partial'),
        csvEscape(tn?.selectedPlayer?.ranking ?? 'N/A'),
        csvEscape(tn?.opponentPlayer?.ranking ?? 'N/A'),
        csvEscape(delta),
        csvEscape(m.surface || tn?.selectedPlayer?.surface || 'N/A'),
        csvEscape(m.venue || 'N/A'),
      ].join(',');
    }
  });

  const csvContent = [headers.map(csvEscape).join(','), ...rows].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const slug = breakdown.system.toLowerCase().replace(/_/g, '-');
  const dateStr = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `data-feed-${slug}-${dateStr}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

interface FilterHoverPopupProps {
  breakdown: SystemFeedBreakdown;
  activeFilterId?: string;
  onRefreshFeed?: () => void;
  isRefreshing?: boolean;
  size?: 'sm' | 'md';
  label?: string;
}

export const FilterHoverPopup: React.FC<FilterHoverPopupProps> = ({
  breakdown,
  activeFilterId,
  onRefreshFeed,
  isRefreshing = false,
  size = 'md',
  label,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; placeAbove: boolean }>({
    top: 0,
    left: 0,
    placeAbove: false,
  });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updatePosition = () => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const popoverWidth = Math.min(480, viewportWidth - 24);
    const popoverEstimatedHeight = 440;

    // Check if there's more room above or below
    const spaceBelow = viewportHeight - rect.bottom;
    const placeAbove = spaceBelow < popoverEstimatedHeight && rect.top > popoverEstimatedHeight;

    let left = rect.left;
    if (left + popoverWidth > viewportWidth - 12) {
      left = Math.max(12, viewportWidth - popoverWidth - 12);
    }

    const top = placeAbove ? Math.max(10, rect.top - 8) : rect.bottom + 8;

    setCoords({ top, left, placeAbove });
  };

  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    updatePosition();
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 220);
  };

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const handleScroll = () => updatePosition();
      window.addEventListener('scroll', handleScroll, true);
      window.addEventListener('resize', handleScroll);
      return () => {
        window.removeEventListener('scroll', handleScroll, true);
        window.removeEventListener('resize', handleScroll);
      };
    }
  }, [isOpen]);

  // Determine active filter step if hovering a specific threshold input
  const activeStep = activeFilterId
    ? breakdown.filterSteps.find((s) => s.filterId === activeFilterId)
    : undefined;

  // Header status indicator
  const isUnconfigured = !breakdown.isConfigured;
  const isError = !!breakdown.error;
  const isLoading = breakdown.isLoading || isRefreshing;
  const isLive = breakdown.isConfigured && !breakdown.error && !isLoading && breakdown.totalFeedRecords > 0;
  const isEmptyFeed = breakdown.isConfigured && !breakdown.error && !isLoading && breakdown.totalFeedRecords === 0;

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={triggerRef}
        type="button"
        id={`filter-hover-trigger-${breakdown.system}-${activeFilterId || 'rule'}`}
        aria-label={`Live feed impact for ${breakdown.ruleTitle}${activeStep ? ` - ${activeStep.filterName}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => {
          updatePosition();
          setIsOpen((prev) => !prev);
        }}
        className={`inline-flex items-center gap-1.5 rounded-md font-semibold transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-brand/40 shadow-xs bg-brand text-on-brand hover:bg-brand-hover cursor-pointer whitespace-nowrap shrink-0 ${
          size === 'sm'
            ? 'px-2 py-0.5 text-[11px]'
            : 'px-2.5 py-1 text-xs'
        }`}
      >
        {isLoading ? (
          <RefreshCw className="w-3.5 h-3.5 text-white animate-spin shrink-0" />
        ) : isUnconfigured ? (
          <KeyRound className="w-3.5 h-3.5 text-white shrink-0" />
        ) : isError ? (
          <AlertCircle className="w-3.5 h-3.5 text-white shrink-0" />
        ) : (
          <Activity className="w-3.5 h-3.5 text-white shrink-0" />
        )}

        <span className="text-white font-semibold tracking-tight whitespace-nowrap">
          {label ||
            (activeStep
              ? `Impact: -${activeStep.standaloneReductionPct}%`
              : isUnconfigured
              ? 'Feed: Not configured'
              : isError
              ? 'Feed: Error'
              : isLoading
              ? 'Feed: Querying...'
              : `Feed: ${breakdown.totalFeedRecords} records`)}
        </span>
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Live data feed breakdown for ${breakdown.ruleTitle}`}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          style={{
            position: 'fixed',
            top: coords.placeAbove ? 'auto' : `${coords.top}px`,
            bottom: coords.placeAbove ? `${window.innerHeight - coords.top}px` : 'auto',
            left: `${coords.left}px`,
            width: '460px',
            maxWidth: 'calc(100vw - 24px)',
            zIndex: 9999,
          }}
          className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        >
          {/* Popover Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
            <div className="flex items-center gap-2 min-w-0">
              <Database className="w-4 h-4 text-sky-500 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {breakdown.ruleTitle}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  Provider:{' '}
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    {breakdown.provider !== 'NONE' ? breakdown.provider : 'No Provider Configured'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {onRefreshFeed && (
                <button
                  type="button"
                  onClick={onRefreshFeed}
                  disabled={isLoading}
                  title="Query live feed from API"
                  className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-sky-500' : ''}`} />
                </button>
              )}
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  isLive
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/60'
                    : isUnconfigured
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60'
                    : isError
                    ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200/60 dark:border-rose-800/60'
                    : 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200/60 dark:border-sky-800/60'
                }`}
              >
                {isLive ? 'LIVE FEED DATA' : isUnconfigured ? 'NOT CONFIGURED' : isError ? 'FEED ERROR' : 'CONNECTING'}
              </span>
            </div>
          </div>

          {/* Popover Body */}
          <div className="p-4 space-y-4 max-h-[460px] overflow-y-auto">
            {/* Case 1: Unconfigured API Key */}
            {isUnconfigured && (
              <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-3.5 space-y-2">
                <div className="flex items-start gap-2.5">
                  <KeyRound className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                      API Key Not Configured
                    </p>
                    <p className="text-xs text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
                      To display the number of records received in the live data feed and the breakdown of filter reductions, configure a valid{' '}
                      {breakdown.sport === 'tennis' ? 'Sportradar Tennis' : 'Sportradar Football or Sportmonks'} API key in
                      Engine Configuration.
                    </p>
                  </div>
                </div>
                <div className="pt-2 border-t border-amber-200/60 dark:border-amber-900/40 text-[11px] text-amber-700 dark:text-amber-400 font-mono">
                  Strict truthfulness active: No simulated or placeholder records are displayed.
                </div>
              </div>
            )}

            {/* Case 2: API Error */}
            {isError && (
              <div className="rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 p-3.5 space-y-2">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-rose-900 dark:text-rose-200">
                      Error Connecting to Provider Feed
                    </p>
                    <p className="text-xs text-rose-800/90 dark:text-rose-300/90 leading-relaxed font-mono break-words">
                      {breakdown.error}
                    </p>
                  </div>
                </div>
                <div className="pt-2 border-t border-rose-200/60 dark:border-rose-900/40 text-[11px] text-rose-700 dark:text-rose-400">
                  Live data feed could not be pulled. No invented numbers or fake fixtures are displayed.
                </div>
              </div>
            )}

            {/* Case 3: Loading */}
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-6 px-4 text-center space-y-2">
                <RefreshCw className="w-6 h-6 text-sky-500 animate-spin" />
                <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                  Connecting to live {breakdown.provider !== 'NONE' ? breakdown.provider : 'sports'} API...
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Pulling upcoming match fixtures and historical team profiles to calculate live reductions.
                </p>
              </div>
            )}

            {/* Case 4: Empty feed returned by provider */}
            {isEmptyFeed && (
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-3.5 text-center space-y-1">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  0 Records Received from Live Feed
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  The live API responded successfully, but returned 0 scheduled matches for the screened query window.
                </p>
              </div>
            )}

            {/* Case 5: Live Data Feed Available */}
            {isLive && (
              <>
                {/* Total Feed Metric Header */}
                <div className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3 border border-slate-200/80 dark:border-slate-700/60">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 block">
                        Total Data Feed Records
                      </span>
                      {breakdown.rawMatches && breakdown.rawMatches.length > 0 ? (
                        <button
                          type="button"
                          id={`download-csv-${breakdown.system}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            exportDataFeedCsv(breakdown);
                          }}
                          className="mt-1 inline-flex items-center gap-1.5 text-[11px] font-bold text-brand hover:text-brand-hover hover:underline cursor-pointer transition-colors"
                          title="Download these data feed records as a tabular CSV file"
                        >
                          <Download className="w-3.5 h-3.5 text-brand shrink-0" />
                          <span>Download Tabular CSV ({breakdown.rawMatches.length} rows)</span>
                        </button>
                      ) : (
                        <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <Download className="w-3 h-3 shrink-0" />
                          <span>Download CSV (0 records)</span>
                        </span>
                      )}
                    </div>
                    <span className="text-lg font-bold text-slate-900 dark:text-slate-100 font-mono">
                      {breakdown.totalFeedRecords} matches
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1.5 border-t border-slate-200/60 dark:border-slate-700/60">
                    <span>Enriched with statistical profile: {breakdown.enrichedRecordsCount}</span>
                    {breakdown.incompleteDataCount > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">
                        ({breakdown.incompleteDataCount} partial/pending enrichment)
                      </span>
                    )}
                  </div>
                </div>

                {/* Pre-Filter / Feed Ingestion Scope Clarification */}
                <div className="rounded-md bg-emerald-50/70 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/40 px-2.5 py-2 text-[10.5px] text-emerald-900 dark:text-emerald-300 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    <strong>Feed Ingestion Pipeline:</strong> Ingests all scheduled matches across an upcoming 3-day query window from {breakdown.provider} with zero league, country, or odds pre-filtering. The first 40 matches are enriched with deep head-to-head, prior season, or ranking profiles.
                  </span>
                </div>

                {/* Specific Hovered Filter Callout (if trigger was for a specific input field) */}
                {activeStep && (
                  <div className="rounded-lg border border-sky-200 dark:border-sky-800/60 bg-sky-50/70 dark:bg-sky-950/30 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-sky-900 dark:text-sky-200">
                      <Filter className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                      <span>{activeStep.filterName}</span>
                    </div>
                    <p className="text-xs text-sky-800/90 dark:text-sky-300/90">
                      Threshold requirement: <span className="font-mono font-semibold">{activeStep.targetRule}</span>
                    </p>
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="p-2 rounded bg-white/80 dark:bg-slate-900/60 border border-sky-100 dark:border-sky-900/40">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">Matches Passing</div>
                        <div className="text-sm font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                          {activeStep.standalonePassedCount}{' '}
                          <span className="text-[10px] text-slate-400 font-normal">
                            / {breakdown.totalFeedRecords}
                          </span>
                        </div>
                      </div>
                      <div className="p-2 rounded bg-white/80 dark:bg-slate-900/60 border border-sky-100 dark:border-sky-900/40">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400">Filter Reduction</div>
                        <div className="text-sm font-bold text-rose-600 dark:text-rose-400 font-mono flex items-center gap-1">
                          <ArrowDownRight className="w-3.5 h-3.5" />
                          <span>-{activeStep.standaloneReductionPct}%</span>
                          <span className="text-[10px] text-slate-400 font-normal">
                            (-{activeStep.standaloneEliminatedCount})
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Filter Breakdown Table / Funnel */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-800 dark:text-slate-200">
                    <span className="flex items-center gap-1">
                      <span>Screening Filter Breakdown</span>
                      <Info className="w-3 h-3 text-slate-400" />
                    </span>
                    <span className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                      Sequential Pipeline
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                    {breakdown.filterSteps.map((step, idx) => {
                      const isThisActive = activeFilterId === step.filterId;
                      return (
                        <div
                          key={step.filterId}
                          className={`p-2.5 text-xs transition-colors ${
                            isThisActive
                              ? 'bg-sky-50/80 dark:bg-sky-950/40 font-medium'
                              : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="w-4 h-4 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-mono flex items-center justify-center shrink-0">
                                  {idx + 1}
                                </span>
                                <span className="text-slate-900 dark:text-slate-100 truncate">
                                  {step.filterName}
                                </span>
                              </div>
                              <div className="mt-0.5 ml-5 text-[11px] text-slate-500 dark:text-slate-400 truncate font-mono">
                                {step.targetValue}
                              </div>
                            </div>

                            <div className="text-right shrink-0">
                              <div className="font-mono text-slate-800 dark:text-slate-200 font-semibold">
                                {step.pipelineRemainingCount}{' '}
                                <span className="text-[10px] text-slate-400 font-normal">remain</span>
                              </div>
                              <div className="text-[10px] font-mono text-rose-600 dark:text-rose-400 flex items-center justify-end gap-0.5">
                                <span>-{step.pipelineEliminatedCount} at step</span>
                                <span>(-{step.cumulativeReductionPct}% total)</span>
                              </div>
                            </div>
                          </div>

                          {/* Progress/Funnel Bar */}
                          <div className="mt-2 ml-5 h-1.5 w-[calc(100%-20px)] bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-sky-500 rounded-full transition-all duration-300"
                              style={{
                                width: `${
                                  breakdown.totalFeedRecords > 0
                                    ? (step.pipelineRemainingCount / breakdown.totalFeedRecords) * 100
                                    : 0
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Final Pipeline Outcome */}
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-2.5 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Preliminary Qualifiers (passed all statistical criteria):</span>
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                      {breakdown.preliminaryQualifiersCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                    <span>Verified Qualifiers (passed Betfair price floor):</span>
                    <span className="font-mono font-medium text-slate-700 dark:text-slate-300">
                      {breakdown.verifiedQualifiersCount}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Popover Footer */}
          <div className="px-4 py-2 bg-slate-50/80 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-400">
            <span>Live data calculated from active API response</span>
            {breakdown.fetchedAt && (
              <span>Synced {new Date(breakdown.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
