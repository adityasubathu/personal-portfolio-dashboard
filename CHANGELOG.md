# Changelog

---

## 2026-08-29 — Breadth ratio chart: large-cap leg is now Nifty 100

- `app/services/kite_historical.py` — added `NIFTY 100` to `INDEX_INSTRUMENTS`. Backfilled from Kite: 2,888 rows from 2015-01-01, complete OHLC.
- `app/services/market_sentiment.py` — the Mid/Small vs Large ratio chart now divides by Nifty 100 (the full large-cap universe: Nifty 50 + Next 50) instead of Nifty 50 (its top half only). Falls back to Nifty 50 where Nifty 100 isn't synced yet (demo mode, fresh install), and reports which was used via a new `ratios.benchmark` field so the chart labels itself honestly.
- Breadth Regime, Relative Strength, and segment drawdowns deliberately keep Nifty 50 — there it is one rung of a size ladder (50 → Next 50 → Mid 150 → Small 250) that Nifty 100 would overlap.
- Response keys `ratios.mid150_nifty50`/`small250_nifty50` → `ratios.mid150`/`small250` (denominator is no longer baked into the key name), plus `ratios.benchmark`.
- `frontend/src/types/marketSentiment.ts`, `frontend/src/pages/MarketSentiment.tsx` — chart title, both series labels, and the explanation text are driven by the reported benchmark.

---

## 2026-08-28 — Unify trend scoring across the summary card and sector table

The summary card and the sector-trends table scored the same index with different indicators, so they could disagree about Nifty 50 / Nifty 500. Both now use one shared model.

- `app/services/market_sentiment.py` — replaced `_short_trend`/`_mid_trend`/`_long_trend` (summary, returned bare strings) and `_sector_short`/`_sector_mid`/`_sector_long` (sector table) with a single `_trend_short`/`_trend_mid`/`_trend_long`, each returning `{label, signals, fading}`. Every horizon now asks the same three questions — MA position, trend direction, fixed-window return — windowed to its timescale (20/50/200-day MA; MACD / ±DI / SMA200 slope; 1M/3M/1Y return).
- Dropped redundant signals: **RSI > 50** (agrees with Close > EMA20 ~96% of the time — binarising at 50 discards what makes RSI useful; it remains as the oscillator chart and a raw value) and **SMA100** (agrees with the 3-month return ~92%). Dropped the **golden cross** from the long-term score — it latches the last 50/200 crossover and can be months stale; it stays as its own badge.
- Labels unified to `Bullish` / `Mostly Bullish` / `Mostly Bearish` / `Bearish` at every horizon (previously the same score read as "Leaning Bearish", "Mixed", or "Uptrend Bias" depending on the column).
- New `fading` flag ("losing steam"): set when the score is 2 and the direction signal is the one failing — i.e. price is up and has risen, but the trend has stopped strengthening. This is 97% of long-horizon 2-of-3 days, so it was worth surfacing rather than leaving behind a generic label. Rendered as a `↘` on the badge.
- `get_sector_trends` now loads OHLC (`_load_ohlc_df`) rather than close-only, since ±DI needs high/low. Verified all 20 index instruments have complete OHLC; endpoint still responds in ~0.5s.
- `frontend/src/types/marketSentiment.ts` — new shared `TrendCell` (`{label, signals, fading}`); replaces `SectorTrendHorizon` and the summary horizons' `trend: string`.
- `frontend/src/pages/MarketSentiment.tsx` — `TrendChip` gains the `↘` marker, an explanatory line, and an optional `info` block; the summary card now uses it instead of `FlagChip`, so it gains the click-for-signals popover the sector table already had. `trendColor` rewritten as a four-step gradient over the new labels. Trend explanations rewritten in plain language.

---

## 2026-08-28 — Market Sentiment: Nifty 50 / Nifty 500 toggle

- `app/services/market_sentiment.py` — generalised `_load_nifty_df` → `_load_ohlc_df(db, tradingsymbol)`; `get_sentiment_summary`/`get_sentiment_series` take a `symbol` param (default `"NIFTY 50"`); added `SENTIMENT_INDICES` allowlist (`nifty50`/`nifty500`)
- `app/routers/market_sentiment.py` — `/summary` and `/series` accept an `index` query param, resolved through the allowlist (400 on unknown value); `/breadth`, `/sector-trends`, `/refresh-indices` unchanged
- `frontend/src/types/marketSentiment.ts` — new `SentimentIndex` union type
- `frontend/src/api/marketSentiment.ts` — `sentimentKeys.summary`/`.series` now take the index as part of the cache key; `useRefreshIndicesMutation` invalidates by key-prefix so both indices refresh together
- `frontend/src/pages/MarketSentiment.tsx` — `SegmentedControl` toggle (persisted via `usePersistentState`) next to the Refresh button; title, no-data alert, and all summary/flags/chart/oscillator/volatility panels follow the selected index. Market Breadth and Sector Trends stay Nifty-50-based by design (see plan for rationale).

---

## 2026-08-25 — Classify OpenFin holdings by ISIN directly, not just by name

- `app/services/mf_ingest.py` (`_AmfiLookups.classify_equity`/`resolve_sector`) — each OpenFin holding carries its own ISIN, but classification only reached AMFI's market-cap/sector data indirectly, through a name→ISIN resolution chain keyed by AMFI's own name wording — so it missed whenever the two disclosures spelled a company differently (e.g. "The Jammu & Kashmir Bank Ltd." vs "...Limited"). Now tries `isin_to_mcap`/`isin_to_sector` directly against the holding's own ISIN first.
- Verified: unmatched-equities count dropped from 16 to 11 on a full re-ingest (EID Parry, Jindal Steel & Power, both Jammu & Kashmir Bank spellings, Ecos India Mobility now resolve via direct ISIN match); MCX's sector went from "Unknown" to "Financial Services" for the same reason. Remaining unmatched names appear to be genuinely absent from AMFI's own classification file (small/micro-caps), not a resolution bug.

---

## 2026-08-25 — Fix duplicate stock rows from inconsistent disclosure naming

- `app/services/allocation.py` (`get_stock_holdings_table`), `app/services/composition.py` (`get_sector_stock_breakdown`) — these grouped fund holdings by the raw `MfSchemeBreakdown.name` string, so the same company disclosed with different wording across funds ("Ltd." vs "Limited") showed up as separate rows. Now grouped by `normalize_company_name()`, with AMFI's canonical `company_name` preferred as the display name.
- Verified: Multi Commodity Exchange of India previously appeared as separate rows (one per spelling variant); now merges into a single row with combined value.

---

## 2026-08-25 — MF breakdown: fix has_holdings flakiness; confirm per-scheme replace

- `app/services/mf_ingest.py` — fixed a bug where OpenFin's catalog response inconsistently omits the `has_holdings` field (present in one fetch, absent in the next); treating a missing key as `False` caused every held fund to be wrongly reported as "not found in OpenFin". Now defaults to `True` when the key is absent.
- The catalog-based staleness check (only re-fetch schemes with a newer `latest_as_of`) is unchanged and stays. Confirmed a stale scheme's local rows are fully deleted and reinserted from the fresh disclosure (`delete().where(scheme_isin == isin)` then insert) rather than merged row-by-row — this was already correct, not an upsert.
- One-time cleanup: cleared `mf_scheme_breakdown` to purge rows from before the CD-mislabeling fix in the previous entry, since those schemes' `as_of` hadn't changed and the staleness check would otherwise have kept skipping them.

---

## 2026-08-25 — OpenFin portfolio disclosure sync

- `app/services/mf_ingest.py` — replaced `ingest_scheme_csvs()` (manual CSVs in `data/mf_portfolio_breakdown/`) with `ingest_from_openfin()`: fetches the OpenFin catalog, compares `latest_as_of` against locally stored `as_of` per scheme, and only re-fetches funds with a newer disclosure. Classification is now per-holding (driven by the API's `holding_type`/`section`) instead of per-fund/per-CSV-row.
- Arbitrage funds: equity + offsetting short-futures legs matched by ISIN (summed across contract expiries) — matched notional → `Equity - Arbitrage`, leftover → extra `Equity` or a new `Derivatives - Leveraged` category (negative market value for a naked short).
- Worked around an OpenFin data quirk: money-market CDs are mislabeled `holding_type: "equity"` — detected via a populated `instrument_yield` (never set on real equity) and reclassified as `Debt`.
- `app/models/mf_breakdown.py` + migration `58d3324ee86b` — `MfSchemeBreakdown` gains `as_of` (disclosure date) and `market_value` (INR); `holdings_pct` precision widened to `Numeric(14,8)`; dropped the `(scheme_isin, name, holding_type)` unique constraint since the API can return duplicate name+type rows (e.g. two Cash lines).
- `app/services/allocation.py`, `app/services/composition.py` — added `Derivatives - Leveraged` to the category display-order lists.
- `app/routers/mf_breakdown.py` — SSE endpoint calls `ingest_from_openfin`; response now includes `already_current`/`schemes_skipped`.
- `frontend/src/pages/Breakdown.tsx` — button renamed "Ingest portfolios" → "Refresh disclosures"; result panel shows "All schemes are up to date" when nothing was stale, and reports skipped-vs-updated scheme counts; "Missing CSVs" messaging → "Not found in OpenFin".
- Verified end-to-end against the live OpenFin API for all 12 currently-held funds (arbitrage, commodity ETFs, plain equity/debt funds) — category totals reconcile to ~100% per scheme.

---

## 2026-08-21 — NAV source switch: mfapi.in ↔ finapi fallback

- `app/services/mfapi_nav.py` — new `fetch_history_finapi()` (finapi.upvaly.com, ISIN-first with scheme-code fallback); `_sync_one`/`sync_nav_history` take a `source` param; finapi sync runs sequential (semaphore=1) to stay within its 30 req/min free-tier limit
- `app/routers/mf.py` — `/sync-nav-history` accepts a `source` query param (`mfapi` default)
- `frontend/src/api/mf.ts` — `useSyncNavHistoryMutation` passes `source` through
- `frontend/src/pages/NavHistory.tsx` — `SegmentedControl` toggle (mfapi.in / FinAPI), persisted via `usePersistentState('navSource', ...)`

---

## 2026-08-06 — Trades page: group by order, expand to see individual fills

- `app/models/trade.py` — new indexed `order_id` column
- migration `330edc09963d` — adds `trades.order_id`; backfilled existing rows by matching against the original Kite tradebook CSVs in `data/trades_data/`
- `app/services/csv_importer.py` — captures `Order ID`/`order_id` from Kite legacy, current, and generic CSV formats; fixed a latent bug where optional generic-CSV columns (e.g. `isin`, `notes`) raised `KeyError` instead of falling back when absent
- `app/services/trades.py` (new) — groups trades by `order_id` and paginates over the groups (trade volume is small enough that grouping in Python is simpler than a grouped SQL query)
- `app/schemas/trades.py`, `app/routers/trades.py` — `list_trades` now returns one `TradeOrderRow` per order (with summed quantity/amount and a volume-weighted price) carrying a nested `trades` list; a large multi-fill order (e.g. a big sell sliced into dozens of exchange fills) used to show as dozens of separate rows
- `frontend/src/pages/Trades.tsx` — one row per order; orders with more than one fill show a trade count and expand on click to reveal the individual fills
- `frontend/src/types/trades.ts` — added `TradeOrderRow`, updated `TradeRow`/`TradesListResponse` to match

---

## 2026-08-05 — Privacy mode: fix Capital Gains leak, mask quantity/foreign-equity, unmask market-data charts

- `frontend/src/pages/CapitalGains.tsx` — bucket cards, opening-position/lot detail rows, per-symbol STCG/LTCG/total, attention items, and the intraday footnote all rendered raw `inr()` regardless of privacy mode; now mask behind `₹•••` like the rest of the app when `usePrivacy().privacyMode` is on
- `frontend/src/pages/Dashboard.tsx` — holdings table `NumQty` now masks quantity in privacy mode (avg price / prev close / LTP stay visible — a bare per-unit price doesn't reveal position size, but qty × price does); Foreign Equity summary card and per-row table (invested/current/change $) now mask in privacy mode, change % stays visible
- `frontend/src/components/LwChart.tsx` — new `maskInPrivacy` prop (default `true`, preserves masking on `NavHistory`'s portfolio value/invested chart)
- `frontend/src/pages/PriceChart.tsx`, `NavChart.tsx`, `MarketSentiment.tsx` — pass `maskInPrivacy={false}`, since these charts show public market/instrument prices, not the user's holding value

---

## 2026-08-01 — Dashboard holdings table: independent heatmap gradients

- `app/services/holdings_engine.py` — computes `day_chg_pct_min`/`max` from actual data via `_range()`, same as every other heatmap column
- `app/schemas/portfolio.py` — `day_chg_pct_min`, `day_chg_pct_max` on `DirectHoldingsResponse`
- `frontend/src/types/portfolio.ts` — mirrored fields
- `frontend/src/pages/Dashboard.tsx` — Day % heatmap now uses the data-driven range instead of a hardcoded ±5% scale, so its gradient no longer looks tied to the Total gain % column's very different range

---

## 2026-08-01 — Rebalance calculator: explain the driving bucket

- `app/services/allocation.py` — `_zero_drift_plan` now identifies the "binding" bucket (the one whose `value/target%` ratio sets `cash_to_zero_drift`) and returns a `binding_note` explaining it; a modest overweight in a low-target-% bucket (e.g. Small Cap 2.6pp over a 7.8% target) can otherwise inflate the headline cash figure with no visible explanation, since diluting a small-target bucket back down requires growing the whole pool. Anchored mode's `get_rebalance_plan` picks whichever of domestic-dilution or foreign-catch-up is the larger driver for its note; asset-class plan gets its own `asset_class_binding_note`
- `frontend/src/types/mfBreakdown.ts` — `binding_note`, `asset_class_binding_note` on `RebalancePlan`
- `frontend/src/pages/Breakdown.tsx` — `RebalanceControls` shows the binding note under the cash input on both the asset-class and category rebalance tables

---

## 2026-08-01 — Rebalance calculator

- `app/services/allocation.py` — `_zero_drift_plan` (core cash-injection formula) and `get_rebalance_plan(db, mode, cash_amount)`: computes how much to invest per category/asset-class to bring every allocation drift to 0%, clamped so over-allocated buckets get 0; supports a custom cash amount (proportional distribution below the zero-drift amount, pro-rata excess distribution above it); anchored mode layers domestic-pool rebalance with a foreign-equity top-up derived from the post-rebalance Large Cap anchor value; adds a `conflict_note` when the asset-class plan calls for Debt/PM that an equity-only plan can't fix
- `app/routers/mf_breakdown.py` — `GET /rebalance-plan?mode=&cash=`
- `app/services/mf_breakdown.py` — re-exports `get_rebalance_plan`
- `frontend/src/types/mfBreakdown.ts` — `RebalanceBucket`, `RebalancePlan`
- `frontend/src/api/mfBreakdown.ts` — `useRebalancePlan(mode, cash?)`
- `frontend/src/pages/Breakdown.tsx` — "Shortfall / Surplus" vs "Rebalance" toggle (shared, persisted) on the asset-class targets table and the category targets table; rebalance view swaps in an Invest/New %/Remaining drift table, a debounced custom cash input, and a "zero all drifts" shortcut

---

## 2026-07-28 — Fix session

- `frontend/src/pages/Breakdown.tsx` — Asset Allocation donut: merged Equity - Foreign into Equity, merged Equity - Arbitrage into Debt, split Emergency Fund out of Debt as its own segment; Category Breakdown donut: Emergency Fund carved out of Debt and shown as a separate segment; both charts use `excluded.emergency_fund` from `useAssetClassComparison`
- `frontend/src/lib/colors.ts` — added Emergency Fund color #DEA9D5
- `frontend/src/pages/Breakdown.tsx` — Asset Allocation donut order: Equity, Debt, Precious Metals, Emergency Fund, Cash, Real Estate Trust, Others; Category Breakdown donut order: Large, Mid, Small, Foreign, Debt, Equity Arbitrage, Gold, Silver, Emergency Fund, Cash, Real Estate Trust, Others
- `frontend/src/pages/Breakdown.tsx` — fixed Others bucket inflating by 21L: added Unclassified Equity to CAT_ORDER, fixed fallback index bug (was using filtered-array index against original chart.values)

---

## 2026-07-28 — Free float allocation overhaul

- `alembic/versions/f6a1b2c3d4e5_allocation_target_mode.py` (new) — migration adds `alloc_mode` column to `allocation_targets`, changes unique constraint to `(category, alloc_mode)`, seeds free_float defaults (Large 26%, Mid 18.2%, Small 7.8%, Foreign 13%, Debt 25%, PM 10%)
- `app/models/allocation_target.py` — added `alloc_mode` field; unique constraint now covers `(category, alloc_mode)`; renamed from `mode` to avoid PostgreSQL reserved-word conflict
- `app/services/allocation.py` — `DEFAULT_TARGETS` split into anchored/free_float dicts; `get_allocation_targets` and `save_allocation_targets` accept `mode`; free_float comparison uses `investable_total` (pool) as denominator and returns Debt + Precious Metals rows in fixed order; fixed `get_asset_class_comparison` to filter `AllocationTarget` by `alloc_mode='anchored'` to avoid MultipleResultsFound after seeding
- `app/routers/mf_breakdown.py` — `/allocation-targets` GET/POST now accept `mode` param
- `frontend/src/types/mfBreakdown.ts` — added optional `pool` field to `AllocationComparison`
- `frontend/src/api/mfBreakdown.ts` — `useSaveAllocationTargetsMutation` now takes `{ targets, mode }` and posts `mode` in form
- `frontend/src/pages/Breakdown.tsx` — free float mode shows single unified table (Large, Mid, Small, Foreign, Debt, PM all as % of pool); hides separate `AssetClassTargetsSection`; mode toggle clears local target edits

---

## 2026-07-25 — Fix session

- `frontend/src/pages/MarketSentiment.tsx` — Momentum column width increased from 220→260px; Volatility (implied) column reduced from 260→220px to prevent long-term row momentum text wrapping

---

## 2026-07-25 — Fix session

- `frontend/src/components/LwChart.tsx` — added `priceScaleWidth` prop (sets `rightPriceScale.minimumWidth`) and `onPriceScaleWidth` callback (measures actual rendered right price scale `<td>` width via DOM after each data load)
- `frontend/src/pages/MarketSentiment.tsx` — all 7 charts report their natural price scale width; parent tracks the max and feeds it back as `priceScaleWidth`, forcing all scales to the same width so x-axes align exactly

---

## 2026-07-24 21:00 — Sector trends table polish

- `frontend/src/pages/MarketSentiment.tsx` — Nifty Bank, Midcap 150, Smallcap 250 pinned below benchmarks in that order; remaining sectors follow
- `frontend/src/pages/MarketSentiment.tsx` — black 2px dividers separate the three column groups (Trends | CAGR | Excess CAGR vs benchmark) across header and all body rows
- `frontend/src/pages/MarketSentiment.tsx` — comparison column group header renamed to "Excess CAGR vs … (pp)" for clarity

---

## 2026-07-24 20:30 — Sector trends table polish

- `frontend/src/pages/MarketSentiment.tsx` — Nifty Bank, Midcap 150, Smallcap 250 pinned below benchmarks in that order; remaining sectors follow sorted below
- `frontend/src/pages/MarketSentiment.tsx` — column group header renamed from "Excess vs … (pp)" to "Excess CAGR vs … (pp)" for clarity

---

## 2026-07-24 20:00 — Sector trends table: dual performance columns

- `frontend/src/pages/MarketSentiment.tsx` — table now shows 6 performance columns: CAGR 2Y/5Y/10Y (always) + Excess vs benchmark 2Y/5Y/10Y (always); selector switches the benchmark between Nifty 50 and Nifty 500 instead of toggling between CAGR and comparison modes; sort keys updated to distinguish the two column groups; heatmap computed separately per group

---

## 2026-07-24 19:30 — Trend chip popovers

- `app/services/market_sentiment.py` — `_sector_short/mid/long` now return `{label, signals}` dicts instead of bare strings; `signals` carries per-condition booleans (e.g. `ema20`, `rsi50`, `sma200_slope`)
- `frontend/src/types/marketSentiment.ts` — added `SectorTrendHorizon` interface; updated `SectorTrendRow.trend` to use it instead of plain strings
- `frontend/src/pages/MarketSentiment.tsx` — added `SIGNAL_LABELS` map and `TrendChip` component; clicking a Short/Mid/Long badge opens a Mantine `Popover` showing each signal with ✓/✗ pass/fail

---

## 2026-07-24 18:00 — Sector Indices Trends

- `app/services/kite_historical.py` — added 15 sectoral indices (Auto, Bank, Fin Services, FMCG, Healthcare, IT, Media, Metal, Pharma, Pvt Bank, PSU Bank, Realty, Consumer Durables, Oil & Gas) and NIFTY 500 to `INDEX_INSTRUMENTS`
- `app/services/market_sentiment.py` — added `SECTOR_INDICES`, `BENCHMARKS`, close-only `_sector_short/mid/long` trend scorers, `_cagr` helper, and `get_sector_trends` service function
- `app/routers/market_sentiment.py` — added `GET /api/v1/market-sentiment/sector-trends`
- `frontend/src/types/marketSentiment.ts` — added `SectorTrendPerf`, `SectorTrendRow`, `SectorTrends`
- `frontend/src/api/marketSentiment.ts` — added `sentimentKeys.sectorTrends`, `useSectorTrends()`; Refresh invalidates sector-trends cache
- `frontend/src/pages/MarketSentiment.tsx` — added `SectorTrendsTable`: mode toggle (CAGR / vs Nifty 50 / vs Nifty 500), sortable horizon columns, per-column heatmap, benchmark rows pinned at top, trend badges, info popover; wired below Volatility section
- `app/demo_seed.py` — added NIFTY 500 + Bank, IT, Pharma, Auto, FMCG to `_INDICES`
- `data/demo/ohlc/` — generated synthetic OHLC for NIFTY500, NIFTYBANK, NIFTYIT, NIFTYPHARMA, NIFTYAUTO, NIFTYFMCG

---

## 2026-07-24 17:30 — Fix session

- `app/services/capital_gains.py` — added `intl_fund`, `gold_etf`, `gold_mf` asset categories with correct post-Budget 2024 tax rules: international MFs and gold MFs (FoF/unlisted) use 24m LTCG threshold at 12.5% with no §112A exemption; gold ETFs (listed) use 12m LTCG threshold at 12.5%; all three fall back to pre-Budget 2024 §50AA / indexed debt rules when sold before 23 Jul 2024
- `app/services/capital_gains.py` — added `_GOLD_RE` regex (gold/silver/commodity/precious metal); `_classify_mf_orientation` now returns `"gold"` for gold/silver instruments; gold check runs before international check so "DSP World Gold Fund" is correctly identified as gold not international
- `app/services/capital_gains.py` — ETF classification now passes `"gold_etf"` and `"intl_fund"` through instead of collapsing all non-equity ETFs to `"debt_mf"`; MF classification converts orientation `"gold"` → `"gold_mf"`
- `tests/test_capital_gains.py` — added 17 new tests covering intl_fund / gold_etf / gold_mf classify_lot branches and gold/international orientation detection; 67 tests total, all passing
- `frontend/src/pages/CapitalGains.tsx` — bucket card label font size increased by 10% (`calc(var(--mantine-font-size-xs) * 1.1)`); color changed from dimmed to default (black)
- `app/services/capital_gains.py` — renamed `debt_ltcg_125` label from "Debt LTCG (12.5%)" to "Debt/Non-Equity LTCG (12.5%)"
- `frontend/src/pages/CapitalGains.tsx` — added persistent slab rate input (NumberInput, 0–42%, default 30%, saved to localStorage via `usePersistentState`); slab-rate bucket cards now show "Est. tax @ X%: ₹Y" instead of a generic "Slab rate" badge when a rate is set; totals card est. tax now includes slab-rate gains computed with the user's rate; footnote text adapts based on whether a slab rate is set

---

## 2026-07-24 — Fix session

- `frontend/src/pages/CapitalGains.tsx` — replaced bucket-grouped lots table with a symbol-grouped expandable table; each row shows total STCG, LTCG, and total P&L for that symbol; clicking a row expands to show the opening position (lots bought before the FY start, aggregated as qty/avg cost/total cost) and individual realized lots sorted by sell date, each with an ST/LT badge and buy→sell dates + days held; FY totals card now breaks out short-term and long-term gains as separate labelled rows above the total

- `app/services/capital_gains.py` — ETFs (instrument_type=ETF) now run `_classify_mf_orientation` instead of unconditionally mapping to `"equity"`; non-domestic-equity ETFs (MON100, international funds, gold ETFs etc.) resolve to `"debt_mf"` and are no longer eligible for the §112A LTCG exemption or §111A flat rate; domestic index ETFs (NIFTYBEES, SENSEXBEES etc.) still map to `"equity"` via the existing name regex
- `tests/test_capital_gains.py` — added `test_international_etf_not_equity` asserting MON100 / FANG+ ETF names do not classify as equity

- `frontend/src/pages/CapitalGains.tsx` — expanded detail rows: font size increased from `xs` to `sm` (~20% larger) across all text, headers, and the inner table's `fz` prop; date cell changed from stacked multi-line layout to a single `nowrap` line (`buy_date → sell_date · Nd`) to prevent wrapping

- `frontend/src/pages/CapitalGains.tsx` — `TermBadge`: added `fz="calc(var(--mantine-font-size-xs) * 1.1)"` to increase ST/LT chip text by 10%

## 2026-07-24 — Capital Gains page

- `app/services/capital_gains.py` (new) — FIFO matcher, Indian tax rule table (Budget 2024/2023/pre), CII indexation, §112A grandfathering, set-off and exemption engine; pure computation over existing `trades` + `price_history` tables, no new DB schema
- `app/schemas/capital_gains.py` (new) — Pydantic response models: `GainBucket`, `RealizedLot`, `AttentionItem`, `CapitalGainsResponse`, `AvailableFYsResponse`
- `app/routers/capital_gains.py` (new) — `GET /api/v1/capital-gains/years` and `GET /api/v1/capital-gains/{fy}`
- `app/main.py` — registered `capital_gains` router
- `tests/test_capital_gains.py` (new) — 49 tests covering FIFO matching, all tax classification boundaries (22 Jul vs 23 Jul 2024, 31 Mar vs 1 Apr 2023, 12/24/36m thresholds), grandfathering higher-of/lower-of logic, CII indexation arithmetic, set-off ordering, §112A exemption cap
- `frontend/src/types/capitalGains.ts` (new) — TS interfaces mirroring the Python schemas 1:1
- `frontend/src/api/capitalGains.ts` (new) — `useCapitalGainsYears()`, `useCapitalGains(fy)` React Query hooks
- `frontend/src/pages/CapitalGains.tsx` (new) — FY selector (persisted), per-bucket summary cards, lots table grouped by bucket with section headers, attention section for missing basis / FMV flags, intraday footnote, help popover; route `/portfolio/capital-gains`
- `frontend/src/App.tsx` — added `/portfolio/capital-gains` route
- `frontend/src/components/AppLayout.tsx` — added "Capital Gains" nav link (`IconReceipt2`)

## 2026-07-23 — Fix session

- `app/routers/market_sentiment.py` — added `POST /api/v1/market-sentiment/refresh-indices` endpoint; calls `sync_index_history` to fetch the latest candle for all 5 index instruments; before market open Kite returns no new candle (0 rows added), handled gracefully
- `frontend/src/api/marketSentiment.ts` — added `useRefreshIndicesMutation`; invalidates summary, series, and breadth queries on settle
- `frontend/src/pages/MarketSentiment.tsx` — wired Refresh button to call the mutation instead of only invalidating the client cache; button shows loading spinner while pending; shows a notification on error or when 0 rows were added (market not yet open)

---

## 2026-07-23 — Expanded FlagsBanner with 8 new indicator chips

- `app/services/market_sentiment.py` — added `_detect_ema_cross()` helper; extended `get_sentiment_summary` to compute Bollinger bands, EMA 9/20, and surface 8 new flags: `rsi14`, `above_200dma`, `adx`, `bb_squeeze`, `bb_pct_b`, `ema_cross`, `underwater_days`, `vix_day_chg`
- `frontend/src/types/marketSentiment.ts` — added 8 new fields to `SentimentFlags`
- `frontend/src/pages/MarketSentiment.tsx` — added `FlagChip` component (Badge + Popover); replaced `FlagsBanner` items with full 13-chip set grouped by Regime / Cross / Momentum / Volatility / Context; every chip is clickable and opens an explanation popover; removed standalone gap `ChartInfo` icon (gap chip's own popover replaces it)

---

## 2026-07-23 — Code review: readability & maintainability

- `app/routers/portfolio.py` — XIRR recompute now runs unconditionally after each sync/fetch-OHLC flow, not only when the LTP update fails
- `app/sse.py` (new) — extracted shared SSE queue/runner/generator scaffold into `sse_stream()` helper; removes ~100 lines of boilerplate
- `app/routers/portfolio.py` — `sync_price_history_stream` and `fetch_ohlc_stream` now delegate to `sse_stream()`
- `app/routers/mf_breakdown.py` — `ingest_stream` now delegates to `sse_stream()`; removed `json as jsonlib` and `EventSourceResponse` imports
- `app/services/holdings_engine.py` — moved all `direct_holdings` business logic out of the router; added `get_direct_holdings()`, `SORT_FIELDS`, `SECTION_ORDER`, `_sort_key`, `_isodate`, `_range`
- `app/routers/portfolio.py` — `direct_holdings` handler is now a one-line delegate to `get_direct_holdings()`
- `app/services/mf_breakdown.py` (1674 lines) — split into `mf_ingest.py` (AMFI sync + scheme CSV ingestion), `allocation.py` (allocation targets/comparison), `composition.py` (category/sector/scheme composition + direct-trade breakdown); `mf_breakdown.py` is now a re-export shim
- `app/main.py` — renamed `settings` router import to `settings_router` to fix name shadowing with config `settings`
- `app/services/holdings_engine.py` — moved `datetime` import to module level (was inline inside `_isodate`)
- `app/routers/demo.py` — demo reset now derives table list from `Base.metadata.sorted_tables` instead of a hardcoded list
- `app/services/kite_sync.py` — renamed `_get_config` → `get_config` and `_assert_token_valid` → `assert_token_valid` (cross-module API, not private)
- `app/services/kite_historical.py` — updated to use renamed public functions from `kite_sync`
- `frontend/src/hooks/useSse.ts` — added `useEffect` cleanup to close the `EventSource` on component unmount

---

## 2026-07-23 — Fix session

- `LwChart.tsx` — added `label?: string` prop; main series price tag now shows the label when provided (previously always blank)
- `MarketSentiment.tsx` — added `label` to RSI chart ("1D RSI"), realized volatility chart ("RV 20"), and breadth ratio chart ("Mid150 / Nifty50") so both lines in each multi-line chart show their name on the crosshair tag
- `NavChart.tsx` — added `label` to ETF area chart when `etfCompareLines` are present so the NAV line is identified alongside the close-price compare line

---

## 2026-07-23 — Market Breadth (Phases 1 & 2)

- `app/services/market_sentiment.py` — added `_breadth_regime`, `_relative_strength_order`, `_segment_drawdown` composite helpers and `get_market_breadth` API function
- `app/routers/market_sentiment.py` — added `GET /api/v1/market-sentiment/breadth` endpoint
- `frontend/src/types/marketSentiment.ts` — added `MarketBreadth`, `BreadthDrawdowns` interfaces
- `frontend/src/api/marketSentiment.ts` — added `useMarketBreadth` hook and `sentimentKeys.breadth`
- `frontend/src/pages/MarketSentiment.tsx` — added `MarketBreadthCard` (3-row table: regime/relative-strength/drawdown), ratio chart (Mid150 vs Nifty50 and Small250 vs Nifty50, rebased 1Y), breadth EXPLANATIONS entries; Refresh button now invalidates breadth key

---

## 2026-07-23 — Market Sentiment table info buttons, MACD histogram, explanation additions

- `frontend/src/components/LwChart.tsx` — added `histogram` series type (lightweight-charts `HistogramSeries`); data path reuses `line` prop
- `frontend/src/pages/MarketSentiment.tsx`:
  - MACD chart changed from `seriesType="line"` to `seriesType="histogram"`
  - Summary table wrapped in `Box px={128}` to match chart side padding; table `fz` raised from `sm` to `md` (+20%)
  - Per-row info icon added in Momentum column (short/mid/long each have tailored explanations)
  - Info icon added to Volatility column header explaining vol_regime
  - Info icon added to FlagsBanner when a gap badge is present (gap analysis explanation)
  - Added `EXPLANATIONS` keys: `tableShort`, `tableMid`, `tableLong`, `tableVol`, `gap`; updated `price` to include Bollinger Band %B detail

---

## 2026-07-23 — Market Sentiment info popovers

- `frontend/src/pages/MarketSentiment.tsx` — added `ChartInfo` component (Mantine `Popover` + `ActionIcon` with `IconInfoCircle`) and `EXPLANATIONS` map with plain-language descriptions for all six charts (price/overlays, RSI, MACD, ADX, ATR%, Realized Volatility); info button appears to the right of each chart name and to the top-right of the candlestick chart

---

## 2026-07-22 — Include PPF in debt bucket for allocation targets

- `app/services/mf_breakdown.py` — `get_asset_class_comparison`: removed `- ppf` from debt calculation so PPF (already present in `category_totals["Debt"]` via `_build_category_totals_full`) is counted in investable debt; removed PPF from `grand_total` add-back and `excluded` dict
- `frontend/src/types/mfBreakdown.ts` — removed `ppf` field from `AssetClassComparison.excluded`
- `frontend/src/pages/Breakdown.tsx` — removed PPF line from "Excludes:" footnote under asset class targets table

---

## 2026-07-22 — Market Sentiment auto-refresh on Kite sync

- `frontend/src/pages/NavHistory.tsx` — after price-history SSE completes, invalidate `['market-sentiment']` query keys so the Market Sentiment page refreshes automatically without a manual page reload

---

## 2026-07-22 — Market Sentiment page polish

- `app/services/market_sentiment.py` — add `rsi14_weekly` to `get_sentiment_series` oscillators
- `frontend/src/types/marketSentiment.ts` — add `rsi14_weekly` field to `SentimentOscillators`
- `frontend/src/components/LwChart.tsx` — add `showOhlcInfo` prop (OHLC + open→close % overlay at top-left on hover for candlestick charts); add `hideControls` prop (suppresses Reset Size button, used on mini oscillator panels so label sits flush above chart); add `hideMainTag` prop (excludes main series from crosshair tag loop, keeping tags only for compare lines); tooltip tags now use `priceFormatter` when set, removing ₹ symbol and K/L/Cr shortening on non-INR charts; tooltip tags now display series label prefix (e.g. "SMA 200: 24935")
- `frontend/src/pages/MarketSentiment.tsx` — 1W RSI plotted alongside 1D RSI on same chart as amber compare line; section headings ("Oscillators", "Volatility") changed to `Title order={2}` centered on `Divider`, font color black; chart names increased to `fz="1.75rem"`, centered, with ↓ suffix to clarify which chart they label; `hideControls` applied to all oscillator/volatility panels; `hideMainTag` on Nifty price chart; `showOhlcInfo` on Nifty price chart; overlay toggles rewritten as custom `Group` + coloured box to fix inner-vs-outer gap ambiguity; `toggleOverlay` fixed to pass a computed value (not a functional updater) to `usePersistentState` so selections persist across refreshes; section padding `px={128}`

---

## 2026-07-22 — Market Sentiment page

- `app/services/market_indicators.py` (new) — pure pandas/numpy indicator functions: EMA, SMA, RSI (Wilder's), MACD, ADX, ATR, Bollinger bands, gap analysis, streaks, golden/death cross, drawdown, rolling volatility, volatility percentile, rolling return
- `app/services/market_sentiment.py` (new) — composites (`_short_trend`, `_mid_trend`, `_long_trend`, `_vol_regime`, `_momentum_divergence`) and API functions `get_sentiment_summary` + `get_sentiment_series` over Nifty 50 `price_history` rows; returns `{"no_data": true}` when no INDEX rows exist
- `app/routers/market_sentiment.py` (new) — `GET /api/v1/market-sentiment/summary` and `GET /api/v1/market-sentiment/series?days=N`
- `app/main.py` — register `market_sentiment` router
- `frontend/src/types/marketSentiment.ts` (new) — `SentimentSummary`, `SentimentSeries`, `IndicatorPoint` interfaces
- `frontend/src/api/marketSentiment.ts` (new) — `useSentimentSummary`, `useSentimentSeries` React Query hooks (1h staleTime)
- `frontend/src/pages/MarketSentiment.tsx` (new) — page with `SentimentSummaryCard` (3-horizon table), `FlagsBanner` (badges), price candlestick chart with toggleable EMA/SMA/Bollinger overlays, oscillator panels (RSI, MACD hist, ADX), and volatility panels (ATR%, realized vol); range selector 1M/3M/6M/1Y/3Y/All; overlay and range states persisted
- `frontend/src/components/LwChart.tsx` — tooltip tags now include series label when set (e.g. "SMA 200: 24935"), benefiting compare lines on all chart pages
- `frontend/src/App.tsx` — add `/market/sentiment` route
- `frontend/src/components/AppLayout.tsx` — add "Market Sentiment" nav entry (IconGauge) between Breakdown and Fund Detail

---

## 2026-07-20 — Manual sector override + holding name cleanup

- `app/models/mf_breakdown.py` — add `EquitySectorOverride` model (mirrors `EquityCategoryOverride` pattern)
- `alembic/versions/e5f6a1b2c3d4_add_equity_sector_override.py` — migration to create `equity_sector_override` table
- `app/services/mf_breakdown.py` — strip trailing `**`/`^^` from holding names during ingestion (`name.rstrip("*^")`)
- `app/services/mf_breakdown.py` — load manual sector overrides at ingest start; auto-prune stale overrides when AMFI data covers them; apply as fallback when `_resolve_equity_sector` returns None
- `app/services/mf_breakdown.py` — add `save_sector_overrides` and `get_sector_list` service functions
- `app/routers/mf_breakdown.py` — add `PATCH /api/v1/mf-breakdown/sector-classify-batch` and `GET /api/v1/mf-breakdown/sector-list` endpoints
- `frontend/src/types/mfBreakdown.ts` — add `SectorClassifyResult` interface
- `frontend/src/api/mfBreakdown.ts` — add `useSectorList`, `useSectorClassifyBatchMutation` hooks; add `sectorList` query key
- `frontend/src/pages/Breakdown.tsx` — add `SectorClassifyPanel` component; wire into `SectorTab` to show when "Unknown"-sector stocks exist

---

## 2026-07-16 — Fix session

- `frontend/src/components/LwChart.tsx` — tooltip root div now has `z-index:10` so value/date tooltips render above the chart canvas
- `frontend/src/components/LwChart.tsx` — `formatTooltipDate` slices time string to first 10 chars before parsing, removing spurious ` HH:MM:SS` suffix from date tooltip when `timeVisible: true`

---

## 2026-07-09 — USD wallet cash (INDMoney), equal-height asset cards

### USD wallet cash
- `app/models/manual_asset.py` — new `asset_type = "USD_CASH"`; stores balance in USD (same `current_value` column used by CASH/FOREIGN_EQ)
- `app/services/manual_assets.py` — converts USD balance to INR at query time using stored USDINR rate; INR equivalent is folded into `total_cash` so it flows into breakdown composition automatically
- `app/schemas/manual_assets.py` — added `usd_cash: Optional[SimpleAsset]` (INR value) and `usd_cash_value_usd: float` to `ManualAssetsSummary`
- `app/routers/manual_assets.py` — added `POST /api/v1/manual-assets/usd-cash` (upsert, like PPF/NPS/Cash)
- `frontend/src/types/manualAssets.ts` — added `usd_cash` and `usd_cash_value_usd` fields
- `frontend/src/api/manualAssets.ts` — added `useUpsertUsdCashMutation()`
- `frontend/src/pages/Dashboard.tsx` — added INDMoney summary card (INR value + USD sub-text); added "INDMoney Wallet (USD)" input in the edit panel

### UI
- `frontend/src/pages/Dashboard.tsx` — manual asset summary cards now use `align="stretch"` so all cards are the same height regardless of content

---

## 2026-07-07 (3) — Demo mode

### Demo mode (Phase 1–3)
- `scripts/fetch_demo_data.py` (new) — one-time developer tool to fetch real MF/ETF NAVs from mfapi.in and generate synthetic stock/index OHLC fixtures; saves to `data/demo/ohlc/` and `data/demo/nav/`
- `data/demo/ohlc/*.json` (committed) — 504-row synthetic OHLC fixtures for 6 stocks + 5 indices
- `data/demo/nav/*.json` (committed) — real NAV fixtures for 3 MFs + 2 ETFs from mfapi.in
- `app/demo_seed.py` (new) — async `seed_demo_data(db)` that populates all tables: 17 instruments, ~70 trades, holdings, price history, NAV history, MF scheme breakdown, AMFI market cap, allocation/asset class targets, manual assets, USDINR rate, CSV import log, nav tracked instruments, policy trigger state
- `app/config.py` — added `demo_mode: bool = False` setting (reads `DEMO_MODE` env var)
- `app/main.py` — lifespan checks `demo_seeded` flag in `app_config`; seeds on first start in demo mode; skips if already seeded
- `app/routers/demo.py` (new) — `GET /api/v1/status` returns `{demo_mode}` flag; `POST /api/v1/demo/reset` wipes all tables and re-seeds without restart
- `frontend/src/types/status.ts` (new) — `AppStatus` interface
- `frontend/src/api/status.ts` (new) — `useAppStatus()` and `useResetDemoMutation()` hooks
- `frontend/src/components/AppLayout.tsx` — violet demo banner shown on all pages when `demo_mode=true`
- `frontend/src/pages/Kite.tsx` — short-circuits to a demo info alert instead of the login form when in demo mode
- `frontend/src/pages/Settings.tsx` — "Reset Demo Data" button shown only in demo mode; calls `POST /api/v1/demo/reset`

---

## 2026-07-07 (2) — pgAdmin, foreign company classification, composition breakdown

### pgAdmin
- `docker-compose.yml` — added `pgadmin` service (`dpage/pgadmin4`, port 5050); desktop mode (`SERVER_MODE=False`, `MASTER_PASSWORD_REQUIRED=False`) so no login prompt; connects to `db` service on the Docker network

### Foreign company classification in MF breakdown
- `app/services/mf_breakdown.py` — added `FOREIGN_COMPANY_SUBSTRINGS` set; any fund holding whose name contains "alphabet", "amazon", "apple", "meta platforms", or "microsoft" is now classified as `Equity - Foreign` regardless of which fund holds it
- `app/services/mf_breakdown.py` — `get_category_composition` now includes each manual `FOREIGN_EQ` asset as an individual row under `Equity - Foreign` (converted to INR at stored USDINR rate)

---

## 2026-07-07 — Foreign equity USD tracking, USDINR rate, commodity ETF CSV fallback, LTP date fix

### Foreign equity USD tracking
- `app/models/app_config.py` (new) — `AppConfig` KV table (`key`, `value_json`) for app-level cached config
- `alembic/versions/d4e5f6a1b2c3_add_app_config.py` (new) — migration for `app_config` table
- `app/services/usdinr.py` (new) — resolves near-month USDINR futures symbol from Kite instruments dump (CDS segment); `refresh_usdinr_rate(db)` fetches via `/quote` and persists to `app_config`; `get_usdinr_rate(db)` reads stored value (default 85.0 if not set); `set_usdinr_rate_manual(db, rate)` for manual override
- `app/routers/usdinr.py` (new) — `GET /api/v1/usdinr` (stored rate), `POST /api/v1/usdinr/refresh` (live fetch from Kite), `POST /api/v1/usdinr/manual` (manual set)
- `app/main.py` — registered `usdinr` router
- `app/routers/manual_assets.py` — added `POST /api/v1/manual-assets/foreign-equity` (label + value in USD)
- `app/schemas/manual_assets.py` — added `ForeignEquityAsset`; `ManualAssetsSummary` extended with `foreign_equities`, `total_foreign_equity_usd`, `total_foreign_equity_inr`, `usdinr_rate`
- `app/services/manual_assets.py` — `FOREIGN_EQ` rows collected; each converted to INR at stored rate; totals included in summary
- `app/services/mf_breakdown.py` — `_build_category_totals_full` adds `total_foreign_equity_inr` to `"Equity - Foreign"` so manual USD holdings flow into the donut chart and allocation tables
- `app/services/kite_sync.py` — `update_ltp()` calls `refresh_usdinr_rate(db)` best-effort after updating stock prices
- `app/services/kite_historical.py` — `sync_price_history()` calls `refresh_usdinr_rate(db)` best-effort after completing the sync
- `frontend/src/types/manualAssets.ts` — added `ForeignEquityAsset`, `UsdinrInfo`; `ManualAssetsSummary` extended
- `frontend/src/api/manualAssets.ts` — added `useAddForeignEquityMutation`, `useRefreshUsdinrMutation`, `useSetManualUsdinrMutation`
- `frontend/src/pages/Dashboard.tsx` — `ManualAssets`: foreign equity summary card (USD + INR), always-visible table with delete; edit panel has Add form (label + USD value), USDINR rate display with "Refresh from Kite" button and manual override input

### Commodity ETF CSV fallback (GOLDCASE, SILVERIETF)
- `app/services/mf_breakdown.py` — after CSV loop, funds in `COMMODITY_ETF_CATEGORY` that are held but have no CSV file now get a synthetic 100% row inserted automatically; they are excluded from `missing_funds` warning

### LTP date fix
- `app/services/kite_client.py` — `get_ltp` now calls `/quote` instead of `/quote/ltp`; extracts `last_trade_time` (falls back to `timestamp`) and returns it alongside `last_price` as `dict[str, tuple[float, datetime | None]]`
- `app/services/kite_sync.py` — `update_ltp` stores `last_trade_time` as `last_price_at` (falls back to `now_ist()` if absent), so the LTP date reflects the actual last trade rather than the fetch time

---

## 2026-06-26 — Allocation modes, Policy Tracker, index OHLC, and UI fixes

### Allocation modes (anchored vs free float)
- `app/services/mf_breakdown.py` — `get_allocation_comparison` now accepts `mode` parameter; anchored mode (default) anchors mid/small/foreign ideal values to large cap value; free float mode uses total equity × target %; `FOREIGN_ANCHOR_RATIO` replaced with `_foreign_anchor_ratio()` computed dynamically from `foreign_target` and `large_target` (formula: `foreign_frac / (large_frac × domestic_frac)`)
- `app/services/mf_breakdown.py` — `Equity - Foreign` merged into `rows` list (was a separate response block); `anchor_note` field shows computed ratio (e.g. "50.0% of LC") instead of hardcoded string
- `app/routers/mf_breakdown.py` — `GET /allocation-comparison` accepts `?mode=anchored|free_float` query param
- `frontend/src/api/mfBreakdown.ts` — `useAllocationComparison(mode)` accepts mode and includes it in the query key
- `frontend/src/pages/Breakdown.tsx` — replaced two separate tables (domestic/foreign split + market-cap targets) with a single unified equity allocation table; `SegmentedControl` toggle between modes, persisted via `usePersistentState`; anchored mode shows "X% of LC" note for foreign row and "—" diff for large cap

### Equity – Foreign target in asset class section
- `app/services/mf_breakdown.py` — `get_asset_class_comparison` loads `Equity - Foreign` target from `allocation_targets` and includes it as `foreign_equity_target` in the response
- `app/routers/mf_breakdown.py` — `POST /asset-class-targets` intercepts `Equity - Foreign` and saves it to `allocation_targets` table (not `asset_class_targets`)
- `frontend/src/pages/Breakdown.tsx` — `AssetClassTargetsSection` shows a configurable "Equity - Foreign (% of total equity)" row; saving it updates `allocation_targets`, which drives the anchor ratio calculation
- `frontend/src/types/mfBreakdown.ts` — `AssetClassComparison` gains `foreign_equity_target`; `AllocationRow` gains `anchor_note`; `AllocationComparison` gains `mode`

### Asset class targets (Equity / Debt / Precious Metals)
- `app/models/allocation_target.py` — added `AssetClassTarget` model
- `app/services/mf_breakdown.py` — added `DEFAULT_ASSET_CLASS_TARGETS`, `get_asset_class_targets()`, `save_asset_class_targets()`, `get_asset_class_comparison()`
- `app/routers/mf_breakdown.py` — added `GET /asset-class-targets`, `POST /asset-class-targets`, `GET /asset-class-comparison`
- `frontend` — added `useAssetClassComparison`, `useSaveAssetClassTargetsMutation`; `AssetClassTargetsSection` component in Overview tab

### Policy Tracker page
- `app/models/policy_trigger.py` — new file: `PolicyTriggerState` (key/value store for trigger state) and `PolicyTriggerEvent` (audit log of state changes with JSONB detail)
- `app/services/policy_tracker.py` — new file: 15 trigger evaluators across 7 sections (Foreign Sleeve, Allocation Drift, Tax, Annual Fund Audit, Cleanup, Emergency Fund, Drawdown Ladder, House Protocol); `evaluate_all(db)` returns structured section/trigger tree
- `app/routers/policy_tracker.py` — `GET /api/v1/policy-tracker`, `PUT /api/v1/policy-tracker/state/{key}`
- `frontend/src/pages/PolicyTracker.tsx` — full page: section headings, per-trigger rows with expand/detail, Switch for manual_input triggers, Mark done + audit note for manual_ack triggers; detail rendered as tables (nested-record shape for drift, single-row for MON100 premium and Nifty drawdown)
- `frontend/src/components/AppLayout.tsx` — Policy nav item with orange indicator dot when `action_count > 0`
- MON100 premium: queries `Instrument` by ISIN directly (not through `Holding`) so it works when ETF is sold out; uses `PriceHistory` close for the same date as NAV for fair comparison; flags stale data on Tue–Sat

### Index OHLC sync
- `app/services/kite_historical.py` — `INDEX_INSTRUMENTS` constant (Nifty 50, Nifty Next 50, Nifty Midcap 150, Nifty Smlcap 250, India VIX); `ensure_index_instruments()`, `resolve_index_tokens()` (segment filter: `"INDICES"`), `sync_index_history()`; `_sync_one` accepts `backfill_start` param with fallback to earliest trade date
- `app/routers/portfolio.py` — `_run_sync()` calls `sync_index_history` after equity price sync with SSE progress

### UI / style
- `frontend/src/overrides.css` — new file: overrides `--mantine-color-dimmed` to `#444` globally (readable on white); imported in `main.tsx` after Mantine styles
- `frontend/src/components/DonutChart.tsx` — replaced chart.js tooltip (overlapped center label) with hover-driven center display; center shows hovered slice name / value / %; falls back to Total when nothing hovered
- Allocation diff cells coloured red only when deviation ≥ 3% (both % and absolute shortfall/surplus); within tolerance renders without colour

---

## 2026-06-10 — Equity – Foreign category with domestic/foreign split

- `app/services/mf_breakdown.py` — added `FOREIGN_FUND_ISINS` constant; moved MON100 (INF247L01AP3) from `ETF_CAP_OVERRIDE` into it so its equity holdings classify as `Equity - Foreign`
- `app/services/mf_breakdown.py` — added `DOMESTIC_EQUITY_CATS`, `FOREIGN_CAT` constants; `EQUITY_CATS` now includes `Equity - Foreign`
- `app/services/mf_breakdown.py` — `_CAT_ORDER` and both `order` lists updated to include `Equity - Foreign` after `Unclassified Equity`
- `app/services/mf_breakdown.py` — `DEFAULT_TARGETS` seeded with `Equity - Foreign: 0.0`
- `app/services/mf_breakdown.py` — `get_allocation_comparison` reworked: cap row % are now relative to domestic equity; response extended with `foreign`, `domestic`, `domestic_equity` fields
- `app/routers/mf_breakdown.py` — `VALID_CATEGORIES` accepts `Equity - Foreign` for classify-batch
- `frontend/src/lib/colors.ts` — added indigo color for `Equity - Foreign`
- `frontend/src/types/mfBreakdown.ts` — added `AllocationSplitSummary`; extended `AllocationComparison` with `foreign`, `domestic`, `domestic_equity`
- `frontend/src/pages/Breakdown.tsx` — Overview tab: domestic/foreign split mini-table above cap table; cap table labelled as % of domestic equity; foreign target editable via NumberInput; `CAP_CATEGORIES` includes `Equity - Foreign`
- `README.md` — updated AllocationTarget model description and MF Breakdown section to document new category, foreign fund list, and split allocation behaviour

---

## 2026-06-06b — Fix session

- `app/services/mf_breakdown.py` — `ingest_scheme_csvs`: now ingests all CSVs whose stem starts with `"IN"` instead of only held-fund ISINs; removed per-file skip gate; computes `missing_funds` (held ISINs with no CSV) and returns them with ISIN + name
- `frontend/src/types/mfBreakdown.ts` — replaced `skipped_isins` with `missing_funds: Array<{isin, name}>` on the ingest result type
- `frontend/src/pages/Breakdown.tsx` — `IngestResultRenderer` now shows a red warning listing each missing fund by ISIN and name when `missing_funds` is non-empty

## 2026-06-06 — Fix session

- `frontend/src/pages/Breakdown.tsx` — Added `ClassifyPanel` component: shown after ingest when unmatched equities are returned; table with per-stock `Select` dropdowns (Large/Mid/Small Cap); submits via `useClassifyBatchMutation` (PATCH `/api/v1/mf-breakdown/classify-batch`) which persists overrides in `equity_category_override` and invalidates all breakdown queries
- Captures `unmatched_equities` from SSE result into local state so the panel stays visible after the SsePanel is dismissed

---

## 2026-06-04 23:30 — Fix session

- `app/schemas/kite.py` — added `KiteDiscrepancy` model and `discrepancies` field to `KiteSyncResult`; Pydantic was stripping the field from sync responses, so the frontend never received discrepancy details

---

## 2026-06-05 23:25 — Dashboard console errors, totals row, manual assets

- `Dashboard.tsx` — fixed React warning: `Collapse in={open}` → `Collapse opened={open}` (Mantine v9 API); this also restores the broken Edit button
- `Dashboard.tsx` — fixed missing `key` prop on fragment in `groups.map`; replaced bare `<>` with `React.Fragment key={...}`
- `Dashboard.tsx` — totals row: added top border + gray background for visual separation from data rows
- `Dashboard.tsx` — totals row: changed `inrCompact` → `inr` so full values with Indian digit grouping are shown
- `Dashboard.tsx` — manual assets summary cards: changed `inrCompact` → `inr` (FDs, PPF, NPS, Cash totals)
- `DataTable.tsx` — fixed missing `key` prop on fragment in sections `map`; replaced bare `<>` with `React.Fragment key={...}`

## 2026-06-04 23:20 — Dashboard edit/format fixes, rb color, composition filter

- `frontend/src/lib/format.ts` — added `gainColorRb` (blue-8 for positive, red-8 for negative) for red-blue gradient cells
- `frontend/src/pages/Dashboard.tsx` — `ManualAssets`: fixed stale state by replacing eager `useState` initializers with `useEffect` sync on data load (edit button now shows correct PPF/NPS/Cash values); summary card values changed from `inrCompact` to `inr`; Day ₹, Gain ₹, XIRR cells now use `gainColorRb` instead of `colorize` so text matches the blue gradient
- `frontend/src/pages/Breakdown.tsx` — `FundStockRows`: added `filterCategory` prop; only stocks matching the parent category are shown (e.g. Large Cap funds show only Large Cap holdings); expanded fund row gets gray-2 background + bold weight for visual distinction; stock sub-rows get blue-0 background

---

## 2026-06-04 22:45 — Dashboard formatting, breakdown font sizes, composition values, ETF chart, resize fix

- `app/services/mf_breakdown.py` — `get_scheme_breakdown` now joins Holding/Instrument to compute absolute rupee `value` per stock (fund_value × pct/100); category_summary also gains `value` field
- `frontend/src/types/mfBreakdown.ts` — `SchemeHolding` corrected: replaced `scheme_isin` with `type`, confirmed `value: number` present
- `frontend/src/components/LwChart.tsx` — Fixed stale height in ResizeObserver via `heightRef.current = height` (sync on every render); eliminates resize glitch and ensures drag-resize reflects immediately without a page refresh
- `frontend/src/pages/Dashboard.tsx` — Holdings table: removed `compact` from all `MoneyText`, replaced `inrCompact` with `inr` for prev_close/ltp cells, table font size upgraded from `fz="xs"` to `fz="sm"`, section headers font size increased, `Badge` size upgraded to `sm`
- `frontend/src/pages/Breakdown.tsx` — All three breakdown tables changed from `fz="xs"` to `fz="sm"`; explicit `size="xs"` removed from sub-row Text components; `FundStockRows` now uses backend-supplied `h.value` directly
- `frontend/src/pages/NavChart.tsx` — ETF single-select (non-compare) mode: close price from Kite OHLC plotted as an orange line alongside the blue NAV area series

---

## 2026-06-04 22:00 — UI contrast, NAV chart formatter, composition drill-down

- `frontend/src/lib/format.ts` — `gainColor` darkened from green-5/red-5 to green-8/red-8 for legible text on heatmap cell backgrounds
- `frontend/src/components/LwChart.tsx` — added optional `priceFormatter` prop; passed to `createChart` localization options
- `frontend/src/pages/NavHistory.tsx` — NAV chart uses compact INR formatter (₹X.XXL / ₹X.XXK) on the price axis; Kite sync panel `maw` widened from 420 to 560
- `frontend/src/pages/Breakdown.tsx` — Sector sub-row stock names: removed `c="dimmed"` for legibility; CompositionTab fund rows: removed `c="dimmed"`, made expandable (shows per-stock table sorted desc by value) via new `FundStockRows` component calling `useSchemeBreakdown`

---

## 2026-06-04 21:30 — Dashboard & Breakdown UI fixes

- `frontend/src/lib/format.ts` — Increased heatmap alpha range from `0.12–0.42` to `0.20–0.65` for stronger cell contrast in both `rg` and `rb` modes
- `frontend/src/pages/NavHistory.tsx` — Removed `c="dimmed"` from NAV-sync success result text (History and AMFI lines) so they read on white backgrounds
- `frontend/src/components/SsePanel.tsx` — Added optional `doneHeading`, `errorHeading`, and `maw` props; heading now resolves dynamically based on SSE status
- `frontend/src/pages/NavHistory.tsx` — Wired Kite price-sync `SsePanel` with `doneHeading="Synced"`, `errorHeading="Sync failed"`, and `maw={420}`
- `frontend/src/components/DonutChart.tsx` — Tooltip now shows rupee value via `inr()` (e.g. `₹1,23,456.00`) instead of raw percentage
- `frontend/src/types/mfBreakdown.ts` — Added `SectorStockHolding` and `SectorStockBreakdownItem` interfaces matching the actual API response; removed mismatched `stocks?` field from `SectorCompositionItem`
- `frontend/src/api/mfBreakdown.ts` — `useSectorStockBreakdown` now returns `SectorStockBreakdownItem[]` (was incorrectly typed as `SectorCompositionItem[]`)
- `frontend/src/pages/Breakdown.tsx` — Restored expandable sector rows in SectorTab: click to expand shows per-stock sub-table with % in sector, % of equity, and ₹ value
