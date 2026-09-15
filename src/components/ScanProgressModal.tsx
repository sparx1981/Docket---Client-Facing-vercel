import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Terminal, X } from 'lucide-react';
import { Button } from './ui';
import { SealMark } from './AppShell';

interface ScanProgressModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

interface ScanStep {
  id: number;
  label: string;
  detail: string;
  status: 'waiting' | 'in_progress' | 'completed';
}

const INITIAL_STEPS: ScanStep[] = [
  {
    id: 1,
    label: 'Fixture ingestion',
    detail: 'Building the candidate pool across domestic leagues and the ATP/WTA tours',
    status: 'in_progress',
  },
  {
    id: 2,
    label: 'Football screening',
    detail: 'Applying System A (Over 1.5) and System B (Under 3.5) locked rules',
    status: 'waiting',
  },
  {
    id: 3,
    label: 'Tennis screening',
    detail: 'Ranking delta, career surface win rate, and the last ten completed singles',
    status: 'waiting',
  },
  {
    id: 4,
    label: 'Verification engine',
    detail: 'Recalculating every aggregate from raw itemised match evidence',
    status: 'waiting',
  },
  {
    id: 5,
    label: 'Exchange audit',
    detail: 'Cross-referencing exchange markets, price thresholds and book depth',
    status: 'waiting',
  },
];

const LOG_MESSAGES = [
  'Requesting today\'s fixture card from the configured provider…',
  'Pulling team/player profiles and head-to-head records for each candidate…',
  'Applying System A (Over 1.5) and System B (Under 3.5) locked rules to real football data…',
  'Applying the tennis straight-sets rule set to real ranking and form data…',
  'Verification engine — recalculating every aggregate from raw itemised evidence…',
  'Betfair Exchange integration is not yet connected (phase 2) — qualifying candidates are held in Price Watch pending a real price.',
  'Writing the sync log with the real counts from this run…',
];

export const ScanProgressModal: React.FC<ScanProgressModalProps> = ({
  isOpen,
  onClose,
  onComplete,
}) => {
  const [logs, setLogs] = useState<string[]>([]);
  const [isFinished, setIsFinished] = useState(false);
  const [steps, setSteps] = useState<ScanStep[]>(INITIAL_STEPS);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setSteps(INITIAL_STEPS);
      setLogs([]);
      setIsFinished(false);
      return;
    }

    let cancelled = false;
    let logIndex = 0;

    const logTimer = setInterval(() => {
      if (cancelled) return;
      if (logIndex < LOG_MESSAGES.length) {
        const message = LOG_MESSAGES[logIndex];
        if (typeof message === 'string') setLogs((prev) => [...prev, message]);
        logIndex++;
      } else {
        clearInterval(logTimer);
      }
    }, 450);

    const runSteps = async () => {
      for (let i = 0; i < INITIAL_STEPS.length; i++) {
        await new Promise((res) => setTimeout(res, 900));
        if (cancelled) return;
        setSteps((prev) =>
          prev.map((s, idx) => ({
            ...s,
            status:
              idx < i + 1 ? 'completed' : idx === i + 1 ? 'in_progress' : 'waiting',
          }))
        );
      }
      if (!cancelled) {
        setIsFinished(true);
        onComplete();
      }
    };

    runSteps();

    return () => {
      cancelled = true;
      clearInterval(logTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  if (!isOpen) return null;

  const done = steps.filter((s) => s.status === 'completed').length;
  const progress = (done / steps.length) * 100;

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
                    : 'Locked-filter screening and raw-evidence verification.'}
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

          {/* Progress meter */}
          <div className="mt-3.5">
            <div className="mb-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-text-3">
              <span>Stage {Math.min(done + (isFinished ? 0 : 1), 5)} of 5</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ease-out ${
                  isFinished ? 'bg-ok' : 'bg-brand'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ul className="divide-y divide-line">
            {steps.map((step) => (
              <li
                key={step.id}
                className={`flex items-start gap-3 px-5 py-3 transition-colors duration-300 ${
                  step.status === 'in_progress' ? 'bg-brand-soft' : ''
                }`}
              >
                <span className="mt-0.5 shrink-0">
                  {step.status === 'completed' ? (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-ok-soft text-ok-ink">
                      <Check className="h-3 w-3" strokeWidth={3.5} />
                    </span>
                  ) : step.status === 'in_progress' ? (
                    <Loader2
                      className="h-5 w-5 animate-spin text-brand-ink"
                      strokeWidth={2.5}
                    />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-line font-mono text-[10px] text-text-3">
                      {step.id}
                    </span>
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[13px] font-bold ${
                        step.status === 'waiting' ? 'text-text-3' : 'text-text'
                      }`}
                    >
                      {step.label}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em]">
                      {step.status === 'completed' && (
                        <span className="text-ok-ink">Passed</span>
                      )}
                      {step.status === 'in_progress' && (
                        <span className="text-brand-ink">Running</span>
                      )}
                      {step.status === 'waiting' && (
                        <span className="text-text-3">Queued</span>
                      )}
                    </span>
                  </div>
                  <p
                    className={`mt-0.5 text-[11px] leading-snug ${
                      step.status === 'waiting' ? 'text-text-3' : 'text-text-2'
                    }`}
                  >
                    {step.detail}
                  </p>
                </div>
              </li>
            ))}
          </ul>

          {/* Audit stream */}
          <div className="border-t border-line bg-surface-2 px-5 py-3.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="rule-head flex items-center gap-1.5 text-text-2">
                <Terminal className="h-3.5 w-3.5" strokeWidth={2.5} />
                Audit stream
              </span>
              <span className="font-mono text-[10px] text-text-3">
                {isFinished ? 'ended' : 'streaming…'}
              </span>
            </div>

            <div
              id="scan-terminal-log"
              ref={logRef}
              className="h-32 space-y-1 overflow-y-auto rounded-lg border border-line bg-surface px-3 py-2.5 font-mono text-[11px] leading-relaxed"
            >
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={
                    log.includes('complete')
                      ? 'font-bold text-ok-ink'
                      : log.includes('Passed')
                      ? 'text-text'
                      : 'text-text-2'
                  }
                >
                  {log}
                </div>
              ))}
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
              : 'Verification in progress…'}
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
