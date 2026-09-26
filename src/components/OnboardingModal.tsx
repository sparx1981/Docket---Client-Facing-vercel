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
  /** CSS selector of the real element this step points at. Highlighted with a glowing ring; silently skipped if not present (e.g. an empty account with no fixtures yet) rather than erroring. */
  targetSelector?: string;
  /** id of a CollapsibleSection's toggle button to expand (if collapsed) before locating targetSelector — for fields that live behind a collapsed Settings section. */
  expandSectionButtonId?: string;
}

const STEPS: OnboardingStep[] = [
  {
    title: 'Welcome to The Docket',
    icon: <Sparkles className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'help',
    body: [
      "The Docket scans real football fixtures against a fixed set of statistical rules, and tells you when a match meets every condition — nothing is ever guessed or invented.",
      "This tour will take you to each real screen and point out the key things to do, in order. You can reopen it any time from Help, and the full written User Guide covers everything here in more depth.",
    ],
  },

  // ---- Engine Configuration: the actual setup workflow, in order ----
  {
    title: '1. Add your provider key',
    icon: <Sliders className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'settings',
    expandSectionButtonId: 'btn-toggle-api-config',
    targetSelector: '#key-thestatsapi',
    body: [
      'Start in API Config: paste your TheStatsAPI key here. Every fixture, team stat, and market price the app shows comes from this key.',
      'Use "Test feeds" in this same section to confirm the key actually works before relying on it.',
    ],
  },
  {
    title: '2. Load and shortlist your leagues',
    icon: <Sliders className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'settings',
    expandSectionButtonId: 'btn-toggle-leagues',
    targetSelector: '#btn-load-leagues',
    body: [
      'In Leagues, click "Load leagues" to pull the full catalog your key can see.',
      'Then build a shortlist below it — narrowing this down is what unlocks Filter Thresholds, and keeps every rule\'s own league picker to just the competitions you actually care about.',
    ],
  },
  {
    title: '3. Set each rule\'s statistical thresholds',
    icon: <Sliders className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'settings',
    expandSectionButtonId: 'btn-toggle-filter-thresholds',
    targetSelector: '#over15-league-toggle',
    body: [
      'Filter Thresholds is where each rule\'s real requirements live — pick the league(s) this rule scans, then set its previous-season form, head-to-head rate, recent scoring, and minimum market odds price.',
      'Every number here is editable, and every popup elsewhere in the app that references a threshold reads it live from here.',
    ],
  },
  {
    title: '4. Save your configuration',
    icon: <Sliders className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'settings',
    targetSelector: '#btn-save-settings',
    body: ['Nothing takes effect — not a scan, not a backtest — until you save. Changes stay a local draft until you click here.'],
  },
  {
    title: '5. Run a backtest before going live',
    icon: <Sliders className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'settings',
    expandSectionButtonId: 'btn-toggle-filter-thresholds',
    targetSelector: '#btn-run-backtest-football_over_1_5',
    body: [
      'Optional but recommended: each rule has its own "Run Backtest" button, below its threshold fields. It replays your exact configuration against real historical matches, so you can see how it would have performed before trusting it live.',
      'Every completed run is saved automatically, so you can compare different configurations later.',
    ],
  },

  // ---- Verified Qualifiers ----
  {
    title: 'Verified Qualifiers',
    icon: <ShieldCheck className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'verified',
    body: [
      'Once configured, a scan populates this list — fixtures that passed every statistical filter for a rule and have a market odds price at or above your configured minimum. Anything here has cleared the full bar with no compromises.',
    ],
  },
  {
    title: 'Filter and search',
    icon: <ShieldCheck className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'verified',
    targetSelector: '#verified-search-input',
    body: ['Search by match, league, or market, and filter by sport or rule, once you have real results to narrow down.'],
  },

  // ---- Price Watch ----
  {
    title: 'Price Watch',
    icon: <TrendingDown className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'pricewatch',
    body: [
      "Fixtures that passed every statistical filter but not the price filter yet — the match itself looks right, the price just isn't there yet.",
    ],
  },
  {
    title: 'Refresh just the odds',
    icon: <TrendingDown className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'pricewatch',
    targetSelector: '#btn-refresh-odds',
    body: [
      'Use this for a quick, lightweight re-check of just the market price for fixtures already here, without waiting for the next full scan. A fixture is promoted to Verified Qualifiers automatically the moment a qualifying price appears.',
    ],
  },

  // ---- Archive & Performance ----
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
    title: 'Auto-settle and export',
    icon: <BarChart3 className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'analytics',
    targetSelector: '#btn-auto-settle-all',
    body: [
      'Pending bets settle automatically once a match\'s final score is confirmed — this button triggers an immediate check rather than waiting for the next scheduled pass.',
      'Use "Export CSV" alongside it any time you want an offline copy of what\'s currently shown.',
    ],
  },

  {
    title: "You're set",
    icon: <Check className="h-6 w-6" strokeWidth={2.5} />,
    tab: 'help',
    body: [
      'That covers the real workflow: key → leagues → thresholds → save → (optionally) backtest, then watch Verified Qualifiers and Price Watch fill in from your scans. The full User Guide (also under Help) goes into more depth on exactly what gets downloaded and where every piece of data lives.',
    ],
  },
];

/**
 * Locates the current step's target element, expanding its Settings section
 * first if needed, and keeps tracking its position (scroll/resize) so the
 * highlight ring stays put. Resolves to null (no ring drawn, panel still
 * shows) whenever the target isn't present — e.g. a fresh account with no
 * fixtures yet — rather than erroring.
 */
function useHighlightRect(targetSelector: string | undefined, expandSectionButtonId: string | undefined, stepKey: number) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRect(null);

    // Polls rather than checking once — onNavigate's tab switch happens in
    // the parent and may not have committed to the DOM yet on this same
    // tick, so a single synchronous getElementById right after a tab change
    // reliably misses the target the first time.
    async function waitFor(find: () => HTMLElement | null, timeoutMs: number): Promise<HTMLElement | null> {
      const deadline = Date.now() + timeoutMs;
      while (!cancelled) {
        const el = find();
        if (el) return el;
        if (Date.now() >= deadline) return null;
        await new Promise((r) => setTimeout(r, 50));
      }
      return null;
    }

    function locate() {
      if (!targetSelector || cancelled) return;
      const el = document.querySelector(targetSelector) as HTMLElement | null;
      if (!el) {
        setRect(null);
        return;
      }
      // Instant, not smooth — reading getBoundingClientRect() right after
      // triggering a smooth scroll returns the pre-scroll (often off-screen)
      // position, since the scroll animation hasn't run yet.
      el.scrollIntoView({ block: 'center', behavior: 'auto' });
      setRect(el.getBoundingClientRect());
    }

    async function run() {
      if (expandSectionButtonId) {
        const toggle = await waitFor(() => document.getElementById(expandSectionButtonId), 2000);
        if (toggle && toggle.getAttribute('aria-expanded') === 'false') {
          toggle.click();
        }
        // Let the section's open-state re-render commit before measuring.
        await new Promise((resolve) => setTimeout(resolve, 250));
      } else if (targetSelector) {
        // No section to expand, but a tab switch may still be in flight.
        await waitFor(() => document.querySelector(targetSelector) as HTMLElement | null, 1500);
      }
      if (cancelled) return;
      locate();
    }
    run();

    const onScrollOrResize = () => locate();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      cancelled = true;
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetSelector, expandSectionButtonId, stepKey]);

  return rect;
}

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Switches the app's active tab so each step sits next to the real screen it's describing. */
  onNavigate: (tab: TabKey) => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose, onNavigate }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];

  // Navigate to this step's real tab whenever the tour is open and the step
  // changes — this is what makes it a guide through the actual app rather
  // than a static description of it.
  useEffect(() => {
    if (isOpen) onNavigate(step.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, stepIndex]);

  const rect = useHighlightRect(isOpen ? step.targetSelector : undefined, step.expandSectionButtonId, stepIndex);

  if (!isOpen) return null;

  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  // The panel normally docks bottom-right, which is exactly where several
  // real targets (e.g. a screen's own "Save"/primary action button) also
  // sit — docking there too would bury the highlighted element under the
  // panel itself. Move the panel to the top-right instead whenever the
  // current target lives in that same bottom-right region.
  const panelAtTop =
    !!rect &&
    typeof window !== 'undefined' &&
    rect.top > window.innerHeight * 0.55 &&
    rect.left + rect.width > window.innerWidth * 0.5;

  const handleClose = () => {
    setStepIndex(0);
    onNavigate('help');
    onClose();
  };

  return (
    <>
      {rect && (
        <div
          className="pointer-events-none fixed z-40 rounded-lg border-2 border-brand shadow-[0_0_0_4px_rgba(16,122,79,0.25)] transition-all duration-300 animate-pulse-ring"
          style={{
            top: Math.max(4, rect.top - 6),
            left: Math.max(4, rect.left - 6),
            width: rect.width + 12,
            height: rect.height + 12,
          }}
        />
      )}

      <div
        role="dialog"
        aria-modal="false"
        aria-labelledby="onboarding-title"
        className={`fixed inset-x-4 z-50 sm:inset-x-auto sm:right-6 sm:w-full sm:max-w-sm ${
          panelAtTop ? 'top-4 sm:top-6' : 'bottom-4 sm:bottom-6'
        }`}
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

          <div className="max-h-[35vh] space-y-2.5 overflow-y-auto px-5 py-4">
            {step.body.map((p, i) => (
              <p key={i} className="text-[12.5px] leading-relaxed text-text-2">
                {p}
              </p>
            ))}
          </div>

          <div className="flex items-center justify-between border-t border-line bg-surface-2 px-5 py-3">
            <span className="font-mono text-[10px] text-text-3">
              Step {stepIndex + 1} of {STEPS.length}
            </span>
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
    </>
  );
};
