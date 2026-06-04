# Changelog

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
