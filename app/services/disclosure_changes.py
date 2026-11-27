"""Latest-vs-previous change for each active equity fund's stored disclosure books.

Both books are re-mapped with today's classification so the comparison never
shows a taxonomy change as a portfolio change. Each bucket's weight change is
split against a do-nothing portfolio — the previous share counts valued at the
latest prices — into trades (what the manager did) and drift (what prices did).
"""
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.mf_breakdown import MfDisclosureBook
from app.services.composition import NON_EQUITY_LABEL, _EQUITY_CATEGORIES
from app.services.mf_ingest import _MV_MULTIPLIERS, _map_scheme_holdings, load_amfi_lookups, normalize_company_name
from app.services.nse_industry import CLASSIFICATION_LEVELS, load_classification_lookup

DIMENSIONS = ("asset_class", "market_cap", *CLASSIFICATION_LEVELS)
_PP_FIELDS = ("before_pct", "after_pct", "delta_pp", "trade_pp", "drift_pp")

_ASSET_CLASS = {
    "Large Cap": "Equity", "Mid Cap": "Equity", "Small Cap": "Equity",
    "Unclassified Equity": "Equity", "Equity - Foreign": "Equity",
    "Real Estate Trust": "Real Estate Trust",
    "Debt": "Debt", "Cash": "Cash",
    "Gold": "Precious Metals", "Silver": "Precious Metals",
    "Equity - Arbitrage": "Derivatives", "Derivatives - Leveraged": "Derivatives",
}
_MARKET_CAPS = {"Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity", "Equity - Foreign"}
_FUND_TYPE_RE = re.compile(r"Equity Scheme - (.+?)\s*\)")


@dataclass
class Position:
    market_value: float
    quantity: float | None
    labels: dict[str, str]


def fund_type_label(amfi_category: str | None) -> str | None:
    match = _FUND_TYPE_RE.search(amfi_category or "")
    return match.group(1).removesuffix(" Fund") if match else None


def bucket_labels(row: dict) -> dict[str, str]:
    category = row["category"]
    labels = {
        "asset_class": _ASSET_CLASS.get(category, "Other"),
        "market_cap": category if category in _MARKET_CAPS else NON_EQUITY_LABEL,
    }
    for level in CLASSIFICATION_LEVELS:
        labels[level] = (row.get(level) or "Unknown") if category in _EQUITY_CATEGORIES else NON_EQUITY_LABEL
    return labels


def to_positions(rows: list[dict]) -> dict[str, Position]:
    """One position per instrument and holding type; ISIN first, normalised name otherwise."""
    positions: dict[str, Position] = {}
    for r in rows:
        ident = r.get("isin") or f"name:{normalize_company_name(r['name'])}"
        key = f"{r['holding_type']}|{ident}"
        qty = r.get("quantity")
        qty = float(qty) if qty is not None else None
        existing = positions.get(key)
        if existing is None:
            positions[key] = Position(float(r["market_value"]), qty, bucket_labels(r))
            continue
        existing.market_value += float(r["market_value"])
        existing.quantity = existing.quantity + qty if existing.quantity is not None and qty is not None else None
    return positions


def sort_buckets(buckets: list[dict]) -> list[dict]:
    return sorted(buckets, key=lambda b: (b["label"] == NON_EQUITY_LABEL, -abs(b["trade_pp"]), -abs(b["delta_pp"])))


def bucket_changes(prev: dict[str, Position], latest: dict[str, Position]) -> dict[str, list[dict]] | None:
    """Per-dimension weight change in pp of NAV, split into trade_pp + drift_pp.

    Do-nothing value of a previous position = previous quantity x latest price.
    Exits and quantity-less rows (cash, TREPS) are held at their previous value.
    trade = latest weight - do-nothing weight; drift = do-nothing weight - previous
    weight. Each sums to zero across a dimension's buckets.
    """
    held_still: dict[str, float] = {}
    for key, p in prev.items():
        now = latest.get(key)
        if now is not None and p.quantity is not None and now.quantity:
            held_still[key] = p.quantity * (now.market_value / now.quantity)
        else:
            held_still[key] = p.market_value

    total_prev = sum(p.market_value for p in prev.values())
    total_latest = sum(p.market_value for p in latest.values())
    total_still = sum(held_still.values())
    if total_prev <= 0 or total_latest <= 0 or total_still <= 0:
        return None

    out: dict[str, list[dict]] = {}
    for dim in DIMENSIONS:
        acc: dict[str, list[float]] = {}  # label -> [before, after, still]
        for key in prev.keys() | latest.keys():
            label = (latest.get(key) or prev[key]).labels[dim]
            a = acc.setdefault(label, [0.0, 0.0, 0.0])
            if key in prev:
                a[0] += prev[key].market_value / total_prev * 100
                a[2] += held_still[key] / total_still * 100
            if key in latest:
                a[1] += latest[key].market_value / total_latest * 100
        out[dim] = sort_buckets([
            {
                "label": label, "before_pct": before, "after_pct": after,
                "delta_pp": after - before, "trade_pp": after - still, "drift_pp": still - before,
                "trade_value": 0.0,
            }
            for label, (before, after, still) in acc.items()
        ])
    return out


def combine(funds: list[tuple[float, dict[str, list[dict]]]]) -> dict[str, list[dict]]:
    """Holding-value-weighted average of per-fund bucket changes; trade_value is summed."""
    total = sum(value for value, _ in funds)
    out: dict[str, list[dict]] = {}
    for dim in DIMENSIONS:
        acc: dict[str, dict] = {}
        for value, dims in funds:
            weight = value / total if total else 0.0
            for b in dims[dim]:
                a = acc.setdefault(b["label"], {"label": b["label"], **{f: 0.0 for f in _PP_FIELDS}, "trade_value": 0.0})
                for f in _PP_FIELDS:
                    a[f] += b[f] * weight
                a["trade_value"] += b["trade_value"]
        out[dim] = sort_buckets(list(acc.values()))
    return out


def _rounded(dimensions: dict[str, list[dict]]) -> dict[str, list[dict]]:
    return {
        dim: [{**b, **{f: round(b[f], 4) for f in _PP_FIELDS}, "trade_value": round(b["trade_value"], 2)} for b in buckets]
        for dim, buckets in dimensions.items()
    }


def book_positions(book: MfDisclosureBook, lookups, nse_levels: dict[str, dict]) -> dict[str, Position]:
    multiplier = _MV_MULTIPLIERS.get((book.meta or {}).get("market_value_unit"))
    if multiplier is None:
        return {}
    rows, _ = _map_scheme_holdings(book.scheme_isin, book.holdings, multiplier, {}, lookups, False)
    for row in rows:
        levels = nse_levels.get(row.get("isin") or "")
        if levels and row["category"] in _EQUITY_CATEGORIES:
            for level in CLASSIFICATION_LEVELS:
                if levels[level]:
                    row[level] = levels[level]
    return to_positions(rows)


async def get_fund_changes(db: AsyncSession) -> dict:
    books = (await db.execute(
        select(MfDisclosureBook).order_by(MfDisclosureBook.scheme_isin, MfDisclosureBook.as_of.desc())
    )).scalars().all()
    by_fund: dict[str, list[MfDisclosureBook]] = {}
    for book in books:
        by_fund.setdefault(book.scheme_isin, []).append(book)
    if not by_fund:
        return {"funds": [], "rollup": None}

    held = (await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.isin.in_(list(by_fund)))
    )).all()
    value_by_isin = {i.isin: h.market_value for h, i in held}
    name_by_isin = {i.isin: i.tradingsymbol or i.name or i.isin for h, i in held}

    lookups = await load_amfi_lookups(db)
    nse_levels = await load_classification_lookup(db)

    funds = []
    for isin, fund_books in by_fund.items():
        latest = fund_books[0]
        previous = fund_books[1] if len(fund_books) > 1 else None
        value = value_by_isin.get(isin, 0.0)
        dimensions = None
        if previous is not None:
            dimensions = bucket_changes(
                book_positions(previous, lookups, nse_levels),
                book_positions(latest, lookups, nse_levels),
            )
        if dimensions is not None:
            for buckets in dimensions.values():
                for b in buckets:
                    b["trade_value"] = b["trade_pp"] / 100 * value
        funds.append({
            "scheme_isin": isin,
            "name": name_by_isin.get(isin, isin),
            "fund_type": fund_type_label(latest.amfi_category),
            "latest_as_of": latest.as_of,
            "previous_as_of": previous.as_of if previous else None,
            "holding_value": round(value, 2),
            "dimensions": _rounded(dimensions) if dimensions else None,
        })
    funds.sort(key=lambda f: -f["holding_value"])

    compared = [f for f in funds if f["dimensions"]]
    rollup = None
    if compared:
        rollup = {
            "fund_count": len(compared),
            "total_value": round(sum(f["holding_value"] for f in compared), 2),
            "latest_as_of": sorted({f["latest_as_of"] for f in compared}),
            "previous_as_of": sorted({f["previous_as_of"] for f in compared}),
            "dimensions": _rounded(combine([(f["holding_value"], f["dimensions"]) for f in compared])),
        }
    return {"funds": funds, "rollup": rollup}
