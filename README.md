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

**Environment variables** (`.env`):
```
DATABASE_URL=postgresql+asyncpg://portfolio:portfolio@db:5432/portfolio
FRONTEND_URL=http://localhost:5173
KITE_REDIRECT_URL=http://localhost:8000/api/v1/kite/auth/callback
```

---

## Directory Layout

```
portfolio-mac-arm/
├── app/
│   ├── main.py                  # FastAPI app, CORSMiddleware, lifespan (runs alembic upgrade), router registration
│   ├── config.py                # Pydantic settings (.env): DATABASE_URL, FRONTEND_URL, Kite keys
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
│   │   ├── manual_asset.py      # ManualAsset — FD / PPF / NPS / Cash
│   │   ├── mf_breakdown.py      # AmfiMarketCap + MfSchemeBreakdown
│   │   ├── allocation_target.py # AllocationTarget — equity cap allocation targets
│   │   └── nav_tracked_instrument.py
│   ├── routers/                 # All return JSON, SSE stream, file download, or redirect
│   │   ├── portfolio.py         # Holdings table, summary cards, NAV history, OHLC upload, SSE sync
│   │   ├── trades.py            # CSV import, split-credit, import history, trade list
│   │   ├── kite.py              # Kite OAuth, config CRUD, holdings sync
│   │   ├── mf.py                # AMFI NAV sync, mfapi.in historical sync
│   │   ├── mf_breakdown.py      # Ingest scheme CSVs, batch classify, chart data
│   │   ├── manual_assets.py     # FD / PPF / NPS / Cash CRUD
│   │   ├── charts.py            # Price and NAV chart data endpoints
│   │   └── settings.py          # Danger-zone bulk deletes, DB info
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
│       ├── manual_assets.py     # FD FV calc, manual assets summary
│       ├── manual_ohlc.py       # Manual OHLC CSV upload for delisted stocks
│       ├── nav_history.py       # Day-by-day portfolio value reconstruction
│       └── xirr.py              # Newton-Raphson XIRR (per-holding + portfolio)
├── frontend/
│   ├── Dockerfile               # node:20-alpine, Vite dev server
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── main.tsx             # MantineProvider, QueryClientProvider, BrowserRouter
│       ├── App.tsx              # Routes (10 pages under AppLayout)
│       ├── api/                 # Typed fetch client + per-domain React Query hooks
│       │   ├── client.ts        # request<T>() wrapper; VITE_API_BASE_URL
│       │   ├── portfolio.ts
│       │   ├── trades.ts
│       │   ├── kite.ts
│       │   ├── mf.ts
│       │   ├── mfBreakdown.ts
│       │   ├── manualAssets.ts
│       │   ├── charts.ts
│       │   └── settings.ts
│       ├── types/               # TS interfaces mirroring app/schemas/ 1:1
│       ├── components/
│       │   ├── AppLayout.tsx    # Mantine AppShell + nav (10 routes)
│       │   ├── DonutChart.tsx   # react-chartjs-2 Doughnut, category/sector color maps, custom legend
│       │   ├── LwChart.tsx      # lightweight-charts wrapper — area/candle/line, drag-resize, persisted height
│       │   ├── DataTable.tsx    # Sortable table with optional section headers and heatmap cells
│       │   ├── SsePanel.tsx     # Spinner + scrolling log + result area; driven by useSse
│       │   └── MoneyText.tsx    # ₹ formatted text with colorize/compact/showSign props
│       ├── pages/
│       │   ├── Dashboard.tsx    # Summary cards + holdings table + manual assets CRUD
│       │   ├── NavHistory.tsx   # Portfolio area chart, price sync SSE, OHLC fetch SSE, manual upload
│       │   ├── Breakdown.tsx    # MF breakdown tabs: Overview, Sector, Composition, Direct Trades
│       │   ├── FundBreakdown.tsx # Per-fund breakdown with autocomplete search
│       │   ├── PriceChart.tsx   # Candlestick chart with trade markers
│       │   ├── NavChart.tsx     # Fund NAV area chart + compare mode (normalised % change)
│       │   ├── Trades.tsx       # Debounced search + paginated trade list
│       │   ├── Import.tsx       # CSV upload, import history, rollback, split-credit
│       │   ├── Kite.tsx         # Config form, OAuth login, token status, one-click sync
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
│   └── mf_portfolio_breakdown/  # Drop scheme CSVs (named by ISIN) + AMFI xlsx here
├── docker-compose.yml           # PostgreSQL 17 + app (uvicorn :8000) + frontend (Vite :5173)
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
Non-traded assets. `asset_type`: FD, PPF, NPS, CASH. FDs have `principal`, `interest_rate`, `start_date`, `maturity_date`, `is_emergency_fund`. Others store `current_value`.

### AmfiMarketCap
AMFI's semi-annual company → market-cap classification (Large / Mid / Small Cap). Loaded from local xlsx in `data/mf_portfolio_breakdown/`. Fields: `isin`, `company_name`, `name_normalized`, `nse_symbol`, `bse_symbol`, `msei_symbol`, `primary_ticker`, `exchanges`, `categorization`, `sector`, `aliases`.

### MfSchemeBreakdown
Per-holding breakdown of each MF/ETF scheme. Parsed from scheme CSVs. Fields: `scheme_isin`, `name`, `holding_type`, `holdings_pct`, `category`, `sector`. Unique on `(scheme_isin, name, holding_type)`.

### EquityCategoryOverride
Persists manual market-cap classifications for equity holdings not found in the AMFI list. Keyed by `name_normalized`. Applied automatically on subsequent ingests.

### AllocationTarget
Per-category equity allocation targets (e.g. Large Cap 50%, Mid Cap 30%). Used by the allocation comparison view.

### NavTrackedInstrument
Marks MF/ETF instruments imported by ISIN without a corresponding trade. Ensures `sync_nav_history` keeps their NAV up to date.

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
| `GET /allocation-comparison` | Current vs target allocation with deltas |
| `GET /allocation-targets` | Saved per-category targets |
| `POST /allocation-targets` | Save per-category targets |
| `GET /category-composition` | Per-category breakdown by contributing scheme |
| `GET /sector-composition` | Per-sector breakdown |
| `GET /direct-trades` | Ticker-wise BUY/SELL breakdown |
| `GET /schemes` | Schemes with breakdown data |
| `GET /scheme/{scheme_isin}` | Per-fund holding list |

### Manual Assets (`/api/v1/manual-assets`)
| Endpoint | Description |
|---|---|
| `POST /fd` | Add fixed deposit |
| `POST /ppf` | Upsert PPF |
| `POST /nps` | Upsert NPS |
| `POST /cash` | Upsert cash balance |
| `DELETE /{asset_id}` | Remove asset |
| `GET /` | All manual assets summary |

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
Click "Sync price history (Kite)" → opens EventSource → server acquires async lock (rejects duplicate syncs) → for each stock/ETF/bond: resolve `kite_instrument_token` → fetch full OHLC in 1800-day windows → upsert → stream progress → send final result.

### MF Breakdown
Sync AMFI xlsx → enrich with sector → write `company_master.csv`. Parse scheme CSVs → classify each equity holding (alias → ISIN → name match → fuzzy → `EquityCategoryOverride`) → upsert breakdown rows. Unmatched holdings shown in post-ingest form.

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
