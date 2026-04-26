"""
FIFO holdings engine.

Walks all trades for each instrument in chronological order and computes:
  - current quantity held
  - average cost (weighted by remaining lots)
  - total cost basis (FIFO-adjusted)
  - realised PnL (informational)

Updates the `holdings` table in place. Instruments with zero remaining
quantity have their holding row deleted (or quantity set to 0).
"""
from collections import deque

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.trade import Trade
from app.time_util import now_ist


async def recompute_holdings(db: AsyncSession) -> dict:
    """
    Recompute all holdings from scratch from the trades table.
    Preserves last_price / last_price_at / kite_synced fields on existing rows
    so a CSV re-import doesn't wipe price data populated by Kite/AMFI sync.
    Returns { count, violations } where violations is a list of instruments whose
    cumulative SELL quantity exceeds BUY quantity (impossible for cash holdings of
    STOCK/ETF/BOND/MF — indicates missing buy trades in the imported data).
    """
    # Snapshot price fields from existing holdings, keyed by instrument_id
    existing = (await db.execute(select(Holding))).scalars().all()
    price_cache: dict[int, dict] = {
        h.instrument_id: {
            "last_price": h.last_price,
            "last_price_at": h.last_price_at,
            "unrealised_pnl": h.unrealised_pnl,
            "kite_synced": h.kite_synced,
            "kite_synced_at": h.kite_synced_at,
        }
        for h in existing
    }

    # Fetch all trades ordered by instrument then date
    result = await db.execute(
        select(Trade).order_by(Trade.instrument_id, Trade.trade_date, Trade.id)
    )
    trades = result.scalars().all()

    by_instrument: dict[int, list[Trade]] = {}
    for t in trades:
        by_instrument.setdefault(t.instrument_id, []).append(t)

    instrument_rows = (await db.execute(select(Instrument))).scalars().all()
    instruments = {i.id: i for i in instrument_rows}

    await db.execute(delete(Holding))

    upserted = 0
    violations: list[dict] = []
    for instrument_id, instrument_trades in by_instrument.items():
        ledger = _fifo_ledger(instrument_trades)

        if ledger["total_sell"] > ledger["total_buy"] + 1e-6:
            instr = instruments.get(instrument_id)
            violations.append({
                "instrument_id": instrument_id,
                "tradingsymbol": instr.tradingsymbol if instr else f"#{instrument_id}",
                "isin": instr.isin if instr else None,
                "instrument_type": instr.instrument_type if instr else "?",
                "total_buy": round(ledger["total_buy"], 6),
                "total_sell": round(ledger["total_sell"], 6),
                "net": round(ledger["total_buy"] - ledger["total_sell"], 6),
            })

        if ledger["quantity"] <= 0:
            continue

        cached = price_cache.get(instrument_id, {})
        last_price = cached.get("last_price")
        unrealised = None
        if last_price is not None:
            unrealised = round(
                ledger["quantity"] * (float(last_price) - ledger["average_price"]), 6
            )

        h = Holding(
            instrument_id=instrument_id,
            quantity=ledger["quantity"],
            average_price=ledger["average_price"],
            total_cost=ledger["total_cost"],
            last_price=last_price,
            last_price_at=cached.get("last_price_at"),
            unrealised_pnl=unrealised,
            kite_synced=cached.get("kite_synced", False),
            kite_synced_at=cached.get("kite_synced_at"),
            updated_at=now_ist(),
        )
        db.add(h)
        upserted += 1

    await db.flush()
    return {"count": upserted, "violations": violations}


def _fifo_ledger(trades: list[Trade]) -> dict:
    """
    Process a list of trades for a single instrument using FIFO.
    Returns { quantity, average_price, total_cost, realised_pnl, total_buy, total_sell }.
    """
    lots: deque[tuple[float, float]] = deque()
    realised_pnl = 0.0
    total_buy = 0.0
    total_sell = 0.0

    for trade in trades:
        qty = float(trade.quantity)
        price = float(trade.price)

        if trade.trade_type == "BUY":
            total_buy += qty
            lots.append((qty, price))

        elif trade.trade_type == "SELL":
            total_sell += qty
            remaining_sell = qty
            while remaining_sell > 0 and lots:
                lot_qty, lot_price = lots[0]
                if lot_qty <= remaining_sell:
                    realised_pnl += lot_qty * (price - lot_price)
                    remaining_sell -= lot_qty
                    lots.popleft()
                else:
                    realised_pnl += remaining_sell * (price - lot_price)
                    lots[0] = (lot_qty - remaining_sell, lot_price)
                    remaining_sell = 0

    total_qty = sum(q for q, _ in lots)
    total_cost = sum(q * p for q, p in lots)
    avg_price = total_cost / total_qty if total_qty > 0 else 0.0

    return {
        "quantity": round(total_qty, 6),
        "average_price": round(avg_price, 6),
        "total_cost": round(total_cost, 6),
        "realised_pnl": round(realised_pnl, 6),
        "total_buy": total_buy,
        "total_sell": total_sell,
    }
