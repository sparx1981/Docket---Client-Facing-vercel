# Design

Records the visual system as built. Written from the shipped code, not from
intention. Direction seed `6ad83b60`; the full contract sits as an HTML comment
at the top of `<body>` in `index.html` and survives the production build.

## The world

**The Docket.** Every selection is a certificate of analysis rather than a tip.
The product's real mechanism is the mandatory secondary recalculation — each
aggregate re-derived from raw itemised match records and published with its
divergence — so the surface is built as a document that can be audited: ruled
plates, stamped verdicts, serial numbers, seals.

Two things this refuses on purpose: the neon-on-near-black sportsbook dashboard,
and its predictable opposite, the flat grey trading terminal.

## Colour

Semantic roles only. There are no raw swatches in component code — every
colour is a token (`src/index.css`), mapped into Tailwind's namespace via
`@theme inline`. Single theme today (see **Theming mechanics** below) — the
table has one column, not two.

| Role | Value | Used for |
|---|---|---|
| `bg` | `#f2f3f5` | Page ground |
| `surface` | `#ffffff` | Plates, rail, topbar |
| `surface-2` | `#f7f8f9` | Plate headers, inputs, inner blocks |
| `surface-3` | `#eceef1` | Track fills, hover |
| `line` / `line-strong` | `#e1e3e8` / `#c5c9d1` | Every rule and border |
| `text` / `text-2` / `text-3` | `#14161a` / `#494e57` / `#6a6f79` | Primary / secondary / helper |
| `brand` | `#0a8a3f` | Rail active state, links, primary structure |
| `brand-ink` | `#06622c` | Brand as *text* |
| `cta` | `#ffc629` | The one primary action per screen ("Run Daily Scan") |
| `seal` | `#8a6a15` | The pressed seal, ornament only |

A sportsbook-green brand with a gold CTA — deliberately in the reference
class `PRODUCT.md` names (Ladbrokes/Paddy Power/Sky Bet/William Hill) rather
than avoiding it. Each role has `-ink` (text-safe), `-soft` (fill) and
`-line` (border) variants; the CTA additionally has `-hover`.

**Verdict palette — outcome and nothing else.** `ok` (`#1e9e4a`, green) = won
/ pass / verified. `bad` (`#d32f2f`, red) = lost / fail. `warn` (`#d9770a`,
amber) = pending / price watch / enhanced verification. `info` (`#0b7ba8`,
teal) = independent confirmation.

`ok` and `brand` are both green and sit close enough on a page that a glyph
is not optional here — see the second rule below. Given the brand is now
tied to the "modern UK betting product" identity in `PRODUCT.md`, this is a
deliberate trade accepted for that fit rather than an oversight; if it ever
reads as ambiguous in practice, resolve it by moving `ok` rather than
`brand`.

The one rule that still drives real decisions:

**Colour never carries meaning alone.** Every verdict ships a glyph —
`Check`, `X`, `Clock`, `Minus`. `OutcomeBadge` is a single component so the
glyph and wording cannot drift between the archive table, the mobile slips
and the drawer.

Use `-ink` for text and `-soft`/`-line` for surfaces; the solid token as
small text risks failing contrast.

### Contrast

Not independently re-measured against the current palette. An earlier
revision of this file gave specific pass/fail numbers, but they were
measured against a different, since-replaced set of token values — repeating
them here would misrepresent the current palette, so they've been removed
rather than left in. `text-3` is the token most worth re-checking if this
matters to you: it carries all helper copy at 10–11px, which is normal text
under WCAG (needs ≥4.5:1), not large text's lower 3:1 bar.

## Typography

**Archivo** for UI, **Azeret Mono** for every measured figure. Both loaded from
Google Fonts with a full system fallback stack in `--font-sans` / `--font-mono`.

Mono is not a costume here: it is reserved for data and measurement — odds,
market IDs, audit IDs, volumes, timestamps, scores. Prose never uses it.
`font-variant-numeric: tabular-nums` is applied globally to mono, tables and
number inputs so odds do not jitter between re-renders — a figure that shifts
width on update reads as instability in a product whose whole claim is
integrity.

`rule-head` is the ledger column head: 10px, 700, `0.1em` tracking, uppercase,
`text-3`. It is the single label style across every table, plate and definition
list.

## Structure

**`Plate` is the only container.** Plates never nest. Inner divisions are drawn
with hairline rules (`divide-line`, `border-line`), not with a second card.
This is why the analytics KPIs are one ruled four-cell plate rather than four
floating cards.

- **Desktop (`lg+`)**: 248px fixed left rail — brand header, nav with live
  counts, standing win-rate/ROI readout with the scheduled scan time. Sticky
  ruled topbar carries the page title, last-scan state and the primary
  action. The seal mark (`SealMark`) appears in the scan modal and the
  verification drawer, not the rail.
- **Below `lg`**: rail collapses to a 4-item bottom tab bar (58px targets,
  `env(safe-area-inset-bottom)`), and every table becomes a stack of docket
  slips. Tables are not horizontally scrolled on phones.
- **Drawer**: full-width to `max-w-2xl`, Escape closes, body scroll locks.

## Motion

One authored moment: **the stamp landing**. `d-stamp` scales in from 1.5 with a
rotation, overshoots to 0.94, settles at 1.0. The settle lives in the keyframes;
the easing is exponential ease-out (`cubic-bezier(0.16, 1, 0.3, 1)`), never an
elastic curve.

Supporting motion is limited and consistent: `d-file-in` (rows arriving, clipped
from the top like a sheet being filed, capped at 8 × 40ms stagger), `d-slide-in`
(drawer), `d-veil` (backdrop with `backdrop-filter`), `d-lift` (dialogs),
`d-pulse-ring` (price-watch promotion marker), `d-sweep` (log streaming).

All content is visible by default; motion only refines arrival.
`prefers-reduced-motion: reduce` collapses every animation and transition to
0.01ms.

## Browser surfaces

Themed rather than left to the platform: text selection, caret colour,
scrollbars (both `scrollbar-color` and `::-webkit-scrollbar`), `:focus-visible`
rings at 2px/2px offset, `accent-color` on native checkboxes and radios,
placeholder colour, and `text-underline-offset`.

## Theming mechanics

Light theme only, currently. Semantic variables are declared once on `:root`
in `src/index.css` and mapped into Tailwind's namespace with `@theme inline`
so utilities compile to `var(--d-*)` — that indirection is what makes adding
a second theme later a matter of adding one more block of variable overrides,
not a rewrite of every component. `color-scheme: light` is set to match.

`src/theme.tsx` still exists (a `ThemeProvider`, `useTheme`, and an unused
`ThemeToggle` component) but every method on it is hardcoded to `'light'` —
`setTheme`/`toggleTheme` ignore their argument, and `ThemeToggle` is not
rendered anywhere in the app. Treat this as inert scaffolding from an earlier
two-theme iteration, not a half-built feature to finish reflexively — confirm
intent before wiring it back up or deleting it.

## Conventions

- Colour tokens only; no `zinc-*`/`emerald-*` or hex values in components.
- Interactive targets: 34px minimum, 44px in dialogs and on mobile.
- Every form control has a visible `<label>`; placeholders are examples, never
  labels. `Field` enforces label-above, hint-below.
- Transitions 150–300ms.
- Icons: lucide-react only, `strokeWidth` 2–2.5 for UI and 3–3.5 for verdict
  glyphs. No emoji, no unicode glyphs standing in for icons.

## Constraints inherited from the product

- The Betfair **Exchange-only** exclusion is stated in the UI (topbar rail,
  qualifiers plate header, settings) and must stay visible.
- Provider state (which of Sportradar / Sportmonks served a fixture) is a
  persistent banner, not a toast — the operator's trust in a number depends
  on knowing its source. There is no premium/fallback tier distinction.
- Enhanced Verification is distinguishable at a glance in list and detail.
- Fixture, results and team/player stats are pulled live from Sportradar and
  Sportmonks. Betfair Exchange odds/liquidity are not yet integrated (a
  separate phase) — the UI states this plainly rather than showing a number.

## Verification

Confirmed in a real browser via the Playwright suite (`e2e/`, `npm run
test:e2e`) — navigation, collapsible sections, the Price Watch popover,
CSV export, and the full mocked-provider workflow all run against actual
rendered output, not just static analysis. That suite doesn't do pixel-level
visual regression, so a layout or contrast change subtle enough to not break
an assertion could still slip through — re-run `npm run dev` and look before
treating a visual change as final.
