import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppSettings,
  CandidateFixture,
  HistoricalBetRecord,
  VerificationAuditCard,
  SyncLogRecord,
} from './types';
import { fetchCandidateFixtures } from './services/dataFeed';
import { runVerificationAudit } from './services/verificationEngine';
import {
  calculateSystemAnalytics,
  getHistoricalBets,
  getStoredLastScanTimestamp,
  getStoredSettings,
  getStoredSyncLogs,
  hasAttemptedHistoricalBackfill,
  logVerifiedQualifierToHistory,
  markHistoricalBackfillAttempted,
  saveStoredSettings,
  syncPastHistoricalRecords,
} from './services/storage';
import {
  autoSettleAllPendingBets,
  executeBackgroundScan,
  isScheduledScanDue,
} from './services/scheduler';
import { AppShell, TabKey } from './components/AppShell';
import { ProviderStatusBanner } from './components/ProviderStatusBanner';
import { VerifiedQualifiersTable } from './components/VerifiedQualifiersTable';
import { PriceWatchTable } from './components/PriceWatchTable';
import { VerificationDrawer } from './components/VerificationDrawer';
import { AnalyticsView } from './components/AnalyticsView';
import { SettingsView } from './components/SettingsView';
import { ScanProgressModal } from './components/ScanProgressModal';
import { SectionInfoModal } from './components/SectionInfoModal';
import { SyncHistoryModal } from './components/SyncHistoryModal';

/** True once at least one real provider key is configured — governs whether we attempt any network call at all. */
const hasAnyProviderKey = (settings: AppSettings) =>
  Boolean(settings.sportradarApiKey || settings.sportmonksApiKey);

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('verified');
  const [settings, setSettings] = useState<AppSettings>(() => getStoredSettings());
  const [historicalBets, setHistoricalBets] = useState<HistoricalBetRecord[]>(() =>
    getHistoricalBets()
  );
  const [lastScanTimestamp, setLastScanTimestamp] = useState<string | null>(() =>
    getStoredLastScanTimestamp()
  );
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  const [isSyncHistoryOpen, setIsSyncHistoryOpen] = useState(false);
  const [infoModalSection, setInfoModalSection] = useState<TabKey | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLogRecord[]>(() => getStoredSyncLogs());
  const [autoScanNotice, setAutoScanNotice] = useState<{
    message: string;
    timestamp: string;
  } | null>(null);
  const [fixturesLoading, setFixturesLoading] = useState(false);
  const [fixturesError, setFixturesError] = useState<string | null>(null);
  // Guard rapid repeat clicks on these three async actions from firing
  // overlapping requests — each reads-then-writes localStorage, so two
  // in-flight calls can race and silently drop one write.
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);
  const [isAutoSettling, setIsAutoSettling] = useState(false);
  const [isAutoScanTesting, setIsAutoScanTesting] = useState(false);
  /** Reflects the outcome of the most recent real provider call — never a hardcoded claim. */
  const [providerHealth, setProviderHealth] = useState<{ ok: boolean; checkedAt: string } | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedFixture, setSelectedFixture] = useState<CandidateFixture | null>(
    null
  );
  const [selectedAudit, setSelectedAudit] =
    useState<VerificationAuditCard | null>(null);

  const [fixtures, setFixtures] = useState<CandidateFixture[]>([]);

  const backfillAttemptedRef = useRef(false);
  // Guards the scheduled-scan interval against overlapping runs: a real
  // network scan can take longer than the 30s poll interval, and the
  // interval's closure only sees `lastScanTimestamp` update after the scan
  // it's already running finishes — without this, a slow scan gets
  // re-triggered by the next tick before it's done.
  const scheduledScanInFlightRef = useRef(false);

  const loadFixtures = async (currentSettings: AppSettings) => {
    if (!hasAnyProviderKey(currentSettings)) {
      setFixtures([]);
      setFixturesError(
        'No data provider configured. Add a Sportradar or Sportmonks API key in Engine Configuration to pull fixtures.'
      );
      return;
    }

    setFixturesLoading(true);
    setFixturesError(null);
    try {
      const { fixtures: fetched, error } = await fetchCandidateFixtures(currentSettings);
      const withAudits = fetched.map((fixture) => ({
        ...fixture,
        verificationCard: runVerificationAudit(fixture, currentSettings.ruleThresholds, undefined),
      }));
      setFixtures(withAudits);
      setFixturesError(error || null);
      setProviderHealth({ ok: !error, checkedAt: new Date().toISOString() });
    } catch (err) {
      setFixtures([]);
      const message = err instanceof Error ? err.message : 'Failed to load fixtures';
      setFixturesError(message);
      setProviderHealth({ ok: false, checkedAt: new Date().toISOString() });
    } finally {
      setFixturesLoading(false);
    }
  };

  // Initial load: fetch real fixtures, and — the very first time this
  // device sees an empty archive with a provider configured — backfill
  // genuine settled results rather than leaving the Archive silently empty
  // forever or seeding it with fabricated rows.
  useEffect(() => {
    loadFixtures(settings);

    if (!backfillAttemptedRef.current && !hasAttemptedHistoricalBackfill()) {
      backfillAttemptedRef.current = true;
      markHistoricalBackfillAttempted();
      if (getHistoricalBets().length === 0 && hasAnyProviderKey(settings)) {
        syncPastHistoricalRecords(settings).then(({ bets, error }) => {
          setHistoricalBets(bets);
          if (error) {
            console.warn('[Historical backfill]', error);
          }
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Automated Background Scheduler Loop
  useEffect(() => {
    if (!settings.scheduleEnabled) return;

    const checkAndExecuteScheduledScan = async () => {
      if (scheduledScanInFlightRef.current) return;
      const isDue = isScheduledScanDue(lastScanTimestamp, settings.dailyScanScheduleUtc);
      if (!isDue) return;

      scheduledScanInFlightRef.current = true;
      try {
        const result = await executeBackgroundScan(settings, true);

        setFixtures(result.refreshedFixtures);
        setHistoricalBets(result.updatedHistoricalBets);
        setSyncLogs(getStoredSyncLogs());
        setLastScanTimestamp(result.scanTimestamp);
        setProviderHealth({ ok: !result.fetchError, checkedAt: result.scanTimestamp });

        const noticeMsg = result.fetchError
          ? `Automatic daily scan finished with issues (${settings.dailyScanScheduleUtc} UTC): ${result.fetchError}`
          : `Automatic daily scan completed (${settings.dailyScanScheduleUtc} UTC) · ${result.autoArchivedCount} qualifiers recorded to archive${
              result.autoSettledCount > 0
                ? `, ${result.autoSettledCount} concluded bets settled`
                : ''
            }.`;
        setAutoScanNotice({
          message: noticeMsg,
          timestamp: new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        });

        setTimeout(() => {
          setAutoScanNotice(null);
        }, 8000);
      } finally {
        scheduledScanInFlightRef.current = false;
      }
    };

    checkAndExecuteScheduledScan();

    const interval = setInterval(checkAndExecuteScheduledScan, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, lastScanTimestamp]);

  const handleSyncHistoricalRecords = async () => {
    if (isSyncingHistory) return;
    setIsSyncingHistory(true);
    try {
      const { bets, error } = await syncPastHistoricalRecords(settings);
      setHistoricalBets(bets);
      setAutoScanNotice({
        message: error
          ? `Historical backfill finished with issues: ${error}`
          : 'Pulled and merged real settled results into the Archive ledger.',
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });
      setTimeout(() => {
        setAutoScanNotice(null);
      }, 7000);
    } finally {
      setIsSyncingHistory(false);
    }
  };

  const verifiedQualifiers = useMemo(
    () =>
      fixtures.filter(
        (f) =>
          f.status === 'VERIFIED_QUALIFIER' &&
          f.verificationCard?.status === 'VERIFIED'
      ),
    [fixtures]
  );

  const priceWatchItems = useMemo(
    () =>
      fixtures.filter(
        (f) =>
          f.status === 'PRICE_WATCH' ||
          f.verificationCard?.status === 'PRICE_DEFICIT'
      ),
    [fixtures]
  );

  const analytics = useMemo(
    () => calculateSystemAnalytics(historicalBets),
    [historicalBets]
  );

  const handleOpenDrawer = (fixture: CandidateFixture) => {
    setSelectedFixture(fixture);
    setSelectedAudit(fixture.verificationCard || null);
    setDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setDrawerOpen(false);
    setSelectedFixture(null);
    setSelectedAudit(null);
  };

  const handleSaveSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveStoredSettings(newSettings);
    loadFixtures(newSettings);
  };

  const handleScanCompleted = async () => {
    const result = await executeBackgroundScan(settings, false);
    setFixtures(result.refreshedFixtures);
    setHistoricalBets(result.updatedHistoricalBets);
    setSyncLogs(getStoredSyncLogs());
    setLastScanTimestamp(result.scanTimestamp);
    setProviderHealth({ ok: !result.fetchError, checkedAt: result.scanTimestamp });
    setFixturesError(result.fetchError || null);
  };

  const handleTriggerAutoScanTest = async () => {
    if (isAutoScanTesting) return;
    setIsAutoScanTesting(true);
    try {
      const result = await executeBackgroundScan(settings, true);
      setFixtures(result.refreshedFixtures);
      setHistoricalBets(result.updatedHistoricalBets);
      setSyncLogs(getStoredSyncLogs());
      setLastScanTimestamp(result.scanTimestamp);
      setProviderHealth({ ok: !result.fetchError, checkedAt: result.scanTimestamp });

      const noticeMsg = result.fetchError
        ? `Automated scan test finished with issues: ${result.fetchError}`
        : `Automated scan test run finished · ${result.autoArchivedCount} qualifiers checked & recorded${
            result.autoSettledCount > 0
              ? `, ${result.autoSettledCount} concluded bets settled`
              : ''
          }.`;
      setAutoScanNotice({
        message: noticeMsg,
        timestamp: new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        }),
      });

      setTimeout(() => {
        setAutoScanNotice(null);
      }, 8000);
    } finally {
      setIsAutoScanTesting(false);
    }
  };

  const handleAutoSettlePending = async () => {
    if (isAutoSettling) return;
    setIsAutoSettling(true);
    try {
      const updated = await autoSettleAllPendingBets(settings);
      setHistoricalBets(updated);
    } finally {
      setIsAutoSettling(false);
    }
  };

  const handleLogToHistory = (
    fixture: CandidateFixture,
    audit: VerificationAuditCard
  ) => {
    logVerifiedQualifierToHistory(fixture, audit, settings.defaultStake);
    setHistoricalBets(getHistoricalBets());
  };

  return (
    <>
      <AppShell
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        verifiedCount={verifiedQualifiers.length}
        priceWatchCount={priceWatchItems.length}
        analytics={analytics}
        settings={settings}
        isScanning={isScanModalOpen || fixturesLoading}
        onRunScan={() => setIsScanModalOpen(true)}
        lastScanTimestamp={lastScanTimestamp}
        onOpenSyncHistory={() => setIsSyncHistoryOpen(true)}
        onOpenSectionInfo={(section) => setInfoModalSection(section)}
        autoScanNotice={autoScanNotice}
        onDismissAutoScanNotice={() => setAutoScanNotice(null)}
        banner={
          <ProviderStatusBanner
            settings={settings}
            providerHealth={providerHealth}
            fixturesError={fixturesError}
            onOpenSettings={() => setActiveTab('settings')}
          />
        }
      >
        {activeTab === 'verified' && (
          <VerifiedQualifiersTable
            fixtures={verifiedQualifiers}
            onSelectFixture={handleOpenDrawer}
            onRunScan={() => setIsScanModalOpen(true)}
            loadError={fixtures.length === 0 ? fixturesError : null}
          />
        )}

        {activeTab === 'pricewatch' && (
          <PriceWatchTable
            items={priceWatchItems}
            onSelectFixture={handleOpenDrawer}
            loadError={fixtures.length === 0 ? fixturesError : null}
            settings={settings}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsView
            historicalBets={historicalBets}
            onUpdateBets={setHistoricalBets}
            settings={settings}
            onAutoSettleAll={handleAutoSettlePending}
            onSyncHistoricalRecords={handleSyncHistoricalRecords}
            isAutoSettling={isAutoSettling}
            isSyncingHistory={isSyncingHistory}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsView
            settings={settings}
            onSaveSettings={handleSaveSettings}
            onTriggerAutoScanTest={handleTriggerAutoScanTest}
            isAutoScanTesting={isAutoScanTesting}
          />
        )}
      </AppShell>

      <VerificationDrawer
        isOpen={drawerOpen}
        onClose={handleCloseDrawer}
        fixture={selectedFixture}
        auditCard={selectedAudit}
        onLogToHistory={handleLogToHistory}
      />

      <ScanProgressModal
        isOpen={isScanModalOpen}
        onClose={() => setIsScanModalOpen(false)}
        onComplete={handleScanCompleted}
      />

      <SyncHistoryModal
        isOpen={isSyncHistoryOpen}
        onClose={() => setIsSyncHistoryOpen(false)}
        syncLogs={syncLogs}
        settings={settings}
        onTriggerScan={() => {
          setIsSyncHistoryOpen(false);
          setIsScanModalOpen(true);
        }}
        isScanning={isScanModalOpen}
        onSyncHistoricalRecords={handleSyncHistoricalRecords}
        isSyncingHistory={isSyncingHistory}
      />

      <SectionInfoModal
        section={infoModalSection}
        isOpen={!!infoModalSection}
        onClose={() => setInfoModalSection(null)}
        settings={settings}
      />
    </>
  );
}
