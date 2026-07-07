# Changelog

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
