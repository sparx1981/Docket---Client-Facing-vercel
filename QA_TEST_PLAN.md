# QA Test Plan — Automated Sports Selection Engine

Scope: verify every user-facing workflow behaves correctly, and that every
piece of user-facing messaging is truthful — reflects real application state,
never a hardcoded/fabricated claim. This plan was produced alongside a
hardening pass that found and fixed several real defects (listed under
**Defects found & fixed** below); the automated suite exists specifically to
keep them fixed.

## How to run

```bash
npm run lint            # TypeScript type-check
npm run test:truthfulness  # static guard against known fabricated-copy regressions
npm run test:e2e        # Playwright end-to-end suite (starts the Vite dev server itself)
npm run test            # all three, in order
```

`test:e2e` only starts the frontend (`dev:web`); tests that need the backend
mock `/api/*` via `page.route()` rather than requiring the real backend or a
real Sportradar/Sportmonks key (see **Known limitation**, below).

## Automated coverage (Playwright, `e2e/`)

| File | Covers |
|---|---|
| `empty-state.spec.ts` | Fresh install (no keys, no localStorage): no console/page errors; provider banner says "Not configured" honestly (never a fake success); Verified Qualifiers, Price Watch and Archive log all show real empty states pointing at Engine Configuration; CSV export is disabled with nothing to export. |
| `engine-configuration.spec.ts` | All four Engine Configuration sections start collapsed; each expands/collapses independently; the local-storage disclosure callout is present; Sportradar/Sportmonks/Betfair fields link to their real key-management pages (and Flashscore/Tennis Abstract, which have no real API, get no fabricated link); Filter Threshold defaults match the documented product spec; editing and saving a threshold persists across reload; disabling a system persists and is reflected live in the Price Watch popover, the Verified Qualifiers info modal, and the Archive & Performance "Odds" column tooltip — every surface that describes a threshold, not just one of them. |
| `csv-export.spec.ts` | Export button state tracks whether there's anything to export; the downloaded file has the right name pattern, header row, and contains the real seeded row's data; the export respects the on-screen Won/Lost/Pending filter. |
| `mocked-provider-flow.spec.ts` | End-to-end proof the real pipeline works: configuring a provider key → backend call → rules engine → UI, using a mocked backend shaped exactly like `server/index.ts`'s real contract. Confirms a fixture that clears every statistical filter lands in Price Watch (not Verified Qualifiers, since Betfair odds aren't connected yet) rather than skipping the odds gate; confirms the audit drawer shows the real provider that supplied the fixture; confirms an upstream HTTP failure (401) is surfaced to the user rather than swallowed or replaced with fake data. |

## Static guard (`scripts/check-fake-copy.mjs`)

Scans `src/` and `server/` for the exact symbols/phrases behind every
previously-real fabricated-data defect in this repo's history (the 250-row
synthetic archive generator, fake demo API keys, "responding at 98ms",
the Premium/Fallback sourcing fabrication, "Rules locked", the fabricated
filter-condition numbers). Fails the build if any reappear. This is a
regression net for exactly-once-fixed defects, not a general banned-word
linter — extend the list whenever a new instance of this defect class is
found.

## Defects found & fixed during this pass

1. **Fabricated provider sourcing.** The Verification Drawer's "Sourcing"
   field showed "Premium (direct)" / "Fallback (B2B)", derived from a stale
   helper that checked an inert settings field left over from before real
   API integration existed — coincidentally often correct, never actually
   true. Fixed: each fixture now carries the real provider that built it
   (`sourceProvider`), and the drawer shows that directly ("Sportradar" /
   "Sportmonks").
2. **Fabricated filter-condition copy.** The Price Watch "Screening Filter
   Conditions" popover and the Verified Qualifiers info-modal criteria list
   both showed hand-written numbers (e.g. "≥75% of last 8 domestic matches",
   "expected goals rate ≥2.40") that never matched `rulesEngine.ts` — and
   would have silently drifted from reality the moment thresholds became
   configurable. Fixed: both now render live from `AppSettings.ruleThresholds`.
3. **Broken click-to-open popover.** The filter-conditions popover used both
   `onMouseEnter`(open)/`onMouseLeave`(close) and an `onClick` *toggle* on the
   same element. A mouse click fires `mouseenter` first (opening it), then
   the click handler's toggle immediately closed it again — click could
   never actually open the popover, only hover could. Fixed: click now sets
   it open (idempotent) instead of toggling, restoring click/touch/keyboard
   access without breaking hover.
4. **Unguarded concurrent actions.** "Pull Historical Results", "Auto-Settle
   Concluded Results", and "Trigger Background Auto-Scan Now" each
   read-then-write `localStorage` with no re-entrancy guard — a rapid
   double-click could fire two overlapping calls and silently drop one
   write. Fixed: each now has a busy-state guard and a disabled/loading
   button state. The 30-second scheduled-scan poll got the same fix, since a
   real network scan can now take longer than 30 seconds.
5. **Stale product documentation.** `PRODUCT.md`/`DESIGN.md` still asserted
   "synthetic demonstration data" and a "Premium direct vs B2B Fallback"
   provider model — both false since the real Sportradar/Sportmonks
   integration landed, and actively responsible for defect #1. Updated to
   describe the real (Sportradar/Sportmonks, no tier distinction,
   Betfair-not-yet-connected) state, and to note that filter thresholds are
   now configurable rather than "locked."
6. **Same broken click-to-open bug, second instance.** The Archive &
   Performance table's column-header tooltips (`ArchiveColumnTooltip`,
   covering Odds/Score/Outcome) had the identical hover-vs-click-toggle
   conflict as defect #3, independently implemented. Fixed the same way.
7. **A fourth place with the same fabricated filter-condition copy.** The
   Archive & Performance "Odds" column tooltip hardcoded "Over 1.5 ≥1.15,
   Under 3.5 ≥1.20, Straight Sets ≥1.20" — the same class of bug as defect
   #2, just not caught in that pass because it lives in a different
   component (`AnalyticsView.tsx`, not `PriceWatchTable.tsx` or
   `SectionInfoModal.tsx`). Fixed to render live from
   `AppSettings.ruleThresholds`, and also fixed the Verified Qualifiers info
   modal to show "Currently disabled" (not a stale number) when a system is
   turned off — it previously only handled the enabled case correctly.
8. **No path to actually get an API key.** Engine Configuration asked for
   Sportradar/Sportmonks/Betfair credentials but gave no link to where a
   user obtains or manages one. Added a "Get a key" link on each real
   provider's field pointing at that provider's actual developer portal
   (Sportradar, Sportmonks, Betfair) — and deliberately did *not* add one to
   Flashscore/Tennis Abstract, since neither has a real API or key-issuing
   process to link to; inventing one there would be exactly the kind of
   placeholder this whole pass exists to remove.

## Manual test cases (cannot be automated in this environment)

These require state this sandbox cannot produce (a real provider
subscription, or hours of elapsed wall-clock time) and should be run by a
human before/after connecting a real key:

| # | Test | Steps | Expected |
|---|---|---|---|
| M1 | Real Sportradar key, football | Paste a real Sportradar key into Engine Configuration, save, open Verified Qualifiers/Price Watch | Real upcoming fixtures appear with real team names/competitions; no fixture shows a fabricated number; any field the provider didn't return is either absent or clearly marked, never invented |
| M2 | Real Sportmonks key, no Sportradar key | Same as M1 with only a Sportmonks key configured | Football fixtures load from Sportmonks; Tennis tab shows an honest "Tennis fixtures require a Sportradar API key" message, not an empty-with-no-explanation state |
| M3 | Invalid/expired key | Paste an invalid key, save | Provider banner shows "Provider error" with the real upstream error message (e.g. 401), not a generic failure or fabricated data |
| M4 | Historical backfill | With a real key and an empty Archive, load the app for the first time | Archive backfills with genuine completed matches from the last 30 days, each priced at its system's disclosed minimum (not a real historical exchange price — the row's notes say so) |
| M5 | Scheduled scan over a real day boundary | Leave the app running with `scheduleEnabled` on across the configured UTC scan time | Exactly one scan fires at/after the scheduled time (not zero, not a double-fire from the 30s poll racing itself) |
| M6 | Auto-settlement | Let a real logged fixture's match time elapse | The bet auto-settles from a real fetched result on the next scan, not a hardcoded outcome table (the old `KNOWN_OFFICIAL_RESULTS` this replaced) |
| M7 | Theme toggle × both themes | Toggle light/dark, revisit every tab and the drawer | No verdict/status relies on color alone (glyphs present); contrast holds in both themes per `DESIGN.md` |
| M8 | Mobile viewport, full workflow | Resize/emulate a phone viewport, repeat the core workflow (browse → drawer → settings → archive → export) | Bottom tab bar replaces the rail; tables become docket-slip stacks per `DESIGN.md`; CSV download still works on mobile Safari/Chrome |
| M9 | Betfair fields | Enter Betfair AppKey/session token in Settings | UI still says "not yet connected — phase 2" everywhere; entering credentials must not cause any screen to start claiming a live exchange price (there is no real integration to back that claim yet) |

## Known limitation

No real Sportradar/Sportmonks/Betfair credentials exist in this environment,
so nothing here has been validated against a live provider response. The
mocked-backend test proves the *pipeline* (fetch → parse → rules engine →
UI) is correct against the *documented* contract; it cannot prove the
documented contract matches what the real API actually returns. Re-run M1–M4
above the first time a real key is available, and adjust
`server/providers/*.ts` field-mapping if anything doesn't line up.
