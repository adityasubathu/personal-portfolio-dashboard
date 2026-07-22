# Portfolio Manager — Architecture & Reference

> **License:** MIT — see [LICENSE](LICENSE) for details.
>
> This app is entirely vibe-coded and comes with no guarantees of correctness, accuracy, or fitness for any purpose. It was built as a personal replacement for an Excel sheet and is shared as-is. Do not rely on it for financial decisions.
>
> Issues and pull requests may not get attention. I may get around to addressing them if and when I have time.

## Planned Features

- Capital gains reporting for the current and prior financial year
- Tax-loss harvesting opportunity detection
- Crypto portfolio support — spot, dated futures, perpetuals, and options
- Automated scraping of mutual fund factsheets and portfolio disclosures

## Overview

A self-hosted portfolio tracker for Indian investors. Imports trades from Zerodha Kite CSVs, syncs live prices from Kite and AMFI, tracks manual assets (FDs, PPF, NPS, cash), computes FIFO cost basis, XIRR, and portfolio NAV over time, and visualizes allocation by market-cap category.

**Stack:** FastAPI · SQLAlchemy (async) · PostgreSQL · Alembic · React 18 (Vite + TypeScript) · Mantine · TanStack Query · lightweight-charts · react-chartjs-2

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

On first start the app auto-seeds ~17 instruments, ~70 trades, 2 years of price/NAV history, MF scheme breakdowns, manual assets, allocation targets, and USDINR rate. Kite integration is disabled. A **Reset Demo Data** button on the Settings page re-seeds from scratch without a restart.

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
│   │   ├── mf_breakdown.py
│   │   ├── charts.py
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
│   │   ├── mf_breakdown.py      # AmfiMarketCap + MfSchemeBreakdown
│   │   ├── allocation_target.py # AllocationTarget — equity cap allocation targets
│   │   ├── app_config.py        # AppConfig — KV store for cached config (USDINR rate)
│   │   └── nav_tracked_instrument.py
│   ├── routers/                 # All return JSON, SSE stream, file download, or redirect
│   │   ├── portfolio.py         # Holdings table, summary cards, NAV history, OHLC upload, SSE sync
│   │   ├── trades.py            # CSV import, split-credit, import history, trade list
│   │   ├── kite.py              # Kite OAuth, config CRUD, holdings sync
│   │   ├── mf.py                # AMFI NAV sync, mfapi.in historical sync
│   │   ├── mf_breakdown.py      # Ingest scheme CSVs, batch classify, chart data
│   │   ├── manual_assets.py     # FD / PPF / NPS / Cash / Foreign equity CRUD
│   │   ├── usdinr.py            # USDINR rate: stored read, Kite refresh, manual set
│   │   ├── charts.py            # Price and NAV chart data endpoints
│   │   ├── settings.py          # Danger-zone bulk deletes, DB info
│   │   ├── market_sentiment.py  # GET /api/v1/market-sentiment/summary, /series
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
│       ├── mf_breakdown.py      # AMFI xlsx parse, scheme CSV ingest, chart aggregation
│       ├── manual_assets.py     # FD FV calc, manual assets summary (incl. FOREIGN_EQ → INR conversion)
│       ├── usdinr.py            # USDINR rate: fetch from Kite CDS near-month FUT, persist, read
│       ├── manual_ohlc.py       # Manual OHLC CSV upload for delisted stocks
│       ├── nav_history.py       # Day-by-day portfolio value reconstruction
│       ├── policy_tracker.py    # 15 trigger evaluators across 7 sections; returns section/trigger tree
│       ├── market_indicators.py  # Pure indicator functions: EMA/SMA, RSI (Wilder's), MACD, ADX, ATR, Bollinger, drawdown, vol
│       ├── market_sentiment.py   # Composite trend/vol/divergence + get_sentiment_summary/get_sentiment_series
│       └── xirr.py              # Newton-Raphson XIRR (per-holding + portfolio)
├── frontend/
│   ├── Dockerfile               # node:20-alpine, Vite dev server
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx             # MantineProvider, QueryClientProvider, BrowserRouter
│       ├── App.tsx              # Routes (12 pages under AppLayout)
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
│       │   ├── marketSentiment.ts # useSentimentSummary(), useSentimentSeries(days)
│       │   └── status.ts        # useAppStatus(), useResetDemoMutation()
│       ├── types/               # TS interfaces mirroring app/schemas/ 1:1
│       ├── components/
│       │   ├── AppLayout.tsx    # Mantine AppShell + nav (11 routes); orange dot on Policy when actions pending
│       │   ├── DonutChart.tsx   # react-chartjs-2 Doughnut, category/sector color maps, custom legend
│       │   ├── LwChart.tsx      # lightweight-charts wrapper — area/candle/line, drag-resize, persisted height
│       │   ├── DataTable.tsx    # Sortable table with optional section headers and heatmap cells
│       │   ├── SsePanel.tsx     # Spinner + scrolling log + result area; driven by useSse
│       │   └── MoneyText.tsx    # ₹ formatted text with colorize/compact/showSign props
│       ├── pages/
│       │   ├── Dashboard.tsx    # Summary cards + holdings table + manual assets CRUD
│       │   ├── NavHistory.tsx   # Portfolio area chart, price sync SSE, OHLC fetch SSE, manual upload
│       │   ├── Breakdown.tsx    # MF breakdown tabs: Overview (asset class + equity allocation), Sector, Composition, Direct Trades
│       │   ├── FundBreakdown.tsx # Per-fund breakdown with autocomplete search
│       │   ├── PolicyTracker.tsx # Policy trigger evaluation: sections, per-trigger rows, detail tables, manual ack
│       │   ├── PriceChart.tsx   # Candlestick chart with trade markers
│       │   ├── NavChart.tsx     # Fund NAV area chart + compare mode (normalised % change)
│       │   ├── Trades.tsx       # Debounced search + paginated trade list
│       │   ├── Import.tsx       # CSV upload, import history, rollback, split-credit
│       │   ├── Kite.tsx         # Config form, OAuth login, token status, one-click sync
│       │   ├── MarketSentiment.tsx # Nifty 50 sentiment: 3-horizon table, flags, candlestick + overlays, oscillator + volatility panels
│       │   └── Settings.tsx     # Danger-zone deletes with confirmation modals
│       ├── hooks/
│       │   ├── useSse.ts        # EventSource wrapper: {logs, status, result, start()}
│       │   └── usePersistentState.ts # localStorage-backed state (chart heights, compare mode)
│       └── lib/
│           ├── format.ts        # inrCompact, inr, pct, heatmapBg, gainColor
│           └── colors.ts        # CATEGORY_COLORS, sectorColor(), categoryColor()
├── alembic/
│   ├── env.py                   # Sync psycopg2 driver, imports app models
│   ├── script.py.mako
│   └── versions/
│       └── 0001_baseline.py     # Full schema + data migrations
├── alembic.ini                  # DB URL set programmatically from app.config
├── data/
│   ├── mf_portfolio_breakdown/  # Drop scheme CSVs (named by ISIN) + AMFI xlsx here
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
AMFI's semi-annual company → market-cap classification (Large / Mid / Small Cap). Loaded from local xlsx in `data/mf_portfolio_breakdown/`. Fields: `isin`, `company_name`, `name_normalized`, `nse_symbol`, `bse_symbol`, `msei_symbol`, `primary_ticker`, `exchanges`, `categorization`, `sector`, `aliases`.

### MfSchemeBreakdown
Per-holding breakdown of each MF/ETF scheme. Parsed from scheme CSVs. Fields: `scheme_isin`, `name`, `holding_type`, `holdings_pct`, `category`, `sector`. Unique on `(scheme_isin, name, holding_type)`.

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
| `GET /config` | Config + token status |
| `GET /auth/url` | Kite login URL |
| `GET /auth/callback` | OAuth callback → redirect to `${FRONTEND_URL}/kite?login=success` |
| `POST /sync` | Sync holdings + positions |

### Mutual Funds (`/api/v1/mf`)
| Endpoint | Description |
|---|---|
| `POST /sync-nav` | Update MF prices from AMFI daily feed |
| `POST /sync-nav-history` | Download historical NAV from mfapi.in |
| `POST /fetch-nav-by-isin` | Import a single fund by ISIN |
| `GET /nav-tracked` | List manually tracked funds |
| `DELETE /nav-tracked/{instrument_id}` | Remove tracking entry |

### MF Breakdown (`/api/v1/mf-breakdown`)
| Endpoint | Description |
|---|---|
| `GET /ingest/stream` | SSE: load AMFI xlsx + ingest scheme CSVs |
| `PATCH /classify-batch` | Manual category override for unmatched equities |
| `GET /chart-data` | Allocation doughnut data |
| `GET /allocation-comparison` | Current vs target allocation with deltas (`?mode=anchored\|free_float`) |
| `GET /allocation-targets` | Saved per-category equity targets |
| `POST /allocation-targets` | Save per-category equity targets |
| `GET /asset-class-comparison` | Asset class (Equity/Debt/PM) current vs target |
| `GET /asset-class-targets` | Saved asset class targets |
| `POST /asset-class-targets` | Save asset class targets (also saves `Equity - Foreign` to `allocation_targets`) |
| `GET /stock-holdings` | Flat list of all equity stocks across schemes |
| `GET /category-composition` | Per-category breakdown by contributing scheme |
| `GET /sector-composition` | Per-sector breakdown |
| `GET /sector-stock-breakdown` | Per-sector individual stock holdings |
| `GET /direct-trades` | Ticker-wise BUY/SELL breakdown |
| `GET /schemes` | Schemes with breakdown data |
| `GET /scheme/{scheme_isin}` | Per-fund holding list |

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
| `GET /` | Stored rate info `{rate, source, fetched_at}` |
| `POST /refresh` | Fetch live rate from Kite CDS USDINR near-month futures |
| `POST /manual` | Override rate manually |

### Status / Demo (`/api/v1`)
| Endpoint | Description |
|---|---|
| `GET /status` | `{demo_mode: bool}` — whether the app is running in demo mode |
| `POST /demo/reset` | Wipe all data and re-seed demo portfolio (only active when `DEMO_MODE=true`) |

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
Click "Sync price history (Kite)" → opens EventSource → server acquires async lock (rejects duplicate syncs) → for each stock/ETF/bond: resolve `kite_instrument_token` → fetch full OHLC in 1800-day windows → upsert → stream progress. After equity sync, also syncs index instruments (Nifty 50, Nifty Next 50, Nifty Midcap 150, Nifty Smlcap 250, India VIX) using segment `"INDICES"` — these are created as synthetic instruments in `price_history` without a holding.

### MF Breakdown
Sync AMFI xlsx → enrich with sector → write `company_master.csv`. Parse scheme CSVs → classify each equity holding: funds in `FOREIGN_FUND_ISINS` (e.g. MON100/Nasdaq 100) classify all their equity as `Equity - Foreign`, bypassing AMFI lookup; holdings matching names in `FOREIGN_COMPANY_SUBSTRINGS` (Alphabet, Amazon, Apple, Meta, Microsoft) are always `Equity - Foreign` regardless of fund; other funds use alias → ISIN → name match → fuzzy → `EquityCategoryOverride`. Unmatched holdings shown in post-ingest form.

**Equity categories:** `Large Cap`, `Mid Cap`, `Small Cap`, `Unclassified Equity` (domestic), `Equity - Foreign`, `Equity - Arbitrage`.  
**Allocation comparison:** two modes selectable per session:
- **Anchored (default):** Mid Cap and Small Cap ideal values are anchored to Large Cap (e.g. Mid = 70% of LC). Foreign ideal = `cur_large × anchor_ratio` where `anchor_ratio = foreign_target / (large_target × domestic_share)`. Large Cap shows no diff; it is the anchor.
- **Free Float:** all ideals computed from total equity × target %; targets are shown as % of total equity.

`Equity - Foreign` target is configured in the asset class targets section and stored in `AllocationTarget`.

### NAV History Chart
Walk trades first-to-today → track qty + cost per instrument → look up daily close from `price_history` (stocks/bonds/ETFs) and `nav_history` (MFs) → forward-fill gaps → output `{date, value, invested}` timeseries.

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
| mfapi.in | Historical MF NAVs | REST per scheme (`mfapi_nav.py`) |
| AMFI xlsx (local) | Company → market-cap classification | Manual download into `data/mf_portfolio_breakdown/` |
| Scheme CSVs (local) | Per-fund holding breakdown | Manual download into `data/mf_portfolio_breakdown/<ISIN>.csv` |
| sector_master.csv (local) | Company → SEBI sector mapping | NSE index CSV; place in `data/mf_portfolio_breakdown/sector_master.csv` |
| company_master.csv (auto) | ISIN master with tickers, exchanges, sector, aliases | Auto-generated on each AMFI sync; edit only the `aliases` column |
