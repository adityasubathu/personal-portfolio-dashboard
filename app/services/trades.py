from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instrument import Instrument
from app.models.trade import Trade
from app.schemas.trades import TradeOrderRow, TradeRow, TradesListResponse


async def list_trades_grouped(db: AsyncSession, page: int, per_page: int, q: str) -> TradesListResponse:
    """Fetch all matching trades and group them by order_id (one row per order).

    Trade volumes for a single-user portfolio are small (low thousands), so grouping
    and pagination happen in Python rather than a more complex grouped SQL query.
    """
    q_stripped = (q or "").strip()

    query = select(Trade, Instrument).join(Instrument, Trade.instrument_id == Instrument.id)
    if q_stripped:
        like = f"%{q_stripped}%"
        query = query.where(or_(Instrument.tradingsymbol.ilike(like), Instrument.isin.ilike(like)))

    result = await db.execute(query.order_by(Trade.trade_date.desc(), Trade.id.desc()))
    rows = result.all()

    groups: dict[str, list[tuple[Trade, Instrument]]] = {}
    order: list[str] = []
    for t, instr in rows:
        key = t.order_id or f"trade_{t.id}"
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append((t, instr))

    total = len(order)
    offset = (page - 1) * per_page
    page_keys = order[offset : offset + per_page]

    order_rows: list[TradeOrderRow] = []
    for key in page_keys:
        members = groups[key]
        t0, instr0 = members[0]
        total_qty = sum(float(t.quantity) for t, _ in members)
        total_amount = sum(float(t.amount) if t.amount is not None else float(t.quantity) * float(t.price) for t, _ in members)

        order_rows.append(
            TradeOrderRow(
                order_id=key,
                instrument_id=t0.instrument_id,
                symbol=instr0.tradingsymbol,
                isin=instr0.isin,
                trade_date=t0.trade_date.isoformat(),
                trade_type=t0.trade_type,
                quantity=total_qty,
                price=total_amount / total_qty if total_qty else 0.0,
                amount=total_amount,
                exchange=t0.exchange,
                segment=t0.segment,
                source=t0.source,
                trades=[
                    TradeRow(
                        id=t.id,
                        instrument_id=t.instrument_id,
                        symbol=instr.tradingsymbol,
                        isin=instr.isin,
                        trade_date=t.trade_date.isoformat(),
                        trade_type=t.trade_type,
                        quantity=float(t.quantity),
                        price=float(t.price),
                        amount=float(t.amount) if t.amount is not None else None,
                        brokerage=float(t.brokerage),
                        exchange=t.exchange,
                        segment=t.segment,
                        notes=t.notes,
                        source=t.source,
                        import_batch_id=t.import_batch_id,
                        order_id=t.order_id,
                    )
                    for t, instr in members
                ],
            )
        )

    return TradesListResponse(
        rows=order_rows,
        page=page,
        per_page=per_page,
        total=total,
        total_pages=(total + per_page - 1) // per_page if per_page else 1,
        q=q_stripped,
    )
