# Automated Sports Selection Engine

Rules-based daily selection engine for three locked systems — Football Over 1.5
Goals, Football Under 3.5 Goals, and Tennis Straight-Sets — with a mandatory
raw-evidence verification audit on every candidate.

## Run it

The app is two parts: a Vite frontend and a small Express backend
(`server/`) that proxies real Sportradar/Sportmonks calls so a provider key
never has to leave the browser toward a third-party origin (and CORS never
bites). One command runs both:

```bash
npm install
npm run dev      # frontend http://localhost:3000, backend http://localhost:8787
npm run build    # production build to dist/
```

`npm run dev` runs `dev:web` (Vite) and `dev:server` (`tsx watch server/index.ts`)
together via `concurrently`; run either alone if you'd rather use two
terminals. Vite proxies `/api/*` to the backend in dev (see `vite.config.ts`),
so the frontend always calls relative `/api/...` paths.

Requires Node 18+. Fonts (Archivo, Azeret Mono) load from Google Fonts at
runtime, so the first render needs a network connection.

To pull real data, open **Engine Configuration** and paste a Sportradar
and/or Sportmonks API key — the key is stored in this browser's
`localStorage` (same as before) and sent to our own backend per request via
an `x-provider-key` header; the backend forwards it to the real provider
server-to-server and never stores it itself.

## What's here

| Path | |
|---|---|
| `server/index.ts` | Express app — REST endpoints the frontend calls (see below) |
| `server/providers/` | One client per provider (Sportradar Soccer, Sportradar Tennis, Sportmonks), each normalizing into the app's domain types |
| `src/index.css` | Design tokens, both themes, base styles, motion |
| `src/theme.tsx` | Theme provider, persistence, toggle |
| `src/components/ui.tsx` | Shared primitives (Plate, Chip, Stamp, PriceTag, Field…) |
| `src/components/AppShell.tsx` | Rail, topbar, mobile tab bar, seal mark |
| `src/services/dataFeed.ts` | Builds real candidate fixtures from the backend, run through `rulesEngine.ts` |
| `src/services/historyBackfill.ts` | One-shot backfill of real settled results into the Archive on first run |
| `src/services/` | Rules engine, verification engine, storage, scheduler |
| `DESIGN.md` | The visual system as built |
| `PRODUCT.md` | Product truth — users, purpose, constraints |

### Backend endpoints

All under `/api`, all requiring an `x-provider-key` header (400 without one):

- `GET /football/fixtures?date=&provider=sportradar|sportmonks`
- `GET /football/team/:teamId?provider=`
- `GET /football/h2h?team1=&team2=&provider=`
- `GET /football/results?from=&to=&provider=` — completed matches, for settlement + backfill
- `GET /tennis/fixtures?date=` / `/tennis/player/:playerId` / `/tennis/h2h?player1=&player2=` / `/tennis/results?from=&to=` (Sportradar only — Sportmonks has no tennis coverage)
- `GET /health` — no key required

A provider failure comes back as a 502 with the upstream status/message —
never a 200 with placeholder data.

## Server-side daily scan (Vercel Cron)

`vercel.json` schedules `GET /api/cron/daily-scan` daily at 06:00 UTC, so the scan runs even when nobody has the app open (the in-browser scheduler only fires while a tab is open and remains as a catch-up fallback). For each user with the scheduled scan enabled and a TheStatsAPI key saved, it runs the same scan + verification code as the app, appends a sync log, auto-archives qualifiers, and caches the classified fixtures so they appear on next login.

Required Vercel environment variables:

- `CRON_SECRET` — any long random string; Vercel sends it as a Bearer token and the endpoint refuses to run without it.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — the full JSON of a Firebase service-account key for the project (Firestore rules only allow signed-in users to read their own data, so the server needs admin credentials).

A user is skipped if their last scan was under 20 hours ago. The cron time is set in `vercel.json` (Hobby plans allow one run per day).

## Views

- **Today's Docket** — selections that cleared every locked filter and the price threshold
- **Price Watch** — statistically clean, held until the exchange reaches the required price
- **Archive & Performance** — settled results, per-system ROI, cumulative profit curve
- **Engine Configuration** — providers, exchange credentials, scan schedule, staking

Each selection opens a verification certificate: audit serial, integrity score,
exchange market validation, the secondary recalculation table, a
filter-by-filter breakdown, and the itemised raw evidence behind it.

## Note on data

Fixture, results, team-stat and ranking data comes from real Sportradar
and/or Sportmonks calls (whichever key is configured), proxied through
`server/`. With no key configured, or on a provider failure, the app shows
a genuine empty state and a real error message rather than any fabricated
data — nothing here is synthetic.

**Betfair Exchange odds are not implemented yet** (phase 2 — it needs a
certificate-based login flow, tracked separately). Every candidate that
clears the statistical rules is held in Price Watch showing "Not yet
connected — exchange odds integration pending" instead of a price; nothing
can reach Verified Qualifiers until a real exchange price is wired in.
