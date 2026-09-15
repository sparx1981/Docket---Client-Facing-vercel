import React, { useState } from 'react';
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
} from 'lucide-react';
import { AppSettings, RuleThresholds } from '../types';
import {
  Button,
  Chip,
  CollapsibleSection,
  Field,
  Switch,
  inputClass,
} from './ui';
import { formatTimeUntilNextRun } from '../services/scheduler';

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
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onTriggerAutoScanTest,
  isAutoScanTesting = false,
}) => {
  const [formData, setFormData] = useState<AppSettings>(settings);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [autoScanTriggered, setAutoScanTriggered] = useState(false);

  const hasProviderKey = !!(formData.sportradarApiKey || formData.sportmonksApiKey);
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
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`Backend responded with ${res.status}`);
      if (!hasProviderKey) {
        setTestResult('Backend reachable, but no provider API key is configured yet — add one below to pull real fixtures.');
      } else {
        setTestResult(
          'Backend reachable. This only confirms our own server is up — use "Run Daily Scan" to make a real Sportradar/Sportmonks call and see whether the configured key is accepted.'
        );
      }
    } catch (err) {
      setTestResult(`Could not reach the backend: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <form
      id="settings-view"
      onSubmit={handleSave}
      className="mx-auto max-w-3xl space-y-5"
    >
      {/* ---- Data storage notice ---- */}
      <div className="rounded-xl border border-info-line bg-info-soft px-4 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-info-ink">
            <HardDrive className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <div className="min-w-0">
            <h2 className="text-[13px] font-extrabold text-info-ink">
              Everything here is stored only in this browser
            </h2>
            <p className="mt-0.5 text-[12px] leading-relaxed text-text-2">
              These settings, the Archive log, and sync history all live in this browser's local
              storage — there is no remote database. Nothing is synced to an account, and the
              backend that calls Sportradar/Sportmonks does not store anything either; it only
              forwards requests.
            </p>
            <p className="mt-2 text-[12px] leading-relaxed text-text-2">
              <strong className="text-text">What this means for you:</strong> opening the app on a
              different device or browser starts completely empty — nothing carries over. Clearing
              this browser's site data/cache, using a private window, or reinstalling the browser
              will permanently delete your Archive log and configuration with no way to recover it.
              Use the Archive log's <strong className="text-text">Export CSV</strong> button
              periodically if you want a backup outside the browser.
            </p>
          </div>
        </div>
      </div>

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

      {/* ---- Sportradar / Sportmonks — the real live providers ---- */}
      <CollapsibleSection
        title="Sportradar &amp; Sportmonks (live provider keys)"
        icon={<ShieldCheck className="h-4 w-4" strokeWidth={2.5} />}
        defaultOpen={false}
        action={<Chip tone={hasProviderKey ? 'ok' : 'warn'}>{hasProviderKey ? 'Configured' : 'Not configured'}</Chip>}
      >
        <div className="space-y-4 px-4 py-4">
          <p className="text-[11px] leading-relaxed text-text-2">
            These are the only two providers this app actually calls for fixtures, results, team
            stats and tennis rankings. The key you paste here is sent to our own backend per
            request (never straight to Sportradar/Sportmonks from the browser), which forwards it
            server-to-server. Sportradar is tried first when both are configured; Sportmonks does
            not cover tennis.
          </p>
          <Switch
            id="force-fallback"
            checked={formData.useFallbackProviders}
            onChange={(v) => set('useFallbackProviders', v)}
            label="Prefer these over Flashscore/Tennis Abstract once integrated"
            hint="Reserved for when Flashscore/Tennis Abstract get a real integration in a later phase — has no effect on fixture pulls today, since those two aren't wired to any data source yet."
          />

          <div className="grid grid-cols-1 gap-4 border-t border-line pt-4 md:grid-cols-2">
            <Field
              label="Sportradar API key"
              htmlFor="key-sportradar"
              hint="Soccer v4 + Tennis v3. Required for tennis fixtures."
              action={
                <ProviderKeyLink href="https://developer.sportradar.com/">
                  Get a key
                </ProviderKeyLink>
              }
            >
              <input
                id="key-sportradar"
                type="text"
                autoComplete="off"
                value={formData.sportradarApiKey}
                onChange={(e) => set('sportradarApiKey', e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </Field>

            <Field
              label="Sportmonks API key"
              htmlFor="key-sportmonks"
              hint="European football fixtures and head-to-head archives."
              action={
                <ProviderKeyLink href="https://www.sportmonks.com/football-api/">
                  Get a key
                </ProviderKeyLink>
              }
            >
              <input
                id="key-sportmonks"
                type="text"
                autoComplete="off"
                value={formData.sportmonksApiKey}
                onChange={(e) => set('sportmonksApiKey', e.target.value)}
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
          <p className="text-[11px] leading-relaxed text-text-2">
            The numeric pass/fail lines for each locked system. Changing a number here changes what
            counts as a qualifier on the next scan — it does not retroactively re-grade anything
            already in the Archive. Disabling a system stops it from being scanned or screened at
            all until re-enabled.
          </p>

          {/* System A: Over 1.5 Goals */}
          <div className="border-t border-line pt-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">
                Football — Over 1.5 Goals
              </h3>
              <Switch
                id="thresh-over15-enabled"
                checked={formData.ruleThresholds.footballOver15.enabled}
                onChange={(v) => setThreshold('footballOver15', 'enabled', v)}
                label="Enabled"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Min. previous-season avg goals scored" htmlFor="over15-avg-scored" hint="Both teams must meet this, independently.">
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
              <Field label="Min. H2H Over 1.5 rate (last 5, %)" htmlFor="over15-h2h-rate">
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
              <Field label="Min. recent scoring count (of last 5)" htmlFor="over15-recent-count">
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
              <Field label="Min. exchange odds" htmlFor="over15-odds">
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
              <Field label="Enhanced verification odds threshold" htmlFor="over15-enhanced-odds" hint="Odds above this trigger the extra audit note.">
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
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">
                Football — Under 3.5 Goals
              </h3>
              <Switch
                id="thresh-under35-enabled"
                checked={formData.ruleThresholds.footballUnder35.enabled}
                onChange={(v) => setThreshold('footballUnder35', 'enabled', v)}
                label="Enabled"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Max. previous-season avg goals scored" htmlFor="under35-avg-scored">
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
              <Field label="Max. previous-season avg goals conceded" htmlFor="under35-avg-conceded">
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
              <Field label="Min. H2H Under 3.5 rate (last 10, %)" htmlFor="under35-h2h-rate">
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
              <Field label="Min. recent Under 3.5 count (of last 5)" htmlFor="under35-recent-count">
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
              <Field label="Min. exchange odds" htmlFor="under35-odds">
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
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[12px] font-extrabold uppercase tracking-wider text-text">
                Tennis — Straight Sets
              </h3>
              <Switch
                id="thresh-tennis-enabled"
                checked={formData.ruleThresholds.tennisStraightSets.enabled}
                onChange={(v) => setThreshold('tennisStraightSets', 'enabled', v)}
                label="Enabled"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field label="Min. ranking delta (places)" htmlFor="tennis-rank-delta">
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
              <Field label="Min. career surface win rate (%)" htmlFor="tennis-surface-rate">
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
              <Field label="Min. recent wins (of last 10)" htmlFor="tennis-recent-wins">
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
              <Field label="Min. exchange odds" htmlFor="tennis-odds">
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
              <Field label="Enhanced verification odds threshold" htmlFor="tennis-enhanced-odds">
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
        {savedSuccess && (
          <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-ok-ink">
            <Check className="h-4 w-4" strokeWidth={3} />
            Configuration saved
          </span>
        )}
        <Button
          type="submit"
          id="btn-save-settings"
          variant="primary"
          icon={<Save className="h-4 w-4" strokeWidth={2.5} />}
        >
          Save configuration
        </Button>
      </div>
    </form>
  );
};
