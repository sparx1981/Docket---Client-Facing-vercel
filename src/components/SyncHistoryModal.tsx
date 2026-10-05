import React, { useState } from 'react';
import {
  History,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  RefreshCw,
  ExternalLink,
  Clock,
  Database,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AppSettings, SyncLogRecord, SyncStatus } from '../types';
import { formatTimeUntilNextRun } from '../services/scheduler';

interface SyncHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  syncLogs: SyncLogRecord[];
  onTriggerScan: () => void;
  isScanning: boolean;
  settings?: AppSettings;
}

export const SyncHistoryModal: React.FC<SyncHistoryModalProps> = ({
  isOpen,
  onClose,
  syncLogs,
  onTriggerScan,
  isScanning,
  settings,
}) => {
  const [filter, setFilter] = useState<'all' | SyncStatus>('all');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(
    syncLogs[0]?.id || null
  );

  if (!isOpen) return null;

  const filteredLogs = syncLogs.filter((log) => {
    if (filter === 'all') return true;
    return log.status === filter;
  });

  const totalScannedAllTime = syncLogs.reduce(
    (acc, log) => acc + log.totalRecordsScanned,
    0
  );

  const formatTimestamp = (iso: string) => {
    try {
      const d = new Date(iso);
      return {
        date: d.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        time: d.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short',
        }),
      };
    } catch {
      return { date: iso, time: '' };
    }
  };

  const getStatusBadge = (status: SyncStatus) => {
    switch (status) {
      case 'SUCCEEDED':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ok-line bg-ok-soft px-2.5 py-0.5 font-mono text-[11px] font-bold text-ok-ink">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Succeeded
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warn-line bg-warn-soft px-2.5 py-0.5 font-mono text-[11px] font-bold text-warn-ink">
            <AlertTriangle className="h-3.5 w-3.5" />
            Warning
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-bad-line bg-bad-soft px-2.5 py-0.5 font-mono text-[11px] font-bold text-bad-ink">
            <XCircle className="h-3.5 w-3.5" />
            Failed
          </span>
        );
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sync-history-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity"
        aria-hidden="true"
      />

      {/* Modal Card */}
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-line bg-surface shadow-plate overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line bg-surface-2 px-6 py-4.5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-line bg-brand-soft">
              <History className="h-5 w-5 text-brand-ink" strokeWidth={2.5} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  id="sync-history-title"
                  className="text-[17px] font-extrabold text-text tracking-tight sm:text-[19px]"
                >
                  Sync &amp; Audit History Log
                </h2>
                <span className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] font-bold text-text-2">
                  {syncLogs.length} logged runs
                </span>
              </div>
              <p className="text-[12px] text-text-2">
                Historical record of all daily scheduled scans and manual data audits
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              id="btn-trigger-sync-from-modal"
              onClick={onTriggerScan}
              disabled={isScanning}
              className="inline-flex items-center gap-1.5 rounded-lg border border-brand bg-brand px-3 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isScanning ? 'animate-spin' : ''}`}
              />
              <span>{isScanning ? 'Auditing...' : 'Run Sync Now'}</span>
            </button>
            <button
              id="btn-close-sync-history"
              onClick={onClose}
              aria-label="Close sync history"
              className="rounded-lg border border-line bg-surface p-1.5 text-text-3 transition-colors hover:border-brand hover:text-text cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Top KPI row */}
        <div className="grid grid-cols-2 border-b border-line bg-surface-2/60 sm:grid-cols-4">
          <div className="border-r border-line p-4">
            <div className="rule-head">Total Audits</div>
            <div className="font-mono text-[17px] font-bold tabular-nums text-text mt-0.5">
              {syncLogs.length}
            </div>
            <div className="text-[10px] text-text-3">100% logged</div>
          </div>
          <div className="border-r border-line p-4">
            <div className="rule-head">Latest Status</div>
            <div className="font-mono text-[15px] font-bold text-ok-ink mt-0.5">
              {syncLogs[0]?.status || 'No runs yet'}
            </div>
            <div className="text-[10px] text-text-3">
              {syncLogs[0] ? `${syncLogs[0].divergenceRate}% divergence` : 'Run a scan to see one'}
            </div>
          </div>
          <div className="border-r border-line p-4">
            <div className="rule-head">Processed Records</div>
            <div className="font-mono text-[17px] font-bold tabular-nums text-text mt-0.5">
              {totalScannedAllTime}
            </div>
            <div className="text-[10px] text-text-3">Total candidate checks scanned</div>
          </div>
          <div className="p-4">
            <div className="rule-head">Avg Duration</div>
            <div className="font-mono text-[17px] font-bold tabular-nums text-text mt-0.5">
              {syncLogs.length > 0
                ? `${Math.round(syncLogs.reduce((a, l) => a + l.durationMs, 0) / syncLogs.length)}ms`
                : '—'}
            </div>
            <div className="text-[10px] text-text-3">Real measured scan time</div>
          </div>
        </div>

        {/* Automated Scan Scheduler Status Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-brand-soft/40 px-6 py-2.5 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-ok"></span>
            </span>
            <span className="font-semibold text-text">
              Auto-Scan Scheduler:{' '}
              <span className="font-bold text-ok-ink">
                {settings?.scheduleEnabled ? 'ACTIVE' : 'PAUSED'}
              </span>
            </span>
            <span className="text-text-3">·</span>
            <span className="text-text-2">
              Daily routine set for <strong>{settings?.dailyScanScheduleUtc || '06:00'} UTC</strong>
            </span>
          </div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-text-3">
            <span>
              Next run: {formatTimeUntilNextRun(settings?.dailyScanScheduleUtc || '06:00')}
            </span>
            <span>·</span>
            <span>
              Auto-Archive:{' '}
              <strong className="text-text-2">
                {settings?.autoArchiveQualifiers !== false ? 'Enabled' : 'Disabled'}
              </strong>
            </span>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex items-center justify-between border-b border-line px-6 py-2.5 bg-surface">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-bold text-text-2 uppercase tracking-wider mr-1">
              Filter:
            </span>
            {(['all', 'SUCCEEDED', 'WARNING', 'FAILED'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={`rounded-md px-2.5 py-1 font-mono text-[11px] font-bold transition-colors ${
                  filter === s
                    ? 'bg-brand text-white'
                    : 'bg-surface-2 text-text-2 hover:bg-surface-3 hover:text-text'
                }`}
              >
                {s === 'all' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>

          <div className="font-mono text-[11px] text-text-3">
            Showing {filteredLogs.length} of {syncLogs.length} runs
          </div>
        </div>

        {/* Log List */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {filteredLogs.length === 0 ? (
            <div className="py-12 text-center text-text-3">
              No sync log entries match the selected filter.
            </div>
          ) : (
            filteredLogs.map((log) => {
              const isExpanded = expandedLogId === log.id;
              const { date, time } = formatTimestamp(log.timestamp);

              return (
                <div
                  key={log.id}
                  className={`rounded-xl border transition-all ${
                    isExpanded
                      ? 'border-brand bg-surface shadow-xs'
                      : 'border-line bg-surface hover:border-text-3'
                  }`}
                >
                  {/* Summary Bar */}
                  <div
                    onClick={() =>
                      setExpandedLogId(isExpanded ? null : log.id)
                    }
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between cursor-pointer select-none"
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">{getStatusBadge(log.status)}</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[13px] font-bold text-text">
                            {log.id}
                          </span>
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-text-2">
                            {log.trigger === 'SCHEDULED'
                              ? 'Daily Schedule'
                              : 'Manual Audit'}
                          </span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 font-mono text-[11px] text-text-3">
                          <Clock className="h-3 w-3" />
                          <span>
                            {date} · {time}
                          </span>
                          <span>•</span>
                          <span>{log.durationMs}ms</span>
                        </div>
                      </div>
                    </div>

                    {/* Stats Pills */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-center">
                        <div className="text-[10px] uppercase font-bold text-text-3">
                          Scanned
                        </div>
                        <div className="font-mono text-[13px] font-bold text-text">
                          {log.totalRecordsScanned}
                        </div>
                      </div>

                      <div className="rounded-lg border border-ok-line bg-ok-soft px-2.5 py-1 text-center">
                        <div className="text-[10px] uppercase font-bold text-ok-ink">
                          Qualifiers
                        </div>
                        <div className="font-mono text-[13px] font-bold text-ok-ink">
                          {log.qualifiersCount}
                        </div>
                      </div>

                      <div className="rounded-lg border border-warn-line bg-warn-soft px-2.5 py-1 text-center">
                        <div className="text-[10px] uppercase font-bold text-warn-ink">
                          Price Watch
                        </div>
                        <div className="font-mono text-[13px] font-bold text-warn-ink">
                          {log.priceWatchCount}
                        </div>
                      </div>

                      <div className="rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-center">
                        <div className="text-[10px] uppercase font-bold text-text-3">
                          Disqualified
                        </div>
                        <div className="font-mono text-[13px] font-bold text-text-2">
                          {log.rejectedCount}
                        </div>
                      </div>

                      <div className="pl-1 text-text-3">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="border-t border-line bg-surface-2/60 p-4 space-y-4">
                      {/* Telemetry Note */}
                      <div className="rounded-lg border border-line bg-surface p-3 text-[12px] text-text-2 leading-relaxed">
                        <span className="font-bold text-text mr-1">
                          Audit Summary:
                        </span>
                        {log.notes}
                        <span className="ml-2 font-mono text-[11px] font-bold text-ok-ink">
                          (Recalculation divergence: {log.divergenceRate}%)
                        </span>
                      </div>

                      {/* Connected Data Sources */}
                      <div>
                        <div className="rule-head mb-2 flex items-center gap-1.5">
                          <Database className="h-3.5 w-3.5" />
                          Data Sources Responding
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          {log.dataSources.map((ds) => (
                            <div
                              key={ds.name}
                              className="flex items-center justify-between rounded-lg border border-line bg-surface p-2.5"
                            >
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold text-text truncate">
                                  {ds.name}
                                </div>
                                <div className="font-mono text-[10px] text-text-3">
                                  {ds.recordsSupplied} records supplied
                                </div>
                              </div>
                              <span
                                className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                                  ds.status === 'ONLINE'
                                    ? 'bg-ok-soft text-ok-ink'
                                    : ds.status === 'DEGRADED'
                                    ? 'bg-warn-soft text-warn-ink'
                                    : 'bg-bad-soft text-bad-ink'
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    ds.status === 'ONLINE' ? 'bg-ok' : ds.status === 'DEGRADED' ? 'bg-warn' : 'bg-bad'
                                  }`}
                                />
                                {ds.status}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Breakdown by System */}
                      <div>
                        <div className="rule-head mb-2 flex items-center gap-1.5">
                          <Layers className="h-3.5 w-3.5" />
                          System Breakdown
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[11px]">
                            <thead>
                              <tr className="border-b border-line text-text-3">
                                <th className="pb-1.5 font-bold">System Strategy</th>
                                <th className="pb-1.5 font-bold text-right">Scanned</th>
                                <th className="pb-1.5 font-bold text-right text-ok-ink">Qualified</th>
                                <th className="pb-1.5 font-bold text-right text-warn-ink">Price Watch</th>
                                <th className="pb-1.5 font-bold text-right">Failed Filter</th>
                              </tr>
                            </thead>
                            <tbody className="font-mono">
                              {log.systemBreakdown.map((sb) => (
                                <tr
                                  key={sb.system}
                                  className="border-b border-line/50 last:border-b-0"
                                >
                                  <td className="py-1.5 font-sans font-medium text-text">
                                    {sb.label}
                                  </td>
                                  <td className="py-1.5 text-right text-text-2">
                                    {sb.scanned}
                                  </td>
                                  <td className="py-1.5 text-right font-bold text-ok-ink">
                                    {sb.qualified}
                                  </td>
                                  <td className="py-1.5 text-right font-bold text-warn-ink">
                                    {sb.priceWatch}
                                  </td>
                                  <td className="py-1.5 text-right text-text-3">
                                    {sb.scanned - sb.qualified - sb.priceWatch}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-line bg-surface-2 px-6 py-3.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
            <span className="font-mono text-[11px] text-text-2">
              Next scheduled daily scan: {formatTimeUntilNextRun(settings?.dailyScanScheduleUtc || '06:00')} ({settings?.dailyScanScheduleUtc || '06:00'} UTC)
            </span>
          </div>

          <button
            id="btn-close-sync-modal-bottom"
            onClick={onClose}
            className="rounded-lg border border-line bg-surface px-4 py-1.5 text-[12px] font-bold text-text hover:border-brand"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
