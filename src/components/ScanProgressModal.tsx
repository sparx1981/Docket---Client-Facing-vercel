import React, { useEffect, useRef } from 'react';
import { Terminal, X } from 'lucide-react';
import { Button } from './ui';
import { SealMark } from './AppShell';
import { FeedProgressEvent } from '../services/dataFeed';

interface ScanProgressModalProps {
  isOpen: boolean;
  /** True while the real fetchCandidateFixtures/verification pipeline is in flight. */
  isRunning: boolean;
  /** True once the real scan has resolved (success or error) — never a timed guess. */
  isFinished: boolean;
  /** Real progress events as they arrive from the live provider calls. */
  events: FeedProgressEvent[];
  /** Latest known "records received so far" count per sport, from real event data. */
  footballRecords: number;
  tennisRecords: number;
  onClose: () => void;
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
  isRunning,
  isFinished,
  events,
  footballRecords,
  tennisRecords,
  onClose,
}) => {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  if (!isOpen) return null;

  const totalRecords = footballRecords + tennisRecords;

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
                  isFinished
                    ? 'animate-stamp bg-ok-soft text-ok-ink'
                    : 'bg-brand text-on-brand'
                }`}
              >
                <SealMark className="h-6 w-6" />
              </span>
              <div>
                <h3 className="text-[15px] font-extrabold tracking-tight text-text">
                  {isFinished ? 'Scan complete' : 'Running daily scan'}
                </h3>
                <p className="text-[12px] text-text-2">
                  {isFinished
                    ? 'Every candidate audited against the locked filters.'
                    : 'Requesting live fixtures from the configured provider(s) — this can take a while under rate limits.'}
                </p>
              </div>
            </div>

            {isFinished && (
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
            {isFinished ? (
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
                {isFinished ? 'ended' : isRunning ? 'streaming…' : 'starting…'}
              </span>
            </div>

            <div
              id="scan-terminal-log"
              ref={logRef}
              className="h-64 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface-2 px-3 py-2.5 font-mono text-[11px] leading-relaxed"
            >
              {events.length === 0 && !isFinished && (
                <div className="text-text-3">Connecting to configured provider(s)…</div>
              )}
              {events.map((evt, i) => (
                <div key={i} className="text-text-2">
                  <span className="text-text-3">[{evt.sport}]</span> {evt.message}
                </div>
              ))}
              {isFinished && (
                <div className="font-bold text-ok-ink">Scan finished — results are ready.</div>
              )}
              {!isFinished && (
                <div className="h-3 w-24 overflow-hidden rounded bg-surface-3">
                  <div className="animate-sweep h-full w-1/3 bg-brand-soft" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Foot */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface-2 px-5 py-3.5">
          <span className="text-[12px] text-text-2">
            {isFinished
              ? 'All candidates audited and stamped.'
              : `${totalRecords} record(s) retrieved so far…`}
          </span>
          <Button
            id="btn-view-scan-results"
            variant="primary"
            disabled={!isFinished}
            onClick={onClose}
          >
            {isFinished ? 'View qualifiers' : 'Auditing…'}
          </Button>
        </div>
      </div>
    </div>
  );
};
