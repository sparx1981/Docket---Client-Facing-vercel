import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  RotateCw,
  ShieldCheck,
  Sliders,
  TrendingDown,
  Info,
  History,
  LogOut,
  Cloud,
  Database,
  OctagonAlert,
  X,
} from 'lucide-react';
import { AppSettings, SystemAnalytics } from '../types';

export type TabKey = 'verified' | 'pricewatch' | 'analytics' | 'settings';

/* The seal. Drawn, not borrowed: a stamp rosette with a ruled centre bar —
   the mark that gets pressed onto every verified docket. */
export const SealMark: React.FC<{ className?: string }> = ({
  className = '',
}) => (
  <svg
    viewBox="0 0 40 40"
    className={className}
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <circle
      cx="20"
      cy="20"
      r="18"
      stroke="currentColor"
      strokeWidth="2"
      opacity="0.35"
    />
    <circle cx="20" cy="20" r="13.5" stroke="currentColor" strokeWidth="2" />
    <path
      d="M20 3.5v4M20 32.5v4M3.5 20h4M32.5 20h4M8.3 8.3l2.8 2.8M28.9 28.9l2.8 2.8M31.7 8.3l-2.8 2.8M11.1 28.9l-2.8 2.8"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.55"
    />
    <path
      d="M14 20.2l4.2 4.2L26.5 16"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

interface NavItem {
  key: TabKey;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  count?: number;
}

interface AppShellProps {
  activeTab: TabKey;
  setActiveTab: (tab: TabKey) => void;
  verifiedCount: number;
  priceWatchCount: number;
  analytics: SystemAnalytics;
  settings: AppSettings;
  isScanning: boolean;
  /** True only while the progress modal itself is open — narrower than isScanning, so the button stays clickable (to reveal the modal) during a background load that hasn't opened it yet. */
  scanModalOpen: boolean;
  /** Live count of records pulled so far — shown on the button while a scan runs so it never looks hung. */
  scanRecordsSoFar?: number;
  onRunScan: () => void;
  /** Actually cancels the in-flight scan/load — only called after the header's own confirm step. Omit to hide the stop control entirely. */
  onStopScan?: () => void;
  /** True only while there's a real in-flight fetch to cancel — narrower than isScanning, which stays true while a finished modal is still on screen. */
  canStopScan?: boolean;
  lastScanTimestamp: string | null;
  onOpenSyncHistory: () => void;
  onOpenSectionInfo: (section: TabKey) => void;
  children: React.ReactNode;
  banner: React.ReactNode;
  autoScanNotice?: { message: string; timestamp: string } | null;
  onDismissAutoScanNotice?: () => void;
  user?: { email?: string | null; displayName?: string | null; photoURL?: string | null; uid?: string } | null;
  onSignOut?: () => void;
  isCloudConnected?: boolean;
}

const TITLES: Record<TabKey, { title: string; strap: string }> = {
  verified: {
    title: 'Verified Qualifiers',
    strap: 'Selections that cleared every locked filter and the price threshold',
  },
  pricewatch: {
    title: 'Price Watch',
    strap: 'Statistically clean, waiting on the exchange to reach the required price',
  },
  analytics: {
    title: 'Archive & Performance',
    strap: 'Settled results, system-by-system return, and the profit trajectory',
  },
  settings: {
    title: 'Engine Configuration',
    strap: 'Data providers, exchange credentials, and the daily scan routine',
  },
};

export const AppShell: React.FC<AppShellProps> = ({
  activeTab,
  setActiveTab,
  verifiedCount,
  priceWatchCount,
  analytics,
  settings,
  isScanning,
  scanModalOpen,
  scanRecordsSoFar,
  onRunScan,
  onStopScan,
  canStopScan = false,
  lastScanTimestamp,
  onOpenSyncHistory,
  onOpenSectionInfo,
  children,
  banner,
  autoScanNotice,
  onDismissAutoScanNotice,
  user = null,
  onSignOut,
  isCloudConnected = true,
}) => {
  const items: NavItem[] = [
    {
      key: 'verified',
      label: 'Verified Qualifiers',
      shortLabel: 'Docket',
      icon: <ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2} />,
      count: verifiedCount,
    },
    {
      key: 'pricewatch',
      label: 'Price Watch',
      shortLabel: 'Watch',
      icon: <TrendingDown className="h-[18px] w-[18px]" strokeWidth={2} />,
      count: priceWatchCount,
    },
    {
      key: 'analytics',
      label: 'Archive & Performance',
      shortLabel: 'Archive',
      icon: <BarChart3 className="h-[18px] w-[18px]" strokeWidth={2} />,
    },
    {
      key: 'settings',
      label: 'Engine Configuration',
      shortLabel: 'Engine',
      icon: <Sliders className="h-[18px] w-[18px]" strokeWidth={2} />,
    },
  ];

  const formatScan = (iso: string | null) => {
    if (!iso) return 'Not run today';
    try {
      return new Date(iso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'Today';
    }
  };

  // A dedicated, always-reachable stop control in the header itself — not
  // just inside the progress modal — so a running scan/background load
  // (from the header button showing "Auditing…") can always be stopped
  // from right there, with its own confirm step before anything cancels.
  const [confirmingStopFromHeader, setConfirmingStopFromHeader] = useState(false);
  const stopPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canStopScan) setConfirmingStopFromHeader(false);
  }, [canStopScan]);

  useEffect(() => {
    if (!confirmingStopFromHeader) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (stopPopoverRef.current && !stopPopoverRef.current.contains(e.target as Node)) {
        setConfirmingStopFromHeader(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [confirmingStopFromHeader]);

  const roiPositive = analytics.roiPercentage >= 0;
  const page = TITLES[activeTab];

  return (
    <div className="min-h-screen">
      {/* ---------------- Desktop rail ---------------- */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-brand-line bg-brand-soft lg:flex">
        <div className="relative border-b border-brand-hover bg-brand px-5 py-5">
          <div className="flex w-full items-center justify-center">
            <span className="text-[18px] font-extrabold tracking-tight text-white">
              The Docket
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Primary">
          {items.map((item) => {
            const active = item.key === activeTab;
            return (
              <button
                key={item.key}
                id={`nav-${item.key}`}
                onClick={() => setActiveTab(item.key)}
                aria-current={active ? 'page' : undefined}
                className={`group relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13px] font-semibold transition-all duration-200 ${
                  active
                    ? 'bg-brand text-on-brand shadow-sm'
                    : 'text-brand-ink hover:bg-brand-soft'
                }`}
              >
                <span className={active ? '' : 'text-brand-ink/70 group-hover:text-brand-ink'}>
                  {item.icon}
                </span>
                <span className="flex-1 truncate">{item.label}</span>
                {typeof item.count === 'number' && item.count > 0 && (
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${
                      active
                        ? 'bg-white/20 text-on-brand'
                        : 'bg-brand-soft text-brand-ink'
                    }`}
                  >
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Standing performance readout — the operator's running score. */}
        <div className="mx-3 mb-3 rounded-xl border border-brand-line bg-surface/75 backdrop-blur-xs px-3.5 py-3">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <div>
              <dt className="text-[10px] uppercase font-bold tracking-wider text-text-3">Win rate</dt>
              <dd className="font-mono text-[15px] font-bold tabular-nums text-text">
                {analytics.winRate}%
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase font-bold tracking-wider text-text-3">ROI</dt>
              <dd
                className={`font-mono text-[15px] font-bold tabular-nums ${
                  roiPositive ? 'text-ok-ink' : 'text-bad-ink'
                }`}
              >
                {roiPositive ? '+' : ''}
                {analytics.roiPercentage}%
              </dd>
            </div>
          </dl>
          <div className="mt-2.5 flex items-center gap-1.5 border-t border-brand-line/70 pt-2 font-mono text-[10px] text-text-3">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            Scheduled {settings.dailyScanScheduleUtc} UTC
          </div>
        </div>

        {/* User Account & Cloud Sync Status */}
        {user && (
          <div className="mx-3 mb-3 rounded-xl border border-brand-line bg-surface/90 p-3 shadow-2xs space-y-2">
            <div className="flex items-center gap-2.5 min-w-0">
              {user.photoURL ? (
                <img
                  src={user.photoURL}
                  alt={user.displayName || 'User'}
                  className="h-7 w-7 rounded-full object-cover border border-line"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="h-7 w-7 rounded-full bg-brand text-white flex items-center justify-center font-bold text-xs shrink-0">
                  {(user.displayName || user.email || 'U')[0].toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-text">
                  {user.displayName || 'Google Account'}
                </p>
                <p className="truncate text-[10px] text-text-3 font-mono">
                  {user.email || 'Connected'}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-line/60 pt-2 text-[10px]">
              <div className="inline-flex items-center gap-1 font-mono text-ok-ink">
                <Database className="h-3 w-3" />
                <span>Firestore Synced</span>
              </div>
              {onSignOut && (
                <button
                  id="btn-sidebar-sign-out"
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex items-center gap-1 font-bold text-text-3 hover:text-bad-ink transition-colors cursor-pointer"
                  title="Sign out of your account"
                >
                  <LogOut className="h-3 w-3" />
                  <span>Sign out</span>
                </button>
              )}
            </div>
          </div>
        )}
      </aside>

      {/* ---------------- Main column ---------------- */}
      <div className="lg:pl-[248px]">
        {banner}

        <header className="sticky top-0 z-30 border-b border-line bg-surface/92 backdrop-blur-md">
          <div className="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            {/* Mobile brand */}
            <span className="inline-flex items-center justify-center rounded-lg bg-brand px-2.5 py-1 text-[12px] font-extrabold tracking-tight text-white shadow-plate lg:hidden">
              The Docket
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[17px] font-extrabold leading-tight tracking-tight text-text sm:text-[19px]">
                  {page.title}
                </h1>
                {(activeTab === 'verified' ||
                  activeTab === 'pricewatch' ||
                  activeTab === 'analytics') && (
                  <button
                    id={`btn-info-${activeTab}`}
                    onClick={() => onOpenSectionInfo(activeTab)}
                    className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-text-2 transition-all hover:border-brand hover:bg-brand-soft hover:text-brand-ink focus:outline-none focus:ring-2 focus:ring-brand/20 cursor-pointer shadow-2xs"
                    title={`Click to view criteria & data sources for ${page.title}`}
                    aria-label={`View inclusion criteria and data sources for ${page.title}`}
                  >
                    <Info className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </button>
                )}
              </div>
              <p className="hidden truncate text-[12px] text-text-2 sm:block">
                {page.strap}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {settings.scheduleEnabled && (
                <div
                  id="header-auto-scan-status"
                  onClick={onOpenSyncHistory}
                  className="hidden xl:inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-text-2 cursor-pointer transition-colors hover:border-brand hover:text-text shadow-2xs"
                  title={`Auto-Scan scheduler is actively running. Scheduled daily at ${settings.dailyScanScheduleUtc} UTC. Click to view sync history.`}
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-ok"></span>
                  </span>
                  <span>Auto-Scan: {settings.dailyScanScheduleUtc} UTC</span>
                </div>
              )}

              <button
                id="btn-header-last-scan"
                onClick={onOpenSyncHistory}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] text-text-2 transition-colors hover:border-brand hover:bg-surface-3 hover:text-text cursor-pointer"
                title="Click to view full sync and audit history log"
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    lastScanTimestamp ? 'bg-ok' : 'bg-warn'
                  }`}
                />
                <span className="hidden xs:inline">Last scan {formatScan(lastScanTimestamp)}</span>
                <span className="xs:hidden">{formatScan(lastScanTimestamp)}</span>
                <History className="h-3 w-3 text-text-3 ml-0.5" />
              </button>

              <div className="relative inline-flex items-stretch">
                <button
                  id="btn-run-daily-scan"
                  onClick={onRunScan}
                  disabled={scanModalOpen}
                  title={isScanning && !scanModalOpen ? 'A fetch is already running — click to view progress' : undefined}
                  className={`inline-flex min-h-[40px] items-center gap-2 bg-cta px-3.5 text-[13px] font-extrabold text-on-cta shadow-plate transition-all duration-200 hover:bg-cta-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-text-3 disabled:shadow-none sm:px-4 ${
                    canStopScan && onStopScan ? 'rounded-l-lg' : 'rounded-lg'
                  }`}
                >
                  <RotateCw
                    className={`h-4 w-4 ${isScanning ? 'animate-spin' : ''}`}
                    strokeWidth={2.5}
                  />
                  <span className="hidden sm:inline">
                    {isScanning
                      ? scanRecordsSoFar !== undefined
                        ? `Auditing… (${scanRecordsSoFar})`
                        : 'Auditing…'
                      : 'Run Daily Scan'}
                  </span>
                  <span className="sm:hidden">
                    {isScanning ? (scanRecordsSoFar !== undefined ? `…${scanRecordsSoFar}` : '…') : 'Scan'}
                  </span>
                </button>

                {canStopScan && onStopScan && (
                  <button
                    id="btn-header-stop-scan"
                    type="button"
                    onClick={() => setConfirmingStopFromHeader((v) => !v)}
                    aria-label="Stop the running scan"
                    title="Stop the running scan"
                    className="inline-flex min-h-[40px] items-center justify-center rounded-r-lg border-l border-cta-hover/40 bg-cta px-2.5 text-on-cta shadow-plate transition-all duration-200 hover:bg-bad hover:text-on-bad active:scale-[0.98]"
                  >
                    <X className="h-4 w-4" strokeWidth={2.5} />
                  </button>
                )}

                {confirmingStopFromHeader && onStopScan && (
                  <div
                    ref={stopPopoverRef}
                    role="dialog"
                    aria-label="Confirm stop scan"
                    className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl border border-line bg-surface p-3 shadow-drawer animate-in fade-in zoom-in-95 duration-150"
                  >
                    <div className="flex items-start gap-2">
                      <OctagonAlert className="h-4 w-4 text-warn-ink shrink-0 mt-0.5" />
                      <p className="text-[12px] font-semibold text-text leading-snug">
                        Stop this scan? In-progress API calls will be cancelled and no results from this run will be saved.
                      </p>
                    </div>
                    <div className="mt-2.5 flex items-center justify-end gap-2">
                      <button
                        id="btn-header-keep-going"
                        type="button"
                        onClick={() => setConfirmingStopFromHeader(false)}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-text-2 hover:bg-surface-3 transition-colors"
                      >
                        Keep going
                      </button>
                      <button
                        id="btn-header-confirm-stop"
                        type="button"
                        onClick={() => {
                          setConfirmingStopFromHeader(false);
                          onStopScan();
                        }}
                        className="px-3 py-1.5 rounded-lg text-[12px] font-bold bg-bad text-on-bad hover:bg-bad-hover transition-colors"
                      >
                        Yes, stop scan
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {user && onSignOut && (
                <button
                  id="btn-header-sign-out"
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 text-[12px] font-semibold text-text-2 hover:bg-surface-3 hover:text-bad-ink transition-colors cursor-pointer"
                  title={`Sign out (${user.email || user.displayName})`}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden md:inline">Sign Out</span>
                </button>
              )}
            </div>
          </div>
        </header>

        {autoScanNotice && (
          <div
            id="banner-auto-scan-notification"
            className="flex items-center justify-between border-b border-brand/20 bg-brand-soft px-4 py-2 text-[12px] text-brand-ink sm:px-6 lg:px-8 transition-all"
          >
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-ok animate-pulse" />
              <span>
                <strong className="font-extrabold">Auto-Scheduler [{autoScanNotice.timestamp}]:</strong>{' '}
                {autoScanNotice.message}
              </span>
            </div>
            {onDismissAutoScanNotice && (
              <button
                id="btn-dismiss-auto-scan-notice"
                onClick={onDismissAutoScanNotice}
                className="font-mono text-[11px] text-text-3 hover:text-text cursor-pointer ml-3 underline"
              >
                Dismiss
              </button>
            )}
          </div>
        )}

        <main className="mx-auto max-w-[1400px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10">
          {children}
        </main>
      </div>

      {/* ---------------- Mobile tab bar ---------------- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
      >
        <div className="grid grid-cols-4">
          {items.map((item) => {
            const active = item.key === activeTab;
            return (
              <button
                key={item.key}
                onClick={() => setActiveTab(item.key)}
                aria-current={active ? 'page' : undefined}
                className={`relative flex min-h-[58px] flex-col items-center justify-center gap-1 px-1 text-[10px] font-bold transition-colors duration-200 ${
                  active ? 'text-brand-ink' : 'text-text-3'
                }`}
              >
                {active && (
                  <span className="absolute inset-x-4 top-0 h-[2px] rounded-b bg-brand" />
                )}
                <span className="relative">
                  {item.icon}
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 min-w-[15px] rounded-full bg-brand px-1 font-mono text-[9px] font-bold leading-[15px] text-on-brand">
                      {item.count}
                    </span>
                  )}
                </span>
                {item.shortLabel}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
