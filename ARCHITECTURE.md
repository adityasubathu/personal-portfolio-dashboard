# Portfolio Manager — Architecture & Reference

## Overview

A self-hosted portfolio tracker for Indian investors. Imports trades from Zerodha Kite CSVs, syncs live prices from Kite and AMFI, tracks manual assets (FDs, PPF, NPS, cash), computes FIFO cost basis, XIRR, and portfolio NAV over time, and visualizes allocation by market-cap category.

**Stack:** FastAPI · SQLAlchemy (async) · PostgreSQL · Jinja2 · HTMX · Pico CSS · Chart.js

---

## Directory Layout

```
app/
├── main.py                  # FastAPI app, lifespan migrations, router registration
├── config.py                # Pydantic settings (.env): DATABASE_URL, Kite keys
├── database.py              # AsyncEngine + AsyncSession (postgresql+asyncpg)
├── templating.py            # Jinja2 env, custom filters: inr(), heatmap()
├── time_util.py             # IST timezone helper (now_ist)
├── models/
│   ├── __init__.py          # Re-exports all models (for Alembic / metadata)
│   ├── instrument.py        # Instrument — master security record
│   ├── trade.py             # Trade — immutable buy/sell ledger
│   ├── holding.py           # Holding — current FIFO position per instrument
│   ├── price_history.py     # PriceHistory — daily OHLC / NAV
│   ├── kite.py              # KiteConfig (singleton) + KiteSyncLog
│   ├── import_log.py        # CSVImportLog — per-batch import metadata
│   ├── manual_asset.py      # ManualAsset — FD / PPF / NPS / Cash
│   └── mf_breakdown.py      # AmfiMarketCap + MfSchemeBreakdown
├── routers/
│   ├── pages.py             # HTML page routes (/, /trades, /import, …)
│   ├── portfolio.py         # Holdings table, summary cards, NAV history, OHLC upload
│   ├── trades.py            # CSV import, split-credit, import history, trade list
│   ├── kite.py              # Kite OAuth, config CRUD, holdings sync
│   ├── mf.py                # AMFI NAV sync, mfapi.in historical sync
│   ├── mf_breakdown.py      # Ingest scheme CSVs, batch classify, chart data
│   ├── manual_assets.py     # FD / PPF / NPS / Cash CRUD
│   └── settings.py          # Danger-zone bulk deletes
├── services/
│   ├── csv_importer.py      # Multi-format CSV parser (Kite legacy/current, generic)
│   ├── holdings_engine.py   # FIFO recompute from trades
│   ├── instrument_registry.py # Smart dedup: ISIN → symbol+exchange → fuzzy bond match
│   ├── kite_client.py       # Async Kite API wrapper (OAuth, holdings, OHLC)
│   ├── kite_sync.py         # Kite holdings/positions ingest + reconciliation
│   ├── kite_historical.py   # Equity price history fetch (windowed, incremental)
│   ├── kite_reconcile.py    # Local ↔ Kite quantity validation
│   ├── amfi_nav.py          # AMFI daily NAV feed → MF last_price
│   ├── mfapi_nav.py         # mfapi.in historical NAV per scheme
│   ├── mf_breakdown.py      # AMFI xlsx parse, scheme CSV ingest, chart aggregation
│   ├── manual_assets.py     # FD FV calc, manual assets summary
│   ├── manual_ohlc.py       # Manual OHLC CSV upload for delisted stocks
│   ├── nav_history.py       # Day-by-day portfolio value reconstruction
│   └── xirr.py              # Newton-Raphson XIRR (per-holding + portfolio)
├── templates/
│   ├── base.html            # Layout: Pico CSS, HTMX, Chart.js, nav links
│   ├── dashboard.html       # Summary cards + holdings table + manual assets
│   ├── trades.html          # Paginated trade list with search
│   ├── import.html          # Multi-file CSV upload + import history
│   ├── kite.html            # Kite config, login, sync controls
│   ├── nav_history.html     # Instrument dropdown + NAV chart
│   ├── mf_breakdown.html    # Ingest button + doughnut chart + stock holdings table
│   ├── settings.html        # Danger-zone delete buttons
│   └── partials/            # HTMX fragments (swapped into parent pages)
│       ├── summary_cards.html
│       ├── holdings_table.html
│       ├── trades_table.html
│       ├── import_result.html
│       ├── import_history.html
│       ├── violations_list.html
│       ├── kite_status.html
│       ├── sync_status.html
│       ├── mf_sync_status.html
│       ├── mf_breakdown_ingest_status.html
│       ├── manual_assets.html
│       ├── manual_ohlc_status.html
│       ├── kite_ohlc_fetch_status.html
│       └── price_history_sync_status.html
└── static/
    └── app.css
data/
└── mf_portfolio_breakdown/  # Drop scheme CSVs (named by ISIN) + AMFI xlsx here
docker-compose.yml           # PostgreSQL 17 + app (uvicorn :8000)
Dockerfile
requirements.txt
.env
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
Daily close prices. Sources: Kite (stocks/bonds), AMFI (MFs), mfapi.in (MF history), manual CSV. Unique on `(instrument_id, price_date)`.

### KiteConfig
Singleton (id=1). Stores Kite OAuth credentials: `api_key`, `api_secret`, `access_token`, expiry. Managed via the Kite settings page.

### KiteSyncLog
Audit trail for every Kite sync: status (SUCCESS/FAILED/MISMATCH), counts, error message.

### CSVImportLog
Per-batch import metadata: filename, row counts, `errors_json`. `batch_id` enables rollback.

### ManualAsset
Non-traded assets. `asset_type`: FD, PPF, NPS, CASH. FDs have `principal`, `interest_rate`, `start_date`, `maturity_date`, `is_emergency_fund`. Others store `current_value`.

### AmfiMarketCap
AMFI's semi-annual company → market-cap classification (Large / Mid / Small Cap). Loaded from local xlsx in `data/mf_portfolio_breakdown/`. `name_normalized` for fuzzy matching.

### MfSchemeBreakdown
Per-holding breakdown of each MF/ETF scheme. Parsed from scheme CSVs. Fields: `scheme_isin`, `name`, `holding_type`, `holdings_pct`, `category`. Unique on `(scheme_isin, name, holding_type)`.

---

## Services

### Trade Import (`csv_importer.py`)
Detects three CSV formats (Kite legacy, Kite current, generic), normalizes columns, validates rows, finds-or-creates instruments via the registry, inserts trades, and recomputes FIFO holdings. Returns a `batch_id` for rollback.

### Holdings Engine (`holdings_engine.py`)
Walks all trades chronologically per instrument in FIFO order. Outputs quantity, average_price, total_cost, realised PnL. Detects sell-exceeds-buy violations. Preserves last_price across reimports.

### Instrument Registry (`instrument_registry.py`)
Deduplicates instruments by ISIN (preferred), then symbol+exchange, then symbol alone. Special handling for bonds (regex patterns for G-secs, SGBs, T-bills with multiple symbol variants). Infers segment: MF, BOND, ETF, STOCK.

### Kite Client (`kite_client.py`)
Thin async wrapper over the Kite Connect API. Token exchange (checksum-protected), holdings/positions fetch, instruments CSV download (~100k rows), historical OHLC (2000-candle cap). Exponential backoff on 429.

### Kite Sync (`kite_sync.py`)
Orchestrates holdings + positions ingest from Kite. Upserts instruments (fills ISIN, symbol, exchange), upserts holdings (price, PnL, kite_synced flags), detects Kite-only positions (transfers). Reconciles before writing.

### Kite Historical (`kite_historical.py`)
Fetches daily OHLC for equities/bonds from Kite. Resolves `kite_instrument_token` (one-time from Kite instruments dump). Windowed fetch (1800 days/request). Incremental from last stored date.

### Kite Reconcile (`kite_reconcile.py`)
Compares local holdings ↔ Kite by ISIN. Flags: new_on_kite, missing_from_kite, quantity_mismatch (tolerance 0.0001). Blocks sync on discrepancy.

### AMFI NAV (`amfi_nav.py`)
Fetches the AMFI daily NAV feed (`NAVAll.txt`), matches MF holdings by ISIN (growth + dividend-reinvestment), updates `last_price` and `unrealised_pnl`.

### mfapi.in NAV (`mfapi_nav.py`)
Downloads historical NAV per MF scheme from mfapi.in. Resolves AMFI scheme codes from the NAV feed. Incremental, concurrent (semaphore=4). For ETFs, stores NAV separately to show market premium.

### MF Breakdown (`mf_breakdown.py`)
- **AMFI xlsx parse:** Reads `AverageMarketCapitalization*.xlsx` from `data/mf_portfolio_breakdown/`, extracts company → market-cap classification, pre-computes normalized names. Warns if file >6 months old.
- **Scheme CSV ingest:** Parses per-scheme CSVs. Classifies each holding: Equity → AMFI lookup (exact then fuzzy ≥85%) → Large/Mid/Small/Unclassified. Bonds → Debt. Cash → Cash. Debt/liquid funds (detected by tradingsymbol) → all Debt. ETF overrides for known index funds.
- **Chart aggregation:** Weights each holding's category by `holding_value × holdings_pct / 100`. Adds manual assets: FD+PPF → Debt, NPS → 75% Large Cap + 25% Debt, Cash → Cash. SGB bonds → Gold.
- **Stock holdings table:** Aggregates equity holdings across all MF/ETF schemes, computes per-stock portfolio weight and value, looks up NSE/BSE ticker from AmfiMarketCap. Sortable by name/weight, searchable by name/ticker.

### Manual Assets (`manual_assets.py`)
FD current value via quarterly compounding: `FV = P × (1 + r/400)^(4t)`. Summary returns totals for FDs, PPF, NPS, Cash, plus emergency fund subtotal. Feeds into both dashboard summary and breakdown chart.

### NAV History (`nav_history.py`)
Reconstructs daily portfolio value from first trade to today. Walks trades chronologically, maintains quantity + cost per instrument, forward-fills prices for weekends/holidays. Outputs `{date, value, invested}` timeseries.

### XIRR (`xirr.py`)
Annualized IRR via Newton-Raphson with bisection fallback. Per-holding cashflows: buys (negative) + sells (positive) + current value as terminal. Portfolio-level: union of all trade cashflows + total value.

### Manual OHLC (`manual_ohlc.py`)
CSV upload for delisted or renamed stocks. Permissive parser: accepts various date formats and column headers. Upserts into `price_history`.

---

## Routers & Endpoints

### Pages (`pages.py`, no prefix)
| Route | Page |
|---|---|
| `GET /` | Dashboard |
| `GET /trades` | Trade list |
| `GET /import` | CSV import |
| `GET /kite` | Kite settings |
| `GET /portfolio/nav-history` | NAV chart |
| `GET /portfolio/mf-breakdown` | MF breakdown chart |
| `GET /settings` | Danger zone |

### Portfolio (`/api/v1/portfolio`)
| Endpoint | Description |
|---|---|
| `GET /direct` | Holdings table (sortable, filterable by section) |
| `GET /summary` | JSON: total cost, value, PnL |
| `GET /summary-cards` | HTML: summary + last Kite sync + XIRR |
| `GET /nav-history` | JSON: portfolio value timeseries |
| `POST /sync-price-history` | Trigger Kite equity OHLC sync |
| `POST /upload-ohlc` | Manual OHLC CSV upload |
| `POST /fetch-ohlc` | Fetch Kite OHLC for a specific ticker |

### Trades (`/api/v1/trades`)
| Endpoint | Description |
|---|---|
| `GET /template` | Download CSV template |
| `POST /import` | Upload & process CSVs |
| `POST /split-credit` | Add synthetic BUY for splits/bonus |
| `GET /imports` | Last 20 imports |
| `DELETE /import/{batch_id}` | Rollback import + recompute |
| `GET /` | Paginated trades with search |

### Kite (`/api/v1/kite`)
| Endpoint | Description |
|---|---|
| `PUT /config` | Save API key + secret |
| `DELETE /config` | Clear credentials |
| `GET /config` | Config status |
| `GET /auth/url` | Kite login URL |
| `GET /auth/callback` | OAuth callback |
| `POST /sync` | Sync holdings + positions |
| `GET /status` | HTML status panel |

### Mutual Funds (`/api/v1/mf`)
| Endpoint | Description |
|---|---|
| `POST /sync-nav` | Update MF prices from AMFI daily feed |
| `POST /sync-nav-history` | Download historical NAV from mfapi.in |

### MF Breakdown (`/api/v1/mf-breakdown`)
| Endpoint | Description |
|---|---|
| `POST /ingest` | Load AMFI xlsx + ingest scheme CSVs |
| `PATCH /classify-batch` | Manual category override for unmatched |
| `GET /chart-data` | JSON for allocation doughnut chart |
| `GET /stock-holdings` | JSON: per-stock breakdown across all MF/ETF holdings |

### Manual Assets (`/api/v1/manual-assets`)
| Endpoint | Description |
|---|---|
| `POST /fd` | Add fixed deposit |
| `POST /ppf` | Upsert PPF |
| `POST /nps` | Upsert NPS |
| `POST /cash` | Upsert cash balance |
| `DELETE /{asset_id}` | Remove asset |
| `GET /` | Render manual assets partial |

### Settings (`/api/v1/settings`)
| Endpoint | Description |
|---|---|
| `DELETE /trades` | Clear trades, holdings, import logs |
| `DELETE /price-history` | Clear all price history |
| `DELETE /mf-breakdown` | Clear breakdown + AMFI classification |
| `DELETE /manual-assets` | Clear manual assets |

---

## Key Workflows

### Trade Import
Upload CSV → detect format (Kite legacy/current, generic) → normalize columns → validate rows → find/create instruments (by ISIN/symbol) → insert trades → recompute FIFO holdings → commit. Rollback via `DELETE /import/{batch_id}`.

### Kite Sync
OAuth login → exchange token (expires 06:00 IST next day) → fetch holdings + positions → find/create instruments → reconcile quantities (block on mismatch) → upsert holdings → log sync.

### MF NAV Update
AMFI daily feed → match MF holdings by ISIN → update `last_price`. Separately: mfapi.in → resolve scheme codes → fetch historical per fund → store in `price_history`.

### Price History Sync
For each stock/ETF/bond holding → resolve `kite_instrument_token` → fetch OHLC in 1800-day windows → upsert into `price_history`. Incremental from last stored date.

### MF Breakdown
Load AMFI xlsx (company → cap classification) → parse scheme CSVs from `data/mf_portfolio_breakdown/` → classify holdings (equity via AMFI fuzzy match, bonds → Debt, cash → Cash) → upsert breakdown rows. Chart: weight by `holding_value × pct` across all funds + manual assets.

### NAV History Chart
Walk trades first-to-today → track qty + cost per instrument → look up daily close from `price_history` → forward-fill gaps → output `{date, value, invested}` timeseries.

---

## Deployment

**docker-compose.yml** runs PostgreSQL 17 + the app (uvicorn on :8000). Volumes mount `./app` (live reload) and `./data` (scheme CSVs + AMFI xlsx).

**Environment variables** (`.env`):
- `DATABASE_URL` — PostgreSQL connection string
- `KITE_REDIRECT_URL` — OAuth callback (default `http://localhost:8000/api/v1/kite/auth/callback`)
- `KITE_API_KEY`, `KITE_API_SECRET` — optional, configurable via web UI

Schema migrations run automatically at startup via the lifespan handler in `main.py`.

---

## External Data Sources

| Source | What | How |
|---|---|---|
| Zerodha Kite API | Live prices, holdings, OHLC | OAuth + REST (`kite_client.py`) |
| AMFI NAVAll.txt | Daily MF NAVs | HTTP fetch (`amfi_nav.py`) |
| mfapi.in | Historical MF NAVs | REST per scheme (`mfapi_nav.py`) |
| AMFI xlsx (local) | Company → market-cap classification | Manual download into `data/mf_portfolio_breakdown/` |
| Scheme CSVs (local) | Per-fund holding breakdown | Manual download into `data/mf_portfolio_breakdown/<ISIN>.csv` |
