import React, { useMemo, useState } from 'react';
import {
  Archive,
  Check,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Info,
  Layers,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  AppSettings,
  HistoricalBetRecord,
  Sport,
  SystemAnalytics,
  SystemType,
} from '../types';
import { calculateSystemAnalytics, settleBet } from '../services/storage';
import {
  Button,
  EmptyState,
  Field,
  OutcomeBadge,
  Plate,
  PlateHeader,
  Segmented,
  inputClass,
} from './ui';

interface AnalyticsViewProps {
  historicalBets: HistoricalBetRecord[];
  onUpdateBets: (bets: HistoricalBetRecord[]) => void;
  settings: AppSettings;
  onAutoSettleAll?: () => void;
  onSyncHistoricalRecords?: () => void;
  isAutoSettling?: boolean;
  isSyncingHistory?: boolean;
}

const SYSTEM_NAME: Record<SystemType, string> = {
  football_over_1_5: 'Football · Over 1.5',
  football_under_3_5: 'Football · Under 3.5',
  tennis_straight_sets: 'Tennis · Straight sets',
};

const signed = (n: number, prefix = '') =>
  `${n >= 0 ? '+' : '−'}${prefix}${Math.abs(n).toFixed(2)}`;

/* ==========================================================================
   Profit curve — the only chart. Ruled like the rest of the document, with a
   hover readout so a point can be identified without a tooltip library.
   ========================================================================== */

const ProfitCurve: React.FC<{
  points: { pnl: number; label: string; date: string }[];
  currency: string;
}> = ({ points, currency }) => {
  const [hover, setHover] = useState<number | null>(null);

  const W = 720;
  const H = 200;
  const PAD = { t: 14, r: 14, b: 22, l: 46 };

  const values = points.map((p) => p.pnl);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = rawMax - rawMin || 1;
  const minY = rawMin - span * 0.12;
  const maxY = rawMax + span * 0.12;
  const range = maxY - minY;

  const x = (i: number) =>
    PAD.l +
    (i * (W - PAD.l - PAD.r)) / Math.max(1, points.length - 1);
  const y = (v: number) =>
    PAD.t + (1 - (v - minY) / range) * (H - PAD.t - PAD.b);

  const coords = points.map((p, i) => `${x(i)},${y(p.pnl)}`);
  const line = `M${coords.join(' L')}`;
  const area = `M${x(0)},${y(minY)} L${coords.join(' L')} L${x(
    points.length - 1
  )},${y(minY)} Z`;

  const ticks = [rawMax, (rawMax + rawMin) / 2, rawMin].filter(
    (v, i, a) => a.indexOf(v) === i
  );

  const active = hover ?? points.length - 1;
  const activePoint = points[active];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="rule-head">
            {hover === null ? 'Latest position' : 'Selected'}
          </div>
          <div className="truncate text-[13px] font-semibold text-text">
            {activePoint.label}
          </div>
        </div>
        <div
          className={`font-mono text-xl font-bold tabular-nums ${
            activePoint.pnl >= 0 ? 'text-ok-ink' : 'text-bad-ink'
          }`}
        >
          {signed(activePoint.pnl, currency)}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-52 w-full"
        role="img"
        aria-label={`Cumulative profit across ${points.length} settled selections, currently ${signed(
          points[points.length - 1].pnl,
          currency
        )}`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--d-brand)" stopOpacity="0.24" />
            <stop offset="100%" stopColor="var(--d-brand)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Ruled gridlines + value axis */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD.l}
              y1={y(t)}
              x2={W - PAD.r}
              y2={y(t)}
              stroke="var(--d-line)"
              strokeWidth="1"
            />
            <text
              x={PAD.l - 8}
              y={y(t) + 3.5}
              textAnchor="end"
              className="font-mono"
              fontSize="10"
              fill="var(--d-text-3)"
            >
              {currency}
              {Math.round(t)}
            </text>
          </g>
        ))}

        {/* Break-even line, drawn heavier — the only number that matters */}
        <line
          x1={PAD.l}
          y1={y(0)}
          x2={W - PAD.r}
          y2={y(0)}
          stroke="var(--d-line-strong)"
          strokeWidth="1"
          strokeDasharray="5 4"
        />

        <path d={area} fill="url(#curveFill)" />
        <path
          d={line}
          fill="none"
          stroke="var(--d-brand)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Hover crosshair */}
        {hover !== null && (
          <line
            x1={x(hover)}
            y1={PAD.t}
            x2={x(hover)}
            y2={H - PAD.b}
            stroke="var(--d-brand-line)"
            strokeWidth="1"
          />
        )}

        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={x(i)}
              cy={y(p.pnl)}
              r={i === active ? 5 : 3}
              fill={i === active ? 'var(--d-brand)' : 'var(--d-surface)'}
              stroke="var(--d-brand)"
              strokeWidth="2"
            />
            {/* Generous invisible hit area */}
            <rect
              x={x(i) - 14}
              y={PAD.t}
              width="28"
              height={H - PAD.t - PAD.b}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            >
              <title>{`${p.date} — ${p.label}: ${signed(p.pnl, currency)}`}</title>
            </rect>
          </g>
        ))}

        <text
          x={PAD.l}
          y={H - 6}
          className="font-mono"
          fontSize="10"
          fill="var(--d-text-3)"
        >
          first settled
        </text>
        <text
          x={W - PAD.r}
          y={H - 6}
          textAnchor="end"
          className="font-mono"
          fontSize="10"
          fill="var(--d-text-3)"
        >
          latest
        </text>
      </svg>
    </div>
  );
};

/* ==========================================================================
   Archive column hover tooltip — explains the origin & calculation of data
   ========================================================================== */

interface ArchiveColumnTooltipProps {
  label: string;
  title: string;
  align?: 'left' | 'center' | 'right';
  children: React.ReactNode;
}

const ArchiveColumnTooltip: React.FC<ArchiveColumnTooltipProps> = ({
  label,
  title,
  align = 'center',
  children,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div
      className={`group relative inline-flex items-center gap-1 cursor-help select-none ${
        align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'
      }`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      // Set open rather than toggle: a mouse click fires "mouseenter" first
      // (opening it via the handler above), so a toggle here would
      // immediately re-close it on every click — see the identical fix in
      // PriceWatchTable's filter-conditions popover.
      onClick={(e) => {
        e.stopPropagation();
        setIsOpen(true);
      }}
      tabIndex={0}
      onFocus={() => setIsOpen(true)}
      onBlur={() => setIsOpen(false)}
      role="button"
      aria-label={`${label} column explanation`}
    >
      <span className="underline decoration-dotted decoration-text-3/70 underline-offset-4 transition-colors group-hover:text-brand-ink group-hover:decoration-brand">
        {label}
      </span>
      <Info className="h-3 w-3 text-text-3 opacity-60 transition-opacity group-hover:opacity-100 group-hover:text-brand-ink shrink-0" />

      {/* Floating Popup Card */}
      <div
        className={`pointer-events-none absolute top-full mt-2 z-50 w-72 sm:w-84 rounded-xl border border-line bg-surface p-3.5 text-left shadow-2xl transition-all duration-150 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0'
        } ${
          align === 'right'
            ? 'right-0 left-auto translate-x-0'
            : align === 'center'
            ? 'left-1/2 -translate-x-1/2'
            : 'left-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Caret arrow */}
        <div
          className={`absolute -top-1.5 h-3 w-3 rotate-45 border-l border-t border-line bg-surface ${
            align === 'right'
              ? 'right-4'
              : align === 'center'
              ? 'left-1/2 -translate-x-1/2'
              : 'left-4'
          }`}
        />

        <div className="relative z-10">
          <div className="flex items-center gap-1.5 border-b border-line pb-2 mb-2">
            <div className="rounded bg-brand-soft p-1 text-brand-ink">
              <Info className="h-3.5 w-3.5" />
            </div>
            <span className="text-[12px] font-bold text-text normal-case tracking-normal">
              {title}
            </span>
          </div>
          <div className="space-y-2 text-[11px] leading-relaxed text-text-2 font-normal normal-case tracking-normal">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

/* ========================================================================== */

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({
  historicalBets,
  onUpdateBets,
  settings,
  onAutoSettleAll,
  onSyncHistoricalRecords,
  isAutoSettling = false,
  isSyncingHistory = false,
}) => {
  const t = settings.ruleThresholds;
  const [scope, setScope] = useState<string>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<string>('all');

  const [settlingBet, setSettlingBet] = useState<HistoricalBetRecord | null>(null);
  const [settleOutcome, setSettleOutcome] = useState<'WON' | 'LOST' | 'VOID'>('WON');
  const [finalScoreInput, setFinalScoreInput] = useState('');

  const scopeToFilter = (
    s: string
  ): { sport?: Sport; system?: SystemType } => {
    switch (s) {
      case 'football_over_1_5':
        return { sport: 'football', system: 'football_over_1_5' };
      case 'football_under_3_5':
        return { sport: 'football', system: 'football_under_3_5' };
      case 'tennis_straight_sets':
        return { sport: 'tennis', system: 'tennis_straight_sets' };
      default:
        return {};
    }
  };

  const { sport, system } = scopeToFilter(scope);
  const current = calculateSystemAnalytics(historicalBets, sport, system);

  const systemRows: { key: SystemType; stats: SystemAnalytics }[] = useMemo(
    () => [
      {
        key: 'football_over_1_5',
        stats: calculateSystemAnalytics(historicalBets, 'football', 'football_over_1_5'),
      },
      {
        key: 'football_under_3_5',
        stats: calculateSystemAnalytics(historicalBets, 'football', 'football_under_3_5'),
      },
      {
        key: 'tennis_straight_sets',
        stats: calculateSystemAnalytics(historicalBets, 'tennis', 'tennis_straight_sets'),
      },
    ],
    [historicalBets]
  );

  const filteredBets = historicalBets.filter((b) => {
    if (sport && b.sport !== sport) return false;
    if (system && b.system !== system) return false;
    if (outcomeFilter !== 'all' && b.outcome !== outcomeFilter) return false;
    return true;
  });

  const csvCell = (value: string | number | undefined): string => {
    const str = value === undefined || value === null ? '' : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const handleExportCsv = () => {
    const headers = [
      'Date',
      'Match',
      'Competition',
      'System',
      'Selection',
      'Odds Taken',
      'Stake',
      'Outcome',
      'Final Score',
      'P&L',
      'ROI %',
      'Settled At',
      'Audit ID',
      'Data Source',
      'Notes',
    ];
    const rows = filteredBets.map((b) => [
      csvCell(b.date),
      csvCell(b.match),
      csvCell(b.competition),
      csvCell(b.system),
      csvCell(b.selection),
      csvCell(b.oddsTaken),
      csvCell(b.stake),
      csvCell(b.outcome),
      csvCell(b.finalScore),
      csvCell(b.pnl),
      csvCell(b.roiContribution),
      csvCell(b.settledAt),
      csvCell(b.auditId),
      csvCell(b.dataSourceName),
      csvCell(b.notes),
    ]);
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const suffix = outcomeFilter === 'all' ? 'all' : outcomeFilter.toLowerCase();
    a.href = url;
    a.download = `archive-log-${suffix}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const curvePoints = useMemo(() => {
    const settled = [...historicalBets]
      .filter((b) => b.outcome === 'WON' || b.outcome === 'LOST')
      .reverse();
    let running = 0;
    return settled.map((bet) => {
      running += bet.pnl;
      return { pnl: running, label: bet.match, date: bet.date };
    });
  }, [historicalBets]);

  const handleSettleSubmit = () => {
    if (!settlingBet) return;
    onUpdateBets(settleBet(settlingBet.id, settleOutcome, finalScoreInput));
    setSettlingBet(null);
    setFinalScoreInput('');
  };

  const kpis = [
    {
      label: 'Archive size',
      value: `${current.settledBets}`,
      note: `Calculated on ${current.settledBets} settled records (${current.totalBets} total, ${current.pendingBets} pending)`,
      tone: 'text-brand-ink',
    },
    {
      label: 'Win rate',
      value: `${current.winRate}%`,
      note: `${current.wonBets} won · ${current.lostBets} lost · ${current.pendingBets} pending`,
      tone: 'text-text',
    },
    {
      label: 'Return on investment',
      value: `${current.roiPercentage >= 0 ? '+' : ''}${current.roiPercentage}%`,
      note: 'Net yield on staked capital',
      tone: current.roiPercentage >= 0 ? 'text-ok-ink' : 'text-bad-ink',
    },
    {
      label: 'Net profit',
      value: signed(current.netProfit, settings.currencySymbol),
      note: `${settings.currencySymbol}${current.totalStaked.toLocaleString()} staked`,
      tone: current.netProfit >= 0 ? 'text-ok-ink' : 'text-bad-ink',
    },
    {
      label: 'Average price',
      value: `@${current.avgOdds.toFixed(2)}`,
      note: `Strike rate ${current.strikeRate}%`,
      tone: 'text-text',
    },
  ];

  return (
    <div id="analytics-view" className="space-y-5">
      {/* ---- Scope ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 max-w-full overflow-x-auto px-1 no-scrollbar">
          <Segmented
            label="Filter by system"
            value={scope}
            onChange={setScope}
            segments={[
              { value: 'all', label: 'All systems' },
              { value: 'football_over_1_5', label: 'Over 1.5' },
              { value: 'football_under_3_5', label: 'Under 3.5' },
              { value: 'tennis_straight_sets', label: 'Straight sets' },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          {onSyncHistoricalRecords && (
            <button
              id="btn-sync-250-history"
              onClick={onSyncHistoricalRecords}
              disabled={isSyncingHistory}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-[11px] font-bold text-text-2 hover:border-brand hover:text-brand-ink transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              title="Pull real settled results from the configured provider for the last 30 days"
            >
              <Database className={`h-3.5 w-3.5 ${isSyncingHistory ? 'animate-pulse' : ''}`} />
              <span>{isSyncingHistory ? 'Pulling…' : 'Pull Historical Results'}</span>
            </button>
          )}
          <span className="font-mono text-[11px] text-text-3">
            {historicalBets.length} archived selections
          </span>
        </div>
      </div>

      {/* ---- KPI plate: one ruled block with 5 metrics ---- */}
      <Plate>
        <dl className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-5 lg:divide-x">
          {kpis.map((k, i) => (
            <div
              key={k.label}
              className={`p-4 border-b border-line lg:border-b-0 ${
                i % 2 === 0 ? 'border-r border-line sm:border-r-0' : ''
              } ${i === 4 ? 'col-span-2 sm:col-span-1 border-b-0 sm:border-b-0' : ''}`}
            >
              <dt className="rule-head mb-1.5">{k.label}</dt>
              <dd
                className={`font-mono text-[24px] lg:text-[26px] font-bold leading-none tabular-nums tracking-tight ${k.tone}`}
              >
                {k.value}
              </dd>
              <p className="mt-1.5 text-[11px] leading-snug text-text-3">
                {k.note}
              </p>
            </div>
          ))}
        </dl>
      </Plate>

      {/* ---- System comparison ---- */}
      <Plate>
        <PlateHeader
          title="System performance"
          icon={<Layers className="h-4 w-4" strokeWidth={2.5} />}
        />
        <div className="divide-y divide-line">
          {systemRows.map(({ key, stats }) => (
            <div
              key={key}
              className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3.5"
            >
              <div className="min-w-[150px] flex-1">
                <div className="text-[13px] font-bold text-text">
                  {SYSTEM_NAME[key]}
                </div>
                <div className="font-mono text-[11px] text-text-3">
                  {stats.totalBets} selections
                </div>
              </div>
              <div className="flex flex-1 items-center gap-6">
                <div>
                  <div className="rule-head">Win rate</div>
                  <div className="font-mono text-[15px] font-bold tabular-nums text-text">
                    {stats.winRate}%
                  </div>
                </div>
                <div>
                  <div className="rule-head">ROI</div>
                  <div
                    className={`font-mono text-[15px] font-bold tabular-nums ${
                      stats.roiPercentage >= 0 ? 'text-ok-ink' : 'text-bad-ink'
                    }`}
                  >
                    {stats.roiPercentage >= 0 ? '+' : ''}
                    {stats.roiPercentage}%
                  </div>
                </div>
                <div>
                  <div className="rule-head">Profit</div>
                  <div
                    className={`font-mono text-[15px] font-bold tabular-nums ${
                      stats.netProfit >= 0 ? 'text-ok-ink' : 'text-bad-ink'
                    }`}
                  >
                    {signed(stats.netProfit, settings.currencySymbol)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Plate>

      {/* ---- Profit curve ---- */}
      <Plate>
        <PlateHeader
          title="Cumulative profit"
          icon={<TrendingUp className="h-4 w-4" strokeWidth={2.5} />}
          meta={`${settings.currencySymbol} · settled only`}
        />
        <div className="px-4 py-4">
          {curvePoints.length > 1 ? (
            <ProfitCurve
              points={curvePoints}
              currency={settings.currencySymbol}
            />
          ) : (
            <p className="py-10 text-center text-[13px] text-text-3">
              At least two settled selections are needed before a trajectory can
              be drawn.
            </p>
          )}
        </div>
      </Plate>

      {/* ---- Archive ---- */}
      <Plate>
        <PlateHeader
          title="Archive log"
          icon={<Archive className="h-4 w-4" strokeWidth={2.5} />}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <div className="-mx-1 max-w-full overflow-x-auto px-1 no-scrollbar">
                <Segmented
                  label="Filter by outcome"
                  value={outcomeFilter}
                  onChange={setOutcomeFilter}
                  segments={[
                    { value: 'all', label: 'All' },
                    { value: 'WON', label: 'Won' },
                    { value: 'LOST', label: 'Lost' },
                    { value: 'PENDING', label: 'Pending' },
                  ]}
                />
              </div>
              <Button
                type="button"
                onClick={handleExportCsv}
                disabled={filteredBets.length === 0}
                icon={<Download className="h-3.5 w-3.5" strokeWidth={2.5} />}
                title="Export the rows currently shown below to a CSV file"
              >
                Export CSV
              </Button>
            </div>
          }
        />

        {historicalBets.some((b) => b.outcome === 'PENDING') && onAutoSettleAll && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-brand-soft/40 px-4 py-2.5 sm:px-6">
            <div className="flex items-center gap-2 text-[12px] text-brand-ink">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-ok"></span>
              </span>
              <span>
                <strong>
                  {historicalBets.filter((b) => b.outcome === 'PENDING').length} pending selection(s)
                </strong>{' '}
                automatically archived from daily scans.
              </span>
            </div>
            <button
              id="btn-auto-settle-all"
              onClick={onAutoSettleAll}
              disabled={isAutoSettling}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-brand px-3 py-1 text-[11px] font-extrabold text-white transition-opacity hover:opacity-90 cursor-pointer shadow-2xs disabled:cursor-not-allowed disabled:opacity-60"
              title="Automatically settle all finished matches with verified official results"
            >
              <Sparkles className={`h-3 w-3 ${isAutoSettling ? 'animate-pulse' : ''}`} />
              <span>{isAutoSettling ? 'Settling…' : 'Auto-Settle Concluded Results'}</span>
            </button>
          </div>
        )}

        {filteredBets.length === 0 ? (
          <EmptyState
            icon={<Archive className="h-6 w-6" strokeWidth={1.75} />}
            title="Nothing archived yet"
            body="Selections appear here automatically once a scheduled or manual scan runs, or when you file one from its audit card. If you haven't yet, add a Sportradar or Sportmonks API key in Engine Configuration to pull real fixtures and results."
          />
        ) : (
          <>
            {/* Desktop */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-surface-2">
                    <th className="rule-head px-4 py-2.5">Date</th>
                    <th className="rule-head px-4 py-2.5">Match &amp; selection</th>
                    <th className="rule-head px-4 py-2.5">System</th>
                    <th className="rule-head px-4 py-2.5 text-right">
                      <ArchiveColumnTooltip
                        label="Odds"
                        title="Betfair Exchange Odds"
                        align="right"
                      >
                        <p>
                          Betfair Exchange integration is not implemented yet (phase 2) — there is
                          no live back price to record. Backfilled and manually-filed rows show the
                          system&rsquo;s own disclosed minimum qualifying price instead of a real
                          market figure, and say so in their notes.
                        </p>
                        <p className="text-text-3">
                          Each system enforces its own configured price floor (Over 1.5{' '}
                          {t.footballOver15.enabled ? `≥${t.footballOver15.minExchangeOdds.toFixed(2)}` : 'disabled'}, Under 3.5{' '}
                          {t.footballUnder35.enabled ? `≥${t.footballUnder35.minExchangeOdds.toFixed(2)}` : 'disabled'}, Straight Sets{' '}
                          {t.tennisStraightSets.enabled ? `≥${t.tennisStraightSets.minExchangeOdds.toFixed(2)}` : 'disabled'}
                          , editable in Engine Configuration &rarr; Filter Thresholds, to avoid
                          excessive risk and ensure positive mathematical expectancy once a real
                          exchange price is connected.
                        </p>
                      </ArchiveColumnTooltip>
                    </th>
                    <th className="rule-head px-4 py-2.5 text-center">
                      <ArchiveColumnTooltip
                        label="Score"
                        title="Official Verified Score"
                        align="center"
                      >
                        <p>
                          The final score pulled from whichever real provider is configured
                          (<strong>Sportradar</strong> or <strong>Sportmonks</strong> for football,
                          <strong> Sportradar</strong> for tennis).
                        </p>
                        <p className="text-text-3">
                          Scores can be audited independently at any time by clicking the &ldquo;Check Google&rdquo; link next to each match.
                        </p>
                      </ArchiveColumnTooltip>
                    </th>
                    <th className="rule-head px-4 py-2.5 text-center">
                      <ArchiveColumnTooltip
                        label="Outcome"
                        title="Rule Settlement Outcome"
                        align="center"
                      >
                        <p>
                          Determined deterministically by evaluating the verified final match score against the system&rsquo;s non-negotiable criteria:
                        </p>
                        <ul className="list-disc pl-4 space-y-1 text-text-3">
                          <li><strong className="text-text">Over 1.5 Goals:</strong> Won if regular-time match goals &ge; 2.</li>
                          <li><strong className="text-text">Under 3.5 Goals:</strong> Won if regular-time match goals &le; 3.</li>
                          <li><strong className="text-text">Tennis Straight Sets:</strong> Won if the selected player won 2-0 (or 3-0 in Grand Slams) without conceding a set.</li>
                          <li><strong className="text-text">Pending:</strong> Match is upcoming or currently underway.</li>
                        </ul>
                      </ArchiveColumnTooltip>
                    </th>
                    <th className="rule-head px-4 py-2.5 text-right">
                      <ArchiveColumnTooltip
                        label="P&L"
                        title="Profit & Loss Calculation"
                        align="right"
                      >
                        <div className="rounded-lg bg-surface-2 p-2 border border-line mb-1">
                          <span className="font-semibold text-text block text-[11px] mb-0.5">
                            How is P&amp;L known without custom bet slips?
                          </span>
                          <p className="text-[10.5px] text-text-2">
                            P&amp;L is standardized using a <strong>flat 1-unit stake</strong> ({settings.currencySymbol}100 default, customizable in Settings).
                          </p>
                        </div>
                        <ul className="list-disc pl-4 space-y-1 text-text-3">
                          <li>
                            <strong className="text-text">WON:</strong> Returns <code>+((Odds &minus; 1) &times; Stake)</code>. For example, odds of 1.25 with a {settings.currencySymbol}100 stake yield <strong>+{settings.currencySymbol}25.00</strong> net profit.
                          </li>
                          <li>
                            <strong className="text-text">LOST:</strong> Returns <strong>&minus;{settings.currencySymbol}100.00</strong> (loss of the unit stake).
                          </li>
                          <li>
                            <strong className="text-text">VOID / PENDING:</strong> {settings.currencySymbol}0.00 until officially settled.
                          </li>
                        </ul>
                        <p className="text-text-3 text-[10.5px] pt-1 border-t border-line">
                          Using a uniform flat stake standardizes Return on Investment (ROI) and performance metrics objectively across all systems, independent of personal bankroll size.
                        </p>
                      </ArchiveColumnTooltip>
                    </th>
                    <th className="rule-head px-4 py-2.5 text-right">
                      <ArchiveColumnTooltip
                        label="Settle"
                        title="Settlement & Auditing"
                        align="right"
                      >
                        <p>
                          Controls the lifecycle from open qualifying fixture to permanent ledger archive:
                        </p>
                        <ul className="list-disc pl-4 space-y-1 text-text-3">
                          <li>
                            <strong className="text-text">Auto-Settled:</strong> When match end-times elapse, the automated settlement runner checks official scoreboards and resolves the outcome.
                          </li>
                          <li>
                            <strong className="text-text">Manual Settle:</strong> Allows you to click &ldquo;Settle&rdquo; on any pending fixture to enter the official score and audit notes immediately.
                          </li>
                          <li>
                            <strong className="text-text">Filed:</strong> Indicates the fixture is permanently sealed in the archive with an immutable audit hash.
                          </li>
                        </ul>
                      </ArchiveColumnTooltip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBets.map((bet) => (
                    <tr
                      key={bet.id}
                      className="border-b border-line transition-colors duration-200 last:border-b-0 hover:bg-surface-2"
                    >
                      <td className="px-4 py-3 font-mono text-[11px] text-text-3">
                        {bet.date}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-[13px] font-semibold text-text">
                          {bet.match}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-text-2">
                            {bet.selection}
                          </span>
                          <a
                            href={
                              bet.googleVerificationUrl ||
                              `https://www.google.com/search?q=${encodeURIComponent(
                                `${bet.match} ${bet.competition} ${bet.date} result score`
                              )}`
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-bold text-info-ink hover:border-brand hover:underline"
                            title="Confirm official match result on Google"
                          >
                            Check Google
                            <ExternalLink className="h-2.5 w-2.5" strokeWidth={2.5} />
                          </a>
                          {bet.flashscoreUrl && (
                            <a
                              href={bet.flashscoreUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-bold text-text-2 hover:border-brand hover:text-brand-ink"
                              title={`Confirm on ${bet.dataSourceName || 'Flashscore'}`}
                            >
                              {bet.sport === 'tennis' ? 'Tennis Abstract' : 'Flashscore'}
                              <ExternalLink className="h-2.5 w-2.5" strokeWidth={2.5} />
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[11px] text-text-2">
                        {SYSTEM_NAME[bet.system]}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[13px] font-bold tabular-nums text-text">
                        @{bet.oddsTaken.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-center font-mono text-[12px] text-text-2">
                        {bet.finalScore || '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <OutcomeBadge outcome={bet.outcome} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[13px] font-bold tabular-nums">
                        {bet.outcome === 'WON' && (
                          <span className="text-ok-ink">
                            {signed(bet.pnl, settings.currencySymbol)}
                          </span>
                        )}
                        {bet.outcome === 'LOST' && (
                          <span className="text-bad-ink">
                            {signed(bet.pnl, settings.currencySymbol)}
                          </span>
                        )}
                        {bet.outcome === 'PENDING' && (
                          <span className="text-text-3">—</span>
                        )}
                        {bet.outcome === 'VOID' && (
                          <span className="text-text-3">
                            {settings.currencySymbol}0.00
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {bet.outcome === 'PENDING' ? (
                          <Button
                            size="sm"
                            onClick={() => {
                              setSettlingBet(bet);
                              setSettleOutcome('WON');
                              setFinalScoreInput('');
                            }}
                          >
                            Settle
                          </Button>
                        ) : (
                          <span className="font-mono text-[10px] uppercase tracking-wider text-text-3">
                            Filed
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile */}
            <ul className="divide-y divide-line lg:hidden">
              {filteredBets.map((bet) => (
                <li key={bet.id} className="px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[14px] font-bold leading-snug text-text">
                        {bet.match}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-text-2">
                        {bet.selection}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-text-3">
                        {bet.date} · {SYSTEM_NAME[bet.system]}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <a
                          href={
                            bet.googleVerificationUrl ||
                            `https://www.google.com/search?q=${encodeURIComponent(
                              `${bet.match} ${bet.competition} ${bet.date} result score`
                            )}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-bold text-info-ink hover:border-brand"
                          title="Confirm official match result on Google"
                        >
                          Check Google
                          <ExternalLink className="h-2.5 w-2.5" strokeWidth={2.5} />
                        </a>
                        {bet.flashscoreUrl && (
                          <a
                            href={bet.flashscoreUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] font-bold text-text-2 hover:border-brand hover:text-brand-ink"
                            title={`Confirm on ${bet.dataSourceName || 'Flashscore'}`}
                          >
                            {bet.sport === 'tennis' ? 'Tennis Abstract' : 'Flashscore'}
                            <ExternalLink className="h-2.5 w-2.5" strokeWidth={2.5} />
                          </a>
                        )}
                      </div>
                    </div>
                    <OutcomeBadge outcome={bet.outcome} />
                  </div>

                  <div className="mt-3 flex items-end justify-between gap-3 border-t border-line pt-3">
                    <div className="flex gap-5">
                      <div>
                        <div className="rule-head">Odds</div>
                        <div className="font-mono text-[14px] font-bold tabular-nums text-text">
                          @{bet.oddsTaken.toFixed(2)}
                        </div>
                      </div>
                      <div>
                        <div className="rule-head">P&amp;L</div>
                        <div
                          className={`font-mono text-[14px] font-bold tabular-nums ${
                            bet.outcome === 'WON'
                              ? 'text-ok-ink'
                              : bet.outcome === 'LOST'
                              ? 'text-bad-ink'
                              : 'text-text-3'
                          }`}
                        >
                          {bet.outcome === 'PENDING'
                            ? '—'
                            : signed(bet.pnl, settings.currencySymbol)}
                        </div>
                      </div>
                      {bet.finalScore && (
                        <div>
                          <div className="rule-head">Score</div>
                          <div className="font-mono text-[14px] font-bold text-text">
                            {bet.finalScore}
                          </div>
                        </div>
                      )}
                    </div>

                    {bet.outcome === 'PENDING' && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setSettlingBet(bet);
                          setSettleOutcome('WON');
                          setFinalScoreInput('');
                        }}
                      >
                        Settle
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Plate>

      {/* ---- Settle dialog: a task that genuinely needs protected focus ---- */}
      {settlingBet && (
        <div
          className="animate-veil fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Settle selection outcome"
          onClick={() => setSettlingBet(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="animate-lift w-full max-w-md overflow-hidden rounded-t-2xl border border-line bg-surface shadow-drawer sm:rounded-2xl"
          >
            <div className="flex items-center justify-between border-b border-line bg-surface-2 px-5 py-3.5">
              <h3 className="text-[15px] font-extrabold text-text">
                Settle selection
              </h3>
              <button
                onClick={() => setSettlingBet(null)}
                aria-label="Cancel settlement"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-3 transition-colors duration-200 hover:bg-surface-3 hover:text-text"
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="rounded-lg border border-line bg-surface-2 px-3.5 py-3">
                <div className="text-[13px] font-bold text-text">
                  {settlingBet.match}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-text-2">
                  {settlingBet.selection} @{settlingBet.oddsTaken.toFixed(2)} ·
                  stake {settings.currencySymbol}
                  {settlingBet.stake}
                </div>
              </div>

              <fieldset>
                <legend className="mb-1.5 text-[12px] font-semibold text-text">
                  Actual result
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {(['WON', 'LOST', 'VOID'] as const).map((o) => {
                    const active = settleOutcome === o;
                    const tone =
                      o === 'WON'
                        ? 'border-ok-line bg-ok-soft text-ok-ink'
                        : o === 'LOST'
                        ? 'border-bad-line bg-bad-soft text-bad-ink'
                        : 'border-line-strong bg-surface-3 text-text';
                    return (
                      <button
                        key={o}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setSettleOutcome(o)}
                        className={`min-h-[44px] rounded-lg border-2 text-[13px] font-extrabold tracking-wide transition-all duration-200 ${
                          active
                            ? tone
                            : 'border-line bg-surface-2 text-text-3 hover:text-text-2'
                        }`}
                      >
                        {o}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <Field
                label="Final score"
                htmlFor="settle-score"
                hint="Recorded alongside the audit so the result stays checkable."
              >
                <input
                  id="settle-score"
                  type="text"
                  placeholder="2–1, or 6-3 6-4"
                  value={finalScoreInput}
                  onChange={(e) => setFinalScoreInput(e.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3.5">
              <Button variant="ghost" onClick={() => setSettlingBet(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSettleSubmit}
                icon={<Check className="h-4 w-4" strokeWidth={2.5} />}
              >
                Confirm settlement
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
