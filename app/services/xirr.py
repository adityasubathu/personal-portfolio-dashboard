"""
XIRR — annualised internal rate of return for irregular cashflows.

Convention: cashflows are (date, amount) tuples. Outflows (buys, invested capital)
are negative; inflows (sells, dividends, terminal value) are positive.

The rate r satisfies:  sum( cf_i / (1 + r) ** ((d_i - d_0) / 365) ) = 0

Solved with Newton-Raphson on the NPV, falling back to bisection when
the derivative is near zero or the root moves outside a reasonable bracket.
Returns None when the cashflows can't support a rate (all same sign, <2 flows, or no convergence).
"""
from datetime import date
from decimal import Decimal
from typing import Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.trade import Trade

Cashflow = tuple[date, float]


def xirr(cashflows: Sequence[Cashflow], guess: float = 0.1) -> float | None:
    if len(cashflows) < 2:
        return None
    amounts = [float(a) for _, a in cashflows]
    if not (any(a > 0 for a in amounts) and any(a < 0 for a in amounts)):
        return None

    cfs = sorted(cashflows, key=lambda x: x[0])
    d0 = cfs[0][0]
    years = [(d - d0).days / 365.0 for d, _ in cfs]
    amts = [float(a) for _, a in cfs]

    def npv(rate: float) -> float:
        return sum(a / (1 + rate) ** y for a, y in zip(amts, years))

    def dnpv(rate: float) -> float:
        return sum(-y * a / (1 + rate) ** (y + 1) for a, y in zip(amts, years))

    # Newton-Raphson
    r = guess
    for _ in range(80):
        try:
            f = npv(r)
            df = dnpv(r)
        except (OverflowError, ZeroDivisionError):
            break
        if abs(f) < 1e-7:
            return r
        if df == 0:
            break
        step = f / df
        r_new = r - step
        if r_new <= -0.999999:
            r_new = (r + -0.99) / 2  # keep inside (-1, ∞)
        if abs(r_new - r) < 1e-9:
            return r_new
        r = r_new

    # Bisection fallback over a wide bracket
    lo, hi = -0.99, 10.0
    try:
        flo, fhi = npv(lo), npv(hi)
    except (OverflowError, ZeroDivisionError):
        return None
    if flo * fhi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        fmid = npv(mid)
        if abs(fmid) < 1e-7:
            return mid
        if flo * fmid < 0:
            hi, fhi = mid, fmid
        else:
            lo, flo = mid, fmid
    return (lo + hi) / 2


async def holding_cashflows(db: AsyncSession, instrument_id: int, *, as_of: date) -> list[Cashflow]:
    """Build cashflows for a single instrument: every BUY is negative, every SELL positive,
    plus the terminal holding value (qty * last_price) as a positive flow dated `as_of`.
    Returns [] if we can't price the terminal value and there are no sells."""
    trades = (
        await db.execute(
            select(Trade).where(Trade.instrument_id == instrument_id).order_by(Trade.trade_date, Trade.id)
        )
    ).scalars().all()
    holding = (
        await db.execute(select(Holding).where(Holding.instrument_id == instrument_id))
    ).scalar_one_or_none()

    flows: list[Cashflow] = []
    for t in trades:
        amt = float(t.quantity) * float(t.price)
        if t.trade_type == "BUY":
            flows.append((t.trade_date, -amt))
        elif t.trade_type == "SELL":
            flows.append((t.trade_date, amt))

    if holding and holding.last_price and float(holding.quantity) > 0:
        terminal = float(holding.quantity) * float(holding.last_price)
        flows.append((as_of, terminal))

    return flows


async def recompute_and_store_xirr(db: AsyncSession) -> None:
    """Recompute XIRR for every holding and persist it. Called after LTP updates, trade imports, and price syncs."""
    today = date.today()
    holdings = (await db.execute(select(Holding))).scalars().all()
    for h in holdings:
        flows = await holding_cashflows(db, h.instrument_id, as_of=today)
        r = xirr(flows)
        h.xirr = r
        h.xirr_as_of = today
    await db.commit()


async def compute_holdings_xirr(db: AsyncSession, as_of: date) -> dict[int, float]:
    """Return {instrument_id: annualised XIRR} for every holding.
    Uses stored xirr when available; computes on-the-fly for any holding missing a stored value."""
    holdings = (await db.execute(select(Holding))).scalars().all()
    out: dict[int, float] = {}
    for h in holdings:
        if h.xirr is not None:
            out[h.instrument_id] = float(h.xirr)
        else:
            flows = await holding_cashflows(db, h.instrument_id, as_of=as_of)
            r = xirr(flows)
            if r is not None:
                out[h.instrument_id] = r
    return out


async def portfolio_xirr(db: AsyncSession, as_of: date) -> float | None:
    """XIRR over the union of all trades plus total current portfolio value."""
    trades = (await db.execute(select(Trade).order_by(Trade.trade_date, Trade.id))).scalars().all()
    flows: list[Cashflow] = []
    for t in trades:
        amt = float(t.quantity) * float(t.price)
        flows.append((t.trade_date, -amt if t.trade_type == "BUY" else amt))

    holdings = (await db.execute(select(Holding))).scalars().all()
    terminal = 0.0
    for h in holdings:
        if h.last_price and float(h.quantity) > 0:
            terminal += float(h.quantity) * float(h.last_price)
    if terminal > 0:
        flows.append((as_of, terminal))

    return xirr(flows)
