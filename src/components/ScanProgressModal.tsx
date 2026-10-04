import React, { useEffect, useRef, useState } from 'react';
import { Database, OctagonAlert, Terminal, X } from 'lucide-react';
import { Button } from './ui';
import { SealMark } from './AppShell';
import { FeedProgressEvent, ScanPlanLine } from '../services/dataFeed';

interface ScanProgressModalProps {
  isOpen: boolean;
  /**
   * True while the modal is open but the user hasn't yet confirmed starting
   * the scan — no provider call has been made at all yet. Clicking "Run
   * Daily Scan" always lands here first; nothing downloads until the user
   * explicitly confirms.
   */
  awaitingConfirmation: boolean;
  /** What this scan will actually download, given the current settings — shown during the confirmation step. */
  planLines: ScanPlanLine[];
  hasAnyWork: boolean;
  /** True while the real fetchCandidateFixtures/verification pipeline is in flight. */
  isRunning: boolean;
  /** True once the real scan has resolved (success or error) — never a timed guess. */
  isFinished: boolean;
  /** True once the user has confirmed stopping the scan and the in-flight calls were aborted. */
  isCancelled: boolean;
  /** Real progress events as they arrive from the live provider calls. */
  events: FeedProgressEvent[];
  /** Latest known "records received so far" count per sport, from real event data. */
  footballRecords: number;
  onClose: () => void;
  /** Actually cancels the in-flight provider calls — only called after the user confirms below. */
  onStop: () => void;
  /** Only called once the user confirms the plan shown above — this is what actually starts the scan. */
  onConfirmStart: () => void;
  /**
   * Which flow this instance represents — the full daily scan (default) or
   * the Settings "Refresh live feed" preview. Both make the same kind of
   * real, cancellable provider calls, so they share this component rather
   * than duplicating it; only the copy differs.
   */
  variant?: 'dailyScan' | 'feedPreview';
}

const COPY = {
  dailyScan: {
    idPrefix: 'scan',
    ariaConfirm: 'Confirm daily scan',
    title: 'Run a manual daily scan?',
    subtitle: 'This makes real calls to the configured provider(s) — nothing has been requested yet.',
    planHeading: 'What this scan will download',
    startLabel: 'Start scan',
    ariaProgress: 'Daily scan progress',
    runningTitle: 'Running daily scan',
    runningSubtitle: 'Requesting live fixtures from the configured provider(s) — this can take a while under rate limits.',
    finishedTitle: 'Scan complete',
    finishedSubtitle: 'Every candidate audited against the locked filters.',
    cancelledTitle: 'Scan stopped',
    cancelledSubtitle: 'Cancelled before finishing — no results from this run were saved.',
    streamLabel: 'Live audit stream',
    stopConfirmText:
      'Stop this scan? The in-progress API calls will be cancelled and no results from this run will be saved.',
    stopButtonLabel: 'Stop scan',
    footerFinishedText: 'All candidates audited and stamped.',
    footerCancelledText: 'Stopped before completion.',
    viewResultsLabel: 'View qualifiers',
    cancelledStreamNote: 'Scan stopped by user — remaining API calls were cancelled.',
    finishedStreamNote: 'Scan finished — results are ready.',
  },
  feedPreview: {
    idPrefix: 'feed-preview',
    ariaConfirm: 'Confirm live feed preview',
    title: 'Refresh Feed & Impact numbers?',
    subtitle:
      "This makes real calls to the configured provider(s), using your current unsaved Filter Thresholds draft — nothing has been requested yet. Only enabled rules are fetched.",
    planHeading: 'What this refresh will download',
    startLabel: 'Start refresh',
    ariaProgress: 'Feed & Impact refresh progress',
    runningTitle: 'Refreshing Feed & Impact numbers',
    runningSubtitle: 'Requesting live fixtures from the configured provider(s) to refresh your current draft filters.',
    finishedTitle: 'Feed & Impact numbers refreshed',
    finishedSubtitle: 'Filter Thresholds below now reflect this data.',
    cancelledTitle: 'Refresh stopped',
    cancelledSubtitle: 'Cancelled before finishing — Filter Thresholds still show data from the last completed refresh.',
    streamLabel: 'Live feed stream',
    stopConfirmText:
      'Stop this refresh? The in-progress API calls will be cancelled and Filter Thresholds will keep showing data from the last completed refresh.',
    stopButtonLabel: 'Stop refresh',
    footerFinishedText: 'Filter Thresholds updated with this data.',
    footerCancelledText: 'Stopped before completion.',
    viewResultsLabel: 'Done',
    cancelledStreamNote: 'Refresh stopped by user — remaining API calls were cancelled.',
    finishedStreamNote: 'Refresh finished — Filter Thresholds updated.',
  },
} as const;

/**
 * Shows the actual state of a running scan — real messages and real record
 * counts as they come back from the provider calls — instead of a fixed
 * animation timed independently of the network work it's meant to reflect.
 * Because provider trial keys are rate-limited (see server/httpClient.ts),
 * a scan enriching dozens of fixtures can legitimately take well over a
 * minute; this is what tells the user it's still working, not hung.
 */
export const ScanProgressModal: React.FC<ScanProgressModalProps> = ({
  isOpen,
  awaitingConfirmation,
  planLines,
  hasAnyWork,
  isRunning,
  isFinished,
  isCancelled,
  events,
  footballRecords,
  onClose,
  onStop,
  onConfirmStart,
  variant = 'dailyScan',
}) => {
  const c = COPY[variant];
  const logRef = useRef<HTMLDivElement>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  useEffect(() => {
    if (!isOpen) setConfirmingStop(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const totalRecords = footballRecords;
  const canClose = isFinished || isCancelled || awaitingConfirmation;

  if (awaitingConfirmation) {
    return (
      <div
        className="animate-veil fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label={c.ariaConfirm}
      >
        <div
          id={`${c.idPrefix}-confirm-modal`}
          className="animate-lift flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-drawer sm:rounded-2xl"
        >
          <div className="guilloche shrink-0 border-b border-line bg-surface-2 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-on-brand">
                  <SealMark className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="text-[15px] font-extrabold tracking-tight text-text">{c.title}</h3>
                  <p className="text-[12px] text-text-2">{c.subtitle}</p>
                </div>
              </div>
              <button
                id={`btn-close-${c.idPrefix}-confirm`}
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-3 transition-colors duration-200 hover:bg-surface-3 hover:text-text"
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-line bg-surface-2 px-2 py-2 text-center">
                <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-3">1. Download</div>
                <div className="mt-0.5 text-[11px] leading-snug text-text-2">
                  Raw fixtures for the days and leagues below
                </div>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 px-2 py-2 text-center">
                <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-3">2. Enrich</div>
                <div className="mt-0.5 text-[11px] leading-snug text-text-2">
                  Team stats &amp; H2H for a capped subset
                </div>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 px-2 py-2 text-center">
                <div className="text-[10px] font-extrabold uppercase tracking-wide text-text-3">3. Filter</div>
                <div className="mt-0.5 text-[11px] leading-snug text-text-2">
                  Each rule's own thresholds decide qualifiers
                </div>
              </div>
            </div>

            <div className="mb-2 flex items-center gap-1.5 rule-head text-text-2">
              <Database className="h-3.5 w-3.5" strokeWidth={2.5} />
              {c.planHeading}
            </div>
            <div className="space-y-2.5">
              {planLines.map((line, i) => (
                <div key={i} className="rounded-lg border border-line bg-surface-2 px-3.5 py-3">
                  <div className="text-[12px] font-bold text-text">{line.label}</div>
                  <div className="mt-0.5 text-[12px] leading-relaxed text-text-2">{line.detail}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3.5">
            <button
              id={`btn-cancel-${c.idPrefix}-confirm`}
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-[12px] font-semibold text-text-2 hover:bg-surface-3 transition-colors"
            >
              Cancel
            </button>
            <Button
              id={`btn-confirm-start-${c.idPrefix}`}
              type="button"
              variant="primary"
              disabled={!hasAnyWork}
              onClick={onConfirmStart}
            >
              {c.startLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="animate-veil fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={c.ariaProgress}
    >
      <div
        id={`${c.idPrefix}-progress-modal`}
        className="animate-lift flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-drawer sm:rounded-2xl"
      >
        {/* Head */}
        <div className="guilloche shrink-0 border-b border-line bg-surface-2 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  isCancelled
                    ? 'bg-warn-soft text-warn-ink'
                    : isFinished
                    ? 'animate-stamp bg-ok-soft text-ok-ink'
                    : 'bg-brand text-on-brand'
                }`}
              >
                {isCancelled ? <OctagonAlert className="h-6 w-6" /> : <SealMark className="h-6 w-6" />}
              </span>
              <div>
                <h3 className="text-[15px] font-extrabold tracking-tight text-text">
                  {isCancelled ? c.cancelledTitle : isFinished ? c.finishedTitle : c.runningTitle}
                </h3>
                <p className="text-[12px] text-text-2">
                  {isCancelled ? c.cancelledSubtitle : isFinished ? c.finishedSubtitle : c.runningSubtitle}
                </p>
              </div>
            </div>

            {canClose && (
              <button
                id={`btn-close-${c.idPrefix}-modal`}
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-3 transition-colors duration-200 hover:bg-surface-3 hover:text-text"
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>

          {/* Live record counters, driven by real provider responses */}
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-3">Football</div>
              <div className="font-mono text-[15px] font-bold text-text">{footballRecords}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-3">Total records</div>
              <div className="font-mono text-[15px] font-bold text-text">{totalRecords}</div>
            </div>
          </div>

          {/* Indeterminate progress bar — there's no fixed step count to
              measure against (dates/fixtures vary per run), so this reflects
              "still working" rather than a fabricated percentage. */}
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
            {isCancelled ? (
              <div className="h-full w-full rounded-full bg-warn" />
            ) : isFinished ? (
              <div className="h-full w-full rounded-full bg-ok" />
            ) : (
              <div className="animate-sweep h-full w-1/3 rounded-full bg-brand" />
            )}
          </div>
        </div>

        {/* Live audit stream */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="px-5 py-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="rule-head flex items-center gap-1.5 text-text-2">
                <Terminal className="h-3.5 w-3.5" strokeWidth={2.5} />
                {c.streamLabel}
              </span>
              <span className="font-mono text-[10px] text-text-3">
                {isCancelled ? 'stopped' : isFinished ? 'ended' : isRunning ? 'streaming…' : 'starting…'}
              </span>
            </div>

            <div
              id={`${c.idPrefix}-terminal-log`}
              ref={logRef}
              className="h-64 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface-2 px-3 py-2.5 font-mono text-[11px] leading-relaxed"
            >
              {events.length === 0 && !isFinished && !isCancelled && (
                <div className="text-text-3">Connecting to configured provider(s)…</div>
              )}
              {events.map((evt, i) => (
                <div key={i} className="text-text-2">
                  <span className="text-text-3">[{evt.sport}]</span> {evt.message}
                </div>
              ))}
              {isCancelled && <div className="font-bold text-warn-ink">{c.cancelledStreamNote}</div>}
              {isFinished && <div className="font-bold text-ok-ink">{c.finishedStreamNote}</div>}
              {!isFinished && !isCancelled && (
                <div className="h-3 w-24 overflow-hidden rounded bg-surface-3">
                  <div className="animate-sweep h-full w-1/3 bg-brand-soft" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stop confirmation — replaces the footer until the user decides */}
        {confirmingStop && (
          <div className="shrink-0 border-t border-line bg-warn-soft px-5 py-3.5">
            <div className="flex items-start gap-2.5">
              <OctagonAlert className="h-4 w-4 text-warn-ink shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1 space-y-2.5">
                <p className="text-[12px] font-semibold text-warn-ink">{c.stopConfirmText}</p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    id={`btn-cancel-stop-${c.idPrefix}`}
                    type="button"
                    onClick={() => setConfirmingStop(false)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-text-2 hover:bg-surface-3 transition-colors"
                  >
                    Keep going
                  </button>
                  <button
                    id={`btn-confirm-stop-${c.idPrefix}`}
                    type="button"
                    onClick={() => {
                      setConfirmingStop(false);
                      onStop();
                    }}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-bad text-on-bad hover:bg-bad-hover transition-colors"
                  >
                    {`Yes, ${c.stopButtonLabel.toLowerCase()}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Foot */}
        {!confirmingStop && (
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface-2 px-5 py-3.5">
            <span className="text-[12px] text-text-2">
              {isCancelled ? c.footerCancelledText : isFinished ? c.footerFinishedText : `${totalRecords} record(s) retrieved so far…`}
            </span>
            <div className="flex items-center gap-2">
              {isRunning && !isFinished && !isCancelled && (
                <button
                  id={`btn-stop-${c.idPrefix}`}
                  type="button"
                  onClick={() => setConfirmingStop(true)}
                  className="px-3 py-2 rounded-lg text-[12px] font-semibold text-bad-ink border border-line hover:bg-surface-3 transition-colors"
                >
                  {c.stopButtonLabel}
                </button>
              )}
              <Button
                id={`btn-view-${c.idPrefix}-results`}
                type="button"
                variant="primary"
                disabled={!canClose}
                onClick={onClose}
              >
                {isCancelled ? 'Close' : isFinished ? c.viewResultsLabel : 'Working…'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
