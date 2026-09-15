import React from 'react';
import { AlertTriangle, Loader2, ShieldCheck, Sliders } from 'lucide-react';
import { AppSettings } from '../types';

interface ProviderStatusBannerProps {
  settings: AppSettings;
  onOpenSettings: () => void;
  /** Outcome of the most recent real provider call — null until one has actually happened. */
  providerHealth?: { ok: boolean; checkedAt: string } | null;
  /** Human-readable error surfaced by the last fixture pull, if any. */
  fixturesError?: string | null;
}

export const ProviderStatusBanner: React.FC<ProviderStatusBannerProps> = ({
  settings,
  onOpenSettings,
  providerHealth,
  fixturesError,
}) => {
  const hasAnyKey = Boolean(settings.sportradarApiKey || settings.sportmonksApiKey);

  let tone: 'warn' | 'ok' | 'bad' = 'warn';
  let icon = <AlertTriangle className="h-4 w-4" strokeWidth={2.5} />;
  let label = 'Not configured';
  let message = 'No Sportradar or Sportmonks API key is configured. Add one in Engine Configuration to pull real fixtures.';

  if (hasAnyKey) {
    if (!providerHealth) {
      tone = 'warn';
      icon = <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.5} />;
      label = 'Checking…';
      message = 'Contacting the configured provider for the first time this session.';
    } else if (providerHealth.ok) {
      tone = 'ok';
      icon = <ShieldCheck className="h-4 w-4" strokeWidth={2.5} />;
      label = 'Connected';
      message = `Last real provider call at ${new Date(providerHealth.checkedAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })} succeeded. Betfair Exchange odds are not yet connected (phase 2) — qualifying candidates sit in Price Watch until a real price is available.`;
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
