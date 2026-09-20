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
  tennisRecords: number;
  onClose: () => void;
  /** Actually cancels the in-flight provider calls — only called after the user confirms below. */
  onStop: () => void;
  /** Only called once the user confirms the plan shown above — this is what actually starts the scan. */
  onConfirmStart: () => void;
}

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
  tennisRecords,
  onClose,
  onStop,
  onConfirmStart,
}) => {
  const logRef = useRef<HTMLDivElement>(null);
  const [confirmingStop, setConfirmingStop] = useState(false);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  useEffect(() => {
    if (!isOpen) setConfirmingStop(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const totalRecords = footballRecords + tennisRecords;
  const canClose = isFinished || isCancelled || awaitingConfirmation;

  if (awaitingConfirmation) {
    return (
      <div
        className="animate-veil fixed inset-0 z-50 flex items-end justify-center bg-black/65 p-0 sm:items-center sm:p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm daily scan"
      >
        <div
          id="scan-confirm-modal"
          className="animate-lift flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-line bg-surface shadow-drawer sm:rounded-2xl"
        >
          <div className="guilloche shrink-0 border-b border-line bg-surface-2 px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-on-brand">
                  <SealMark className="h-6 w-6" />
                </span>
                <div>
                  <h3 className="text-[15px] font-extrabold tracking-tight text-text">Run a manual daily scan?</h3>
                  <p className="text-[12px] text-text-2">
                    This makes real calls to the configured provider(s) — nothing has been requested yet.
                  </p>
                </div>
              </div>
              <button
                id="btn-close-scan-confirm"
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-3 transition-colors duration-200 hover:bg-surface-3 hover:text-text"
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            <div className="mb-2 flex items-center gap-1.5 rule-head text-text-2">
              <Database className="h-3.5 w-3.5" strokeWidth={2.5} />
              What this scan will download
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
              id="btn-cancel-scan-confirm"
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-[12px] font-semibold text-text-2 hover:bg-surface-3 transition-colors"
            >
              Cancel
            </button>
            <Button id="btn-confirm-start-scan" variant="primary" disabled={!hasAnyWork} onClick={onConfirmStart}>
              Start scan
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
      aria-label="Daily scan progress"
    >
      <div
        id="scan-progress-modal"
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
                  {isCancelled ? 'Scan stopped' : isFinished ? 'Scan complete' : 'Running daily scan'}
                </h3>
                <p className="text-[12px] text-text-2">
                  {isCancelled
                    ? 'Cancelled before finishing — no results from this run were saved.'
                    : isFinished
                    ? 'Every candidate audited against the locked filters.'
                    : 'Requesting live fixtures from the configured provider(s) — this can take a while under rate limits.'}
                </p>
              </div>
            </div>

            {canClose && (
              <button
                id="btn-close-scan-modal"
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-text-3 transition-colors duration-200 hover:bg-surface-3 hover:text-text"
              >
                <X className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>

          {/* Live record counters, driven by real provider responses */}
          <div className="mt-3.5 grid grid-cols-3 gap-2">
            <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-3">Football</div>
              <div className="font-mono text-[15px] font-bold text-text">{footballRecords}</div>
            </div>
            <div className="rounded-lg border border-line bg-surface px-2.5 py-2">
              <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-text-3">Tennis</div>
              <div className="font-mono text-[15px] font-bold text-text">{tennisRecords}</div>
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
                Live audit stream
              </span>
              <span className="font-mono text-[10px] text-text-3">
                {isCancelled ? 'stopped' : isFinished ? 'ended' : isRunning ? 'streaming…' : 'starting…'}
              </span>
            </div>

            <div
              id="scan-terminal-log"
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
              {isCancelled && (
                <div className="font-bold text-warn-ink">Scan stopped by user — remaining API calls were cancelled.</div>
              )}
              {isFinished && <div className="font-bold text-ok-ink">Scan finished — results are ready.</div>}
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
                <p className="text-[12px] font-semibold text-warn-ink">
                  Stop this scan? The in-progress API calls will be cancelled and no results from this run will be
                  saved.
                </p>
                <div className="flex items-center justify-end gap-2">
                  <button
                    id="btn-cancel-stop-scan"
                    type="button"
                    onClick={() => setConfirmingStop(false)}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-text-2 hover:bg-surface-3 transition-colors"
                  >
                    Keep going
                  </button>
                  <button
                    id="btn-confirm-stop-scan"
                    type="button"
                    onClick={() => {
                      setConfirmingStop(false);
                      onStop();
                    }}
                    className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-bad text-on-bad hover:bg-bad-hover transition-colors"
                  >
                    Yes, stop scan
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
              {isCancelled
                ? 'Stopped before completion.'
                : isFinished
                ? 'All candidates audited and stamped.'
                : `${totalRecords} record(s) retrieved so far…`}
            </span>
            <div className="flex items-center gap-2">
              {isRunning && !isFinished && !isCancelled && (
                <button
                  id="btn-stop-scan"
                  type="button"
                  onClick={() => setConfirmingStop(true)}
                  className="px-3 py-2 rounded-lg text-[12px] font-semibold text-bad-ink border border-line hover:bg-surface-3 transition-colors"
                >
                  Stop scan
                </button>
              )}
              <Button
                id="btn-view-scan-results"
                variant="primary"
                disabled={!canClose}
                onClick={onClose}
              >
                {isCancelled ? 'Close' : isFinished ? 'View qualifiers' : 'Auditing…'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
