import React, { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronRight,
  ExternalLink,
  MapPin,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { CandidateFixture, SystemType } from '../types';
import {
  Button,
  Chip,
  EmptyState,
  Plate,
  PlateHeader,
  PriceTag,
  Stamp,
  Tone,
} from './ui';

interface VerifiedQualifiersTableProps {
  fixtures: CandidateFixture[];
  onSelectFixture: (fixture: CandidateFixture) => void;
  onRunScan: () => void;
  /** Set when no fixtures could be loaded at all (no provider key, or the last pull failed). */
  loadError?: string | null;
}

const SYSTEM_LABEL: Record<SystemType, { short: string; tone: Tone }> = {
  football_over_1_5: { short: 'A · Over 1.5', tone: 'brand' },
  football_under_3_5: { short: 'B · Under 3.5', tone: 'info' },
};

const googleUrl = (f: CandidateFixture) =>
  f.googleVerificationUrl ||
  `https://www.google.com/search?q=${encodeURIComponent(
    `${f.matchTitle} ${f.competition} fixture date time`
  )}`;

const formatKickoff = (iso: string) => {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString([], {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return iso;
  }
};

export const VerifiedQualifiersTable: React.FC<VerifiedQualifiersTableProps> = ({
  fixtures,
  onSelectFixture,
  onRunScan,
  loadError,
}) => {
  const [selectedSystem, setSelectedSystem] = useState<'all' | SystemType>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = fixtures.filter((f) => {
    if (!f) return false;
    if (selectedSystem !== 'all' && f.system !== selectedSystem) return false;
    if (searchQuery && typeof searchQuery === 'string') {
      const q = searchQuery.toLowerCase().trim();
      const haystack = `${f.matchTitle || ''} ${f.competition || ''} ${
        f.betType || ''
      }`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return (
    <div id="verified-qualifiers-view" className="space-y-5">
      {/* ---- Filter bar ---- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
              aria-label="Filter by football system"
              value={selectedSystem}
              onChange={(e) => setSelectedSystem(e.target.value as SystemType)}
              className="min-h-[36px] rounded-lg border border-line bg-surface-2 px-2.5 text-[12px] font-semibold text-text outline-none transition-colors duration-200 hover:border-line-strong focus:border-brand"
            >
              <option value="all">Both football systems</option>
              <option value="football_over_1_5">System A · Over 1.5</option>
              <option value="football_under_3_5">System B · Under 3.5</option>
          </select>
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-3"
            strokeWidth={2}
          />
          <input
            id="verified-search-input"
            type="search"
            aria-label="Search selections"
            placeholder="Search match, league or market"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="min-h-[36px] w-full rounded-lg border border-line bg-surface-2 pl-9 pr-3 text-[12px] text-text outline-none transition-colors duration-200 hover:border-line-strong focus:border-brand focus:bg-surface"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Plate>
          <EmptyState
            icon={<ShieldCheck className="h-6 w-6" strokeWidth={1.75} />}
            title={
              fixtures.length === 0
                ? loadError
                  ? 'No fixtures loaded'
                  : 'Nothing qualified today'
                : 'No selections match this filter'
            }
            body={
              fixtures.length === 0
                ? loadError ||
                  'Every candidate fixture is measured against the locked filters and the raw-evidence audit. When the criteria or the price threshold are not met, the selection is excluded rather than softened.'
                : 'Clear the system or search filter to see the rest of the docket.'
            }
            action={
              fixtures.length === 0 ? (
                <Button variant="secondary" onClick={onRunScan}>
                  Re-run daily scan
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setSelectedSystem('all');
                    setSearchQuery('');
                  }}
                >
                  Clear filters
                </Button>
              )
            }
          />
        </Plate>
      ) : (
        <Plate>
          <PlateHeader
            title="Verified qualifiers"
            icon={<ShieldCheck className="h-4 w-4" strokeWidth={2.5} />}
            meta={`${filtered.length} of ${fixtures.length}`}
            action={
              <span className="hidden font-mono text-[10px] uppercase tracking-[0.12em] text-text-3 sm:inline">
Market odds · via TheStatsAPI
              </span>
            }
          />

          {/* ---- Desktop ledger ---- */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-surface-2">
                  <th className="rule-head px-4 py-2.5">Fixture</th>
                  <th className="rule-head px-4 py-2.5">Competition</th>
                  <th className="rule-head px-4 py-2.5">System &amp; selection</th>
                  <th className="rule-head px-4 py-2.5 text-right">
                    Bookmaker price
                  </th>
                  <th className="rule-head px-4 py-2.5 text-center">Audit</th>
                  <th className="rule-head px-4 py-2.5 text-right">
                    <span className="sr-only">Open audit card</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const enhanced = item.verificationCard?.enhancedVerification;
                  const sys = SYSTEM_LABEL[item.system];

                  return (
                    <tr
                      key={item.id}
                      id={`row-${item.id}`}
                      onClick={() => onSelectFixture(item)}
                      style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
                      className="animate-file-in group cursor-pointer border-b border-line transition-colors duration-200 last:border-b-0 hover:bg-surface-2"
                    >
                      <td className="px-4 py-3.5 align-top">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-bold text-text transition-colors duration-200 group-hover:text-brand-ink">
                            {item.matchTitle}
                          </span>
                          {item.surface && (
                            <Chip tone="neutral">{item.surface}</Chip>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-text-3">
                          <Calendar className="h-3 w-3" strokeWidth={2} />
                          {formatKickoff(item.matchTime)}
                        </div>
                        <a
                          id={`btn-verify-google-${item.id}`}
                          href={googleUrl(item)}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1.5 inline-flex items-center gap-1 rounded border border-info-line bg-info-soft px-1.5 py-0.5 text-[10px] font-bold text-info-ink transition-colors duration-200 hover:bg-info-soft"
                        >
                          Check Google
                          <ExternalLink className="h-2.5 w-2.5" strokeWidth={2.5} />
                        </a>
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <div className="text-[13px] font-semibold text-text">
                          {item.competition}
                        </div>
                        {item.venue && (
                          <div className="mt-1 flex max-w-[200px] items-center gap-1 truncate text-[11px] text-text-3">
                            <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
                            <span className="truncate">{item.venue}</span>
                          </div>
                        )}
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <Chip tone={sys.tone}>{sys.short}</Chip>
                        <div className="mt-1.5 font-mono text-[13px] font-bold text-text">
                          {item.betType}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 align-top">
                        <div className="flex items-start justify-end gap-2">
                          {enhanced && (
                            <span
                              title="Enhanced verification triggered by this price"
                              className="mt-1 text-warn-ink"
                            >
                              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
                            </span>
                          )}
                          {item.marketOdds ? (
                            <PriceTag
                              odds={item.marketOdds.decimalOdds}
                              size="lg"
                              sub={item.marketOdds.bookmaker}
                            />
                          ) : (
                            <span className="text-right text-[11px] font-bold text-warn-ink">
                              No price on file
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-center align-top">
                        <Stamp
                          tone="ok"
                          icon={<Check className="h-3 w-3" strokeWidth={3.5} />}
                        >
                          Verified
                        </Stamp>
                      </td>

                      <td className="px-4 py-3.5 text-right align-top">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectFixture(item);
                          }}
                          className="inline-flex min-h-[34px] items-center gap-1 rounded-lg border border-line bg-surface-2 px-2.5 text-[12px] font-bold text-text transition-all duration-200 hover:border-brand-line hover:text-brand-ink"
                        >
                          Audit card
                          <ChevronRight
                            className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                            strokeWidth={2.5}
                          />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ---- Mobile docket slips ---- */}
          <ul className="divide-y divide-line lg:hidden">
            {filtered.map((item, i) => {
              const enhanced = item.verificationCard?.enhancedVerification;
              const sys = SYSTEM_LABEL[item.system];

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
                        <div className="mt-1 font-mono text-[11px] text-text-3">
                          {formatKickoff(item.matchTime)}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {item.marketOdds ? (
                          <PriceTag
                            odds={item.marketOdds.decimalOdds}
                            size="lg"
                            sub={item.marketOdds.bookmaker}
                          />
                        ) : (
                          <span className="text-[11px] font-bold text-warn-ink">No price on file</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      <Stamp
                        tone="ok"
                        icon={<Check className="h-3 w-3" strokeWidth={3.5} />}
                      >
                        Verified
                      </Stamp>
                      <Chip tone={sys.tone}>{sys.short}</Chip>
                      {item.surface && <Chip tone="neutral">{item.surface}</Chip>}
                      {enhanced && (
                        <Chip
                          tone="warn"
                          icon={<AlertTriangle className="h-3 w-3" strokeWidth={2.5} />}
                        >
                          Enhanced
                        </Chip>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5">
                      <span className="truncate font-mono text-[12px] font-bold text-text">
                        {item.betType}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-bold text-brand-ink">
                        Audit card
                        <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                      </span>
                    </div>
                  </button>

                  <div className="px-4 pb-3">
                    <a
                      id={`btn-verify-google-m-${item.id}`}
                      href={googleUrl(item)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-h-[32px] items-center gap-1.5 rounded-md border border-info-line bg-info-soft px-2 text-[11px] font-bold text-info-ink"
                    >
                      Check Google
                      <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </Plate>
      )}
    </div>
  );
};
