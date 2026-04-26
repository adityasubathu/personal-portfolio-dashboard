"""
Kite ↔ local reconciliation.

Called before any upsert so that we either write a fully-consistent state or
refuse to write anything. Compares quantities by ISIN — equity holdings against
Kite /portfolio/holdings.

If a Kite-side fetch failed upstream, pass None — reconciliation is skipped
(we can't compare what we couldn't fetch).
"""
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument

QTY_TOLERANCE = 0.0001


def _fmt_qty(q: float) -> str:
    return f"{q:.4f}".rstrip("0").rstrip(".") or "0"


async def compute_discrepancies(
    db: AsyncSession,
    *,
    kite_equity: list[dict] | None,
) -> list[dict]:
    """Return a list of {kind, symbol, isin, kite_qty, local_qty}.
    kind in {"new_on_kite", "missing_from_kite", "quantity_mismatch"}.
    """
    if kite_equity is None:
        return []

    result = await db.execute(
        select(Holding, Instrument).join(Instrument, Holding.instrument_id == Instrument.id)
    )
    local_by_isin: dict[str, tuple[Holding, Instrument]] = {}
    for h, i in result.all():
        if float(h.quantity or 0) > 0 and i.isin and i.instrument_type != "MF":
            local_by_isin[i.isin] = (h, i)

    out: list[dict] = []
    kite_by_isin: dict[str, dict] = {}
    for r in kite_equity:
        qty = float(r.get("quantity") or 0)
        if qty <= 0:
            continue
        isin = (r.get("isin") or "").strip()
        if not isin:
            continue
        kite_by_isin[isin] = r

    for isin, kite_row in kite_by_isin.items():
        kite_qty = float(kite_row.get("quantity") or 0)
        local = local_by_isin.get(isin)
        if local is None:
            out.append({
                "kind": "new_on_kite",
                "symbol": kite_row.get("tradingsymbol") or isin,
                "isin": isin,
                "kite_qty": _fmt_qty(kite_qty),
                "local_qty": None,
            })
            continue
        local_h, local_i = local
        local_qty = float(local_h.quantity or 0)
        if abs(kite_qty - local_qty) > QTY_TOLERANCE:
            out.append({
                "kind": "quantity_mismatch",
                "symbol": local_i.tradingsymbol or isin,
                "isin": isin,
                "kite_qty": _fmt_qty(kite_qty),
                "local_qty": _fmt_qty(local_qty),
            })

    for isin, (local_h, local_i) in local_by_isin.items():
        if isin not in kite_by_isin:
            out.append({
                "kind": "missing_from_kite",
                "symbol": local_i.tradingsymbol or isin,
                "isin": isin,
                "kite_qty": None,
                "local_qty": _fmt_qty(float(local_h.quantity or 0)),
            })

    return out
