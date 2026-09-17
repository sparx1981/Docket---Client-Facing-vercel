import React, { useState } from 'react';
import { Check, ChevronDown, Minus, X, Clock } from 'lucide-react';

/* ==========================================================================
   Plate — the ruled document panel. This is the only container in the system.
   Nothing nests inside another plate; inner divisions are drawn with rules.
   ========================================================================== */

export const Plate: React.FC<{
  children: React.ReactNode;
  className?: string;
  id?: string;
}> = ({ children, className = '', id }) => (
  <section id={id} className={`plate overflow-hidden ${className}`}>
    {children}
  </section>
);

export const PlateHeader: React.FC<{
  title: React.ReactNode;
  icon?: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
}> = ({ title, icon, meta, action }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface-2 px-4 py-3">
    <div className="flex items-center gap-2.5 min-w-0">
      {icon && <span className="text-brand-ink shrink-0">{icon}</span>}
      <h2 className="rule-head text-text truncate">{title}</h2>
      {meta && (
        <span className="font-mono text-[11px] text-text-3 truncate">
          {meta}
        </span>
      )}
    </div>
    {action}
  </div>
);

/**
 * A Plate whose body can be collapsed. The title (and icon) toggle it; any
 * `action` content sits alongside as its own control, never nested inside
 * the toggle button, so switches/chips/buttons in the header stay
 * independently clickable.
 */
export const CollapsibleSection: React.FC<{
  title: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  id?: string;
  buttonId?: string;
}> = ({
  title,
  icon,
  action,
  defaultOpen = true,
  children,
  className = '',
  id,
  buttonId,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Plate className={className} id={id}>
      <div
        className={`flex flex-wrap items-center justify-between gap-3 bg-surface-2 px-4 py-3 transition-colors ${
          open ? 'border-b border-line' : ''
        }`}
      >
        <button
          id={buttonId}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex min-w-0 items-center gap-2.5 text-left cursor-pointer hover:text-brand-ink transition-colors"
        >
          {icon && <span className="text-brand-ink shrink-0">{icon}</span>}
          <h2 className="rule-head text-text truncate">{title}</h2>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-text-3 transition-transform duration-200 ${
              open ? 'rotate-180 text-brand-ink' : ''
            }`}
            strokeWidth={2.5}
          />
        </button>
        {action}
      </div>
      {open && children}
    </Plate>
  );
};

/* ==========================================================================
   Verdict chip — outcome only. Every tone carries a glyph so the meaning
   survives without colour.
   ========================================================================== */

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'neutral';

const TONE: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok-ink border-ok-line',
  warn: 'bg-warn-soft text-warn-ink border-warn-line',
  bad: 'bg-bad-soft text-bad-ink border-bad-line',
  info: 'bg-info-soft text-info-ink border-info-line',
  brand: 'bg-brand-soft text-brand-ink border-brand-line',
  neutral: 'bg-surface-3 text-text-2 border-line',
};

export const Chip: React.FC<{
  tone?: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  title?: string;
}> = ({ tone = 'neutral', icon, children, className = '', title }) => (
  <span
    title={title}
    className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-bold leading-5 tracking-wide whitespace-nowrap ${TONE[tone]} ${className}`}
  >
    {icon}
    {children}
  </span>
);

/* Stamped verdict — the authored moment. Reserved for a settled audit result. */
export const Stamp: React.FC<{
  tone?: Tone;
  children: React.ReactNode;
  icon?: React.ReactNode;
  animate?: boolean;
}> = ({ tone = 'ok', children, icon, animate = false }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-md border-2 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] ${TONE[tone]} ${
      animate ? 'animate-stamp' : ''
    }`}
  >
    {icon}
    {children}
  </span>
);

/* ==========================================================================
   Outcome badge — one component owns Won / Lost / Pending / Void everywhere,
   so the glyph and wording can never drift between views.
   ========================================================================== */

export const OutcomeBadge: React.FC<{ outcome: string }> = ({ outcome }) => {
  switch (outcome) {
    case 'WON':
      return (
        <Chip tone="ok" icon={<Check className="h-3 w-3" strokeWidth={3} />}>
          WON
        </Chip>
      );
    case 'LOST':
      return (
        <Chip tone="bad" icon={<X className="h-3 w-3" strokeWidth={3} />}>
          LOST
        </Chip>
      );
    case 'PENDING':
      return (
        <Chip tone="warn" icon={<Clock className="h-3 w-3" strokeWidth={2.5} />}>
          PENDING
        </Chip>
      );
    default:
      return (
        <Chip tone="neutral" icon={<Minus className="h-3 w-3" strokeWidth={3} />}>
          VOID
        </Chip>
      );
  }
};

/* ==========================================================================
   Price tag — the exchange price, set at bookmaker scale.
   ========================================================================== */

export const PriceTag: React.FC<{
  odds: number;
  tone?: 'ok' | 'warn' | 'neutral';
  size?: 'sm' | 'md' | 'lg';
  sub?: React.ReactNode;
  align?: 'left' | 'right';
}> = ({ odds, tone = 'ok', size = 'md', sub, align = 'right' }) => {
  const colour =
    tone === 'ok' ? 'text-ok-ink' : tone === 'warn' ? 'text-warn-ink' : 'text-text';
  const scale =
    size === 'lg' ? 'text-2xl' : size === 'md' ? 'text-lg' : 'text-sm';

  return (
    <div className={align === 'right' ? 'text-right' : 'text-left'}>
      <div
        className={`font-mono font-bold tabular-nums leading-none tracking-tight ${scale} ${colour}`}
      >
        <span className="opacity-55">@</span>
        {odds.toFixed(2)}
      </div>
      {sub && (
        <div className="mt-1 font-mono text-[10px] leading-tight text-text-3">
          {sub}
        </div>
      )}
    </div>
  );
};

/* ==========================================================================
   Buttons
   ========================================================================== */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
};

const VARIANT: Record<string, string> = {
  primary:
    'bg-cta text-on-cta hover:bg-cta-hover shadow-plate disabled:bg-surface-3 disabled:text-text-3 disabled:shadow-none',
  secondary:
    'bg-surface-2 text-text border border-line hover:border-line-strong hover:bg-surface-3 disabled:text-text-3',
  ghost:
    'bg-transparent text-text-2 hover:bg-surface-2 hover:text-text disabled:text-text-3',
  danger:
    'bg-bad-soft text-bad-ink border border-bad-line hover:bg-bad-soft disabled:text-text-3',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  ...rest
}) => (
  <button
    {...rest}
    className={`inline-flex items-center justify-center gap-2 rounded-lg font-bold tracking-wide transition-all duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:active:scale-100 ${
      size === 'sm'
        ? 'min-h-[34px] px-3 text-[12px]'
        : 'min-h-[40px] px-4 text-[13px]'
    } ${VARIANT[variant]} ${className}`}
  >
    {icon}
    {children}
  </button>
);

/* ==========================================================================
   Segmented control — the filter switch used across every view.
   ========================================================================== */

export interface Segment {
  value: string;
  label: string;
  count?: number;
  tone?: Tone;
}

export const Segmented: React.FC<{
  segments: Segment[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}> = ({ segments, value, onChange, label }) => (
  <div
    role="tablist"
    aria-label={label}
    className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5"
  >
    {segments.map((s) => {
      const active = s.value === value;
      return (
        <button
          key={s.value}
          role="tab"
          aria-selected={active}
          onClick={() => onChange(s.value)}
          className={`inline-flex min-h-[34px] items-center gap-1.5 rounded-[6px] px-3 text-[12px] font-semibold transition-all duration-200 ${
            active
              ? 'bg-surface text-text shadow-plate'
              : 'text-text-3 hover:text-text-2'
          }`}
        >
          {s.label}
          {typeof s.count === 'number' && (
            <span
              className={`font-mono text-[10px] tabular-nums ${
                active ? 'text-brand-ink' : 'text-text-3'
              }`}
            >
              {s.count}
            </span>
          )}
        </button>
      );
    })}
  </div>
);

/* ==========================================================================
   Form field — visible label, helper text below, never placeholder-as-label.
   ========================================================================== */

export const Field: React.FC<{
  label: string;
  hint?: string;
  children: React.ReactNode;
  htmlFor?: string;
  /** Optional control rendered alongside the label — e.g. a link to the provider's own key-management page. */
  action?: React.ReactNode;
}> = ({ label, hint, children, htmlFor, action }) => (
  <div className="space-y-1.5">
    <div className="flex items-center justify-between gap-2">
      <label
        htmlFor={htmlFor}
        className="block text-[12px] font-semibold text-text"
      >
        {label}
      </label>
      {action}
    </div>
    {children}
    {hint && <p className="text-[11px] leading-snug text-text-3">{hint}</p>}
  </div>
);

export const inputClass =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-text transition-colors duration-200 outline-none hover:border-line-strong focus:border-brand focus:bg-surface';

export const Switch: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  id?: string;
}> = ({ checked, onChange, label, hint, id }) => (
  <div className="flex items-start gap-3">
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 ${
        checked
          ? 'border-brand-line bg-brand'
          : 'border-line bg-surface-3'
      }`}
    >
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-plate transition-[left] duration-200 ${
          checked ? 'left-[23px]' : 'left-[3px]'
        }`}
      />
    </button>
    <div className="min-w-0">
      <label
        htmlFor={id}
        className="block text-[12px] font-semibold text-text"
      >
        {label}
      </label>
      {hint && <p className="text-[11px] leading-snug text-text-3">{hint}</p>}
    </div>
  </div>
);

/* ==========================================================================
   Empty state
   ========================================================================== */

export const EmptyState: React.FC<{
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}> = ({ icon, title, body, action }) => (
  <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-surface-2 text-text-3">
      {icon}
    </div>
    <h3 className="text-[15px] font-bold text-text">{title}</h3>
    <p className="max-w-[46ch] text-[13px] leading-relaxed text-text-2">
      {body}
    </p>
    {action && <div className="mt-1">{action}</div>}
  </div>
);

/* ==========================================================================
   Definition pair — the certificate's field/value unit.
   ========================================================================== */

export const Detail: React.FC<{
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}> = ({ label, children, mono = false }) => (
  <div className="min-w-0">
    <dt className="rule-head mb-0.5">{label}</dt>
    <dd
      className={`truncate text-[12px] font-semibold text-text ${
        mono ? 'font-mono tabular-nums' : ''
      }`}
    >
      {children}
    </dd>
  </div>
);
