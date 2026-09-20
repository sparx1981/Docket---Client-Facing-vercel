import React, { useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  HardDrive,
  Key,
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
} from 'lucide-react';
import { AppSettings, BacktestSummary, CandidateFixture, FeedSummaryRecord, LeagueOption, RuleThresholds } from '../types';
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
import { checkFeedHealth, FeedHealthResult, fetchLeagues, fetchLiveFeedSummary } from '../services/dataFeed';
import { runBacktest } from '../services/backtest';

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
  onRefreshFixtures?: () => void;
  footballFeedInfo?: FeedSummaryRecord;
  tennisFeedInfo?: FeedSummaryRecord;
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
  onRefreshFixtures,
  footballFeedInfo,
  tennisFeedInfo,
}) => {
  const [formData, setFormData] = useState<AppSettings>(settings);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [feedHealth, setFeedHealth] = useState<FeedHealthResult[] | null>(null);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [autoScanTriggered, setAutoScanTriggered] = useState(false);

  // League filter (Filter Thresholds)
  const [leagues, setLeagues] = useState<LeagueOption[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState(false);
  const [leaguesError, setLeaguesError] = useState<string | null>(null);

  // Backtest (Filter Thresholds)
  const [backtestSystem, setBacktestSystem] = useState<'football_over_1_5' | 'football_under_3_5'>(
    'football_over_1_5'
  );
  const [backtestLeagueId, setBacktestLeagueId] = useState<string>('');
  const [backtestRunning, setBacktestRunning] = useState(false);
  const [backtestResult, setBacktestResult] = useState<BacktestSummary | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);

  // Live feed state for Filter Thresholds breakdown
  const [liveFixtures, setLiveFixtures] = useState<CandidateFixture[]>(fixtures || []);
  const [feedInfoFootball, setFeedInfoFootball] = useState<FeedSummaryRecord | undefined>(footballFeedInfo);
  const [feedInfoTennis, setFeedInfoTennis] = useState<FeedSummaryRecord | undefined>(tennisFeedInfo);
  const [isRefreshingFeed, setIsRefreshingFeed] = useState(false);
  const [feedError, setFeedError] = useState<string | undefined>(fixturesError);

  useEffect(() => {
    if (fixtures && fixtures.length > 0) {
      setLiveFixtures(fixtures);
    }
  }, [fixtures]);

  useEffect(() => {
    if (footballFeedInfo) setFeedInfoFootball(footballFeedInfo);
  }, [footballFeedInfo]);

  useEffect(() => {
    if (tennisFeedInfo) setFeedInfoTennis(tennisFeedInfo);
  }, [tennisFeedInfo]);

  const footballConfigured = !!formData.theStatsApiKey;
  // Tennis has no configured data supplier since the Sportradar/Sportmonks
  // migration — kept as a constant (rather than deleted) so the tennis
  // breakdown card below still renders its real "not configured" state.
  const tennisConfigured = false;

  const handleRefreshLiveFeed = async () => {
    setIsRefreshingFeed(true);
    setFeedError(undefined);
    try {
      const res = await fetchLiveFeedSummary(formData);
      if (res.fixtures && res.fixtures.length > 0) {
        setLiveFixtures(res.fixtures);
      }
      if (res.footballFeedInfo) {
        setFeedInfoFootball(res.footballFeedInfo);
      }
      if (res.tennisFeedInfo) {
        setFeedInfoTennis(res.tennisFeedInfo);
      }
      if (res.error) {
        setFeedError(res.error);
      }
      if (onRefreshFixtures) {
        onRefreshFixtures();
      }
    } catch (err) {
      setFeedError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshingFeed(false);
    }
  };

  // Deliberately no auto-fetch on mount: a live provider call must only
  // happen at the configured schedule time or via an explicit manual
  // trigger (the refresh button below), never just from opening this page.

  const over15Breakdown = useMemo(
    () =>
      calculateSystemBreakdown({
        systemKey: 'footballOver15',
        thresholds: formData.ruleThresholds,
        fixtures: liveFixtures,
        feedInfo: feedInfoFootball,
        isConfigured: footballConfigured,
        isLoading: isRefreshingFeed || fixturesLoading,
        error: feedInfoFootball?.error || (footballConfigured ? undefined : 'TheStatsAPI key not configured'),
      }),
    [formData.ruleThresholds, liveFixtures, feedInfoFootball, footballConfigured, isRefreshingFeed, fixturesLoading]
  );

  const under35Breakdown = useMemo(
    () =>
      calculateSystemBreakdown({
        systemKey: 'footballUnder35',
        thresholds: formData.ruleThresholds,
        fixtures: liveFixtures,
        feedInfo: feedInfoFootball,
        isConfigured: footballConfigured,
        isLoading: isRefreshingFeed || fixturesLoading,
        error: feedInfoFootball?.error || (footballConfigured ? undefined : 'TheStatsAPI key not configured'),
      }),
    [formData.ruleThresholds, liveFixtures, feedInfoFootball, footballConfigured, isRefreshingFeed, fixturesLoading]
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
  // Flashscore / Tennis Abstract have no real integration in this app (no
  // public API for either) — these fields are kept only as optional manual
  // reference links, so this just reflects "a value is typed in", not "this
  // is a connected feed".
  const hasLegacyKeys = !!(formData.flashscoreApiKey || formData.tennisAbstractApiKey);

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

  const handleLoadLeagues = async () => {
    setLeaguesLoading(true);
    setLeaguesError(null);
    try {
      const result = await fetchLeagues(formData);
      setLeagues(result.sort((a, b) => a.name.localeCompare(b.name)));
      if (result.length === 0) {
        setLeaguesError('No competitions returned — check the TheStatsAPI key above.');
      }
    } catch (err) {
      setLeaguesError(err instanceof Error ? err.message : String(err));
    } finally {
      setLeaguesLoading(false);
    }
  };

  const toggleLeagueSelected = (id: string) => {
    setFormData((prev) => {
      const selected = new Set(prev.selectedLeagueIds);
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      return { ...prev, selectedLeagueIds: Array.from(selected) };
    });
  };

  const handleRunBacktest = async () => {
    setBacktestRunning(true);
    setBacktestError(null);
    setBacktestResult(null);
    try {
      const league = backtestLeagueId ? leagues.find((l) => l.id === backtestLeagueId) : undefined;
      const result = await runBacktest(
        formData,
        backtestSystem,
        backtestLeagueId || null,
        league ? league.name : 'All leagues',
        200
      );
      setBacktestResult(result);
    } catch (err) {
      setBacktestError(err instanceof Error ? err.message : String(err));
    } finally {
      setBacktestRunning(false);
    }
  };

  return (
    <form
      id="settings-view"
      onSubmit={handleSave}
      className="mx-auto max-w-3xl space-y-5"
    >
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
              Linked: {user.email}
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
            All data within <strong className="text-text">Engine Configuration</strong> (your Sportradar,
            Sportmonks, and Betfair API keys, custom rule thresholds, scan schedule, and staking parameters)
            along with all <strong className="text-text">synced application data</strong> (the complete
            Archive log of verified qualifiers, settled match outcomes, P&amp;L history, and sync audit logs)
            are associated with your authenticated Google account and securely stored in our remote{' '}
            <strong className="text-text">Firebase Firestore cloud database</strong>.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-[11.5px] leading-relaxed">
            <div className="rounded-lg border border-line bg-surface p-2.5">
              <p className="font-bold text-text">What carries over between devices:</p>
              <p className="mt-0.5 text-text-2">
                Opening the app on any phone, tablet, laptop, or new browser and signing in with your
                Google account automatically restores your saved API keys, custom rule thresholds, and
                entire Archive ledger. Everything is synced to your account across all devices.
              </p>
            </div>

            <div className="rounded-lg border border-line bg-surface p-2.5">
              <p className="font-bold text-text">Browser cache vs Firestore cloud database:</p>
              <p className="mt-0.5 text-text-2">
                Clearing your browser cache or site data, using a private window, or reinstalling the browser
                will <strong className="text-text">NOT</strong> delete your configuration or Archive log —
                they remain safely preserved in the remote Firebase database. What is reset is only your local
                browser session (you will simply sign back in with Google) and any transient in-memory unverified
                fixtures currently open in your view. You can also use the Archive log's{' '}
                <strong className="text-text">Export CSV</strong> button periodically if you want an independent
                offline file backup.
              </p>
            </div>
          </div>
        </div>
      </CollapsibleSection>

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
                  ? 'Fixtures, results and team stats are pulled live from Sportradar/Sportmonks via our backend. Betfair Exchange odds are not yet connected (phase 2).'
                  : 'Add a Sportradar or Sportmonks API key below to pull real fixtures. Until then the docket and archive stay empty.'}
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
            {feedHealth.map((h) => (
              <div
                key={`${h.sport}-${h.provider}`}
                className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed ${
                  h.status === 'ok'
                    ? 'border-ok-line bg-ok-soft text-ok-ink'
                    : h.status === 'rate_limited'
                    ? 'border-warn-line bg-warn-soft text-warn-ink'
                    : 'border-bad-line bg-bad-soft text-bad-ink'
                }`}
              >
                {h.status === 'ok' ? (
                  <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                ) : h.status === 'rate_limited' ? (
                  <Clock className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                ) : (
                  <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
                )}
                <div className="min-w-0 flex-1">
                  <span className="font-bold uppercase tracking-wide">
                    {h.sport === 'football' ? 'Football' : 'Tennis'} — {h.provider}
                  </span>
                  <span className="ml-1.5">
                    {h.status === 'ok'
                      ? `OK — ${h.recordCount} fixture(s) for today`
                      : h.status === 'rate_limited'
                      ? `Rate-limited / quota exhausted — ${h.message}`
                      : `Error — ${h.message}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- Schedule & staking ---- */}
      <CollapsibleSection
        title="Scan schedule &amp; staking"
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

      {/* ---- Combined: Sports Data Feeds & Betfair Exchange Credentials ---- */}
      <CollapsibleSection
        title="Direct Data Feeds &amp; Betfair Exchange Credentials"
        icon={<Key className="h-4 w-4" strokeWidth={2.5} />}
        defaultOpen={false}
        action={
          <div className="flex items-center gap-1.5">
            <Chip tone="info">Sportsbook excluded</Chip>
            <Chip tone={hasLegacyKeys ? 'ok' : 'warn'}>
              {hasLegacyKeys ? 'Key entered' : 'Keys pending'}
            </Chip>
          </div>
        }
      >
        <div className="space-y-5 px-4 py-4">
          {/* Subsection 1: Sports Feeds */}
          <div>
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">
                1. Flashscore &amp; Tennis Abstract (manual reference only)
              </h3>
              <span className="font-mono text-[10px] text-text-3">
                Not integrated — no public API for either
              </span>
            </div>
            <p className="mb-3 text-[11px] leading-relaxed text-text-2">
              Flashscore and Tennis Abstract have no public API this app can call — these keys are
              not used to pull any data. They're kept here only so the "Check Google" / stats links
              elsewhere point at the right place if you ever wire in a scraper or partner feed.
              Real fixtures, results and team stats come from Sportradar/Sportmonks below.
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                label="Flashscore API key"
                htmlFor="key-flashscore"
                hint="Not currently used to fetch data — reserved for a future integration."
              >
                <input
                  id="key-flashscore"
                  type="password"
                  autoComplete="off"
                  placeholder="fs_live_…"
                  value={formData.flashscoreApiKey}
                  onChange={(e) => set('flashscoreApiKey', e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </Field>

              <Field
                label="Tennis Abstract API key"
                htmlFor="key-tennis"
                hint="Not currently used to fetch data — reserved for a future integration."
              >
                <input
                  id="key-tennis"
                  type="password"
                  autoComplete="off"
                  placeholder="ta_api_…"
                  value={formData.tennisAbstractApiKey}
                  onChange={(e) => set('tennisAbstractApiKey', e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
            </div>
          </div>

          {/* Subsection 2: Betfair Exchange */}
          <div className="border-t border-line pt-4">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">
                2. Betfair Exchange API-NG Credentials
              </h3>
              <span className="font-mono text-[10px] text-warn-ink font-semibold">
                Not yet connected — phase 2
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                label="Application key (AppKey)"
                htmlFor="key-bf-app"
                hint="Betfair developer API Application Key."
                action={
                  <ProviderKeyLink href="https://developer.betfair.com/">
                    Get a key
                  </ProviderKeyLink>
                }
              >
                <input
                  id="key-bf-app"
                  type="password"
                  autoComplete="off"
                  placeholder="bf_app_…"
                  value={formData.betfairAppKey}
                  onChange={(e) => set('betfairAppKey', e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </Field>

              <Field
                label="Session token (SSOID)"
                htmlFor="key-bf-sso"
                hint="Authenticated Betfair SSO session token for live liquidity queries. Generated via Betfair's login API using your AppKey, not a static value from the portal."
                action={
                  <ProviderKeyLink href="https://developer.betfair.com/en/get-started/">
                    How to get one
                  </ProviderKeyLink>
                }
              >
                <input
                  id="key-bf-sso"
                  type="password"
                  autoComplete="off"
                  placeholder="bf_sso_…"
                  value={formData.betfairSessionToken}
                  onChange={(e) => set('betfairSessionToken', e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-text-2">
              Betfair Exchange integration is not implemented yet — it needs a certificate-based
              login flow that's a separate piece of work. These credentials are stored but not
              used by any request today. Until phase 2 lands, every qualifying candidate is held
              in Price Watch showing "Not yet connected — exchange odds integration pending"
              instead of a price.
            </p>
          </div>
        </div>
      </CollapsibleSection>

      {/* ---- TheStatsAPI — the live football data provider ---- */}
      <CollapsibleSection
        title="TheStatsAPI (live provider key)"
        icon={<ShieldCheck className="h-4 w-4" strokeWidth={2.5} />}
        defaultOpen={false}
        action={<Chip tone={hasProviderKey ? 'ok' : 'warn'}>{hasProviderKey ? 'Configured' : 'Not configured'}</Chip>}
      >
        <div className="space-y-4 px-4 py-4">
          <p className="text-[11px] leading-relaxed text-text-2">
            TheStatsAPI.com is this app's football data provider — fixtures, results, team
            stats, competitions and head-to-head records all come from it. The key you paste here
            is sent to our own backend per request (never straight to TheStatsAPI from the
            browser), which forwards it server-to-server as a Bearer token. Sportradar and
            Sportmonks were retired from this app over cost and are no longer called anywhere.
            Tennis has no configured data supplier yet — it is planned to move to its own new
            provider in a later phase.
          </p>

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

      {/* ---- Filter Thresholds ---- */}
      <CollapsibleSection
        title="Filter Thresholds"
        icon={<SlidersHorizontal className="h-4 w-4" strokeWidth={2.5} />}
        defaultOpen={false}
      >
        <div className="space-y-5 px-4 py-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-surface-2 border border-line">
            <div className="space-y-1">
              <p className="text-[12px] font-semibold text-text">
                Live Data Feed Impact & Filter Reductions
              </p>
              <p className="text-[11px] leading-relaxed text-text-2">
                Hover over any rule header or threshold label below to inspect total records received from the live feed and the breakdown of matches eliminated by each filter. Only live data from configured APIs is displayed — no placeholder data.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefreshLiveFeed}
              disabled={isRefreshingFeed}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-line bg-surface text-text hover:border-brand transition-colors shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshingFeed ? 'animate-spin text-brand' : ''}`} />
              <span>{isRefreshingFeed ? 'Querying feed…' : 'Refresh live feed'}</span>
            </button>
          </div>

          {feedError && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-300">
              <span className="font-semibold">Provider feed notice: </span>
              {feedError}
            </div>
          )}

          {/* League filter */}
          <div className="border-t border-line pt-4">
            <div className="mb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">League Filter</h3>
                <p className="text-[11px] leading-relaxed text-text-2">
                  Choose which football competitions fixtures and backtests are pulled from. Leave
                  nothing selected for "All" — every competition your TheStatsAPI key can see.
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

            {leaguesError && (
              <p className="mb-3 text-[11px] font-medium text-bad-ink">{leaguesError}</p>
            )}

            <div className="flex flex-wrap items-center gap-2 mb-2">
              <Chip tone={formData.selectedLeagueIds.length === 0 ? 'ok' : 'neutral'}>
                {formData.selectedLeagueIds.length === 0
                  ? 'All leagues'
                  : `${formData.selectedLeagueIds.length} league${formData.selectedLeagueIds.length === 1 ? '' : 's'} selected`}
              </Chip>
              {formData.selectedLeagueIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => set('selectedLeagueIds', [])}
                  className="text-[11px] font-semibold text-brand-ink hover:underline"
                >
                  Reset to All
                </button>
              )}
            </div>

            {leagues.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-lg border border-line divide-y divide-line">
                {leagues.map((league) => {
                  const checked = formData.selectedLeagueIds.includes(league.id);
                  return (
                    <label
                      key={league.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-[12px] cursor-pointer hover:bg-surface-2"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleLeagueSelected(league.id)}
                          className="shrink-0"
                        />
                        <span className="truncate text-text">{league.name}</span>
                        {league.country && (
                          <span className="shrink-0 text-text-2 text-[11px]">({league.country})</span>
                        )}
                      </span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-text-2">{league.type}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Backtest */}
          <div className="border-t border-line pt-4">
            <div className="mb-3 space-y-1">
              <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">Backtest</h3>
              <p className="text-[11px] leading-relaxed text-text-2">
                Settle the last 200 finished matches for the selected league against a rule's real
                final scores, at that rule's configured required odds. This checks the goal-line
                outcome only — it does not replay each match's pre-match form/H2H as it stood on
                that date (TheStatsAPI has no "stats as of a past date" query), and there is no
                historical Betfair Exchange price to test against.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 sm:items-end mb-3">
              <Field label="Rule" htmlFor="backtest-system">
                <select
                  id="backtest-system"
                  value={backtestSystem}
                  onChange={(e) => setBacktestSystem(e.target.value as typeof backtestSystem)}
                  className={inputClass}
                >
                  <option value="football_over_1_5">Football — Over 1.5 Goals</option>
                  <option value="football_under_3_5">Football — Under 3.5 Goals</option>
                </select>
              </Field>
              <Field label="League" htmlFor="backtest-league">
                <select
                  id="backtest-league"
                  value={backtestLeagueId}
                  onChange={(e) => setBacktestLeagueId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">All leagues</option>
                  {leagues.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                id="btn-run-backtest"
                onClick={handleRunBacktest}
                disabled={backtestRunning || !formData.theStatsApiKey}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-line bg-surface text-text hover:border-brand transition-colors shrink-0 disabled:opacity-60"
              >
                <Play className={`w-3.5 h-3.5 ${backtestRunning ? 'animate-pulse text-brand' : ''}`} />
                <span>{backtestRunning ? 'Running backtest…' : 'Run backtest'}</span>
              </button>
            </div>

            {backtestError && <p className="mb-3 text-[11px] font-medium text-bad-ink">{backtestError}</p>}

            {backtestResult && (
              <div className="rounded-lg border border-line bg-surface-2 p-3 space-y-2">
                <p className="text-[12px] font-semibold text-text">
                  {backtestResult.leagueLabel} · {backtestResult.sampleSize} matches settled
                </p>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] font-mono text-text">
                  <span>Wins: {backtestResult.wins}</span>
                  <span>Losses: {backtestResult.losses}</span>
                  <span>Win rate: {backtestResult.winRatePct}%</span>
                  <span>Required odds: {backtestResult.requiredOdds.toFixed(2)}</span>
                  <span>Net units: {backtestResult.netUnitsAtRequiredOdds >= 0 ? '+' : ''}{backtestResult.netUnitsAtRequiredOdds}</span>
                  <span>ROI: {backtestResult.roiPct}%</span>
                </div>
                <p className="text-[10px] leading-relaxed text-text-2">{backtestResult.scopeNote}</p>
              </div>
            )}
          </div>

          {/* System A: Over 1.5 Goals */}
          <div className="border-t border-line pt-4">
            <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">
                  Football — Over 1.5 Goals
                </h3>
                <FilterHoverPopup
                  breakdown={over15Breakdown}
                  onRefreshFeed={handleRefreshLiveFeed}
                  isRefreshing={isRefreshingFeed}
                />
              </div>
              <Switch
                id="thresh-over15-enabled"
                checked={formData.ruleThresholds.footballOver15.enabled}
                onChange={(v) => setThreshold('footballOver15', 'enabled', v)}
                label="Enabled"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            </div>
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
                  onRefreshFeed={handleRefreshLiveFeed}
                  isRefreshing={isRefreshingFeed}
                />
              </div>
              <Switch
                id="thresh-under35-enabled"
                checked={formData.ruleThresholds.footballUnder35.enabled}
                onChange={(v) => setThreshold('footballUnder35', 'enabled', v)}
                label="Enabled"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
            </div>
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
                  onRefreshFeed={handleRefreshLiveFeed}
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
    </form>
  );
};
