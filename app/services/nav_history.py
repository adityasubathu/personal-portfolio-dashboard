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
    """Return [{date, value, invested, unit_nav}] from the earliest trade to today.
    Forward-fills missing prices; falls back to trade price when no close
    is known yet for a newly-bought instrument.

    `unit_nav` is a daily time-weighted return (Modified Dietz, cash flows
    counted at day-end) compounded from BASE_NAV — the standard GIPS-style
    method fund administrators use to report performance independent of
    contribution/withdrawal timing. Unlike a unit-creation approach keyed to
    trade price, it never compares a trade's execution price against that
    day's close, so it isn't thrown off when a data vendor (e.g. Kite)
    retroactively re-scales historical closes for a later corporate action —
    each day's return only ever compares consecutive days from the same
    price series. See plans/2026-08-19-unit-nav-chart.md.
    """
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

    BASE_NAV = 100.0
    prev_value = 0.0   # prior day's end-of-day portfolio value (yesterday's `value`)
    unit_nav = BASE_NAV

    cur = start
    while cur <= end:
        # Update last_close from any price_history row on this date.
        for iid, day_map in price_lookup.items():
            close = day_map.get(cur)
            if close is not None:
                last_close[iid] = close

        # Apply trades on this date, tracking net cash flow (BUY = contribution,
        # SELL = withdrawal) for today's TWR calc below.
        net_cf = 0.0
        for t in trades_by_date.get(cur, []):
            q = float(t.quantity or 0)
            p = float(t.price or 0)
            brokerage = float(t.brokerage or 0)
            if t.trade_type == "BUY":
                qty[t.instrument_id] += q
                cost[t.instrument_id] += q * p + brokerage
                # Seed last_close from the trade price if no external close is known yet.
                last_close.setdefault(t.instrument_id, p)
                net_cf += q * p + brokerage
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
                net_cf -= q * p

        value = 0.0
        for iid, q in qty.items():
            if q <= 0:
                continue
            price = last_close.get(iid)
            if price is None:
                continue  # No data yet — treat as zero (will start contributing once first close lands)
            value += q * price

        invested = sum(c for c in cost.values() if c > 0)

        # Daily time-weighted return: organic gain = end_value - begin_value -
        # net_cash_flow, scaled by begin_value. On a day with no prior holdings
        # (fund inception, or re-entry after a full exit) there's no basis to
        # measure a return against yet — comparing today's contributed cash
        # (real trade price) to today's mark (price_history close) would just
        # reintroduce whatever gap exists between the two, e.g. Kite retroactively
        # rescaling historical closes for a later corporate action. So unit_nav
        # carries forward unchanged (100 on true inception), and today's
        # end-of-day value becomes tomorrow's basis instead.
        if prev_value > 1e-9:
            numerator = value - prev_value - net_cf
            unit_nav *= 1.0 + numerator / prev_value

        series.append({
            "date": cur.isoformat(),
            "value": round(value, 2),
            "invested": round(invested, 2),
            "unit_nav": round(unit_nav, 4),
        })
        prev_value = value
        cur += timedelta(days=1)

    return series
