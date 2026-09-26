import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  TrendingDown,
  BarChart3,
  Sliders,
  Sparkles,
  X,
  ArrowRight,
  ArrowLeft,
  Check,
} from 'lucide-react';
import { TabKey } from './AppShell';

interface OnboardingStep {
  title: string;
  icon: React.ReactNode;
  body: string[];
  /** The real tab this step is about — navigated to live so the step's explanation sits next to the actual screen, not a description of it. */
  tab: TabKey;
}

const STEPS: OnboardingStep[] = [
  {
    title: 'Welcome to The Docket',
    icon: <Sparkles className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'help',
    body: [
      "The Docket scans real football fixtures against a fixed set of statistical rules, and tells you when a match meets every condition — nothing is ever guessed or invented.",
      "This tour will take you to each real screen as it explains it. You can reopen it any time from Help, and the full written User Guide covers everything here in more depth.",
    ],
  },
  {
    title: 'Engine Configuration',
    icon: <Sliders className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'settings',
    body: [
      'Start here: add your TheStatsAPI key, pick which leagues each rule scans, and set the daily scan schedule.',
      "Filter Thresholds is where each rule's real statistical requirements live — previous-season form, head-to-head rate, recent scoring, and the minimum market odds price. Every number here is editable, and every popup elsewhere in the app that references a threshold reads it live from here, never a hardcoded copy.",
      'Each rule also has its own "Run Backtest" button, so you can see how a given configuration would have performed against real historical matches before relying on it live.',
    ],
  },
  {
    title: 'Verified Qualifiers',
    icon: <ShieldCheck className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'verified',
    body: [
      'This is the headline list — fixtures that passed every statistical filter for a rule and have a market odds price at or above your configured minimum. Anything here has cleared the full bar with no compromises.',
      'Open any fixture to see its full audit: exactly which numbers it was checked against, and why it passed.',
    ],
  },
  {
    title: 'Price Watch',
    icon: <TrendingDown className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'pricewatch',
    body: [
      "Fixtures that passed every statistical filter but not the price filter yet — the match itself looks right, the price just isn't there yet.",
      'Use "Refresh Odds" in the header for a quick, lightweight re-check of just the market price for fixtures already here, without waiting for the next full scan. A fixture is promoted to Verified Qualifiers automatically the moment a qualifying price appears.',
    ],
  },
  {
    title: 'Archive & Performance',
    icon: <BarChart3 className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'analytics',
    body: [
      'Your real, permanent record — every bet actually logged and settled against a genuine final score, with running win rate, P&L and ROI.',
      "This is different from Backtest: Backtest asks \"what if\" against historical matches and is never saved to Archive; Archive records what actually happened, permanently, synced to your account.",
    ],
  },
  {
    title: "You're set",
    icon: <Check className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'help',
    body: [
      'That covers the basics. The full User Guide (also under Help) goes into more detail on exactly what gets downloaded, what gets checked, and where every piece of data lives — worth a read once you\'re configuring real rules.',
    ],
  },
];

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Switches the app's active tab so each step sits next to the real screen it's describing. */
  onNavigate: (tab: TabKey) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose, onNavigate }) => {
  const [stepIndex, setStepIndex] = useState(0);

  // Navigate to this step's real tab whenever the tour is open and the step
  // changes — this is what makes it a guide through the actual app rather
  // than a static description of it.
  useEffect(() => {
    if (isOpen) onNavigate(STEPS[stepIndex].tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, stepIndex]);

  if (!isOpen) return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  const handleClose = () => {
    setStepIndex(0);
    onNavigate('help');
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="onboarding-title"
      className="fixed inset-x-4 bottom-4 z-50 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-full sm:max-w-sm"
    >
      <div className="flex w-full flex-col rounded-2xl border border-line bg-surface shadow-plate overflow-hidden">
        <div className="flex items-center justify-between border-b border-line bg-surface-2 px-5 py-3.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-line bg-brand-soft text-brand-ink">
              {step.icon}
            </div>
            <h2 id="onboarding-title" className="truncate text-[14px] font-extrabold text-text tracking-tight">
              {step.title}
            </h2>
          </div>
          <button
            id="btn-close-onboarding"
            onClick={handleClose}
            aria-label="Close tour"
            className="shrink-0 rounded-lg border border-line bg-surface p-1.5 text-text-3 transition-colors hover:border-brand hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[40vh] space-y-2.5 overflow-y-auto px-5 py-4">
          {step.body.map((p, i) => (
            <p key={i} className="text-[12.5px] leading-relaxed text-text-2">
              {p}
            </p>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-line bg-surface-2 px-5 py-3">
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full transition-colors ${i === stepIndex ? 'bg-brand' : 'bg-brand-line'}`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                type="button"
                id="btn-onboarding-back"
                onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[12px] font-bold text-text transition-colors hover:border-brand"
              >
                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2.5} />
                Back
              </button>
            )}
            <button
              type="button"
              id={isLast ? 'btn-onboarding-done' : 'btn-onboarding-next'}
              onClick={() => (isLast ? handleClose() : setStepIndex((i) => Math.min(STEPS.length - 1, i + 1)))}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3.5 py-1.5 text-[12px] font-bold text-white transition-opacity hover:opacity-90"
            >
              {isLast ? 'Done' : 'Next'}
              {!isLast && <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
