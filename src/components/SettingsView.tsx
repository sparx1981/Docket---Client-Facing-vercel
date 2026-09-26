import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  HardDrive,
  RotateCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  Play,
  Sparkles,
  Database,
  Cloud,
  RefreshCw,
  X,
} from 'lucide-react';
import { AppSettings, BacktestRunRecord, BacktestSummary, CandidateFixture, FeedSummaryRecord, LeagueOption, RuleThresholds } from '../types';
import {
  Button,
  Chip,
  CollapsibleSection,
  Field,
  Switch,
  inputClass,
} from './ui';
import { formatTimeUntilNextRun } from '../services/scheduler';
import { FilterHoverPopup } from './FilterHoverPopup';
import { calculateSystemBreakdown } from '../services/filterBreakdown';
import {
  checkFeedHealth,
  describeLiveFeedPreviewPlan,
  FeedHealthResult,
  FeedProgressEvent,
  fetchLeagues,
  fetchLiveFeedSummary,
} from '../services/dataFeed';
import { runBacktest } from '../services/backtest';
import { deleteBacktestRun, getStoredBacktestRuns, logBacktestRun } from '../services/storage';
import { ScanProgressModal } from './ScanProgressModal';

/** A link to the real place a provider's own dashboard lets you create/view an API key or token. */
const ProviderKeyLink: React.FC<{ href: string; children: React.ReactNode }> = ({
  href,
  children,
}) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold text-brand-ink hover:underline"
  >
    {children}
    <ExternalLink className="h-3 w-3" strokeWidth={2.5} />
  </a>
);

interface SettingsViewProps {
  settings: AppSettings;
  onSaveSettings: (settings: AppSettings) => void;
  onTriggerAutoScanTest?: () => Promise<void>;
  isAutoScanTesting?: boolean;
  user?: { email?: string | null; displayName?: string | null; uid?: string } | null;
  isSavingToCloud?: boolean;
  fixtures?: CandidateFixture[];
  fixturesLoading?: boolean;
  fixturesError?: string;
  footballFeedInfo?: FeedSummaryRecord;
  tennisFeedInfo?: FeedSummaryRecord;
  /**
   * Reports whenever the local draft (formData) starts or stops differing
   * from the last-saved settings — the header's Run Daily Scan button lives
   * outside this component, but still needs to know, since it only ever
   * reads from saved settings and shouldn't run against a stale
   * configuration silently.
   */
  onDraftDirtyChange?: (dirty: boolean) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onTriggerAutoScanTest,
  isAutoScanTesting = false,
  user = null,
  isSavingToCloud = false,
  fixtures,
  fixturesLoading = false,
  fixturesError,
  footballFeedInfo,
  tennisFeedInfo,
  onDraftDirtyChange,
}) => {
  const [formData, setFormData] = useState<AppSettings>(settings);
  // What's actually live — the header's Run Daily Scan, the real scan/fetch
  // logic, and this backtest all read from the `settings` prop, not from
  // formData. Toggling a rule here edits only this local draft; comparing
  // against the last-saved snapshot lets the UI say so before that gap
  // confuses someone into thinking a toggle already took effect.
  const [lastSavedData, setLastSavedData] = useState<AppSettings>(settings);
  const hasUnsavedChanges = useMemo(
    () => JSON.stringify(formData) !== JSON.stringify(lastSavedData),
    [formData, lastSavedData]
  );

  useEffect(() => {
    onDraftDirtyChange?.(hasUnsavedChanges);
    // Once this view unmounts (e.g. the user leaves the Settings tab) the
    // draft goes with it, so from the header's perspective there's no
    // longer anything "unsaved" to warn about.
    return () => onDraftDirtyChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnsavedChanges]);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [feedHealth, setFeedHealth] = useState<FeedHealthResult[] | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [autoScanTriggered, setAutoScanTriggered] = useState(false);

  // League catalog (Filter Thresholds) — the persisted list of leagues each
  // rule's own League selector picks from. Fetched on demand via "Load
  // leagues" and stored on formData.leagueCatalog (part of AppSettings), so
  // it survives a reload/cross-device the same way every other saved
  // setting does, instead of resetting to empty every time this page mounts.
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);
  const [pendingLeagueCatalogUpdate, setPendingLeagueCatalogUpdate] = useState<{
    newCatalog: LeagueOption[];
    drops: { systemLabel: string; names: string[] }[];
  } | null>(null);
  // Keyed by idPrefix — a rule's own League picker and the Leagues section's
  // shortlist picker each need to open/close independently.
  const [openLeagueDropdown, setOpenLeagueDropdown] = useState<string | null>(null);
  // Search text per open dropdown, keyed the same way as openLeagueDropdown.
  const [leagueSearchTerms, setLeagueSearchTerms] = useState<Record<string, string>>({});

  // Backtest — one per football rule, since the league to backtest against
  // and the "Run backtest" trigger both live inside that rule's own card now.
  type BacktestSystem = 'football_over_1_5' | 'football_under_3_5';
  const [backtestLeagueBySystem, setBacktestLeagueBySystem] = useState<Record<BacktestSystem, string>>({
    football_over_1_5: '',
    football_under_3_5: '',
  });
  const [backtestRunningBySystem, setBacktestRunningBySystem] = useState<Record<BacktestSystem, boolean>>({
    football_over_1_5: false,
    football_under_3_5: false,
  });
  const [backtestResultBySystem, setBacktestResultBySystem] = useState<Record<BacktestSystem, BacktestSummary | null>>({
    football_over_1_5: null,
    football_under_3_5: null,
  });
  const [backtestErrorBySystem, setBacktestErrorBySystem] = useState<Record<BacktestSystem, string | null>>({
    football_over_1_5: null,
    football_under_3_5: null,
  });
  const [backtestProgressBySystem, setBacktestProgressBySystem] = useState<
    Record<BacktestSystem, { completed: number; total: number } | null>
  >({
    football_over_1_5: null,
    football_under_3_5: null,
  });
  // Saved backtest runs (persisted to localStorage + Firestore) — so a user
  // trying several rule configurations can come back and compare which
  // setup actually performed best, instead of each result vanishing the
  // moment they navigate away.
  const [backtestRuns, setBacktestRuns] = useState<BacktestRunRecord[]>(() => getStoredBacktestRuns());
  const [backtestHistorySortBySystem, setBacktestHistorySortBySystem] = useState<
    Record<BacktestSystem, 'recent' | 'roi'>
  >({
    football_over_1_5: 'recent',
    football_under_3_5: 'recent',
  });
  // Lets a running backtest actually be cancelled — one controller per rule
  // card, since either system's backtest can be running independently.
  const backtestAbortControllersRef = useRef<Record<BacktestSystem, AbortController | null>>({
    football_over_1_5: null,
    football_under_3_5: null,
  });

  // Live feed state for Filter Thresholds breakdown
  const [liveFixtures, setLiveFixtures] = useState<CandidateFixture[]>(fixtures || []);
  const [feedInfoOver15, setFeedInfoOver15] = useState<FeedSummaryRecord | undefined>(footballFeedInfo);
  const [feedInfoUnder35, setFeedInfoUnder35] = useState<FeedSummaryRecord | undefined>(footballFeedInfo);
  const [feedInfoTennis, setFeedInfoTennis] = useState<FeedSummaryRecord | undefined>(tennisFeedInfo);
  const [isRefreshingFeed, setIsRefreshingFeed] = useState(false);
  const [feedError, setFeedError] = useState<string | undefined>(fixturesError);

  // "Refresh live feed" makes the same kind of real, rate-limited provider
  // calls as the daily scan — it deserves the same confirm-first,
  // cancellable, real-progress treatment rather than firing immediately
  // with no way to see what it's doing or stop it.
  const [isFeedPreviewModalOpen, setIsFeedPreviewModalOpen] = useState(false);
  const [isAwaitingFeedPreviewConfirmation, setIsAwaitingFeedPreviewConfirmation] = useState(false);
  const [isFeedPreviewFinished, setIsFeedPreviewFinished] = useState(false);
  const [isFeedPreviewCancelled, setIsFeedPreviewCancelled] = useState(false);
  const [feedPreviewEvents, setFeedPreviewEvents] = useState<FeedProgressEvent[]>([]);
  const [feedPreviewFootballRecords, setFeedPreviewFootballRecords] = useState(0);
  const [feedPreviewTennisRecords, setFeedPreviewTennisRecords] = useState(0);
  const feedPreviewAbortControllerRef = useRef<AbortController | null>(null);
  const feedPreviewPlan = useMemo(() => describeLiveFeedPreviewPlan(formData), [formData]);

  useEffect(() => {
    if (fixtures && fixtures.length > 0) {
      setLiveFixtures(fixtures);
    }
  }, [fixtures]);

  useEffect(() => {
    if (tennisFeedInfo) setFeedInfoTennis(tennisFeedInfo);
  }, [tennisFeedInfo]);

  // Belt-and-braces alongside the UI lock below: disabling the controls
  // stops new "enabled with no league chosen" states from being created,
  // but doesn't retroactively flip an already-true toggle if leagues are
  // cleared back to empty afterwards (or arrived that way from an older
  // save). This keeps the saved data itself consistent with the rule the
  // lock exists to enforce — a rule can never be saved as enabled while
  // still scoped to "All leagues".
  useEffect(() => {
    setFormData((prev) => {
      const over15NeedsDisable = prev.ruleThresholds.footballOver15.selectedLeagueIds.length === 0 && prev.ruleThresholds.footballOver15.enabled;
      const under35NeedsDisable = prev.ruleThresholds.footballUnder35.selectedLeagueIds.length === 0 && prev.ruleThresholds.footballUnder35.enabled;
      if (!over15NeedsDisable && !under35NeedsDisable) return prev;
      return {
        ...prev,
        ruleThresholds: {
          ...prev.ruleThresholds,
          footballOver15: over15NeedsDisable ? { ...prev.ruleThresholds.footballOver15, enabled: false } : prev.ruleThresholds.footballOver15,
          footballUnder35: under35NeedsDisable ? { ...prev.ruleThresholds.footballUnder35, enabled: false } : prev.ruleThresholds.footballUnder35,
        },
      };
    });
  }, [formData.ruleThresholds.footballOver15.selectedLeagueIds, formData.ruleThresholds.footballUnder35.selectedLeagueIds]);

  const footballConfigured = !!formData.theStatsApiKey;
  // Tennis has no configured data supplier since the Sportradar/Sportmonks
  // migration — kept as a constant (rather than deleted) so the tennis
  // breakdown card below still renders its real "not configured" state.
  const tennisConfigured = false;

  // Opens the same confirm-first modal the daily scan uses — Refresh live
  // feed makes real, rate-limited provider calls for both football rules
  // (plus tennis if it ever gets a supplier), so it deserves the same
  // "what will this download" step and the same ability to cancel, rather
  // than firing immediately with no visible progress and no way to stop it.
  const handleOpenFeedPreviewConfirm = () => {
    if (isRefreshingFeed) {
      setIsFeedPreviewModalOpen(true);
      setIsAwaitingFeedPreviewConfirmation(false);
      return;
    }
    setIsFeedPreviewModalOpen(true);
    setIsAwaitingFeedPreviewConfirmation(true);
  };

  const handleCancelFeedPreviewConfirmation = () => {
    setIsFeedPreviewModalOpen(false);
    setIsAwaitingFeedPreviewConfirmation(false);
  };

  const handleConfirmStartFeedPreview = async () => {
    setIsAwaitingFeedPreviewConfirmation(false);
    setFeedPreviewEvents([]);
    setFeedPreviewFootballRecords(0);
    setFeedPreviewTennisRecords(0);
    setIsFeedPreviewFinished(false);
    setIsFeedPreviewCancelled(false);
    setIsRefreshingFeed(true);
    setFeedError(undefined);

    const controller = new AbortController();
    feedPreviewAbortControllerRef.current = controller;
    const onProgress = (evt: FeedProgressEvent) => {
      setFeedPreviewEvents((prev) => [...prev, evt]);
      if (evt.sport === 'football') setFeedPreviewFootballRecords(evt.recordsSoFar);
      else setFeedPreviewTennisRecords(evt.recordsSoFar);
    };

    try {
      const res = await fetchLiveFeedSummary(formData, onProgress, controller.signal);
      if (res.fixtures && res.fixtures.length > 0) {
        setLiveFixtures(res.fixtures);
      }
      if (res.footballOver15FeedInfo) setFeedInfoOver15(res.footballOver15FeedInfo);
      if (res.footballUnder35FeedInfo) setFeedInfoUnder35(res.footballUnder35FeedInfo);
      if (res.tennisFeedInfo) {
        setFeedInfoTennis(res.tennisFeedInfo);
      }
      if (res.error) {
        setFeedError(res.error);
      }
      // Deliberately does NOT also call onRefreshFixtures — this button's
      // whole job is refreshing Feed & Impact numbers below; it used to
      // silently trigger a second, separate real fetch of the main
      // qualifiers table too, which nothing in its confirmation or copy
      // ever mentioned.
      setIsFeedPreviewFinished(true);
    } catch (err) {
      // A user-requested stop isn't a real failure — leave feedError empty
      // rather than surfacing "AbortError" as if the provider had failed.
      if (err instanceof DOMException && err.name === 'AbortError') {
        setIsFeedPreviewCancelled(true);
      } else {
        setFeedError(err instanceof Error ? err.message : String(err));
        setIsFeedPreviewFinished(true);
      }
    } finally {
      feedPreviewAbortControllerRef.current = null;
      setIsRefreshingFeed(false);
    }
  };

  const handleStopFeedPreview = () => {
    feedPreviewAbortControllerRef.current?.abort();
  };

  // Abort an in-flight preview if this view unmounts, same as the backtest
  // controllers above.
  useEffect(() => {
    return () => {
      feedPreviewAbortControllerRef.current?.abort();
    };
  }, []);

  // Deliberately no auto-fetch on mount: a live provider call must only
  // happen at the configured schedule time or via an explicit manual
  // trigger (the refresh button below), never just from opening this page.

  const over15Breakdown = useMemo(
    () =>
      calculateSystemBreakdown({
        systemKey: 'footballOver15',
        thresholds: formData.ruleThresholds,
        fixtures: liveFixtures,
        feedInfo: feedInfoOver15,
        isConfigured: footballConfigured,
        isLoading: isRefreshingFeed || fixturesLoading,
        error: feedInfoOver15?.error || (footballConfigured ? undefined : 'TheStatsAPI key not configured'),
        leagueCatalog: formData.leagueCatalog,
      }),
    [formData.ruleThresholds, formData.leagueCatalog, liveFixtures, feedInfoOver15, footballConfigured, isRefreshingFeed, fixturesLoading]
  );

  const under35Breakdown = useMemo(
    () =>
      calculateSystemBreakdown({
        systemKey: 'footballUnder35',
        thresholds: formData.ruleThresholds,
        fixtures: liveFixtures,
        feedInfo: feedInfoUnder35,
        isConfigured: footballConfigured,
        isLoading: isRefreshingFeed || fixturesLoading,
        error: feedInfoUnder35?.error || (footballConfigured ? undefined : 'TheStatsAPI key not configured'),
        leagueCatalog: formData.leagueCatalog,
      }),
    [formData.ruleThresholds, formData.leagueCatalog, liveFixtures, feedInfoUnder35, footballConfigured, isRefreshingFeed, fixturesLoading]
  );

  const tennisBreakdown = useMemo(
    () =>
      calculateSystemBreakdown({
        systemKey: 'tennisStraightSets',
        thresholds: formData.ruleThresholds,
        fixtures: liveFixtures,
        feedInfo: feedInfoTennis,
        isConfigured: tennisConfigured,
        isLoading: isRefreshingFeed || fixturesLoading,
        error: feedInfoTennis?.error || 'Tennis has no configured data supplier yet',
      }),
    [formData.ruleThresholds, liveFixtures, feedInfoTennis, tennisConfigured, isRefreshingFeed, fixturesLoading]
  );

  const hasProviderKey = !!formData.theStatsApiKey;
  // An empty selection means "All leagues" — the expensive default this
  // safeguard exists to prevent. Each rule stays locked (its toggle,
  // thresholds and backtest all disabled) until the user has explicitly
  // narrowed it to at least one specific league.
  const over15Locked = formData.ruleThresholds.footballOver15.selectedLeagueIds.length === 0;
  const under35Locked = formData.ruleThresholds.footballUnder35.selectedLeagueIds.length === 0;
  // Checked against the SAVED settings (the `settings` prop), not the
  // in-progress form draft — merely ticking a league box shouldn't unlock
  // this section until the user has actually clicked "Save configuration",
  // otherwise navigating away without saving would leave it misleadingly open.
  // Gated on the Leagues shortlist rather than either rule's own selection —
  // saving a shortlist is now the one thing that unlocks this section; each
  // rule still separately requires its own league selection before it can
  // actually run (see over15Locked/under35Locked below).
  const filterThresholdsLocked = settings.leagueShortlistIds.length === 0;

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setFormData((prev) => ({ ...prev, [key]: value }));

  const setThreshold = <S extends keyof RuleThresholds, K extends keyof RuleThresholds[S]>(
    system: S,
    key: K,
    value: RuleThresholds[S][K]
  ) =>
    setFormData((prev) => ({
      ...prev,
      ruleThresholds: {
        ...prev.ruleThresholds,
        [system]: { ...prev.ruleThresholds[system], [key]: value },
      },
    }));

  // Percentages are stored as a 0-1 rate internally but edited as whole
  // numbers (e.g. 0.8 <-> "80").
  const percentInput = (rate: number) => Math.round(rate * 100);
  const percentToRate = (pct: number) => Math.min(1, Math.max(0, pct)) / 100;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveSettings(formData);
    setLastSavedData(formData);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleTestFeeds = async () => {
    setIsTesting(true);
    setTestResult(null);
    setFeedHealth(null);
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`Backend responded with ${res.status}`);

      if (!hasProviderKey) {
        setTestResult('Backend reachable, but no provider API key is configured yet — add one below to pull real fixtures.');
        return;
      }

      // One cheap call per configured feed (today only, no enrichment) —
      // real evidence of whether each provider is healthy or already
      // rate-limited, without paying for a full multi-minute scan just to
      // find out.
      const health = await checkFeedHealth(formData);
      setFeedHealth(health.filter((h) => h.status !== 'not_configured'));
    } catch (err) {
      setTestResult(`Could not reach the backend: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsTesting(false);
    }
  };

  /** Applies a freshly-fetched league catalog, pruning any rule selections (and the shortlist) that no longer resolve. */
  const applyLeagueCatalogUpdate = (newCatalog: LeagueOption[]) => {
    const freshIds = new Set(newCatalog.map((l) => l.id));
    setFormData((prev) => ({
      ...prev,
      leagueCatalog: newCatalog,
      leagueCatalogUpdatedAt: new Date().toISOString(),
      leagueShortlistIds: prev.leagueShortlistIds.filter((id) => freshIds.has(id)),
      ruleThresholds: {
        ...prev.ruleThresholds,
        footballOver15: {
          ...prev.ruleThresholds.footballOver15,
          selectedLeagueIds: prev.ruleThresholds.footballOver15.selectedLeagueIds.filter((id) => freshIds.has(id)),
        },
        footballUnder35: {
          ...prev.ruleThresholds.footballUnder35,
          selectedLeagueIds: prev.ruleThresholds.footballUnder35.selectedLeagueIds.filter((id) => freshIds.has(id)),
        },
      },
    }));
  };

  const handleLoadLeagues = async () => {
    setLeaguesLoading(true);
    setLeaguesError(null);
    setPendingLeagueCatalogUpdate(null);
    try {
      const fresh = await fetchLeagues(formData);
      if (fresh.length === 0) {
        setLeaguesError('No competitions returned — check the TheStatsAPI key above.');
        return;
      }
      const sorted = fresh.sort((a, b) => a.name.localeCompare(b.name));
      const freshIds = new Set(sorted.map((l) => l.id));

      const drops = [
        { key: 'footballOver15' as const, label: 'Football — Over 1.5 Goals' },
        { key: 'footballUnder35' as const, label: 'Football — Under 3.5 Goals' },
      ]
        .map(({ key, label }) => {
          const missingIds = formData.ruleThresholds[key].selectedLeagueIds.filter((id) => !freshIds.has(id));
          if (missingIds.length === 0) return null;
          const names = missingIds.map(
            (id) => formData.leagueCatalog.find((l) => l.id === id)?.name || id
          );
          return { systemLabel: label, names };
        })
        .filter((d): d is { systemLabel: string; names: string[] } => d !== null);

      const missingShortlistIds = formData.leagueShortlistIds.filter((id) => !freshIds.has(id));
      if (missingShortlistIds.length > 0) {
        drops.push({
          systemLabel: 'Leagues shortlist',
          names: missingShortlistIds.map((id) => formData.leagueCatalog.find((l) => l.id === id)?.name || id),
        });
      }

      if (drops.length > 0) {
        setPendingLeagueCatalogUpdate({ newCatalog: sorted, drops });
      } else {
        applyLeagueCatalogUpdate(sorted);
      }
    } catch (err) {
      setLeaguesError(err instanceof Error ? err.message : String(err));
    } finally {
      setLeaguesLoading(false);
    }
  };

  const confirmLeagueCatalogUpdate = () => {
    if (!pendingLeagueCatalogUpdate) return;
    applyLeagueCatalogUpdate(pendingLeagueCatalogUpdate.newCatalog);
    setPendingLeagueCatalogUpdate(null);
  };

  const cancelLeagueCatalogUpdate = () => setPendingLeagueCatalogUpdate(null);

  const toggleLeagueSelected = (system: 'footballOver15' | 'footballUnder35', id: string) => {
    setFormData((prev) => {
      const selected = new Set(prev.ruleThresholds[system].selectedLeagueIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return {
        ...prev,
        ruleThresholds: {
          ...prev.ruleThresholds,
          [system]: { ...prev.ruleThresholds[system], selectedLeagueIds: Array.from(selected) },
        },
      };
    });
  };

  // Toggles a league in the curated shortlist (Leagues section). Narrowing
  // the shortlist also prunes any rule's own selection down to what's still
  // in it — otherwise a rule could keep a league selected that its own
  // picker no longer even shows, silently pulling fixtures for something
  // the shortlist says is no longer in scope. An emptied-out shortlist
  // (nothing left in it at all) is treated as "not curated" rather than
  // "nothing allowed", so rule selections are left alone in that case —
  // consistent with leagueShortlistIds.length === 0 meaning no restriction.
  const toggleShortlistLeague = (id: string) => {
    setFormData((prev) => {
      const selected = new Set(prev.leagueShortlistIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      const nextShortlist = Array.from(selected);

      const prune = (ids: string[]) =>
        nextShortlist.length === 0 ? ids : ids.filter((leagueId) => nextShortlist.includes(leagueId));

      return {
        ...prev,
        leagueShortlistIds: nextShortlist,
        ruleThresholds: {
          ...prev.ruleThresholds,
          footballOver15: {
            ...prev.ruleThresholds.footballOver15,
            selectedLeagueIds: prune(prev.ruleThresholds.footballOver15.selectedLeagueIds),
          },
          footballUnder35: {
            ...prev.ruleThresholds.footballUnder35,
            selectedLeagueIds: prune(prev.ruleThresholds.footballUnder35.selectedLeagueIds),
          },
        },
      };
    });
  };

  const handleRunBacktest = async (system: BacktestSystem) => {
    const controller = new AbortController();
    backtestAbortControllersRef.current[system] = controller;
    setBacktestRunningBySystem((prev) => ({ ...prev, [system]: true }));
    setBacktestErrorBySystem((prev) => ({ ...prev, [system]: null }));
    setBacktestResultBySystem((prev) => ({ ...prev, [system]: null }));
    setBacktestProgressBySystem((prev) => ({ ...prev, [system]: null }));
    try {
      const ruleKey = system === 'football_over_1_5' ? 'footballOver15' : 'footballUnder35';
      const leagueIds = formData.ruleThresholds[ruleKey].selectedLeagueIds;
      const leagueLabel =
        leagueIds.length === 0
          ? 'All leagues'
          : leagueIds.map((id) => formData.leagueCatalog.find((l) => l.id === id)?.name || id).join(', ');
      const result = await runBacktest(
        formData,
        system,
        leagueIds,
        leagueLabel,
        200,
        controller.signal,
        (evt) => setBacktestProgressBySystem((prev) => ({ ...prev, [system]: evt }))
      );
      setBacktestResultBySystem((prev) => ({ ...prev, [system]: result }));
      const run: BacktestRunRecord = {
        id: `BT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        runAt: new Date().toISOString(),
        system,
        ruleSnapshot: formData.ruleThresholds[ruleKey],
        summary: result,
      };
      setBacktestRuns(logBacktestRun(run));
    } catch (err) {
      // A user-requested stop isn't a real failure — leave the error banner
      // empty rather than surfacing an "AbortError" as if the provider failed.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setBacktestErrorBySystem((prev) => ({ ...prev, [system]: err instanceof Error ? err.message : String(err) }));
      }
    } finally {
      backtestAbortControllersRef.current[system] = null;
      setBacktestRunningBySystem((prev) => ({ ...prev, [system]: false }));
      setBacktestProgressBySystem((prev) => ({ ...prev, [system]: null }));
    }
  };

  const handleStopBacktest = (system: BacktestSystem) => {
    backtestAbortControllersRef.current[system]?.abort();
  };

  // Abort any in-flight backtest if this view unmounts (e.g. the user
  // navigates away) rather than leaving it running with nothing left to
  // ever read its result.
  useEffect(() => {
    return () => {
      backtestAbortControllersRef.current.football_over_1_5?.abort();
      backtestAbortControllersRef.current.football_under_3_5?.abort();
    };
  }, []);

  const renderBacktestButton = (system: BacktestSystem, locked: boolean) => {
    const running = backtestRunningBySystem[system];
    if (running) {
      const progress = backtestProgressBySystem[system];
      const pct = progress && progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;
      return (
        <div className="inline-flex flex-col items-start gap-1.5">
          <div className="inline-flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-bold text-text">
              <Play className="h-3 w-3 animate-pulse text-brand" strokeWidth={2.5} />
              <span>
                Running backtest{progress ? ` — match ${progress.completed} of ${progress.total}` : '…'}
              </span>
            </span>
            <button
              type="button"
              id={`btn-stop-backtest-${system}`}
              onClick={() => handleStopBacktest(system)}
              title="Stop this backtest"
              className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-[11px] font-bold text-bad-ink transition-colors hover:bg-bad-soft"
            >
              <X className="h-3 w-3" strokeWidth={2.5} />
              <span>Stop</span>
            </button>
          </div>
          {progress && (
            <div className="h-1.5 w-48 overflow-hidden rounded-full bg-brand-line">
              <div
                className="h-full rounded-full bg-brand transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          id={`btn-run-backtest-${system}`}
          onClick={() => handleRunBacktest(system)}
          disabled={!formData.theStatsApiKey || locked || hasUnsavedChanges}
          title={hasUnsavedChanges ? 'Save configuration first — results from an unsaved draft could stop matching reality the moment you change your mind and save something else.' : undefined}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-bold text-text transition-colors hover:border-brand disabled:opacity-60"
        >
          <Play className="h-3 w-3" strokeWidth={2.5} />
          <span>Run backtest</span>
        </button>
        {hasUnsavedChanges && !locked && (
          <span className="text-[10px] font-semibold text-warn-ink">Save configuration to enable backtesting.</span>
        )}
      </div>
    );
  };

  const handleDeleteBacktestRun = (id: string) => {
    setBacktestRuns(deleteBacktestRun(id));
  };

  const renderBacktestHistory = (system: BacktestSystem) => {
    const runsForSystem = backtestRuns.filter((r) => r.system === system);
    if (runsForSystem.length === 0) return null;

    const sortMode = backtestHistorySortBySystem[system];
    const sorted = [...runsForSystem].sort((a, b) =>
      sortMode === 'roi'
        ? b.summary.roiPct - a.summary.roiPct
        : new Date(b.runAt).getTime() - new Date(a.runAt).getTime()
    );

    const ruleKey = system === 'football_over_1_5' ? 'footballOver15' : 'footballUnder35';
    const configLabel = (snapshot: BacktestRunRecord['ruleSnapshot']): string => {
      if (ruleKey === 'footballOver15') {
        const s = snapshot as RuleThresholds['footballOver15'];
        return `H2H≥${Math.round(s.minH2HOver15Rate * 100)}% · recent≥${s.minRecentScoredCount} · odds≥${s.minExchangeOdds.toFixed(2)}`;
      }
      const s = snapshot as RuleThresholds['footballUnder35'];
      return `H2H≥${Math.round(s.minH2HUnder35Rate * 100)}% · recent≥${s.minRecentUnder35Count} · odds≥${s.minExchangeOdds.toFixed(2)}`;
    };

    return (
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide text-text-3">
            Saved runs ({runsForSystem.length})
          </p>
          <div className="inline-flex items-center gap-1 text-[10px] font-semibold">
            <button
              type="button"
              onClick={() => setBacktestHistorySortBySystem((prev) => ({ ...prev, [system]: 'recent' }))}
              className={`rounded px-1.5 py-0.5 ${sortMode === 'recent' ? 'bg-brand text-white' : 'text-text-3 hover:bg-surface-2'}`}
            >
              Most recent
            </button>
            <button
              type="button"
              onClick={() => setBacktestHistorySortBySystem((prev) => ({ ...prev, [system]: 'roi' }))}
              className={`rounded px-1.5 py-0.5 ${sortMode === 'roi' ? 'bg-brand text-white' : 'text-text-3 hover:bg-surface-2'}`}
            >
              Best ROI
            </button>
          </div>
        </div>
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          {sorted.map((run) => (
            <div
              key={run.id}
              className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[11px]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-text">
                  <span>{new Date(run.runAt).toLocaleString()}</span>
                  <span className={run.summary.roiPct >= 0 ? 'font-bold text-ok-ink' : 'font-bold text-bad-ink'}>
                    ROI {run.summary.roiPct >= 0 ? '+' : ''}
                    {run.summary.roiPct}%
                  </span>
                  <span>Win rate {run.summary.winRatePct}%</span>
                  <span>
                    Net {run.summary.netUnitsAtRequiredOdds >= 0 ? '+' : ''}
                    {run.summary.netUnitsAtRequiredOdds}u
                  </span>
                  <span>{run.summary.sampleSize} qualified</span>
                </div>
                <p className="truncate text-[10px] text-text-3">
                  {run.summary.leagueLabel} · {configLabel(run.ruleSnapshot)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleDeleteBacktestRun(run.id)}
                title="Delete this saved run"
                className="shrink-0 rounded p-1 text-text-3 transition-colors hover:bg-bad-soft hover:text-bad-ink"
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderBacktestResult = (system: BacktestSystem) => {
    const result = backtestResultBySystem[system];
    const error = backtestErrorBySystem[system];
    if (!result && !error) return null;
    return (
      <div className="mt-4">
        {error && <p className="mb-2 text-[11px] font-medium text-bad-ink">{error}</p>}
        {result && (
          <div className="rounded-lg border border-line bg-surface-2 p-3 space-y-2">
            <p className="text-[12px] font-semibold text-text">
              {result.leagueLabel} · {result.candidateCount} finished matches found · {result.evaluatedCount} evaluated
              with full historical context · {result.sampleSize} would have qualified
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] font-mono text-text">
              <span>Wins: {result.wins}</span>
              <span>Losses: {result.losses}</span>
              <span>Win rate: {result.winRatePct}%</span>
              <span>Required odds: {result.requiredOdds.toFixed(2)}</span>
              <span>Net units: {result.netUnitsAtRequiredOdds >= 0 ? '+' : ''}{result.netUnitsAtRequiredOdds}</span>
              <span>ROI: {result.roiPct}%</span>
            </div>
            <p className="text-[10px] leading-relaxed text-text-2">{result.scopeNote}</p>
          </div>
        )}
      </div>
    );
  };

  const renderLeagueMultiSelect = (system: 'footballOver15' | 'footballUnder35', idPrefix: string) => {
    const selected = formData.ruleThresholds[system].selectedLeagueIds;
    const isOpen = openLeagueDropdown === idPrefix;
    const hasShortlist = formData.leagueShortlistIds.length > 0;
    // A curated shortlist (Leagues section, above) narrows what this rule
    // can even pick from; with none set yet, every rule falls back to the
    // full raw catalog so nothing that worked before this feature existed
    // silently stops working.
    const pool = hasShortlist
      ? formData.leagueCatalog.filter((l) => formData.leagueShortlistIds.includes(l.id))
      : formData.leagueCatalog;
    const searchTerm = leagueSearchTerms[idPrefix] || '';
    const filtered = searchTerm.trim()
      ? pool.filter(
          (l) =>
            l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (l.country || '').toLowerCase().includes(searchTerm.toLowerCase())
        )
      : pool;

    return (
      <div>
        <button
          type="button"
          id={`${idPrefix}-toggle`}
          onClick={() => setOpenLeagueDropdown(isOpen ? null : idPrefix)}
          className={`${inputClass} flex items-center justify-between text-left`}
        >
          <span>
            {selected.length === 0 ? 'All leagues' : `${selected.length} league${selected.length === 1 ? '' : 's'} selected`}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (
          <div className="mt-2 rounded-lg border border-line">
            {pool.length > 0 && (
              <div className="border-b border-line p-2">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setLeagueSearchTerms((prev) => ({ ...prev, [idPrefix]: e.target.value }))}
                  placeholder="Search leagues…"
                  className={`${inputClass} text-[11px]`}
                />
              </div>
            )}
            <div className="max-h-48 overflow-y-auto divide-y divide-line">
              {formData.leagueCatalog.length === 0 ? (
                <p className="p-3 text-[11px] text-text-2">No leagues loaded yet — use "Load leagues" below.</p>
              ) : !hasShortlist ? (
                <p className="p-3 text-[11px] text-text-2">
                  Showing the full raw catalog — curate a shortlist in the <strong className="text-text">Leagues</strong> section above to narrow this list.
                </p>
              ) : filtered.length === 0 ? (
                <p className="p-3 text-[11px] text-text-2">No leagues match "{searchTerm}".</p>
              ) : null}
              {filtered.map((league) => {
                const checked = selected.includes(league.id);
                return (
                  <label
                    key={league.id}
                    className="flex items-center justify-between gap-3 px-3 py-1.5 text-[11px] cursor-pointer hover:bg-surface-2"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleLeagueSelected(system, league.id)}
                        className="shrink-0"
                      />
                      <span className="truncate text-text">{league.name}</span>
                    </span>
                    {league.country && <span className="shrink-0 text-text-2">{league.country}</span>}
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLeagueShortlistPicker = () => {
    const idPrefix = 'league-shortlist';
    const selected = formData.leagueShortlistIds;
    const isOpen = openLeagueDropdown === idPrefix;
    const searchTerm = leagueSearchTerms[idPrefix] || '';
    const filtered = searchTerm.trim()
      ? formData.leagueCatalog.filter(
          (l) =>
            l.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (l.country || '').toLowerCase().includes(searchTerm.toLowerCase())
        )
      : formData.leagueCatalog;

    return (
      <div>
        <button
          type="button"
          id={`${idPrefix}-toggle`}
          onClick={() => setOpenLeagueDropdown(isOpen ? null : idPrefix)}
          className={`${inputClass} flex items-center justify-between text-left`}
        >
          <span>
            {selected.length === 0
              ? 'No shortlist — every rule sees the full raw catalog'
              : `${selected.length} league${selected.length === 1 ? '' : 's'} shortlisted`}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (
          <div className="mt-2 rounded-lg border border-line">
            {formData.leagueCatalog.length > 0 && (
              <div className="flex items-center gap-2 border-b border-line p-2">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setLeagueSearchTerms((prev) => ({ ...prev, [idPrefix]: e.target.value }))}
                  placeholder="Search leagues…"
                  className={`${inputClass} text-[11px]`}
                />
                {selected.length > 0 && (
                  <button
                    type="button"
                    id="btn-clear-league-shortlist"
                    onClick={() => setFormData((prev) => ({ ...prev, leagueShortlistIds: [] }))}
                    className="shrink-0 rounded-md border border-line px-2 py-1 text-[11px] font-semibold text-text-2 hover:border-brand hover:text-text"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
            <div className="max-h-64 overflow-y-auto divide-y divide-line">
              {formData.leagueCatalog.length === 0 ? (
                <p className="p-3 text-[11px] text-text-2">No leagues loaded yet — use "Load leagues" below.</p>
              ) : filtered.length === 0 ? (
                <p className="p-3 text-[11px] text-text-2">No leagues match "{searchTerm}".</p>
              ) : (
                filtered.map((league) => {
                  const checked = selected.includes(league.id);
                  return (
                    <label
                      key={league.id}
                      className="flex items-center justify-between gap-3 px-3 py-1.5 text-[11px] cursor-pointer hover:bg-surface-2"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleShortlistLeague(league.id)}
                          className="shrink-0"
                        />
                        <span className="truncate text-text">{league.name}</span>
                      </span>
                      {league.country && <span className="shrink-0 text-text-2">{league.country}</span>}
                    </label>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <form
      id="settings-view"
      onSubmit={handleSave}
      className="mx-auto max-w-3xl space-y-5"
    >
      {hasUnsavedChanges && (
        <div
          id="settings-unsaved-banner"
          className="sticky top-0 z-10 flex items-center gap-2 rounded-xl border border-warn-line bg-warn-soft px-4 py-2.5 text-[12px] font-bold text-warn-ink"
        >
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn animate-pulse" />
          You have unsaved changes — toggles and thresholds below won't take effect (including on the
          daily scan or a backtest) until you click Save configuration.
        </div>
      )}

      {/* ---- Cloud-Persisted Engine & Synced Betting Data (Firebase Firestore) ---- */}
      <CollapsibleSection
        id="section-cloud-storage"
        buttonId="btn-toggle-cloud-storage"
        title="Cloud-Persisted Engine & Synced Betting Data (Firebase Firestore)"
        icon={<Database className="h-4 w-4" strokeWidth={2.5} />}
        defaultOpen={false}
        className="border-brand-line/60"
        action={
          user?.email ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-brand-line bg-surface px-2 py-0.5 font-mono text-[11px] font-semibold text-brand-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-ok" />
              Linked
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[11px] text-text-3">
              Cloud Storage
            </span>
          )
        }
      >
        <div className="space-y-3 px-4 py-4 bg-brand-soft/20">
          <p className="text-[12px] leading-relaxed text-text-2">
            All data within <strong className="text-text">Engine Configuration</strong> (your TheStatsAPI
            key, custom rule thresholds, scan schedule, and staking parameters), all{' '}
            <strong className="text-text">synced application data</strong> (the complete Archive log of
            verified qualifiers, settled match outcomes, P&amp;L history, and sync audit logs), and every{' '}
            <strong className="text-text">saved backtest run</strong> (each rule configuration you tested
            and its result) are associated with your authenticated Google account and securely stored in
            our remote <strong className="text-text">Firebase Firestore cloud database</strong> —{' '}
            <strong className="text-text">provided you are signed in with Google.</strong> Browsing in Guest
            Mode (no Google sign-in) skips Firestore entirely: everything above still saves, but only to
            this browser's local storage, on this one device.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-[11.5px] leading-relaxed">
            <div className="rounded-lg border border-line bg-surface p-2.5">
              <p className="font-bold text-text">What carries over between devices:</p>
              <p className="mt-0.5 text-text-2">
                Opening the app on any phone, tablet, laptop, or new browser and signing in with your
                Google account automatically restores your saved API keys, custom rule thresholds, entire
                Archive ledger, and every saved backtest run. Everything is synced to your account across
                all devices. Guest Mode does not sync anywhere — it's this one browser only, until you sign in.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-surface p-2.5">
              <p className="font-bold text-text">Browser storage vs Firestore cloud database:</p>
              <p className="mt-0.5 text-text-2">
                If you're signed in with Google, clearing your browser cache or site data, using a private
                window, or reinstalling the browser will <strong className="text-text">NOT</strong> delete
                your configuration, Archive log, or backtest history — they remain safely preserved in the
                remote Firebase database; sign back in with the same Google account anywhere to restore
                them. In Guest Mode, the same data lives only in this browser's local storage, so clearing
                site data or switching devices <strong className="text-text">WILL</strong> erase it — sign
                in with Google to move it to the cloud instead. Either way, what's{' '}
                <strong className="text-text">never</strong> stored anywhere is the live, in-memory Verified
                Qualifiers / Price Watch fixtures from your last scan — those refresh from a new scan and
                are described further via each tab's own storage badge. You can also use the Archive log's{' '}
                <strong className="text-text">Export CSV</strong> button periodically if you want an
                independent offline file backup.
              </p>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* ---- Schedule & staking ---- */}
      <CollapsibleSection
        title="Schedule"
        icon={<Clock className="h-4 w-4" strokeWidth={2.5} />}
        defaultOpen={false}
      >
        <div className="space-y-4 px-4 py-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field
              label="Daily scan time (UTC)"
              htmlFor="scan-time"
              hint="Runs ingestion and verification automatically."
            >
              <input
                id="scan-time"
                type="text"
                inputMode="numeric"
                value={formData.dailyScanScheduleUtc}
                onChange={(e) => set('dailyScanScheduleUtc', e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </Field>

            <Field label="Default stake" htmlFor="default-stake">
              <input
                id="default-stake"
                type="number"
                min={0}
                step="0.01"
                value={formData.defaultStake}
                onChange={(e) =>
                  set('defaultStake', Number(e.target.value) || 0)
                }
                className={`${inputClass} font-mono`}
              />
            </Field>

            <Field label="Currency symbol" htmlFor="currency">
              <input
                id="currency"
                type="text"
                maxLength={3}
                value={formData.currencySymbol}
                onChange={(e) => set('currencySymbol', e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </Field>
          </div>

          <div className="space-y-4 border-t border-line pt-4">
            <Field
              label="Notification email"
              htmlFor="notify-email"
              hint="Where new verified qualifiers are sent."
            >
              <input
                id="notify-email"
                type="email"
                value={formData.notificationEmail}
                onChange={(e) => set('notificationEmail', e.target.value)}
                className={inputClass}
              />
            </Field>

            <Switch
              id="notify-enabled"
              checked={formData.emailNotificationsEnabled}
              onChange={(v) => set('emailNotificationsEnabled', v)}
              label="Alert on new verified qualifiers"
              hint="Sends as soon as a selection clears the audit."
            />

            <Switch
              id="schedule-enabled"
              checked={formData.scheduleEnabled}
              onChange={(v) => set('scheduleEnabled', v)}
              label="Run the daily scan automatically"
              hint="Executes the full audit in the background at the specified UTC time every day."
            />

            <Switch
              id="auto-archive-qualifiers"
              checked={formData.autoArchiveQualifiers !== false}
              onChange={(v) => set('autoArchiveQualifiers', v)}
              label="Automatically file verified qualifiers to Archive"
              hint="When a scheduled scan completes, qualified fixtures are automatically recorded into the Archive ledger without requiring manual button clicks."
            />

            <Switch
              id="auto-settle-completed"
              checked={formData.autoSettleCompleted !== false}
              onChange={(v) => set('autoSettleCompleted', v)}
              label="Automatically settle completed match results"
              hint="When match times elapse, scores are confirmed against the official feed and outcomes are auto-settled into the P&L curve."
            />

            {/* Live Scheduler Engine Status Card */}
            <div className="rounded-xl border border-line bg-surface-2/80 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-ok"></span>
                  </span>
                  <span className="text-[12px] font-extrabold text-text">
                    Auto-Scheduler Engine Status
                  </span>
                </div>
                <span className="font-mono text-[11px] font-bold text-ok-ink">
                  {formData.scheduleEnabled ? 'ACTIVE & MONITORING' : 'PAUSED'}
                </span>
              </div>
              <p className="text-[11px] text-text-2">
                Checks every 30 seconds. Next scheduled execution runs{' '}
                <strong>{formatTimeUntilNextRun(formData.dailyScanScheduleUtc)}</strong> at{' '}
                <span className="font-mono">{formData.dailyScanScheduleUtc} UTC</span>.
              </p>
              {onTriggerAutoScanTest && (
                <div className="pt-1 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={isAutoScanTesting}
                    onClick={async () => {
                      await onTriggerAutoScanTest();
                      setAutoScanTriggered(true);
                      setTimeout(() => setAutoScanTriggered(false), 3000);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-brand/30 bg-surface px-2.5 py-1 text-[11px] font-bold text-brand-ink transition-colors hover:border-brand hover:bg-brand-soft cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Play className={`h-3 w-3 ${isAutoScanTesting ? 'animate-pulse' : ''}`} />
                    <span>{isAutoScanTesting ? 'Running…' : 'Trigger Background Auto-Scan Now (Test)'}</span>
                  </button>
                  {autoScanTriggered && !isAutoScanTesting && (
                    <span className="text-[11px] font-bold text-ok-ink flex items-center gap-1 animate-pulse">
                      <Check className="h-3 w-3" /> Auto-scan completed &amp; archived!
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* ---- TheStatsAPI — the live football data provider ---- */}
      <CollapsibleSection
        title="API Config"
        icon={<ShieldCheck className="h-4 w-4" strokeWidth={2.5} />}
        defaultOpen={false}
        action={<Chip tone={hasProviderKey ? 'ok' : 'warn'}>{hasProviderKey ? 'Configured' : 'Not configured'}</Chip>}
      >
        <div className="space-y-4 px-4 py-4">
          <p className="text-[11px] leading-relaxed text-text-2">
            TheStatsAPI.com is this app's football data provider — fixtures, results, team
            stats, competitions, odds and head-to-head records all come from it. The key you paste here
            is sent to our own backend per request (never straight to TheStatsAPI from the
            browser), which forwards it server-to-server as a Bearer token. Sportradar and
            Sportmonks were retired from this app over cost and are no longer called anywhere.
            Tennis has no configured data supplier yet — it is planned to move to its own new
            provider in a later phase.
          </p>

          {/* ---- Current state ---- */}
          <div
            className={`rounded-xl border px-4 py-4 ${
              hasProviderKey
                ? 'border-ok-line bg-ok-soft'
                : 'border-warn-line bg-warn-soft'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span
                  className={`mt-0.5 shrink-0 ${
                    hasProviderKey ? 'text-ok-ink' : 'text-warn-ink'
                  }`}
                >
                  {hasProviderKey ? (
                    <ShieldCheck className="h-5 w-5" strokeWidth={2.5} />
                  ) : (
                    <AlertTriangle className="h-5 w-5" strokeWidth={2.5} />
                  )}
                </span>
                <div className="min-w-0">
                  <h2
                    className={`text-[13px] font-extrabold ${
                      hasProviderKey ? 'text-ok-ink' : 'text-warn-ink'
                    }`}
                  >
                    {hasProviderKey ? 'Provider key configured' : 'No provider configured'}
                  </h2>
                  <p className="mt-0.5 text-[12px] leading-snug text-text-2">
                    {hasProviderKey
                      ? 'Fixtures, results, team stats and market odds are pulled live from TheStatsAPI via our backend.'
                      : 'Add a TheStatsAPI key below to pull real fixtures. Until then the docket and archive stay empty.'}
                  </p>
                </div>
              </div>

              <Button
                type="button"
                onClick={handleTestFeeds}
                disabled={isTesting}
                icon={
                  <RotateCw
                    className={`h-4 w-4 ${isTesting ? 'animate-spin' : ''}`}
                    strokeWidth={2.5}
                  />
                }
              >
                {isTesting ? 'Testing…' : 'Test feeds'}
              </Button>
            </div>

            {testResult && (
              <p className="mt-3 flex items-start gap-2 border-t border-line pt-2.5 font-mono text-[11px] leading-relaxed text-text-2">
                <Check className="mt-px h-3.5 w-3.5 shrink-0 text-ok-ink" strokeWidth={3} />
                {testResult}
              </p>
            )}

            {feedHealth && feedHealth.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-line pt-2.5">
                <p className="text-[11px] font-semibold text-text-2">
                  One real call per feed, today's date only — the same real error a full scan would hit, without waiting for one.
                </p>
                {feedHealth.map((h, i) => (
                  <div
                    key={`${h.sport}-${h.provider}-${h.leagueLabel || i}`}
                    className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${
                      h.status === 'ok'
                        ? 'border-ok-line bg-ok-soft text-ok-ink'
                        : h.status === 'rate_limited' || h.status === 'leagues_not_selected'
                        ? 'border-warn-line bg-warn-soft text-warn-ink'
                        : 'border-bad-line bg-bad-soft text-bad-ink'
                    }`}
                  >
                    {h.status === 'ok' ? (
                      <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                    ) : h.status === 'rate_limited' || h.status === 'leagues_not_selected' ? (
                      <Clock className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                    ) : (
                      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className="font-bold uppercase tracking-wide">
                        {h.sport === 'football' ? 'Football' : 'Tennis'} — {h.provider}
                        {h.leagueLabel ? ` — ${h.leagueLabel}` : ''}
                      </span>
                      <span className="ml-1.5">
                        {h.status === 'ok'
                          ? `OK — ${h.recordCount} fixture(s) for today`
                          : h.status === 'rate_limited'
                          ? `Rate-limited / quota exhausted — ${h.message}`
                          : h.status === 'leagues_not_selected'
                          ? h.message
                          : `Error — ${h.message}`}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 border-t border-line pt-4">
            <Field
              label="TheStatsAPI key"
              htmlFor="key-thestatsapi"
              hint="Sent as an Authorization: Bearer header. Used for football competitions, fixtures, results, team stats and head-to-head."
              action={
                <ProviderKeyLink href="https://www.thestatsapi.com/">
                  Get a key
                </ProviderKeyLink>
              }
            >
              <input
                id="key-thestatsapi"
                type="text"
                autoComplete="off"
                placeholder="tsa_…"
                value={formData.theStatsApiKey}
                onChange={(e) => set('theStatsApiKey', e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </Field>
          </div>
        </div>
      </CollapsibleSection>

      {/* ---- Leagues ---- */}
      <CollapsibleSection
        title="Leagues"
        icon={<Database className="h-4 w-4" strokeWidth={2.5} />}
        defaultOpen={false}
      >
        <div className="px-4 py-4">
          <div className="mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[11px] leading-relaxed text-text-2">
                The full raw catalog TheStatsAPI returns. This list is saved with the rest of your
                configuration, so it survives a reload and stays the same across devices — it won't
                reset just because the page refreshed.
                {formData.leagueCatalogUpdatedAt && (
                  <>
                    {' '}
                    Last loaded {new Date(formData.leagueCatalogUpdatedAt).toLocaleString([], {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                    {' '}· {formData.leagueCatalog.length} competitions.
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              id="btn-load-leagues"
              onClick={handleLoadLeagues}
              disabled={leaguesLoading || !formData.theStatsApiKey}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-line bg-surface text-text hover:border-brand transition-colors shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${leaguesLoading ? 'animate-spin text-brand' : ''}`} />
              <span>{leaguesLoading ? 'Loading leagues…' : 'Load leagues'}</span>
            </button>
          </div>

          {leaguesError && <p className="mb-3 text-[11px] font-medium text-bad-ink">{leaguesError}</p>}

          {pendingLeagueCatalogUpdate && (
            <div className="rounded-lg border border-warn-line bg-warn-soft p-3 space-y-2">
              <p className="text-[12px] font-semibold text-warn-ink">
                The refreshed league list drops {pendingLeagueCatalogUpdate.drops.reduce((n, d) => n + d.names.length, 0)}{' '}
                league(s) currently selected in a rule or in the shortlist below:
              </p>
              <ul className="text-[11px] text-warn-ink space-y-0.5">
                {pendingLeagueCatalogUpdate.drops.map((d) => (
                  <li key={d.systemLabel}>
                    <strong>{d.systemLabel}:</strong> {d.names.join(', ')}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-warn-ink">
                Applying the update removes those from the affected rule's selection (it falls back
                toward "All" for whatever's left) and from the shortlist. Keeping the current list
                leaves everything as-is.
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  id="btn-confirm-league-update"
                  onClick={confirmLeagueCatalogUpdate}
                  className="inline-flex items-center gap-1.5 rounded-md bg-bad px-2.5 py-1 text-[11px] font-bold text-on-bad hover:bg-bad-hover"
                >
                  Apply update, drop those leagues
                </button>
                <button
                  type="button"
                  id="btn-cancel-league-update"
                  onClick={cancelLeagueCatalogUpdate}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1 text-[11px] font-bold text-text hover:border-brand"
                >
                  Keep current list
                </button>
              </div>
            </div>
          )}

          <div className="mt-4 border-t border-line pt-4 space-y-3">
            <p className="text-[11px] leading-relaxed text-text-2">
              Narrow the raw catalog above down to a shortlist — search and multi-select the leagues
              you actually care about. Once you save a non-empty shortlist, every League field below
              (including each rule's own, inside Filter Thresholds) only offers leagues from it
              instead of the entire raw catalog — and saving one here is what unlocks Filter
              Thresholds below.
            </p>
            <Field
              label="Leagues shortlist"
              htmlFor="league-shortlist-toggle"
              hint="Narrows what every League field below can pick from, and unlocks Filter Thresholds once saved."
            >
              {renderLeagueShortlistPicker()}
            </Field>
          </div>
        </div>
      </CollapsibleSection>

      {/* ---- Filter Thresholds ---- */}
      <CollapsibleSection
        title="Filter Thresholds"
        icon={<SlidersHorizontal className="h-4 w-4" strokeWidth={2.5} />}
        defaultOpen={false}
        locked={filterThresholdsLocked}
        lockedMessage={
          <>
            Locked until a <strong className="text-text">Leagues shortlist</strong> is chosen and saved in the{' '}
            <strong className="text-text">Leagues</strong> section above — a rule's League field defaults to "All leagues", and
            letting this section open before you've made a real choice risks configuring (and running) a rule against every
            competition TheStatsAPI covers. Pick a shortlist above, then click <strong className="text-text">Save configuration</strong>{' '}
            to unlock this section.
          </>
        }
      >
        <div className="space-y-5 px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-surface-2 border border-line">
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-text">
                Live Data Feed Impact & Filter Reductions
              </p>
              <p className="text-[11px] leading-relaxed text-text-2">
                Hover over any rule header or threshold label below to inspect total records received from the live feed and the breakdown of matches eliminated by each filter. Only live data from configured APIs is displayed — no placeholder data. Only fetches a rule's data if that rule is Enabled above.
              </p>
            </div>
            <button
              type="button"
              onClick={handleOpenFeedPreviewConfirm}
              disabled={isFeedPreviewModalOpen}
              title={isRefreshingFeed && !isFeedPreviewModalOpen ? 'A refresh is already running — click to view progress' : undefined}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-line bg-surface text-text hover:border-brand transition-colors shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingFeed ? 'animate-spin text-brand' : ''}`} />
              <span>{isRefreshingFeed ? 'Refreshing…' : 'Refresh Feed & Impact Numbers'}</span>
            </button>
          </div>

          {feedError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-300">
              <span className="font-semibold">Provider feed notice: </span>
              {feedError}
            </div>
          )}

          {/* System A: Over 1.5 Goals */}
          <div className="border-t border-line pt-4">
            <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">
                  Football — Over 1.5 Goals
                </h3>
                <FilterHoverPopup
                  breakdown={over15Breakdown}
                  onRefreshFeed={handleOpenFeedPreviewConfirm}
                  isRefreshing={isRefreshingFeed}
                />
              </div>
              <div className="flex items-center gap-3">
                {renderBacktestButton('football_over_1_5', over15Locked)}
                <Switch
                  id="thresh-over15-enabled"
                  checked={formData.ruleThresholds.footballOver15.enabled}
                  onChange={(v) => setThreshold('footballOver15', 'enabled', v)}
                  label="Enabled"
                  disabled={over15Locked}
                />
              </div>
            </div>
            {over15Locked && (
              <div className="mb-3 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-[11px] font-semibold text-warn-ink">
                Select at least one league below before this rule can be enabled or configured — leaving it on
                "All leagues" risks pulling far more records than needed on every scan.
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="League" htmlFor="over15-league-toggle" hint="Leagues this rule's fixture pulls, verified qualifiers, Price Watch, and backtest all scope to.">
                {renderLeagueMultiSelect('footballOver15', 'over15-league')}
              </Field>
              <fieldset disabled={over15Locked} className="contents">
              <Field
                label="Min. previous-season avg goals scored"
                htmlFor="over15-avg-scored"
                hint="Both teams must meet this, independently."
                action={
                  <FilterHoverPopup
                    breakdown={over15Breakdown}
                    activeFilterId="F1_PREV_SEASON_SCORED"
                    size="sm"
                  />
                }
              >
                <input
                  id="over15-avg-scored"
                  type="number"
                  min={0}
                  step="0.01"
                  value={formData.ruleThresholds.footballOver15.minPrevSeasonAvgScored}
                  onChange={(e) => setThreshold('footballOver15', 'minPrevSeasonAvgScored', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Min. H2H Over 1.5 rate (last 5, %)"
                htmlFor="over15-h2h-rate"
                action={
                  <FilterHoverPopup
                    breakdown={over15Breakdown}
                    activeFilterId="F2_H2H_OVER15"
                    size="sm"
                  />
                }
              >
                <input
                  id="over15-h2h-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={percentInput(formData.ruleThresholds.footballOver15.minH2HOver15Rate)}
                  onChange={(e) => setThreshold('footballOver15', 'minH2HOver15Rate', percentToRate(Number(e.target.value) || 0))}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Min. recent scoring count (of last 5)"
                htmlFor="over15-recent-count"
                action={
                  <FilterHoverPopup
                    breakdown={over15Breakdown}
                    activeFilterId="F3_RECENT_FORM_SCORED"
                    size="sm"
                  />
                }
              >
                <input
                  id="over15-recent-count"
                  type="number"
                  min={0}
                  max={5}
                  step="1"
                  value={formData.ruleThresholds.footballOver15.minRecentScoredCount}
                  onChange={(e) => setThreshold('footballOver15', 'minRecentScoredCount', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Min. exchange odds"
                htmlFor="over15-odds"
                action={
                  <FilterHoverPopup
                    breakdown={over15Breakdown}
                    activeFilterId="F4_EXCHANGE_PRICE"
                    size="sm"
                  />
                }
              >
                <input
                  id="over15-odds"
                  type="number"
                  min={1}
                  step="0.01"
                  value={formData.ruleThresholds.footballOver15.minExchangeOdds}
                  onChange={(e) => setThreshold('footballOver15', 'minExchangeOdds', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Enhanced verification odds threshold"
                htmlFor="over15-enhanced-odds"
                hint="Odds above this trigger the extra audit note."
                action={
                  <FilterHoverPopup
                    breakdown={over15Breakdown}
                    label="Audit threshold"
                    size="sm"
                  />
                }
              >
                <input
                  id="over15-enhanced-odds"
                  type="number"
                  min={1}
                  step="0.01"
                  value={formData.ruleThresholds.footballOver15.enhancedOddsThreshold}
                  onChange={(e) => setThreshold('footballOver15', 'enhancedOddsThreshold', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              </fieldset>
            </div>
            {renderBacktestResult('football_over_1_5')}
            {renderBacktestHistory('football_over_1_5')}
          </div>

          {/* System B: Under 3.5 Goals */}
          <div className="border-t border-line pt-4">
            <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">
                  Football — Under 3.5 Goals
                </h3>
                <FilterHoverPopup
                  breakdown={under35Breakdown}
                  onRefreshFeed={handleOpenFeedPreviewConfirm}
                  isRefreshing={isRefreshingFeed}
                />
              </div>
              <div className="flex items-center gap-3">
                {renderBacktestButton('football_under_3_5', under35Locked)}
                <Switch
                  id="thresh-under35-enabled"
                  checked={formData.ruleThresholds.footballUnder35.enabled}
                  onChange={(v) => setThreshold('footballUnder35', 'enabled', v)}
                  label="Enabled"
                  disabled={under35Locked}
                />
              </div>
            </div>
            {under35Locked && (
              <div className="mb-3 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-[11px] font-semibold text-warn-ink">
                Select at least one league below before this rule can be enabled or configured — leaving it on
                "All leagues" risks pulling far more records than needed on every scan.
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="League" htmlFor="under35-league-toggle" hint="Leagues this rule's fixture pulls, verified qualifiers, Price Watch, and backtest all scope to.">
                {renderLeagueMultiSelect('footballUnder35', 'under35-league')}
              </Field>
              <fieldset disabled={under35Locked} className="contents">
              <Field
                label="Max. previous-season avg goals scored"
                htmlFor="under35-avg-scored"
                action={
                  <FilterHoverPopup
                    breakdown={under35Breakdown}
                    activeFilterId="F1_PREV_SEASON_SCORED_U35"
                    size="sm"
                  />
                }
              >
                <input
                  id="under35-avg-scored"
                  type="number"
                  min={0}
                  step="0.01"
                  value={formData.ruleThresholds.footballUnder35.maxPrevSeasonAvgScored}
                  onChange={(e) => setThreshold('footballUnder35', 'maxPrevSeasonAvgScored', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Max. previous-season avg goals conceded"
                htmlFor="under35-avg-conceded"
                action={
                  <FilterHoverPopup
                    breakdown={under35Breakdown}
                    activeFilterId="F2_PREV_SEASON_CONCEDED_U35"
                    size="sm"
                  />
                }
              >
                <input
                  id="under35-avg-conceded"
                  type="number"
                  min={0}
                  step="0.01"
                  value={formData.ruleThresholds.footballUnder35.maxPrevSeasonAvgConceded}
                  onChange={(e) => setThreshold('footballUnder35', 'maxPrevSeasonAvgConceded', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Min. H2H Under 3.5 rate (last 10, %)"
                htmlFor="under35-h2h-rate"
                action={
                  <FilterHoverPopup
                    breakdown={under35Breakdown}
                    activeFilterId="F3_H2H_UNDER35"
                    size="sm"
                  />
                }
              >
                <input
                  id="under35-h2h-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={percentInput(formData.ruleThresholds.footballUnder35.minH2HUnder35Rate)}
                  onChange={(e) => setThreshold('footballUnder35', 'minH2HUnder35Rate', percentToRate(Number(e.target.value) || 0))}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Min. recent Under 3.5 count (of last 5)"
                htmlFor="under35-recent-count"
                action={
                  <FilterHoverPopup
                    breakdown={under35Breakdown}
                    activeFilterId="F4_RECENT_FORM_UNDER35"
                    size="sm"
                  />
                }
              >
                <input
                  id="under35-recent-count"
                  type="number"
                  min={0}
                  max={5}
                  step="1"
                  value={formData.ruleThresholds.footballUnder35.minRecentUnder35Count}
                  onChange={(e) => setThreshold('footballUnder35', 'minRecentUnder35Count', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Min. exchange odds"
                htmlFor="under35-odds"
                action={
                  <FilterHoverPopup
                    breakdown={under35Breakdown}
                    activeFilterId="F5_EXCHANGE_PRICE_U35"
                    size="sm"
                  />
                }
              >
                <input
                  id="under35-odds"
                  type="number"
                  min={1}
                  step="0.01"
                  value={formData.ruleThresholds.footballUnder35.minExchangeOdds}
                  onChange={(e) => setThreshold('footballUnder35', 'minExchangeOdds', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              </fieldset>
            </div>
            {renderBacktestResult('football_under_3_5')}
            {renderBacktestHistory('football_under_3_5')}
          </div>

          {/* System C: Tennis Straight Sets */}
          <div className="border-t border-line pt-4">
            <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">
                  Tennis — Straight Sets
                </h3>
                <FilterHoverPopup
                  breakdown={tennisBreakdown}
                  onRefreshFeed={handleOpenFeedPreviewConfirm}
                  isRefreshing={isRefreshingFeed}
                />
              </div>
              <Switch
                id="thresh-tennis-enabled"
                checked={formData.ruleThresholds.tennisStraightSets.enabled}
                onChange={(v) => setThreshold('tennisStraightSets', 'enabled', v)}
                label="Enabled"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                label="Min. ranking delta (places)"
                htmlFor="tennis-rank-delta"
                action={
                  <FilterHoverPopup
                    breakdown={tennisBreakdown}
                    activeFilterId="T1_RANKING_DELTA"
                    size="sm"
                  />
                }
              >
                <input
                  id="tennis-rank-delta"
                  type="number"
                  min={0}
                  step="1"
                  value={formData.ruleThresholds.tennisStraightSets.minRankingDelta}
                  onChange={(e) => setThreshold('tennisStraightSets', 'minRankingDelta', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Min. career surface win rate (%)"
                htmlFor="tennis-surface-rate"
                action={
                  <FilterHoverPopup
                    breakdown={tennisBreakdown}
                    activeFilterId="T2_SURFACE_WIN_RATE"
                    size="sm"
                  />
                }
              >
                <input
                  id="tennis-surface-rate"
                  type="number"
                  min={0}
                  max={100}
                  step="0.1"
                  value={formData.ruleThresholds.tennisStraightSets.minSurfaceWinRate}
                  onChange={(e) => setThreshold('tennisStraightSets', 'minSurfaceWinRate', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Min. recent wins (of last 10)"
                htmlFor="tennis-recent-wins"
                action={
                  <FilterHoverPopup
                    breakdown={tennisBreakdown}
                    activeFilterId="T3_RECENT_SINGLES_FORM"
                    size="sm"
                  />
                }
              >
                <input
                  id="tennis-recent-wins"
                  type="number"
                  min={0}
                  max={10}
                  step="1"
                  value={formData.ruleThresholds.tennisStraightSets.minRecentWinsCount}
                  onChange={(e) => setThreshold('tennisStraightSets', 'minRecentWinsCount', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Min. exchange odds"
                htmlFor="tennis-odds"
                action={
                  <FilterHoverPopup
                    breakdown={tennisBreakdown}
                    activeFilterId="T4_EXCHANGE_PRICE_TENNIS"
                    size="sm"
                  />
                }
              >
                <input
                  id="tennis-odds"
                  type="number"
                  min={1}
                  step="0.01"
                  value={formData.ruleThresholds.tennisStraightSets.minExchangeOdds}
                  onChange={(e) => setThreshold('tennisStraightSets', 'minExchangeOdds', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
              <Field
                label="Enhanced verification odds threshold"
                htmlFor="tennis-enhanced-odds"
                action={
                  <FilterHoverPopup
                    breakdown={tennisBreakdown}
                    label="Audit threshold"
                    size="sm"
                  />
                }
              >
                <input
                  id="tennis-enhanced-odds"
                  type="number"
                  min={1}
                  step="0.01"
                  value={formData.ruleThresholds.tennisStraightSets.enhancedOddsThreshold}
                  onChange={(e) => setThreshold('tennisStraightSets', 'enhancedOddsThreshold', Number(e.target.value) || 0)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* ---- Save ---- */}
      <div className="sticky bottom-[70px] flex items-center justify-end gap-3 rounded-xl border border-line bg-surface/95 px-4 py-3 backdrop-blur-md lg:bottom-4">
        {isSavingToCloud && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-text-2">
            <Cloud className="h-4 w-4 animate-pulse text-brand" />
            Syncing to Firebase…
          </span>
        )}
        {savedSuccess && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-ok-ink">
            <Check className="h-4 w-4" strokeWidth={3} />
            Configuration saved &amp; synced to Firebase
          </span>
        )}
        {!savedSuccess && !isSavingToCloud && hasUnsavedChanges && (
          <span
            id="settings-unsaved-indicator"
            className="inline-flex items-center gap-1.5 text-[12px] font-bold text-warn-ink"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-warn animate-pulse" />
            Unsaved changes — nothing below takes effect until you save
          </span>
        )}
        <Button
          type="submit"
          id="btn-save-settings"
          variant="primary"
          icon={<Save className="h-4 w-4" strokeWidth={2.5} />}
          disabled={isSavingToCloud}
        >
          Save configuration
        </Button>
      </div>

      <ScanProgressModal
        variant="feedPreview"
        isOpen={isFeedPreviewModalOpen}
        awaitingConfirmation={isAwaitingFeedPreviewConfirmation}
        planLines={feedPreviewPlan.lines}
        hasAnyWork={feedPreviewPlan.hasAnyWork}
        isRunning={isRefreshingFeed}
        isFinished={isFeedPreviewFinished}
        isCancelled={isFeedPreviewCancelled}
        events={feedPreviewEvents}
        footballRecords={feedPreviewFootballRecords}
        tennisRecords={feedPreviewTennisRecords}
        onClose={isAwaitingFeedPreviewConfirmation ? handleCancelFeedPreviewConfirmation : () => setIsFeedPreviewModalOpen(false)}
        onStop={handleStopFeedPreview}
        onConfirmStart={handleConfirmStartFeedPreview}
      />
    </form>
  );
};
