from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.manual_asset import ManualAsset
from app.services.usdinr import get_usdinr_rate


def compute_fd_value(principal: float, annual_rate: float, start: date, as_of: date | None = None) -> float:
    """Future value with quarterly compounding: FV = P * (1 + r/4)^(4t)"""
    if as_of is None:
        as_of = date.today()
    days = (as_of - start).days
    if days <= 0:
        return principal
    years = days / 365.25
    n = 4  # quarterly
    return principal * (1 + annual_rate / (100 * n)) ** (n * years)


async def get_manual_assets_summary(db: AsyncSession) -> dict:
    rows = (await db.execute(
        select(ManualAsset).order_by(ManualAsset.asset_type, ManualAsset.id)
    )).scalars().all()

    fds = []
    ppf = None
    nps = None
    cash = None
    usd_cash = None
    usd_cash_usd = 0.0
    foreign_equities = []
    today = date.today()

    usdinr_rate = await get_usdinr_rate(db)

    for a in rows:
        if a.asset_type == "FD":
            current = compute_fd_value(
                float(a.principal), float(a.interest_rate), a.start_date, today
            ) if a.principal and a.interest_rate and a.start_date else float(a.principal or 0)
            maturity_value = compute_fd_value(
                float(a.principal), float(a.interest_rate), a.start_date, a.maturity_date
            ) if a.principal and a.interest_rate and a.start_date and a.maturity_date else current
            fds.append({
                "id": a.id,
                "label": a.label,
                "principal": float(a.principal or 0),
                "interest_rate": float(a.interest_rate or 0),
                "start_date": a.start_date,
                "maturity_date": a.maturity_date,
                "current_value": round(current, 2),
                "maturity_value": round(maturity_value, 2),
                "is_emergency_fund": a.is_emergency_fund,
            })
        elif a.asset_type == "PPF":
            ppf = {"id": a.id, "label": a.label, "current_value": float(a.current_value or 0)}
        elif a.asset_type == "NPS":
            nps = {"id": a.id, "label": a.label, "current_value": float(a.current_value or 0)}
        elif a.asset_type == "CASH":
            cash = {"id": a.id, "label": a.label, "current_value": float(a.current_value or 0)}
        elif a.asset_type == "USD_CASH":
            usd_cash_usd = float(a.current_value or 0)
            usd_cash = {"id": a.id, "label": a.label, "current_value": round(usd_cash_usd * usdinr_rate, 2)}
        elif a.asset_type == "FOREIGN_EQ":
            value_usd = float(a.current_value or 0)
            foreign_equities.append({
                "id": a.id,
                "label": a.label or "",
                "value_usd": value_usd,
                "invested_usd": float(a.principal or 0),
                "value_inr": round(value_usd * usdinr_rate, 2),
            })

    total_fd = sum(f["current_value"] for f in fds)
    emergency_total = sum(f["current_value"] for f in fds if f["is_emergency_fund"])
    total_ppf = ppf["current_value"] if ppf else 0
    total_nps = nps["current_value"] if nps else 0
    total_cash = (cash["current_value"] if cash else 0) + (usd_cash["current_value"] if usd_cash else 0)
    total_foreign_usd = sum(f["value_usd"] for f in foreign_equities)
    total_foreign_inr = sum(f["value_inr"] for f in foreign_equities)
    total = total_fd + total_ppf + total_nps + total_cash + total_foreign_inr

    return {
        "fds": fds,
        "ppf": ppf,
        "nps": nps,
        "cash": cash,
        "usd_cash": usd_cash,
        "foreign_equities": foreign_equities,
        "total_fd": total_fd,
        "emergency_total": emergency_total,
        "total_ppf": total_ppf,
        "total_nps": total_nps,
        "total_cash": total_cash,
        "usd_cash_value_usd": round(usd_cash_usd, 2),
        "total_foreign_equity_usd": round(total_foreign_usd, 2),
        "total_foreign_equity_inr": round(total_foreign_inr, 2),
        "usdinr_rate": usdinr_rate,
        "total_manual": total,
    }
