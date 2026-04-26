"""
Portfolio NAV reconstruction.

Walks trades chronologically from the earliest trade date to today, maintains
a running {instrument_id -> (qty, cost_basis)} map, and for each day multiplies
current holdings by their closing price (from price_history, forward-filled
across weekends/holidays/gaps) to produce a {date, value, invested} timeseries
for the NAV-history chart.

`invested` is the weighted-average cost basis of *currently-held* units — on a
SELL, the cost basis shrinks proportionally (sold units take their share of
cost out) rather than subtracting the sell proceeds. This matches what the
Holdings page reports as total_cost and keeps the chart's invested line
consistent with the cost-basis column on the dashboard.
"""
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instrument import Instrument
from app.models.nav_history import NavHistory
from app.models.price_history import PriceHistory
from app.models.trade import Trade

MF_TYPES = {"MF"}


async def compute_nav_series(db: AsyncSession) -> list[dict]:
    """Return [{date, value, invested}] from the earliest trade to today.
    Forward-fills missing prices; falls back to trade price when no close
    is known yet for a newly-bought instrument."""
    trades = list(
        (await db.execute(select(Trade).order_by(Trade.trade_date, Trade.id))).scalars().all()
    )
    if not trades:
        return []

    traded_ids = {t.instrument_id for t in trades}
    instr_rows = (
        await db.execute(select(Instrument).where(Instrument.id.in_(traded_ids)))
    ).scalars().all()
    mf_ids = {i.id for i in instr_rows if i.instrument_type in MF_TYPES}

    price_rows = list(
        (
            await db.execute(
                select(
                    PriceHistory.instrument_id,
                    PriceHistory.price_date,
                    PriceHistory.close,
                ).order_by(PriceHistory.instrument_id, PriceHistory.price_date)
            )
        ).all()
    )
    nav_rows = list(
        (
            await db.execute(
                select(
                    NavHistory.instrument_id,
                    NavHistory.nav_date,
                    NavHistory.nav,
                ).order_by(NavHistory.instrument_id, NavHistory.nav_date)
            )
        ).all()
    )

    price_lookup: dict[int, dict[date, float]] = defaultdict(dict)
    for iid, d, c in price_rows:
        price_lookup[iid][d] = float(c)
    for iid, d, nav in nav_rows:
        if iid in mf_ids:
            price_lookup[iid][d] = float(nav)

    # Group trades by date for O(1) lookup inside the day loop.
    trades_by_date: dict[date, list[Trade]] = defaultdict(list)
    for t in trades:
        trades_by_date[t.trade_date].append(t)

    start = trades[0].trade_date
    end = date.today()

    qty: dict[int, float] = defaultdict(float)
    cost: dict[int, float] = defaultdict(float)  # running cost basis of held units
    last_close: dict[int, float] = {}
    series: list[dict] = []

    cur = start
    while cur <= end:
        # Apply trades on this date before valuing.
        for t in trades_by_date.get(cur, []):
            q = float(t.quantity or 0)
            p = float(t.price or 0)
            brokerage = float(t.brokerage or 0)
            if t.trade_type == "BUY":
                qty[t.instrument_id] += q
                cost[t.instrument_id] += q * p + brokerage
                # Seed last_close from the trade price if no external close is known yet.
                last_close.setdefault(t.instrument_id, p)
            else:  # SELL
                held = qty[t.instrument_id]
                if held > 0:
                    # Weighted-average cost: sold units take their share of the basis out.
                    cost_removed = cost[t.instrument_id] * min(q, held) / held
                    cost[t.instrument_id] = max(0.0, cost[t.instrument_id] - cost_removed)
                qty[t.instrument_id] -= q
                if qty[t.instrument_id] <= 1e-9:
                    # Full exit — zero out any residual float dust.
                    qty[t.instrument_id] = 0.0
                    cost[t.instrument_id] = 0.0

        # Update last_close from any price_history row on this date.
        for iid, day_map in price_lookup.items():
            close = day_map.get(cur)
            if close is not None:
                last_close[iid] = close

        value = 0.0
        for iid, q in qty.items():
            if q <= 0:
                continue
            price = last_close.get(iid)
            if price is None:
                continue  # No data yet — treat as zero (will start contributing once first close lands)
            value += q * price

        invested = sum(c for c in cost.values() if c > 0)
        series.append({
            "date": cur.isoformat(),
            "value": round(value, 2),
            "invested": round(invested, 2),
        })
        cur += timedelta(days=1)

    return series
