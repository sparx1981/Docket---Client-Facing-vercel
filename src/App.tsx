import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppSettings,
  CandidateFixture,
  HistoricalBetRecord,
  VerificationAuditCard,
  SyncLogRecord,
} from './types';
import { describeScanPlan, FeedProgressEvent, fetchCandidateFixtures } from './services/dataFeed';
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
  setActiveUserContext,
  hydrateUserDataFromCloud,
} from './services/storage';
import {
  signInWithGoogle,
  logOut,
  subscribeToAuthChanges,
  persistUserSettingsToCloud,
} from './services/firebase';
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
import { LoginScreen } from './components/LoginScreen';
import { VersionBadge } from './components/VersionBadge';

/** True once at least one real provider key is configured — governs whether we attempt any network call at all. */
const hasAnyProviderKey = (settings: AppSettings) =>
  Boolean(
    settings.theStatsApiKey
  );

/**
 * True once the user has saved a specific league selection on at least one
 * football rule. Until this is true, no TheStatsAPI endpoint beyond the
 * competitions listing (needed to populate the league picker itself) may be
 * called — an empty selection means "All leagues", which is exactly the
 * unscoped, expensive default this guard exists to prevent from ever being
 * hit silently.
 */
const hasAnyLeagueSelected = (settings: AppSettings) =>
  settings.ruleThresholds.footballOver15.selectedLeagueIds.length > 0 ||
  settings.ruleThresholds.footballUnder35.selectedLeagueIds.length > 0;

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserProfile | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(() => {
    try {
      return (
        sessionStorage.getItem('sports_selection_guest_mode') === 'true' ||
        localStorage.getItem('sports_selection_guest_mode') === 'true'
      );
    } catch {
      return false;
    }
  });
  const [authChecking, setAuthChecking] = useState(true);
  const [authActionLoading, setAuthActionLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  const [activeTab, setActiveTab] = useState<TabKey>('verified');
  const [settings, setSettings] = useState<AppSettings>(() => getStoredSettings());
  const [historicalBets, setHistoricalBets] = useState<HistoricalBetRecord[]>(() =>
    getHistoricalBets()
  );
  const [lastScanTimestamp, setLastScanTimestamp] = useState<string | null>(() =>
    getStoredLastScanTimestamp()
  );
  const [isScanModalOpen, setIsScanModalOpen] = useState(false);
  // Reported by SettingsView whenever its local draft differs from saved
  // settings — a scan only ever reads saved settings, so the header button
  // is disabled (with a warning) rather than silently running against
  // whatever was last saved while newer edits sit unsaved on-screen.
  const [hasUnsavedSettingsChanges, setHasUnsavedSettingsChanges] = useState(false);
  // True while the modal is showing the "here's what will download, confirm
  // to proceed" step — set on every "Run Daily Scan" click, before any
  // provider call is made. Only clicking "Start scan" inside the modal
  // clears it and actually kicks off the fetch.
  const [isAwaitingScanConfirmation, setIsAwaitingScanConfirmation] = useState(false);
  const [isScanRunning, setIsScanRunning] = useState(false);
  const [isScanFinished, setIsScanFinished] = useState(false);
  const [isScanCancelled, setIsScanCancelled] = useState(false);
  const [scanEvents, setScanEvents] = useState<FeedProgressEvent[]>([]);
  const [scanFootballRecords, setScanFootballRecords] = useState(0);
  const [scanTennisRecords, setScanTennisRecords] = useState(0);
  const scanAbortControllerRef = useRef<AbortController | null>(null);
  const [isSyncHistoryOpen, setIsSyncHistoryOpen] = useState(false);
  const [infoModalSection, setInfoModalSection] = useState<TabKey | null>(null);
  const [syncLogs, setSyncLogs] = useState<SyncLogRecord[]>(() => getStoredSyncLogs());
  const [autoScanNotice, setAutoScanNotice] = useState<{
    message: string;
    timestamp: string;
  } | null>(null);
  const [fixturesLoading, setFixturesLoading] = useState(false);
  const [fixturesError, setFixturesError] = useState<string | null>(null);
  const [isSyncingHistory, setIsSyncingHistory] = useState(false);
  const [isAutoSettling, setIsAutoSettling] = useState(false);
  const [isAutoScanTesting, setIsAutoScanTesting] = useState(false);
  /** Reflects the outcome of the most recent real provider call — never a hardcoded claim. */
  const [providerHealth, setProviderHealth] = useState<{ ok: boolean; checkedAt: string } | null>(null);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedFixture, setSelectedFixture] = useState<CandidateFixture | null>(null);
  const [selectedAudit, setSelectedAudit] = useState<VerificationAuditCard | null>(null);

  const [fixtures, setFixtures] = useState<CandidateFixture[]>([]);

  const backfillAttemptedRef = useRef(false);
  const scheduledScanInFlightRef = useRef(false);

  // Monitor Firebase Auth state
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges(async (firebaseUser) => {
      if (firebaseUser) {
        const userProfile: UserProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
        };
        setCurrentUser(userProfile);
        setActiveUserContext(userProfile);
        setIsGuest(false);

        try {
          const hydrated = await hydrateUserDataFromCloud(firebaseUser.uid, userProfile);
          setSettings(hydrated.settings);
          setHistoricalBets(hydrated.historicalBets);
          setSyncLogs(hydrated.syncLogs);
          setLastScanTimestamp(hydrated.lastScanTimestamp);
          // Deliberately no loadFixtures() here — a fresh network pull must
          // only happen at the configured schedule time or via an explicit
          // "Run Daily Scan"/manual trigger, never as a side effect of
          // logging in. The header shows whatever fixtures state already
          // holds (empty on a fresh session) until one of those fires.
        } catch (err) {
          console.error('Failed to hydrate user data from cloud on login:', err);
        }
      } else {
        setCurrentUser(null);
        setActiveUserContext(null);
      }
      setAuthChecking(false);
    });

    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSignInWithGoogle = async () => {
    setAuthActionLoading(true);
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (err: any) {
      console.error('Google Sign In failed:', err);
      setAuthError(err?.message || 'Failed to sign in with Google.');
      throw err;
    } finally {
      setAuthActionLoading(false);
    }
  };

  const handleContinueAsGuest = () => {
    try {
      sessionStorage.setItem('sports_selection_guest_mode', 'true');
    } catch {}
    setIsGuest(true);
  };

  const handleSignOut = async () => {
    try {
      await logOut();
    } catch (err) {
      console.error('Logout error:', err);
    }
    try {
      sessionStorage.removeItem('sports_selection_guest_mode');
      localStorage.removeItem('sports_selection_guest_mode');
    } catch {}
    setIsGuest(false);
    setCurrentUser(null);
    setActiveUserContext(null);
  };

  // Shared by every real fetch path (initial load, post-login hydration,
  // settings save, "Run Daily Scan") so the header count and the Stop
  // control are never specific to just one of them — a user watching
  // "Auditing…" doesn't care which code path started it.
  //
  // openModal is false for background loads (initial mount, post-login
  // hydration, settings save) — those must never block the whole UI behind
  // a modal the user didn't ask for. They still drive the header's live
  // count via isScanRunning, and the header button stays clickable so the
  // user can open the modal on demand to see progress or stop it.
  const beginFeedFetch = (openModal: boolean) => {
    if (openModal) setIsScanModalOpen(true);
    setScanEvents([]);
    setScanFootballRecords(0);
    setScanTennisRecords(0);
    setIsScanFinished(false);
    setIsScanCancelled(false);
    setIsScanRunning(true);

    const controller = new AbortController();
    scanAbortControllerRef.current = controller;

    const onProgress = (evt: FeedProgressEvent) => {
      setScanEvents((prev) => [...prev, evt]);
      if (evt.sport === 'football') setScanFootballRecords(evt.recordsSoFar);
      else setScanTennisRecords(evt.recordsSoFar);
    };

    return { signal: controller.signal, onProgress };
  };

  const endFeedFetch = (outcome: 'finished' | 'cancelled') => {
    setIsScanRunning(false);
    if (outcome === 'cancelled') setIsScanCancelled(true);
    else setIsScanFinished(true);
    scanAbortControllerRef.current = null;
  };

  const loadFixtures = async (currentSettings: AppSettings) => {
    if (!hasAnyProviderKey(currentSettings)) {
      setFixtures([]);
      setFixturesError(
        'No data provider configured. Add a TheStatsAPI key in Engine Configuration to pull fixtures.'
      );
      return;
    }
    // Don't clobber an already-running fetch's progress state (e.g. the
    // post-login hydration effect and the initial-mount effect both firing).
    if (isScanRunning) return;

    setFixturesLoading(true);
    setFixturesError(null);
    const { signal, onProgress } = beginFeedFetch(false);
    try {
      const { fixtures: fetched, error } = await fetchCandidateFixtures(currentSettings, onProgress, signal);
      const withAudits = fetched.map((fixture) => ({
        ...fixture,
        verificationCard: runVerificationAudit(fixture, currentSettings.ruleThresholds),
      }));
      setFixtures(withAudits);
      setFixturesError(error || null);
      setProviderHealth({ ok: !error, checkedAt: new Date().toISOString() });
      endFeedFetch('finished');
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        endFeedFetch('cancelled');
        return;
      }
      setFixtures([]);
      const message = err instanceof Error ? err.message : 'Failed to load fixtures';
      setFixturesError(message);
      setProviderHealth({ ok: false, checkedAt: new Date().toISOString() });
      endFeedFetch('finished');
    } finally {
      setFixturesLoading(false);
    }
  };

  // Initial load: deliberately does NOT call loadFixtures() — a fixture
  // pull must only happen at the configured schedule time or via an
  // explicit manual trigger, never automatically on every app open. The
  // one thing this still does automatically is a one-off historical
  // backfill the very first time this device sees an empty archive with a
  // provider configured, so the Archive isn't silently empty forever; that
  // is a single one-time backfill, not a recurring sync, so it stays.
  useEffect(() => {
    if (!backfillAttemptedRef.current && !hasAttemptedHistoricalBackfill()) {
      backfillAttemptedRef.current = true;
      markHistoricalBackfillAttempted();
      if (getHistoricalBets().length === 0 && hasAnyProviderKey(settings) && hasAnyLeagueSelected(settings)) {
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

  const handleSaveSettings = async (newSettings: AppSettings) => {
    setIsSavingSettings(true);
    setSettings(newSettings);
    saveStoredSettings(newSettings);
    if (currentUser) {
      try {
        await persistUserSettingsToCloud(currentUser.uid, newSettings, currentUser);
      } catch (err) {
        console.error('Failed to sync updated settings to Firestore:', err);
      }
    }
    setIsSavingSettings(false);
    // Saving settings no longer triggers a fixture pull — a sync only runs
    // at the configured schedule time or via an explicit manual trigger.
  };

  const scanPlan = useMemo(() => describeScanPlan(settings), [settings]);

  // Triggered directly from the "Run Daily Scan" click. Never starts a
  // fetch by itself — it only opens the modal's confirmation step, showing
  // what this scan will actually download given the current settings.
  // Nothing is requested from any provider until the user explicitly clicks
  // "Start scan" inside that modal (handleConfirmStartScan below).
  const handleRunScan = () => {
    // Belt-and-braces alongside the header button's own disabled state — a
    // scan only ever reads saved settings, so an unsaved draft (from any
    // entry point, not just the header, e.g. the empty-state CTA) should
    // never silently kick one off against stale configuration.
    if (hasUnsavedSettingsChanges) {
      setActiveTab('settings');
      return;
    }
    if (isScanRunning) {
      // A background load (mount, login, settings save) is already
      // fetching — reveal its real progress and the Stop control instead
      // of asking to confirm a second, duplicate fetch.
      setIsScanModalOpen(true);
      setIsAwaitingScanConfirmation(false);
      return;
    }
    setIsScanModalOpen(true);
    setIsAwaitingScanConfirmation(true);
  };

  const handleCancelScanConfirmation = () => {
    setIsScanModalOpen(false);
    setIsAwaitingScanConfirmation(false);
  };

  // Only reachable after the user confirms the plan shown in the modal —
  // this is the sole place a manual scan's provider calls actually start
  // (never from a useEffect keyed on isScanModalOpen — React 18 StrictMode
  // double-invokes effects in development, which would fire the real
  // provider calls twice). Streams real progress into the modal as it
  // happens, rather than a fixed-length animation standing in for work that
  // (under provider rate limits) can take well over a minute.
  const handleConfirmStartScan = () => {
    setIsAwaitingScanConfirmation(false);
    const { signal, onProgress } = beginFeedFetch(true);

    executeBackgroundScan(settings, false, onProgress, signal)
      .then((result) => {
        setFixtures(result.refreshedFixtures);
        setHistoricalBets(result.updatedHistoricalBets);
        setSyncLogs(getStoredSyncLogs());
        setLastScanTimestamp(result.scanTimestamp);
        setProviderHealth({ ok: !result.fetchError, checkedAt: result.scanTimestamp });
        setFixturesError(result.fetchError || null);
        endFeedFetch('finished');
      })
      .catch((err) => {
        // A user-requested stop rejects every in-flight call with
        // AbortError — that's the one outcome we don't treat as a scan
        // failure, since nothing was actually wrong with the provider.
        if (err instanceof DOMException && err.name === 'AbortError') {
          endFeedFetch('cancelled');
          return;
        }
        setFixturesError(err instanceof Error ? err.message : String(err));
        endFeedFetch('finished');
      });
  };

  // Called only after the modal's own confirm step — actually cancels the
  // in-flight provider calls rather than just hiding the progress UI.
  const handleStopScan = () => {
    scanAbortControllerRef.current?.abort();
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

  if (authChecking) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand border-t-transparent shadow-xs" />
          <p className="font-mono text-xs text-text-3 font-medium">Initializing The Docket…</p>
        </div>
        <VersionBadge />
      </div>
    );
  }

  if (!currentUser && !isGuest) {
    return (
      <>
        <LoginScreen
          onSignInWithGoogle={handleSignInWithGoogle}
          onContinueAsGuest={handleContinueAsGuest}
          isLoading={authActionLoading}
          error={authError}
        />
        <VersionBadge />
      </>
    );
  }

  return (
    <>
      <AppShell
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        verifiedCount={verifiedQualifiers.length}
        priceWatchCount={priceWatchItems.length}
        analytics={analytics}
        settings={settings}
        isScanning={isScanModalOpen || fixturesLoading || isScanRunning}
        scanModalOpen={isScanModalOpen}
        scanRecordsSoFar={isScanRunning ? scanFootballRecords + scanTennisRecords : undefined}
        onRunScan={handleRunScan}
        onStopScan={handleStopScan}
        hasUnsavedSettingsChanges={hasUnsavedSettingsChanges}
        canStopScan={isScanRunning}
        lastScanTimestamp={lastScanTimestamp}
        onOpenSyncHistory={() => setIsSyncHistoryOpen(true)}
        onOpenSectionInfo={(section) => setInfoModalSection(section)}
        autoScanNotice={autoScanNotice}
        onDismissAutoScanNotice={() => setAutoScanNotice(null)}
        user={currentUser}
        onSignOut={currentUser || isGuest ? handleSignOut : undefined}
        isCloudConnected={Boolean(currentUser)}
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
            onRunScan={handleRunScan}
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
            user={currentUser}
            isSavingToCloud={isSavingSettings}
            fixtures={fixtures}
            fixturesLoading={fixturesLoading}
            fixturesError={fixturesError || undefined}
            onDraftDirtyChange={setHasUnsavedSettingsChanges}
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
        awaitingConfirmation={isAwaitingScanConfirmation}
        planLines={scanPlan.lines}
        hasAnyWork={scanPlan.hasAnyWork}
        isRunning={isScanRunning}
        isFinished={isScanFinished}
        isCancelled={isScanCancelled}
        events={scanEvents}
        footballRecords={scanFootballRecords}
        tennisRecords={scanTennisRecords}
        onClose={isAwaitingScanConfirmation ? handleCancelScanConfirmation : () => setIsScanModalOpen(false)}
        onStop={handleStopScan}
        onConfirmStart={handleConfirmStartScan}
      />

      <SyncHistoryModal
        isOpen={isSyncHistoryOpen}
        onClose={() => setIsSyncHistoryOpen(false)}
        syncLogs={syncLogs}
        settings={settings}
        onTriggerScan={() => {
          setIsSyncHistoryOpen(false);
          handleRunScan();
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
