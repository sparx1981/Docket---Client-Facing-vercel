import React from 'react';
import { AlertTriangle, Clock, Loader2, ShieldCheck, Sliders } from 'lucide-react';
import { AppSettings } from '../types';

interface ProviderStatusBannerProps {
  settings: AppSettings;
  onOpenSettings: () => void;
  /** Outcome of the most recent real provider call — null until one has actually happened. */
  providerHealth?: { ok: boolean; checkedAt: string } | null;
  /** Human-readable error surfaced by the last fixture pull, if any. */
  fixturesError?: string | null;
  /** True only while a fetch is actually in flight — distinguishes "checking right now" from "no scan has run yet this session", which used to show the same "Checking…" wording either way. */
  fixturesLoading?: boolean;
}

export const ProviderStatusBanner: React.FC<ProviderStatusBannerProps> = ({
  settings,
  onOpenSettings,
  providerHealth,
  fixturesError,
  fixturesLoading = false,
}) => {
  const hasAnyKey = Boolean(settings.theStatsApiKey);
  // Nothing will actually be scanned — and so no provider call will ever be
  // made — until at least one rule is both enabled and has leagues saved.
  // The banner must not claim to be "checking" a provider it has no reason
  // to contact yet.
  const hasScannableRule =
    (settings.ruleThresholds.footballOver15.enabled && settings.ruleThresholds.footballOver15.selectedLeagueIds.length > 0) ||
    (settings.ruleThresholds.footballUnder35.enabled && settings.ruleThresholds.footballUnder35.selectedLeagueIds.length > 0);

  let tone: 'warn' | 'ok' | 'bad' = 'warn';
  let icon = <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />;
  let label = 'Not configured';
  let message = 'No TheStatsAPI key is configured. Add one in Engine Configuration to pull real fixtures.';

  if (hasAnyKey && !hasScannableRule) {
    tone = 'warn';
    icon = <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />;
    label = 'Awaiting setup';
    message = 'No rule is both enabled and has leagues selected yet — no provider call will be made until one is. Configure this in Engine Configuration.';
  } else if (hasAnyKey) {
    if (fixturesLoading) {
      tone = 'warn';
      icon = <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />;
      label = 'Checking…';
      message = 'Contacting the configured provider now — this can take a moment while fixtures are enriched.';
    } else if (!providerHealth) {
      tone = 'warn';
      icon = <Clock className="h-4 w-4" strokeWidth={2.5} />;
      label = 'Not yet run';
      message = 'No scan has been run yet this session — click Run Daily Scan, or wait for the scheduled time, to contact the provider.';
    } else if (providerHealth.ok) {
      tone = 'ok';
      icon = <ShieldCheck className="h-4 w-4" strokeWidth={2.5} />;
      label = 'Connected';
      message = `Last real provider call at ${new Date(providerHealth.checkedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })} succeeded. Candidates without a live market price on file yet sit in Price Watch.`;
    } else {
      tone = 'bad';
      icon = <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />;
      label = 'Provider error';
      message = fixturesError || 'The most recent provider call failed. See Engine Configuration for details.';
    }
  }

  const toneClasses: Record<typeof tone, string> = {
    warn: 'border-warn-line bg-warn-soft',
    ok: 'border-ok-line bg-ok-soft',
    bad: 'border-bad-line bg-bad-soft',
  };
  const inkClasses: Record<typeof tone, string> = {
    warn: 'text-warn-ink',
    ok: 'text-ok-ink',
    bad: 'text-bad-ink',
  };

  return (
    <div
      id="provider-status-banner"
      className={`border-b px-4 py-2 sm:px-6 lg:px-8 ${toneClasses[tone]}`}
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={`shrink-0 ${inkClasses[tone]}`}>{icon}</span>

        <span className={`font-mono text-[10px] font-bold uppercase tracking-[0.12em] ${inkClasses[tone]}`}>
          {label}
        </span>

        <p className="min-w-0 flex-1 text-[12px] leading-snug text-text-2">{message}</p>

        <button
          id="btn-configure-providers"
          onClick={onOpenSettings}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-bold transition-colors duration-200 ${inkClasses[tone]}`}
        >
          <Sliders className="h-3 w-3" strokeWidth={2.5} />
          {hasAnyKey ? 'Manage providers' : 'Add provider key'}
        </button>
      </div>
    </div>
  );
};
