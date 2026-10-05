import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Download, Loader2, Trash2, X } from 'lucide-react';
import { Button, inputClass } from './ui';
import { getHistoricalBets, getResettableDataCounts, resetUserData } from '../services/storage';
import { buildArchiveCsv } from '../services/archiveCsv';
import { downloadCsv } from '../services/backtest';

/** The word the user must type to confirm. Case-sensitive on purpose. */
export const RESET_CONFIRM_WORD = 'RESET';

interface ResetDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The signed-in user's id, so the cloud copy is wiped too. Null only when nobody is signed in. */
  userId: string | null;
  /** Set when something must be fixed before a reset is allowed (e.g. unsaved configuration changes). */
  blockedReason?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "Reset data": wipes the Archive, sync history, saved backtests and the
 * current Verified Qualifiers / Price Watch, from the cloud and this browser,
 * and keeps Engine Configuration. Guarded by a count of exactly what will go,
 * an offer to download the Archive first, and typing RESET.
 */
export const ResetDataModal: React.FC<ResetDataModalProps> = ({ isOpen, onClose, userId, blockedReason }) => {
  const [confirmText, setConfirmText] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Counted each time the modal opens, so it shows what is stored right now.
  const counts = useMemo(() => (isOpen ? getResettableDataCounts() : null), [isOpen]);

  if (!isOpen || !counts) return null;

  const handleClose = () => {
    if (isResetting) return;
    setConfirmText('');
    setError(null);
    onClose();
  };

  const handleDownloadArchive = () => {
    downloadCsv(`archive-log-all-${new Date().toISOString().slice(0, 10)}.csv`, buildArchiveCsv(getHistoricalBets()));
  };

  const handleReset = async () => {
    if (confirmText !== RESET_CONFIRM_WORD || isResetting || blockedReason) return;
    setIsResetting(true);
    setError(null);
    try {
      await resetUserData(userId);
      // A reload is the simplest way to be sure every screen, in-memory list and
      // cache starts from the now-empty data rather than a stale copy.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The reset failed. Nothing was deleted.');
      setIsResetting(false);
    }
  };

  const canConfirm = confirmText === RESET_CONFIRM_WORD && !isResetting && !blockedReason;

  // Rendered into <body>, outside Settings' <form>: pressing Enter in the confirm box
  // must never submit (and save) the configuration form behind it.
  return createPortal(
    <div
      id="reset-data-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-data-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      <div onClick={handleClose} className="fixed inset-0 bg-black/40 backdrop-blur-xs" aria-hidden="true" />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-plate">
        <div className="flex items-center justify-between border-b border-line bg-surface-2 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-bad-line bg-bad-soft">
              <Trash2 className="h-5 w-5 text-bad-ink" strokeWidth={2.5} />
            </div>
            <h2 id="reset-data-title" className="text-[17px] font-extrabold tracking-tight text-text">
              Reset data
            </h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-text-3 transition-colors hover:bg-surface-3 hover:text-text"
          >
            <X className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4 text-[12.5px] leading-relaxed text-text-2">
          <div>
            <p className="font-bold text-text">This will permanently delete:</p>
            <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
              <li id="reset-count-archive">
                Archive &amp; Performance: <strong className="text-text">{plural(counts.archiveRows, 'selection', 'selections')}</strong>
              </li>
              <li id="reset-count-synclogs">
                Sync history: <strong className="text-text">{plural(counts.syncLogs, 'logged run', 'logged runs')}</strong>
              </li>
              <li id="reset-count-backtests">
                Saved backtests: <strong className="text-text">{plural(counts.backtestRuns, 'run', 'runs')}</strong>
              </li>
              <li id="reset-count-fixtures">
                Verified Qualifiers &amp; Price Watch from the last scan:{' '}
                <strong className="text-text">{plural(counts.currentFixtures, 'fixture', 'fixtures')}</strong>
              </li>
            </ul>
          </div>

          <div>
            <p className="font-bold text-text">This stays:</p>
            <p className="mt-1">
              Everything in Engine Configuration: your TheStatsAPI key, leagues, filter thresholds, scan schedule,
              email and staking settings.
            </p>
          </div>

          <div className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2.5 text-warn-ink">
            <p className="flex items-center gap-1.5 font-bold">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
              This cannot be undone
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>It is deleted from your cloud account too, so it disappears on every device.</li>
              <li>
                Verified Qualifiers and Price Watch will be empty until the next scan. Your scan schedule is not
                changed, so nothing runs straight away. Use Run Daily Scan if you want one now.
              </li>
              <li>If Docket is open on another device or tab, reload it so it does not show old data.</li>
            </ul>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <p className="min-w-0 flex-1">Want to keep a copy of your Archive first?</p>
            <Button
              type="button"
              id="btn-reset-download-archive"
              size="sm"
              icon={<Download className="h-3.5 w-3.5" strokeWidth={2.5} />}
              onClick={handleDownloadArchive}
              disabled={counts.archiveRows === 0}
            >
              Download Archive CSV
            </Button>
          </div>

          {blockedReason && (
            <p
              id="reset-blocked-reason"
              className="rounded-lg border border-warn-line bg-warn-soft px-3 py-2 font-semibold text-warn-ink"
            >
              {blockedReason}
            </p>
          )}

          <div>
            <label htmlFor="input-reset-confirm" className="font-bold text-text">
              Type {RESET_CONFIRM_WORD} to confirm
            </label>
            <input
              id="input-reset-confirm"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={isResetting}
              className={`${inputClass} mt-1.5 font-mono`}
              placeholder={RESET_CONFIRM_WORD}
            />
          </div>

          {error && (
            <p id="reset-error" className="rounded-lg border border-bad-line bg-bad-soft px-3 py-2 font-semibold text-bad-ink">
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3.5">
          <Button type="button" variant="ghost" onClick={handleClose} disabled={isResetting}>
            Cancel
          </Button>
          <Button
            type="button"
            id="btn-confirm-reset-data"
            variant="danger"
            onClick={handleReset}
            disabled={!canConfirm}
            icon={
              isResetting ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />
              ) : (
                <Trash2 className="h-4 w-4" strokeWidth={2.5} />
              )
            }
          >
            {isResetting ? 'Resetting…' : 'Reset data'}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};
