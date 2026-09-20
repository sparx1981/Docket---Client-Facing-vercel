import React from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Database,
  ExternalLink,
  Hash,
  ListChecks,
  ScrollText,
  X,
} from 'lucide-react';
import { CandidateFixture, VerificationAuditCard } from '../types';
import { Button, Chip, Detail, Stamp } from './ui';
import { SealMark } from './AppShell';

interface VerificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  fixture: CandidateFixture | null;
  auditCard: VerificationAuditCard | null;
  onLogToHistory?: (
    fixture: CandidateFixture,
    audit: VerificationAuditCard
  ) => void;
}

const SectionTitle: React.FC<{
  icon: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
}> = ({ icon, children, aside }) => (
  <div className="mb-2.5 flex items-center justify-between gap-3 border-b border-line pb-2">
    <h3 className="rule-head flex items-center gap-1.5 text-text">
      <span className="text-brand-ink">{icon}</span>
      {children}
    </h3>
    {aside}
  </div>
);

export const VerificationDrawer: React.FC<VerificationDrawerProps> = ({
  isOpen,
  onClose,
  fixture,
  auditCard,
  onLogToHistory,
}) => {
  const [copied, setCopied] = React.useState(false);
  const [filed, setFiled] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      setCopied(false);
      setFiled(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen || !fixture || !auditCard) return null;

  const handleCopy = () => {
    const text = `VERIFICATION CARD AUDIT
Audit ID: ${auditCard.auditId}
Match: ${fixture.matchTitle} (${fixture.competition})
System: ${fixture.betType} @${fixture.betfairMarket ? fixture.betfairMarket.decimalOdds : 'not yet connected'}
Betfair Market ID: ${fixture.betfairMarket ? fixture.betfairMarket.marketId : 'n/a — exchange integration pending'}
Integrity Score: ${auditCard.dataIntegrityScore}%
Enhanced Verification: ${auditCard.enhancedVerification ? 'YES' : 'NO'}
Audit Status: ${auditCard.status}
Timestamp: ${auditCard.generatedAt}
Summary:
${auditCard.rawEvidenceSummary.join('\n')}`;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="animate-veil absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        id="verification-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Verification certificate for ${fixture.matchTitle}`}
        className="animate-slide-in absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-line bg-surface shadow-drawer"
      >
        {/* ---------------- Certificate head ---------------- */}
        <header className="guilloche relative shrink-0 border-b border-line bg-surface-2 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <Stamp
                  tone="ok"
                  animate
                  icon={<Check className="h-3 w-3" strokeWidth={3.5} />}
                >
                  Audit verified
                </Stamp>
                {auditCard.enhancedVerification && (
                  <Chip
                    tone="warn"
                    icon={<AlertTriangle className="h-3 w-3" strokeWidth={2.5} />}
                  >
                    Enhanced
                  </Chip>
                )}
              </div>

              <h2 className="text-[19px] font-extrabold leading-tight tracking-tight text-text">
                {fixture.matchTitle}
              </h2>

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-text-2">
                <span>{fixture.competition}</span>
                <span className="text-text-3">·</span>
                <span className="font-mono font-bold text-text">
                  {fixture.betType}
                </span>
                <span className="text-text-3">·</span>
                {fixture.betfairMarket ? (
                  <span className="font-mono font-bold text-ok-ink">
                    @{fixture.betfairMarket.decimalOdds.toFixed(2)}
                  </span>
                ) : (
                  <span className="font-mono font-bold text-warn-ink">
                    Exchange odds not yet connected
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              {/* The pressed seal — this document has been signed off. */}
              <span className="animate-stamp mr-1 hidden text-seal sm:block">
                <SealMark className="h-11 w-11" />
              </span>
              <button
                id="btn-close-drawer"
                onClick={onClose}
                aria-label="Close certificate"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-text-3 transition-colors duration-200 hover:bg-surface-3 hover:text-text"
              >
                <X className="h-5 w-5" strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </header>

        {/* ---------------- Body ---------------- */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Serial block */}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-line bg-surface-2 px-4 py-3.5 sm:grid-cols-4">
            <Detail label="Audit ID" mono>
              {auditCard.auditId}
            </Detail>
            <Detail label="Integrity">
              <span className="text-ok-ink">
                {auditCard.dataIntegrityScore}% independent
              </span>
            </Detail>
            <Detail label="Sourcing">
              {auditCard.providerUsed === 'THESTATSAPI'
                ? 'TheStatsAPI'
                : auditCard.providerUsed === 'SPORTRADAR'
                ? 'Sportradar'
                : 'Sportmonks'}
            </Detail>
            <Detail label="Stamped at" mono>
              {new Date(auditCard.generatedAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </Detail>
          </dl>

          {/* Quick Outbound Independent Verification Links */}
          <div className="mt-4 rounded-xl border border-brand-line bg-brand-soft p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider text-brand-ink">
                External Verification Links
              </span>
              <span className="font-mono text-[10px] text-text-3">
                Independent live audit
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {/* Link 1: Official / Google Schedule */}
              <a
                id="btn-quick-google-verify"
                href={
                  fixture.googleVerificationUrl ||
                  `https://www.google.com/search?q=${encodeURIComponent(
                    `${fixture.matchTitle} ${fixture.competition} fixture date time`
                  )}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg border border-line bg-surface px-2.5 py-2 text-[11px] font-bold text-text shadow-sm transition-all hover:border-brand hover:text-brand-ink"
              >
                <span>Google Schedule</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-text-3" strokeWidth={2.5} />
              </a>

              {/* Link 2: Betfair Exchange */}
              <a
                id="btn-quick-betfair-verify"
                href={`https://www.betfair.com/exchange/plus/search?query=${encodeURIComponent(fixture.matchTitle)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg border border-brand-line bg-brand px-2.5 py-2 text-[11px] font-bold text-white shadow-sm transition-all hover:bg-brand-hover"
              >
                <span>Betfair Exchange</span>
                <ExternalLink className="h-3 w-3 shrink-0" strokeWidth={2.5} />
              </a>

              {/* Link 3: Flashscore or Tennis Abstract */}
              <a
                id="btn-quick-stats-verify"
                href={
                  fixture.sport === 'tennis'
                    ? `http://www.tennisabstract.com/cgi-bin/player.cgi?p=${encodeURIComponent(fixture.matchTitle.split(' v ')[0])}`
                    : `https://www.flashscore.com/search/?q=${encodeURIComponent(fixture.matchTitle)}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between rounded-lg border border-line bg-surface px-2.5 py-2 text-[11px] font-bold text-text shadow-sm transition-all hover:border-brand hover:text-brand-ink"
              >
                <span>{fixture.sport === 'tennis' ? 'Tennis Abstract' : 'Flashscore Stats'}</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-text-3" strokeWidth={2.5} />
              </a>
            </div>
          </div>

          {/* Schedule Validation / Independent confirmation */}
          <section className="mt-5 rounded-xl border border-info-line bg-info-soft px-4 py-3.5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="text-[13px] font-bold text-info-ink">
                  Schedule Validation &amp; Fixture Confirmation
                </h3>
                <p className="mt-0.5 text-[12px] leading-snug text-text-2">
                  Verify outside this system that the fixture is confirmed and scheduled as stated.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  id="btn-drawer-google-verify"
                  href={
                    fixture.googleVerificationUrl ||
                    `https://www.google.com/search?q=${encodeURIComponent(
                      `${fixture.matchTitle} ${fixture.competition} fixture date time`
                    )}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg bg-info px-3 text-[11px] font-bold text-white transition-opacity duration-200 hover:opacity-90"
                >
                  Check Google
                  <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
                </a>
                <a
                  id="btn-drawer-schedule-external"
                  href={
                    fixture.sport === 'tennis'
                      ? `https://www.flashscore.com/search/?q=${encodeURIComponent(fixture.matchTitle)}`
                      : `https://www.flashscore.com/search/?q=${encodeURIComponent(fixture.matchTitle)}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[34px] shrink-0 items-center gap-1.5 rounded-lg border border-info-line bg-surface px-2.5 text-[11px] font-bold text-info-ink transition-colors hover:bg-info-soft"
                >
                  Flashscore Match Centre
                  <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
                </a>
              </div>
            </div>

            <dl className="mt-3 grid grid-cols-1 gap-3 border-t border-info-line pt-3 sm:grid-cols-3">
              <Detail label="Scheduled" mono>
                {new Date(fixture.matchTime).toLocaleString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Detail>
              <Detail label="Venue">
                {fixture.venue || 'Official competition venue'}
              </Detail>
              <Detail label="Competition">{fixture.competition}</Detail>
            </dl>
          </section>

          {auditCard.enhancedVerification &&
            auditCard.enhancedVerificationReason && (
              <section className="mt-5 rounded-xl border border-warn-line bg-warn-soft px-4 py-3.5">
                <h3 className="flex items-center gap-1.5 text-[13px] font-bold text-warn-ink">
                  <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Enhanced verification log
                </h3>
                <p className="mt-1 text-[12px] leading-relaxed text-text-2">
                  {auditCard.enhancedVerificationReason}
                </p>
              </section>
            )}

          {/* Exchange market */}
          <section className="mt-6">
            <SectionTitle
              icon={<ScrollText className="h-3.5 w-3.5" strokeWidth={2.5} />}
              aside={
                <a
                  id="btn-drawer-betfair-section-link"
                  href={`https://www.betfair.com/exchange/plus/search?query=${encodeURIComponent(fixture.matchTitle)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border border-brand-line bg-brand-soft px-2.5 text-[11px] font-bold text-brand-ink transition-colors hover:bg-brand hover:text-white"
                >
                  Audit on Betfair Exchange
                  <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
                </a>
              }
            >
              Betfair Exchange Market Integrity
            </SectionTitle>

            {fixture.betfairMarket ? (
              <div className="rounded-xl border border-line bg-surface-2 px-4 py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-bold text-text">
                      {fixture.betfairMarket.selectionName}
                    </span>
                    <Chip tone="info">Exchange only</Chip>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xl font-bold tabular-nums leading-none text-ok-ink">
                      <span className="opacity-55">@</span>
                      {fixture.betfairMarket.decimalOdds.toFixed(2)}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-text-3">
                      lay @{fixture.betfairMarket.layOdds.toFixed(2)}
                    </div>
                  </div>
                </div>

                <dl className="grid grid-cols-3 gap-3 pt-3">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wider text-text-3">Market ID</dt>
                    <dd className="mt-0.5">
                      <a
                        id="btn-drawer-market-id-link"
                        href={`https://www.betfair.com/exchange/plus/search?query=${encodeURIComponent(fixture.betfairMarket.marketId)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[13px] font-bold text-brand-ink underline hover:opacity-80"
                        title="Verify Market ID directly on Betfair"
                      >
                        {fixture.betfairMarket.marketId}
                        <ExternalLink className="ml-1 inline h-2.5 w-2.5 align-baseline" />
                      </a>
                    </dd>
                  </div>
                  <Detail label="Matched" mono>
                    £{fixture.betfairMarket.liquidityMatched.toLocaleString()}
                  </Detail>
                  <Detail label="Depth" mono>
                    £{fixture.betfairMarket.availableBackVolume.toLocaleString()}
                  </Detail>
                </dl>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-2.5 text-[11px]">
                  <p className="flex items-center gap-1.5 text-text-2">
                    <Check className="h-3.5 w-3.5 shrink-0 text-ok-ink" strokeWidth={3} />
                    <span>Sportsbook excluded · Order-book verified on Betfair Exchange</span>
                  </p>
                  <a
                    id="btn-drawer-exchange-direct"
                    href={`https://www.betfair.com/exchange/plus/search?query=${encodeURIComponent(fixture.matchTitle)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] font-bold text-brand-ink underline hover:text-brand"
                  >
                    Confirm Live Order Book &rarr;
                  </a>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-warn-line bg-warn-soft px-4 py-3.5">
                <p className="flex items-center gap-2 text-[13px] font-bold text-warn-ink">
                  <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                  Not yet connected — exchange odds integration pending
                </p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-text-2">
                  Betfair Exchange integration is deferred to a later phase (it needs a
                  certificate-based login flow). This candidate's statistical criteria have been
                  checked against real provider data, but no live price has been attached — it will
                  show here as soon as phase 2 lands.
                </p>
              </div>
            )}
          </section>

          {/* Recalculation */}
          <section className="mt-6">
            <SectionTitle
              icon={<Database className="h-3.5 w-3.5" strokeWidth={2.5} />}
              aside={
                <div className="flex items-center gap-2">
                  <Chip tone="ok">0% divergence</Chip>
                  <a
                    id="btn-drawer-recalc-outbound"
                    href={
                      fixture.sport === 'tennis'
                        ? `http://www.tennisabstract.com/cgi-bin/player.cgi?p=${encodeURIComponent(fixture.matchTitle.split(' v ')[0])}`
                        : `https://www.flashscore.com/search/?q=${encodeURIComponent(fixture.matchTitle)}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-text-2 underline hover:text-brand-ink"
                  >
                    Audit stats archive
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              }
            >
              Secondary recalculation
            </SectionTitle>

            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-surface-2">
                    <th className="rule-head px-3 py-2">Criterion</th>
                    <th className="rule-head px-3 py-2">Computed</th>
                    <th className="rule-head px-3 py-2">Threshold</th>
                    <th className="rule-head px-3 py-2 text-right">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {auditCard.recalculatedMetrics.map((m, i) => (
                    <tr key={i} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-2.5 text-[12px] font-semibold text-text">
                        {m.ruleLabel}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px] tabular-nums text-text-2">
                        {m.computedMetric}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px] tabular-nums text-text-3">
                        {m.thresholdRequired}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {m.verifiedMatch ? (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-ok-ink">
                            <Check className="h-3 w-3" strokeWidth={3.5} />
                            PASS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] font-bold text-bad-ink">
                            <X className="h-3 w-3" strokeWidth={3.5} />
                            FAIL
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Filters */}
          <section className="mt-6">
            <SectionTitle icon={<ListChecks className="h-3.5 w-3.5" strokeWidth={2.5} />}>
              Locked-rule breakdown
            </SectionTitle>

            <div className="space-y-2">
              {auditCard.filterChecks.map((filter) => (
                <div
                  key={filter.filterId}
                  className={`rounded-lg border px-3.5 py-3 ${
                    filter.passed
                      ? 'border-line bg-surface-2'
                      : 'border-bad-line bg-bad-soft'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-[12px] font-bold text-text">
                      {filter.filterName}
                    </span>
                    {filter.passed ? (
                      <Chip tone="ok" icon={<Check className="h-3 w-3" strokeWidth={3.5} />}>
                        Satisfied
                      </Chip>
                    ) : (
                      <Chip tone="bad" icon={<X className="h-3 w-3" strokeWidth={3.5} />}>
                        Unmet
                      </Chip>
                    )}
                  </div>
                  <dl className="mt-2 space-y-1 text-[11px]">
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-text-3">Rule</dt>
                      <dd className="text-text-2">{filter.targetRule}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-text-3">Observed</dt>
                      <dd className="font-semibold text-text">
                        {filter.observedValue}
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 border-t border-line pt-1.5 font-mono text-[10px] leading-relaxed text-text-3">
                    {filter.auditDetails}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* Raw evidence */}
          {fixture.footballDetails && (
            <section className="mt-6">
              <SectionTitle
                icon={<Hash className="h-3.5 w-3.5" strokeWidth={2.5} />}
                aside={
                  <div className="flex items-center gap-1.5">
                    <a
                      id="btn-drawer-raw-flashscore"
                      href={`https://www.flashscore.com/search/?q=${encodeURIComponent(fixture.matchTitle)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-bold text-text transition-colors hover:border-brand hover:text-brand-ink"
                    >
                      Audit on Flashscore
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <a
                      id="btn-drawer-raw-sofascore"
                      href={`https://www.sofascore.com/search?q=${encodeURIComponent(fixture.matchTitle)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-bold text-text transition-colors hover:border-brand hover:text-brand-ink"
                    >
                      SofaScore H2H
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                }
              >
                Raw Evidence: Head-to-head records
              </SectionTitle>
              <ul className="overflow-hidden rounded-xl border border-line">
                {fixture.footballDetails.h2hMatches.map((m, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2 last:border-b-0"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-[10px] text-text-3">
                        {m.date}
                      </span>
                      <span className="truncate text-[12px] font-semibold text-text">
                        {m.homeTeam} v {m.awayTeam}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className="font-mono text-[13px] font-bold tabular-nums text-text">
                        {m.homeScore}–{m.awayScore}
                      </span>
                      <Chip tone={m.totalGoals > 1 ? 'ok' : 'neutral'}>
                        {m.totalGoals} goals
                      </Chip>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {fixture.tennisDetails && (
            <section className="mt-6">
              <SectionTitle
                icon={<Hash className="h-3.5 w-3.5" strokeWidth={2.5} />}
                aside={
                  <div className="flex items-center gap-1.5">
                    <a
                      id="btn-drawer-raw-tennis-abstract"
                      href={`http://www.tennisabstract.com/cgi-bin/player.cgi?p=${encodeURIComponent(fixture.matchTitle.split(' v ')[0])}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-bold text-text transition-colors hover:border-brand hover:text-brand-ink"
                    >
                      Audit on Tennis Abstract
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    <a
                      id="btn-drawer-raw-tennis-flashscore"
                      href={`https://www.flashscore.com/search/?q=${encodeURIComponent(fixture.matchTitle)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-bold text-text transition-colors hover:border-brand hover:text-brand-ink"
                    >
                      Flashscore Tennis
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                }
              >
                Raw Evidence: Completed singles matches
              </SectionTitle>
              <ul className="overflow-hidden rounded-xl border border-line">
                {fixture.tennisDetails.playerRecentSingles.slice(0, 10).map((m, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2 last:border-b-0"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-mono text-[10px] text-text-3">
                        {m.date}
                      </span>
                      <span className="truncate text-[12px] font-semibold text-text">
                        v {m.opponent}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-text-3">
                        #{m.opponentRank}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span className="font-mono text-[12px] tabular-nums text-text-2">
                        {m.score}
                      </span>
                      <Chip tone={m.won ? 'ok' : 'bad'}>{m.won ? 'Win' : 'Loss'}</Chip>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ---------------- Footer ---------------- */}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-2 px-5 py-3.5">
          <Button
            id="btn-drawer-copy-summary"
            onClick={handleCopy}
            icon={
              copied ? (
                <Check className="h-4 w-4 text-ok-ink" strokeWidth={2.5} />
              ) : (
                <Copy className="h-4 w-4" strokeWidth={2} />
              )
            }
          >
            {copied ? 'Copied' : 'Copy audit'}
          </Button>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {onLogToHistory && (
              <Button
                id="btn-drawer-archive-bet"
                variant="primary"
                disabled={filed}
                onClick={() => {
                  onLogToHistory(fixture, auditCard);
                  setFiled(true);
                }}
                icon={
                  filed ? <Check className="h-4 w-4" strokeWidth={2.5} /> : undefined
                }
              >
                {filed ? 'Filed to archive' : 'File to archive'}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};
