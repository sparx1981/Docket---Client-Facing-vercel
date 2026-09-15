# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A single private operator (owner-user) running a rules-based sports selection
system for themselves. They open the app once daily, usually shortly after the
scheduled UTC scan, on desktop at a desk and on a phone away from it. Their job:
see which fixtures passed today's locked filters, inspect the raw evidence behind
each one before committing money, and record/settle outcomes afterwards. They are
numerate and domain-fluent — they read decimal odds, exchange liquidity and
head-to-head tables without explanation.

## Product Purpose

Automates a fixed, pre-committed betting methodology so the operator never has to
re-derive it by hand or trust a black box. Three locked systems: Football Over 1.5
Goals (System A), Football Under 3.5 Goals (System B), and Tennis Straight-Sets.
A daily scan ingests the fixture pool, applies the locked filters, then runs a
mandatory verification audit that independently recalculates every aggregate from
raw itemised match records. Success means the operator can act on a selection with
the audit trail in front of them, and can see whether the systems are actually
profitable over time.

## Positioning

Not a tipster feed and not a generic dashboard. The differentiating mechanism is
the mandatory secondary recalculation: every aggregate shown is re-derived from
itemised raw match evidence and reported with a divergence figure, alongside an
independent Google fixture confirmation link. The product's claim is auditability
— nothing is asserted that the operator cannot open and check.

## Capabilities

- Manual and scheduled (daily UTC cron) scan with live step/log progress
- Verified Qualifiers: selections that passed both filters and the price threshold
- Price Watch: selections that passed all statistical filters but sit below the
  required decimal price; monitored for odds drift
- Verification drawer per selection: audit metadata, integrity score, Betfair
  Exchange market validation, secondary recalculation table, filter-by-filter
  breakdown, itemised H2H / recent-form evidence, copy-to-clipboard audit summary
- Historical archive: log, settle (Won/Lost/Void), P&L, cumulative profit curve,
  per-system performance breakdown
- Settings: premium and fallback data provider keys, Betfair Exchange credentials,
  scan schedule, email notification routing, default stake, currency

## Constraints and Terminology

- Betfair **Exchange** only; Sportsbook fixed-odds markets are strictly excluded.
  This exclusion is stated in the UI and must remain visible.
- Provider state (which of Sportradar / Sportmonks actually supplied a given
  fixture) must be persistently visible — the operator's trust in a number
  depends on knowing where it came from. There is no "premium" tier and no
  "fallback" tier: both are real, equally-weighted providers, and Flashscore
  / Tennis Abstract keys in Settings are inert placeholders reserved for a
  future integration, not a currently-used data source.
- "Enhanced Verification" is a real state, triggered once a fixture's exchange
  odds cross the threshold configured for its system in Engine Configuration →
  Filter Thresholds (defaults: Over 1.5 above 1.25, Tennis Straight-Sets at or
  above 1.50) — must be distinguishable at a glance in lists and detail.
- The three systems' pass/fail thresholds are user-configurable per-operator
  in Engine Configuration → Filter Thresholds (not hardcoded); each system can
  also be individually disabled. What is locked is the *shape* of each rule
  (which factors it checks) — the UI never lets the operator add, remove, or
  reorder a filter, only tune its numeric bar and on/off state. Any UI that
  describes a threshold value must read it from that live configuration, never
  restate a fixed number.
- Domain vocabulary to preserve: Verified Qualifier, Price Watch, Audit Card,
  Integrity Score, Divergence, Matched Volume, Required Odds, Deficit, Settle.
- Fixture and season/H2H/form stats are pulled live from Sportradar and
  Sportmonks via the project's own backend proxy (`server/`) — real data, not
  synthetic. Betfair Exchange odds/liquidity are the one exception: that
  integration doesn't exist yet (a separate certificate-based login flow), so
  `betfairMarket` is genuinely absent on every fixture today and the UI must
  keep saying so plainly rather than showing a placeholder number.

## Stack

Existing: React 19, TypeScript, Vite 6, Tailwind CSS v4 (`@tailwindcss/vite`),
lucide-react icons, `motion` available. localStorage persistence. No router —
tab state is local. Must remain buildable with `npm run dev` / `npm run build`.

## Accessibility

Dark and light themes are both required (user-confirmed). Colour must never be
the only carrier of outcome meaning — Won/Lost/Pending, Pass/Fail and
Verified/Deficit all need a non-colour cue.

## Brand commitments

User-confirmed: the surface should read like a modern UK betting product
(Ladbrokes, Paddy Power, Sky Bet, William Hill are the reference class) but must
carry its own identity rather than imitate any one of them.
