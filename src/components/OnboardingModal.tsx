import React, { useState } from 'react';
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

interface OnboardingStep {
  title: string;
  icon: React.ReactNode;
  body: string[];
}

const STEPS: OnboardingStep[] = [
  {
    title: 'Welcome to The Docket',
    icon: <Sparkles className="h-6 w-6" strokeWidth={2.5} />,
    body: [
      "The Docket scans real football fixtures against a fixed set of statistical rules, and tells you when a match meets every condition — nothing is ever guessed or invented.",
      'This short tour covers what each area of the app does. You can reopen it any time from Help, and the full written User Guide covers everything here in more depth.',
    ],
  },
  {
    title: 'Engine Configuration',
    icon: <Sliders className="h-6 w-6" strokeWidth={2.5} />,
    body: [
      'Start here: add your TheStatsAPI key, pick which leagues each rule scans, and set the daily scan schedule.',
      "Filter Thresholds is where each rule's real statistical requirements live — previous-season form, head-to-head rate, recent scoring, and the minimum market odds price. Every number here is editable, and every popup elsewhere in the app that references a threshold reads it live from here, never a hardcoded copy.",
      'Each rule also has its own "Run Backtest" button, so you can see how a given configuration would have performed against real historical matches before relying on it live.',
    ],
  },
  {
    title: 'Verified Qualifiers',
    icon: <ShieldCheck className="h-6 w-6" strokeWidth={2.5} />,
    body: [
      'This is the headline list — fixtures that passed every statistical filter for a rule and have a market odds price at or above your configured minimum. Anything here has cleared the full bar with no compromises.',
      'Open any fixture to see its full audit: exactly which numbers it was checked against, and why it passed.',
    ],
  },
  {
    title: 'Price Watch',
    icon: <TrendingDown className="h-6 w-6" strokeWidth={2.5} />,
    body: [
      "Fixtures that passed every statistical filter but not the price filter yet — the match itself looks right, the price just isn't there yet.",
      'Use "Refresh Odds" in the header for a quick, lightweight re-check of just the market price for fixtures already here, without waiting for the next full scan. A fixture is promoted to Verified Qualifiers automatically the moment a qualifying price appears.',
    ],
  },
  {
    title: 'Archive & Performance',
    icon: <BarChart3 className="h-6 w-6" strokeWidth={2.5} />,
    body: [
      'Your real, permanent record — every bet actually logged and settled against a genuine final score, with running win rate, P&L and ROI.',
      "This is different from Backtest: Backtest asks \"what if\" against historical matches and is never saved to Archive; Archive records what actually happened, permanently, synced to your account.",
    ],
  },
  {
    title: "You're set",
    icon: <Check className="h-6 w-6" strokeWidth={2.5} />,
    body: [
      'That covers the basics. The full User Guide (also under Help) goes into more detail on exactly what gets downloaded, what gets checked, and where every piece of data lives — worth a read once you\'re configuring real rules.',
    ],
  },
];

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  const [stepIndex, setStepIndex] = useState(0);

  if (!isOpen) return null;

  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  const handleClose = () => {
    setStepIndex(0);
    onClose();
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="onboarding-title" className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div onClick={handleClose} className="fixed inset-0 bg-black/40 backdrop-blur-xs" aria-hidden="true" />

      <div className="relative z-10 flex w-full max-w-lg flex-col rounded-2xl border border-line bg-surface shadow-plate overflow-hidden">
        <div className="flex items-center justify-between border-b border-line bg-surface-2 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand-line bg-brand-soft text-brand-ink">
              {step.icon}
            </div>
            <h2 id="onboarding-title" className="text-[16px] font-extrabold text-text tracking-tight">
              {step.title}
            </h2>
          </div>
          <button
            id="btn-close-onboarding"
            onClick={handleClose}
            aria-label="Close tour"
            className="rounded-lg border border-line bg-surface p-1.5 text-text-3 transition-colors hover:border-brand hover:text-text"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-6 py-5">
          {step.body.map((p, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-text-2">
              {p}
            </p>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-line bg-surface-2 px-6 py-3.5">
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
                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] font-bold text-text transition-colors hover:border-brand"
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
