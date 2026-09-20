# Portfolio Manager — Architecture & Reference

> **License:** MIT — see [LICENSE](LICENSE) for details.
>
> This app is entirely vibe-coded and comes with no guarantees of correctness, accuracy, or fitness for any purpose. It was built as a personal replacement for an Excel sheet and is shared as-is. Do not rely on it for financial decisions.
>
> Issues and pull requests may not get attention. I may get around to addressing them if and when I have time.

## Planned Features

- Tax-loss harvesting opportunity detection
- Crypto portfolio support — spot, dated futures, perpetuals, and options
- Automated scraping of mutual fund factsheets and portfolio disclosures

## Overview

A self-hosted portfolio tracker for Indian investors. Imports trades from Zerodha Kite CSVs, syncs live prices from Kite and AMFI, tracks manual assets (FDs, PPF, NPS, cash), computes FIFO cost basis, XIRR, and portfolio NAV over time, and visualizes allocation by market-cap category.

The frontend is a responsive workspace that follows the operating system's light/dark preference with local system typography, a collapsible sidebar with a mobile sheet drawer below 768px, lazy-loaded routes, contained analytical tables, and privacy masking preserved across desktop and mobile views.

**Stack:** FastAPI · SQLAlchemy (async) · PostgreSQL · Alembic · React 18 (Vite + TypeScript) · Tailwind CSS v4 · shadcn/ui · TanStack Query · lightweight-charts · recharts

---

## Running locally

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| React SPA | http://localhost:5173 |
| FastAPI JSON + SSE | http://localhost:8000 |
| OpenAPI docs | http://localhost:8000/docs |
| pgAdmin | http://localhost:5050 |

**Environment variables** (`.env`):
```
DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@db:5432/portfolio
FRONTEND_URL=http://localhost:5173
KITE_REDIRECT_URL=http://localhost:8000/api/v1/kite/auth/callback
```

### Demo mode

Launch with a fully pre-populated fictional portfolio (no Kite account needed):

```bash
DEMO_MODE=true docker compose up --build
```

On first start the app auto-seeds ~23 instruments, ~70 trades, 2 years of price/NAV history for 11 indices (Nifty 50, Nifty 500, Bank, IT, Pharma, Auto, FMCG + breadth indices), MF scheme breakdowns, manual assets, allocation targets, and USDINR rate. Kite integration is disabled. A **Reset Demo Data** button on the Settings page re-seeds from scratch without a restart.

To refresh the fixture data (e.g. to extend the date range):
```bash
source venv/bin/activate
python scripts/fetch_demo_data.py
```

---

## Directory Layout

```
portfolio-mac-arm/
├── app/
│   ├── main.py                  # FastAPI app, CORSMiddleware, lifespan (alembic upgrade + demo seed), router registration
│   ├── config.py                # Pydantic settings (.env): DATABASE_URL, FRONTEND_URL, Kite keys, DEMO_MODE
│   ├── demo_seed.py             # Demo data seed: instruments, trades, holdings, price/NAV history, MF breakdown, manual assets
│   ├── database.py              # AsyncEngine + AsyncSession (postgresql+asyncpg)
│   ├── time_util.py             # IST timezone helper (now_ist)
│   ├── schemas/                 # Pydantic response models (mirrored as TS types in frontend/src/types/)
│   │   ├── portfolio.py
│   │   ├── trades.py
│   │   ├── kite.py
│   │   ├── manual_assets.py
│   │   ├── mf.py
│   │   └── settings.py
│   ├── models/
│   │   ├── __init__.py          # Re-exports all models (for Alembic / metadata)
│   │   ├── instrument.py        # Instrument — master security record
│   │   ├── trade.py             # Trade — immutable buy/sell ledger
│   │   ├── holding.py           # Holding — current FIFO position per instrument
│   │   ├── price_history.py     # PriceHistory — daily OHLC from Kite
│   │   ├── nav_history.py       # NavHistory — daily NAV from mfapi.in / AMFI
│   │   ├── kite.py              # KiteConfig (singleton) + KiteSyncLog
│   │   ├── import_log.py        # CSVImportLog — per-batch import metadata
│   │   ├── manual_asset.py      # ManualAsset — FD / PPF / NPS / Cash / USD_CASH / FOREIGN_EQ
│   │   ├── mf_breakdown.py      # AmfiMarketCap + MfSchemeBreakdown + EquityCategoryOverride + EquitySectorOverride + NseIndustryClassification
│   │   ├── allocation_target.py # AllocationTarget — equity cap allocation targets
│   │   ├── app_config.py        # AppConfig — KV store for cached config (USDINR rate)
│   │   └── nav_tracked_instrument.py
│   ├── routers/                 # All return JSON, SSE stream, file download, or redirect
│   │   ├── portfolio.py         # Holdings table, summary cards, NAV history, OHLC upload, SSE sync
│   │   ├── trades.py            # CSV import, split-credit, import history, trade list
│   │   ├── kite.py              # Kite OAuth, config CRUD, holdings sync
│   │   ├── mf.py                # AMFI NAV sync, mfapi.in historical sync
│   │   ├── mf_breakdown.py      # Ingest OpenFin disclosures, batch classify, chart data
│   │   ├── manual_assets.py     # FD / PPF / NPS / Cash / Foreign equity CRUD
│   │   ├── usdinr.py            # USDINR rate: Kite refresh, manual set
│   │   ├── charts.py            # Price and NAV chart data endpoints
│   │   ├── settings.py          # Danger-zone bulk deletes, DB info
│   │   ├── market_sentiment.py  # GET /api/v1/market-sentiment/summary, /series, /breadth, /sector-trends; POST /refresh-indices
│   │   ├── capital_gains.py     # GET /api/v1/capital-gains/years, /api/v1/capital-gains/{fy}
│   │   └── demo.py              # GET /api/v1/status, POST /api/v1/demo/reset
│   └── services/
│       ├── csv_importer.py      # Multi-format CSV parser (Kite legacy/current, generic)
│       ├── holdings_engine.py   # FIFO recompute from trades
│       ├── instrument_registry.py # Smart dedup: ISIN → symbol+exchange → fuzzy bond match, symbol aliases
│       ├── kite_client.py       # Async Kite API wrapper (OAuth, holdings, OHLC)
│       ├── kite_sync.py         # Kite holdings/positions ingest + reconciliation
│       ├── kite_historical.py   # Equity OHLC history fetch (windowed, incremental, SSE progress)
│       ├── kite_reconcile.py    # Local ↔ Kite quantity validation
│       ├── amfi_nav.py          # AMFI daily NAV feed → MF last_price
│       ├── mfapi_nav.py         # mfapi.in historical NAV per scheme → nav_history table
│       ├── mf_ingest.py         # AMFI xlsx parse + OpenFin disclosure ingest, company-name normalisation
│       ├── allocation.py        # Category/asset-class totals, targets, comparison, rebalance plan
│       ├── composition.py       # Per-category/sector composition, per-scheme breakdown, manual taxonomy overrides (any of the four NSE levels, cascading up the hierarchy)
│       ├── manual_assets.py     # FD FV calc, manual assets summary (incl. FOREIGN_EQ → INR conversion)
│       ├── usdinr.py            # USDINR rate: fetch from Kite CDS near-month FUT, persist, read stored rate
│       ├── manual_ohlc.py       # Manual OHLC CSV upload for delisted stocks
│       ├── nav_history.py       # Day-by-day portfolio value reconstruction
│       ├── policy_tracker.py    # 15 trigger evaluators across 7 sections; returns section/trigger tree
│       ├── market_indicators.py  # Pure indicator functions: EMA/SMA, RSI (Wilder's), MACD, ADX, ATR, Bollinger, drawdown, vol
│       ├── market_sentiment.py   # Composite trend/vol/divergence + get_sentiment_summary/get_sentiment_series/get_market_breadth/get_sector_trends; one shared 3-signal trend model (_trend_short/_trend_mid/_trend_long) used by both the summary card and the sector table
│       ├── capital_gains.py      # FIFO matching, Indian tax rules (FY 2020-21+), CII indexation, §112A grandfathering + exemption
│       └── xirr.py              # Newton-Raphson XIRR (per-holding + portfolio)
├── frontend/
│   ├── Dockerfile               # node:20-alpine, Vite dev server
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── components.json          # shadcn CLI config (style new-york, base colour neutral)
│   └── src/
│       ├── main.tsx             # QueryClientProvider, PrivacyProvider, BrowserRouter, sonner Toaster
│       ├── App.tsx              # Routes (13 pages under AppLayout)
│       ├── api/                 # Typed fetch client + per-domain React Query hooks
│       │   ├── client.ts        # request<T>() wrapper; VITE_API_BASE_URL
│       │   ├── portfolio.ts
│       │   ├── trades.ts
│       │   ├── kite.ts
│       │   ├── mf.ts
│       │   ├── mfBreakdown.ts
│       │   ├── manualAssets.ts
│       │   ├── charts.ts
│       │   ├── settings.ts
│   │   ├── marketSentiment.ts # useSentimentSummary(index), useSentimentSeries(days, index), useMarketBreadth(), useSectorTrends(), useRefreshIndicesMutation()
│       │   ├── capitalGains.ts  # useCapitalGainsYears(), useCapitalGains(fy)
│       │   └── status.ts        # useAppStatus(), useResetDemoMutation()
│       ├── types/               # TS interfaces mirroring app/schemas/ 1:1
│       ├── components/
│       │   ├── ui/              # shadcn/ui primitives — CLI-managed, never hand-edited
│       │   ├── AppLayout.tsx    # shadcn Sidebar shell + top bar (13 routes)
│       │   ├── AppSidebar.tsx   # Nav groups/links; badge on Policy when actions pending
│       │   ├── PageHeader.tsx   # Shared route title, metadata, and action layout
│       │   ├── Section.tsx      # Semantic content surface (border + card background)
│       │   ├── MetricCard.tsx   # Dashboard and summary metric surface
│       │   ├── EmptyState.tsx   # Selector-driven route empty state
│       │   ├── ConfirmActionButton.tsx # Confirmed destructive action control (shadcn Dialog)
│       │   ├── DonutChart.tsx   # recharts Pie/Cell, category/sector color maps, custom legend
│       │   ├── LwChart.tsx      # lightweight-charts wrapper — area/candle/line, drag-resize, persisted height
│       │   ├── DataTable.tsx    # Sortable table with optional section headers and heatmap cells
│       │   ├── SsePanel.tsx     # Spinner + scrolling log + result area; driven by useSse
│       │   ├── InfoPopover.tsx  # Click-to-open explainer popover; default info-icon trigger
│       │   └── MoneyText.tsx    # ₹ formatted text with colorize/compact/showSign props
│       ├── pages/
│       │   ├── Dashboard.tsx    # Summary cards + holdings table + manual assets CRUD
│       │   ├── NavHistory.tsx   # Portfolio area chart, price sync SSE, OHLC fetch SSE, manual upload
│       │   ├── Breakdown.tsx    # MF breakdown tabs: Overview (asset class + equity allocation), Sector (Macro/Sector/Industry/Basic level selector, manual-classify panel at every level, sub-1% Others clubbing on Basic), Composition
│       │   ├── FundBreakdown.tsx # Per-fund breakdown: autocomplete search, market-cap/asset-class + sector donuts, holdings table
│       │   ├── PolicyTracker.tsx # Policy trigger evaluation: sections, per-trigger rows, detail tables, manual ack
│       │   ├── PriceChart.tsx   # Candlestick chart with trade markers
│       │   ├── NavChart.tsx     # Fund NAV area chart + compare mode (normalised % change)
│       │   ├── Trades.tsx       # Debounced search + paginated trade list
│       │   ├── Import.tsx       # CSV upload, import history, rollback, split-credit
│       │   ├── Kite.tsx         # Config form, OAuth login, token status, one-click sync
│   │   ├── MarketSentiment.tsx # Nifty 50 / Nifty 500 sentiment (persisted toggle): 3-horizon table, flags banner, breadth table + ratio chart, sector trends table (CAGR + vs-benchmark, clickable trend chips), candlestick + overlays, oscillator + volatility panels
│       │   ├── CapitalGains.tsx # Realized gains by FY: FIFO lots grouped by tax bucket, set-off, §112A exemption, attention items
│       │   └── Settings.tsx     # Danger-zone deletes with confirmation modals
│       ├── hooks/
│       │   ├── useSse.ts        # EventSource wrapper: {logs, status, result, start()}
│       │   ├── usePersistentState.ts # localStorage-backed state (chart heights, compare mode)
│       │   ├── useDebouncedValue.ts # Debounced mirror of a value (search boxes, cash inputs)
│       │   ├── usePrivacy.ts    # Privacy hook/context — masks ₹ amounts across the app
│       │   └── PrivacyProvider.tsx # Privacy-mode provider
│       └── lib/
│           ├── format.ts        # inrCompact, inr, pct, heatmapBg, gainColor
│           ├── colors.ts        # CATEGORY_COLORS, sectorColor(), categoryColor(), CHIP_CLASS/chipClass()
│           ├── utils.ts         # cn() — clsx + tailwind-merge, used by every component
│           └── notify.ts        # notify.success/error/info/warning — thin wrapper over sonner's toast
├── alembic/
│   ├── env.py                   # Sync psycopg2 driver, imports app models
│   ├── script.py.mako
│   └── versions/
│       └── 0001_baseline.py     # Full schema + data migrations
├── alembic.ini                  # DB URL set programmatically from app.config
├── data/
│   ├── mf_portfolio_breakdown/  # Drop AMFI xlsx here; scheme holdings come from OpenFin, sector data from NSE — no CSV drop needed
│   └── demo/                    # Committed fixture files for demo seed
│       ├── ohlc/                # <SYMBOL>.json — daily OHLC rows (synthetic)
│       └── nav/                 # <ISIN>.json — daily NAV rows (real, from mfapi.in)
├── scripts/
│   └── fetch_demo_data.py       # One-time script to refresh demo fixture data (Yahoo Finance + mfapi.in)
├── docker-compose.yml           # PostgreSQL 17 + app (uvicorn :8000) + frontend (Vite :5173) + pgAdmin (5050)
├── Dockerfile                   # Backend image
├── requirements.txt
└── .env
```

---

## Designing with v0

The frontend's design tokens in `frontend/src/index.css` are the stock shadcn/ui set, and `components.json` uses the CLI's default aliases — so components generated by [v0 by Vercel](https://v0.dev) drop in with minimal changes:

- Paste generated components into `frontend/src/components/`, never into `frontend/src/components/ui/` — that directory is CLI-managed and gets overwritten by `npx shadcn add`.
- Next.js → Vite substitutions:
  - Delete `"use client"` directives.
  - `next/link` → `import { Link } from 'react-router-dom'`, and swap `href=` for `to=`.
  - `next/image` → plain `<img>`.
  - `next/font` → nothing; the app uses a local system font stack.
  - `@/components/ui/*` imports already resolve via the `@` path alias.
- If a generated component needs a primitive that isn't installed yet, add it with `npx shadcn@latest add <name> --yes` — never hand-write one.
- A v0 theme (a `:root` / `.dark` CSS variable block) can be pasted directly over the corresponding blocks in `frontend/src/index.css`, since the token names match.

---

## Models

### Instrument
Master record for every security (stock, ETF, MF, bond). Key fields: `isin`, `tradingsymbol`, `exchange`, `instrument_type`, `name`, `amfi_scheme_code`, `kite_instrument_token`.

### Trade
Immutable buy/sell ledger entry. Fields: `trade_date`, `trade_type` (BUY/SELL), `quantity`, `price`, `amount`, `brokerage`, `segment`, `source` (CSV_IMPORT / SPLIT_CREDIT / MANUAL), `import_batch_id`. Used for FIFO cost-basis and XIRR.

### Holding
Current position per instrument, derived from trades via FIFO. Fields: `quantity`, `average_price`, `total_cost`, `last_price`, `unrealised_pnl`, `kite_synced`. One-to-one with Instrument.

### PriceHistory
Daily OHLC from Kite historical API. Covers stocks, ETFs, and bonds. Fields: `instrument_id`, `price_date`, `open`, `high`, `low`, `close`. Unique on `(instrument_id, price_date)`.

### NavHistory
Daily NAV from mfapi.in / AMFI. Separate from PriceHistory so ETF market prices and fund NAVs don't collide. Fields: `instrument_id`, `nav_date`, `nav`. Unique on `(instrument_id, nav_date)`.

### KiteConfig
Singleton (id=1). Stores Kite OAuth credentials: `api_key`, `api_secret`, `access_token`, expiry. Managed via the Kite settings page.

### KiteSyncLog
Audit trail for every Kite sync: status (SUCCESS/FAILED/MISMATCH), counts, error message.

### CSVImportLog
Per-batch import metadata: filename, row counts, `errors_json`. `batch_id` enables rollback.

### ManualAsset
Non-traded assets. `asset_type`: FD, PPF, NPS, CASH, USD_CASH, FOREIGN_EQ. FDs have `principal` (cost), `interest_rate`, `start_date`, `maturity_date`, `is_emergency_fund`. PPF/NPS/Cash store `current_value` in INR. USD_CASH stores `current_value` in USD (e.g. INDMoney wallet); the INR equivalent is computed at query time and folded into the cash total. FOREIGN_EQ stores `current_value` (USD market value) and `principal` (USD cost basis); the INR equivalent is computed at query time using the stored USDINR rate.

### AmfiMarketCap
AMFI's semi-annual company → market-cap classification (Large / Mid / Small Cap). Loaded from local xlsx in `data/mf_portfolio_breakdown/`. Fields: `isin`, `company_name`, `name_normalized`, `nse_symbol`, `bse_symbol`, `msei_symbol`, `primary_ticker`, `exchanges`, `categorization`, `sector`, `macro_sector`, `industry`, `basic_industry`, `aliases`. The four sector/industry fields are backfilled by ISIN from `NseIndustryClassification` after every ingest.

### MfSchemeBreakdown
Per-holding breakdown of each MF/ETF scheme. Fetched from the OpenFin disclosure API. Fields: `scheme_isin`, `name`, `holding_type`, `holdings_pct`, `market_value` (INR, fund-level), `category`, `isin` (the holding's own ISIN, from OpenFin), `sector`, `macro_sector`, `industry`, `basic_industry`, `as_of` (disclosure date, shared by all rows for a scheme — compared against the catalog's `latest_as_of` to decide which schemes need refetching; a stale scheme's rows are fully deleted and reinserted, never merged).

### NseIndustryClassification
NSE's four-level industry taxonomy (Macro-Economic Sector → Sector → Industry → Basic Industry), one row per ISIN, fetched from NSE's live quote API. **ISIN is the only identifier used to join classifications to holdings anywhere in this pipeline** — no company-name or ticker matching. Fields: `isin` (PK), `symbol`, `company_name`, `series`, `macro_sector`, `sector`, `industry`, `basic_industry`, `status` (`CLASSIFIED` / `UNCLASSIFIED` / `API_ERROR` / `ISIN_MISMATCH`), `error_message`, `first_seen_at`, `updated_at`. Rows are never deleted — a company's classification is permanent reference data. A `CLASSIFIED` row is never re-fetched; only the other three statuses are retried on the next ingest.

### EquityCategoryOverride
Persists manual market-cap classifications for equity holdings not found in the AMFI list. Keyed by `name_normalized`. Applied automatically on subsequent ingests.

### AllocationTarget
Per-category equity allocation targets. Stores the domestic market-cap targets (Large Cap, Mid Cap, Small Cap — as % of domestic equity) and the `Equity - Foreign` target (as % of total equity).

### AssetClassTarget
Top-level asset class targets: Equity, Debt, Precious Metals — stored as % of invested portfolio. `Equity - Foreign` (% of total equity) is configured here but stored in `AllocationTarget`.

### PolicyTriggerState
Key/value store for Policy Tracker trigger states. Supports `value_bool` (toggle switches), `value_text` (audit notes), `value_num`. `acknowledged_at` is set when a manual-ack trigger is marked done. `key` is unique.

### PolicyTriggerEvent
Audit log of Policy Tracker state changes. Each PUT to the state endpoint appends a row: `trigger_key`, `status`, JSONB `detail` (previous + new values), `created_at`.

### NavTrackedInstrument
Marks MF/ETF instruments imported by ISIN without a corresponding trade. Ensures `sync_nav_history` keeps their NAV up to date.

### AppConfig
Simple key-value table (`key` TEXT PK, `value_json` TEXT) for caching configuration that needs to survive restarts. Currently used to store the USDINR exchange rate fetched from Kite's CDS USDINR futures market, including source and timestamp metadata.

---

## API Endpoints

### Portfolio (`/api/v1/portfolio`)
| Endpoint | Description |
|---|---|
| `GET /direct` | Holdings table (sortable, grouped by type, day change columns) |
| `GET /summary-cards` | Total cost, value, PnL, XIRR, last sync |
| `GET /nav-history` | Portfolio value timeseries `{date, value, invested}` |
| `GET /instruments` | All traded instruments with price row count |
| `GET /sync-price-history/stream` | SSE: Kite OHLC sync with live progress |
| `POST /sync-price-history/cancel` | Halt a running price sync |
| `POST /upload-ohlc` | Manual OHLC CSV upload |
| `GET /fetch-ohlc/stream` | SSE: fetch Kite OHLC for a specific ticker |

### Charts (`/api/v1/charts`)
| Endpoint | Description |
|---|---|
| `GET /instruments` | Instruments with OHLC price data |
| `GET /nav-instruments` | Instruments with NAV data |
| `GET /price/{instrument_id}` | OHLC candles + aggregated trade markers |
| `GET /nav/{instrument_id}` | NAV timeseries + trade markers; ETFs also return `price_history` |

### Trades (`/api/v1/trades`)
| Endpoint | Description |
|---|---|
| `GET /template` | Download CSV template |
| `POST /import` | Upload & process CSVs |
| `POST /split-credit` | Add synthetic BUY for splits/bonus |
| `GET /imports` | Last 20 imports |
| `DELETE /import/{batch_id}` | Rollback import + recompute |
| `GET /` | Paginated trades with search |
| `GET /instruments` | Instruments that have trades |

### Kite (`/api/v1/kite`)
| Endpoint | Description |
|---|---|
| `PUT /config` | Save API key + secret |
| `DELETE /config` | Clear credentials |
| `GET /auth/callback` | OAuth callback → redirect to `${FRONTEND_URL}/kite?login=success` |
| `POST /sync` | Sync holdings + positions |
| `GET /status` | Config + token status, last sync, and the Kite login URL |

### Mutual Funds (`/api/v1/mf`)
| Endpoint | Description |
|---|---|
| `POST /sync-nav` | Update MF prices from AMFI daily feed |
| `POST /sync-nav-history?source=mfapi\|finapi` | Download historical NAV (mfapi.in default, finapi.upvaly.com fallback) |
| `GET /nav-tracked` | List manually tracked funds |
| `DELETE /nav-tracked/{instrument_id}` | Remove tracking entry |

### MF Breakdown (`/api/v1/mf-breakdown`)
| Endpoint | Description |
|---|---|
| `GET /ingest/stream` | SSE: load AMFI xlsx, refresh stale disclosures from OpenFin, then classify held ISINs from NSE. First run classifies ~750 ISINs (~6 min); later runs only query ISINs new to the portfolio. |
| `PATCH /classify-batch` | Manual category override for unmatched equities |
| `GET /chart-data` | Allocation doughnut data |
| `GET /allocation-comparison` | Current vs target allocation with deltas (`?mode=anchored\|free_float`) |
| `POST /allocation-targets` | Save per-category equity targets |
| `GET /asset-class-comparison` | Asset class (Equity/Debt/PM) current vs target |
| `GET /rebalance-plan` | Cash injection needed to zero out allocation drift (`?mode=anchored\|free_float&cash=`) |
| `POST /asset-class-targets` | Save asset class targets (also saves `Equity - Foreign` to `allocation_targets`) |
| `GET /category-composition` | Per-category breakdown by contributing scheme |
| `GET /sector-composition` | Per-sector breakdown (`?level=macro_sector\|sector\|industry\|basic_industry`, defaults to `sector`) |
| `GET /sector-stock-breakdown` | Per-sector individual stock holdings (`?level=` as above) |
| `GET /sector-list` | Selectable values at a taxonomy level (`?level=` as above), unioning what's currently held with NSE's full classified taxonomy |
| `PATCH /sector-classify-batch` | Manual taxonomy fix, `[{name, level, value}]` → `{updated, rows_updated}`; the chosen value cascades up NSE's hierarchy and merges into `equity_sector_override` |
| `GET /schemes` | Schemes with breakdown data |
| `GET /scheme/{scheme_isin}` | Per-fund holding list (with each holding’s NSE macro/sector/industry/basic levels) + market-cap/asset-class and sector summaries |

The per-fund sector view collapses debt, cash, commodities and arbitrage/derivative holdings into a single `Non-Equity` slice, which is why an arbitrage fund's sector donut renders as almost entirely grey.

### Policy Tracker (`/api/v1/policy-tracker`)
| Endpoint | Description |
|---|---|
| `GET /` | Evaluate all triggers; returns section → trigger tree with status, detail, action |
| `PUT /state/{key}` | Update a trigger's persisted state (toggle, ack, text note) |

### Manual Assets (`/api/v1/manual-assets`)
| Endpoint | Description |
|---|---|
| `POST /fd` | Add fixed deposit |
| `POST /ppf` | Upsert PPF |
| `POST /nps` | Upsert NPS |
| `POST /cash` | Upsert cash balance (INR) |
| `POST /usd-cash` | Upsert USD wallet balance (e.g. INDMoney); converted to INR at USDINR rate |
| `POST /foreign-equity` | Add foreign equity holding (USD values) |
| `PUT /foreign-equity/{asset_id}` | Update label, current value, invested value |
| `DELETE /{asset_id}` | Remove asset |
| `GET /` | All manual assets summary |

### USDINR (`/api/v1/usdinr`)
| Endpoint | Description |
|---|---|
| `POST /refresh` | Fetch live rate from Kite CDS USDINR near-month futures |
| `POST /manual` | Override rate manually |

### Status / Demo (`/api/v1`)
| Endpoint | Description |
|---|---|
| `GET /status` | `{demo_mode: bool}` — whether the app is running in demo mode |
| `POST /demo/reset` | Wipe all data and re-seed demo portfolio (only active when `DEMO_MODE=true`) |

### Capital Gains (`/api/v1/capital-gains`)
| Endpoint | Description |
|---|---|
| `GET /years` | Indian FYs (2020-21+) with at least one sell trade |
| `GET /{fy}` | Full FIFO-matched gains for that FY: buckets, lots, set-off, §112A exemption, attention items, intraday footnote |

### Settings (`/api/v1/settings`)
| Endpoint | Description |
|---|---|
| `DELETE /trades` | Clear trades, holdings, import logs |
| `DELETE /price-history` | Clear Kite OHLC price history |
| `DELETE /nav-history` | Clear MF/ETF NAV history |
| `DELETE /mf-breakdown` | Clear breakdown + AMFI classification |
| `DELETE /manual-assets` | Clear manual assets |
| `GET /db-info` | DB host, port, name |

---

## Key Workflows

### Trade Import
Upload CSV → detect format (Kite legacy/current, generic) → normalize columns → validate rows → find/create instruments (by ISIN/symbol, with alias resolution for renamed tickers) → insert trades → recompute FIFO holdings → commit. Rollback via `DELETE /import/{batch_id}`.

### Kite Sync
OAuth login → exchange token (expires 06:00 IST next day) → fetch holdings + positions → find/create instruments → reconcile quantities (block on mismatch) → upsert holdings → log sync.

### MF NAV Update
AMFI daily feed → match MF holdings by ISIN → update `last_price`. Separately: mfapi.in → resolve scheme codes → fetch historical per fund → store in `nav_history`.

### Price History Sync (SSE)
Click "Sync price history (Kite)" → opens EventSource → server acquires async lock (rejects duplicate syncs) → for each stock/ETF/bond: resolve `kite_instrument_token` → fetch full OHLC in 1800-day windows from 2015-01-01 (Kite's earliest available day-candle data) → upsert → stream progress. Backward gap-fill runs automatically if stored history doesn't reach the floor date. A Halt button POSTs to `/sync-price-history/cancel` to stop mid-run. After equity sync, also syncs index instruments (Nifty 50, Nifty Next 50, Nifty 100, Nifty Midcap 150, Nifty Smlcap 250, India VIX) using segment `"INDICES"` — these are created as synthetic instruments in `price_history` without a holding.

### MF Breakdown
"Refresh disclosures" runs three steps in order, all inside one SSE stream (`GET /ingest/stream`):

1. **AMFI sync.** Load the local xlsx → enrich each company's `sector`/`macro_sector`/`industry`/`basic_industry` by ISIN from `nse_industry_classification` → write `company_master.csv`.
2. **OpenFin disclosures.** Fetch the OpenFin catalog (`GET /api/v1/catalog`) → for each held MF/ETF, compare the catalog's `latest_as_of` against the locally stored `as_of`; only funds with a newer disclosure are re-fetched (`GET /api/v1/holdings/{amfi_code}?as_of=...`). A stale scheme's local rows are deleted and reinserted from the fresh disclosure — a full per-scheme replace, never a row-level upsert. Each holding's `market_value` (unit-converted to INR via `meta.market_value_unit`) drives a two-pass re-normalization: total the fund's holdings, then set `holdings_pct = market_value / total × 100`. Each row also records the holding's own `isin`, straight from OpenFin.
3. **NSE classification.** Collect every ISIN held directly or inside a fund → skip any already `CLASSIFIED` → resolve the rest to an NSE symbol via the equity master and fetch the four-level taxonomy → verify the response's ISIN matches the one queried (mismatches are recorded, never applied) → write results to `nse_industry_classification` → backfill the four levels onto `amfi_market_cap` and `mf_scheme_breakdown` by ISIN. The backfill never writes a blank level over one already stored, so a `CLASSIFIED` row with gaps can't erase a manual fix. A `CLASSIFIED` row is permanent and never re-fetched; `UNCLASSIFIED` / `API_ERROR` / `ISIN_MISMATCH` rows are retried on every subsequent refresh, since a company that NSE currently has no data for could get classified later — a handful of names can stay in this retry state indefinitely if NSE genuinely never returns taxonomy data for them. This step also runs the manual-override auto-prune: any level of `equity_sector_override` that the automatic pipeline can now resolve on its own is cleared, and a row left with nothing set is deleted.

Steps 1 and 2 must complete before step 3, since step 3's backfill needs both a populated `amfi_market_cap` and `isin` values on `mf_scheme_breakdown`. First run classifies roughly 750 ISINs (~6 minutes); later runs only query ISINs new to the portfolio, typically seconds.

Classification is per-holding, driven by the API's `holding_type`/`section`, not per-fund: funds in `FOREIGN_FUND_ISINS` (e.g. MON100/Nasdaq 100) classify all their equity as `Equity - Foreign`, bypassing AMFI lookup; holdings matching names in `FOREIGN_COMPANY_SUBSTRINGS` (Alphabet, Amazon, Apple, Meta, Microsoft) are always `Equity - Foreign` regardless of fund; a non-`IN` ISIN prefix is also treated as foreign; other funds use alias → ISIN → name match → fuzzy → `EquityCategoryOverride`. Unmatched holdings shown in post-ingest form.

**Arbitrage funds** (name matches `arbitrage`): equity and offsetting short-futures legs are grouped by ISIN and summed across contract expiries; the matched (lower) notional becomes `Equity - Arbitrage`, any leftover becomes extra `Equity` (long side bigger) or `Derivatives - Leveraged` (short side bigger, stored as a negative market value). OpenFin sometimes mislabels money-market paper (CDs) as `holding_type: "equity"` — a populated `instrument_yield` (never set on real equity) is used to catch and reclassify these as `Debt`.

**Equity categories:** `Large Cap`, `Mid Cap`, `Small Cap`, `Unclassified Equity` (domestic), `Equity - Foreign`, `Equity - Arbitrage`.  
**Allocation comparison:** two modes selectable per session:
- **Anchored (default):** Mid Cap and Small Cap ideal values are anchored to Large Cap (e.g. Mid = 70% of LC). Foreign ideal = `cur_large × anchor_ratio` where `anchor_ratio = foreign_target / (large_target × domestic_share)`. Large Cap shows no diff; it is the anchor.
- **Free Float:** all ideals computed from total equity × target %; targets are shown as % of total equity.

`Equity - Foreign` target is configured in the asset class targets section and stored in `AllocationTarget`.

### NAV History Chart
Walk trades first-to-today → track qty + cost per instrument → look up daily
close from `price_history` (stocks/bonds/ETFs) and `nav_history` (MFs) →
forward-fill gaps → output `{date, value, invested, unit_nav}` timeseries.

Only rows that the walk can use are loaded: instruments that were actually
traded, on dates from the first trade onwards, grouped as
`{date -> [(instrument_id, close)]}` so each day touches only the rows that
exist. NAV rows are applied after price rows, so an MF holding both on the
same day marks at its NAV. The day walk itself is the pure
`build_nav_series()`; `compute_nav_series()` is the thin DB wrapper around it.
The frontend caches the result for 5 minutes (`staleTime` in
`src/api/portfolio.ts`); every sync that writes price or NAV rows invalidates
the `['portfolio']` query key.

---

## Database Migrations

Managed by **Alembic**. Migration files live in `alembic/versions/`.

- `env.py` uses the sync `psycopg2` driver (strips `+asyncpg`).
- `main.py` lifespan runs `alembic upgrade head` on startup.

```bash
export DATABASE_URL="postgresql+asyncpg://portfolio:portfolio@localhost:5432/portfolio"
venv/bin/alembic current
venv/bin/alembic revision --autogenerate -m "description"
venv/bin/alembic upgrade head
venv/bin/alembic downgrade -1
```

---

## External Data Sources

| Source | What | How |
|---|---|---|
| Zerodha Kite API | Live prices, holdings, OHLC | OAuth + REST (`kite_client.py`) |
| AMFI NAVAll.txt | Daily MF NAVs | HTTP fetch (`amfi_nav.py`) |
| mfapi.in / finapi.upvaly.com | Historical MF NAVs (user-toggled source) | REST per scheme (`mfapi_nav.py`) |
| AMFI xlsx (local) | Company → market-cap classification | Manual download into `data/mf_portfolio_breakdown/` |
| openfin.pocketedge.in | Per-fund MF holding disclosures (catalog + holdings) | REST, no auth (`mf_ingest.py`) |
| NSE equity master (`EQUITY_L.csv`) | ISIN → NSE symbol index | HTTP fetch each refresh, not stored (`nse_industry.py`) |
| NSE quote API | Four-level industry taxonomy per held ISIN | HTTP fetch, cached permanently in `nse_industry_classification` (`nse_industry.py`) |
| company_master.csv (auto) | ISIN master with tickers, exchanges, sector, aliases | Auto-generated on each AMFI sync; edit only the `aliases` column |
