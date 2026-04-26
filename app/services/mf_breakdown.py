import csv
import io
import re
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path

import openpyxl
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.mf_breakdown import AmfiMarketCap, MfSchemeBreakdown
from app.time_util import now_ist

BREAKDOWN_DIR = Path("data/mf_portfolio_breakdown")

_AMFI_DATE_RE = re.compile(
    r"AverageMarketCapitalization(\d{1,2})(\w{3})(\d{4})",
    re.IGNORECASE,
)
_MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

# ETFs whose entire equity portfolio is a single market-cap category.
# All equity holdings in these are classified directly without AMFI lookup.
ETF_CAP_OVERRIDE: dict[str, str] = {
    "INF247L01AP3": "Large Cap",   # MON100
    "INF204KB14I2": "Large Cap",   # NIFTYBEES
    "INF732E01045": "Large Cap",   # JUNIORBEES (Nifty Next 50)
    "INF769K01IC9": "Mid Cap",     # MIDCAPETF
}

_BRACKET_RE = re.compile(r"\[.*?\]")
_GLUED_DOT = re.compile(r"\.(?=[a-z])")
_ABBREV_MAP = [
    (re.compile(r"\bltd\.?\b", re.IGNORECASE), "limited"),
    (re.compile(r"\bcorp\.?\b", re.IGNORECASE), "corporation"),
    (re.compile(r"\bpvt\.?\b", re.IGNORECASE), "private"),
    (re.compile(r"\bco\.?\b", re.IGNORECASE), "company"),
]
_SUFFIX_RE = re.compile(
    r"\b(limited|limted|company|corporation|ordinary\s+shares|private)\b",
    re.IGNORECASE,
)
_TRAILING_JUNK = re.compile(r"[\s.*\-]+$")
_MULTI_SPACE = re.compile(r"\s+")

_NAME_ALIASES: dict[str, str] = {
    "m.r.f.": "mrf",
    "m r f": "mrf",
}


def normalize_company_name(name: str) -> str:
    s = name.lower().strip()
    s = _BRACKET_RE.sub("", s)
    s = _GLUED_DOT.sub(". ", s)
    for pat, expansion in _ABBREV_MAP:
        s = pat.sub(expansion, s)
    s = _SUFFIX_RE.sub("", s)
    s = s.replace("(", " ").replace(")", " ").replace(".", " ")
    s = _TRAILING_JUNK.sub("", s)
    s = _MULTI_SPACE.sub(" ", s).strip()
    for alias, canonical in _NAME_ALIASES.items():
        s = s.replace(alias, canonical)
    return s


def _find_amfi_xlsx() -> Path | None:
    if not BREAKDOWN_DIR.exists():
        return None
    candidates = list(BREAKDOWN_DIR.glob("AverageMarketCapitalization*.xlsx"))
    if not candidates:
        return None
    candidates.sort(key=lambda p: _parse_amfi_date(p.name) or date.min, reverse=True)
    return candidates[0]


def _parse_amfi_date(filename: str) -> date | None:
    m = _AMFI_DATE_RE.search(filename)
    if not m:
        return None
    day, mon_str, year = int(m.group(1)), m.group(2).lower(), int(m.group(3))
    month = _MONTH_MAP.get(mon_str[:3])
    if not month:
        return None
    return date(year, month, day)


async def sync_amfi_market_cap(db: AsyncSession) -> dict:
    xlsx_path = _find_amfi_xlsx()
    if not xlsx_path:
        return {"error": "No AverageMarketCapitalization*.xlsx found in data/mf_portfolio_breakdown/"}

    file_date = _parse_amfi_date(xlsx_path.name)
    stale_warning = None
    if file_date:
        age_days = (date.today() - file_date).days
        if age_days > 180:
            stale_warning = f"Classification file is {age_days} days old ({file_date:%d %b %Y}). Consider updating from AMFI website."

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]

    rows_to_insert: list[dict] = []
    counts = {"Large Cap": 0, "Mid Cap": 0, "Small Cap": 0}

    for i, row in enumerate(ws.iter_rows(min_row=3, values_only=True)):
        company = str(row[1] or "").strip()
        isin = str(row[2] or "").strip() or None
        bse_sym = str(row[3] or "").strip() or None
        nse_sym = str(row[5] or "").strip() or None
        cat = str(row[10] or "").strip()
        if not company or cat not in counts:
            continue
        counts[cat] += 1
        rows_to_insert.append({
            "company_name": company,
            "isin": isin,
            "bse_symbol": bse_sym,
            "nse_symbol": nse_sym,
            "categorization": cat,
            "name_normalized": normalize_company_name(company),
            "updated_at": now_ist(),
        })

    wb.close()

    await db.execute(delete(AmfiMarketCap))
    if rows_to_insert:
        await db.execute(AmfiMarketCap.__table__.insert(), rows_to_insert)
    await db.flush()

    result = {
        "rows_loaded": len(rows_to_insert),
        "large": counts["Large Cap"],
        "mid": counts["Mid Cap"],
        "small": counts["Small Cap"],
        "file": xlsx_path.name,
    }
    if file_date:
        result["file_date"] = file_date.strftime("%d %b %Y")
    if stale_warning:
        result["stale_warning"] = stale_warning
    return result


def _classify_equity(
    name: str,
    amfi_by_name: dict[str, str],
    amfi_names: list[str],
) -> str:
    norm = normalize_company_name(name)
    cat = amfi_by_name.get(norm)
    if cat:
        return cat

    best_ratio = 0.0
    best_cat = None
    for amfi_norm, amfi_cat in amfi_by_name.items():
        r = SequenceMatcher(None, norm, amfi_norm).ratio()
        if r > best_ratio:
            best_ratio = r
            best_cat = amfi_cat
    if best_ratio >= 0.85 and best_cat:
        return best_cat

    return "Unclassified Equity"


def _classify_type(
    holding_type: str,
    name: str,
    amfi_by_name: dict[str, str],
    amfi_names: list[str],
    equity_override: str | None = None,
) -> str:
    t = holding_type.strip()
    if t == "Equity":
        if equity_override:
            return equity_override
        return _classify_equity(name, amfi_by_name, amfi_names)
    if t.startswith("Bond"):
        return "Debt"
    if t.startswith("Cash") or t == "Cash":
        return "Cash"
    return "Other"


def _parse_holdings_pct(s: str) -> float | None:
    s = s.strip().rstrip("%").strip()
    try:
        return float(s)
    except ValueError:
        return None


async def ingest_scheme_csvs(db: AsyncSession) -> dict:
    amfi_rows = (await db.execute(
        select(AmfiMarketCap.name_normalized, AmfiMarketCap.categorization)
    )).all()
    amfi_by_name: dict[str, str] = {n: c for n, c in amfi_rows}
    amfi_names = list(amfi_by_name.keys())

    held_funds = (await db.execute(
        select(Instrument)
        .join(Holding, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF")))
    )).scalars().all()
    held_isins = {i.isin for i in held_funds if i.isin}

    _DEBT_KEYWORDS = re.compile(r"\b(debt|liquid)\b", re.IGNORECASE)
    debt_fund_isins: set[str] = set()
    for i in held_funds:
        if i.isin and i.tradingsymbol and _DEBT_KEYWORDS.search(i.tradingsymbol):
            debt_fund_isins.add(i.isin)

    if not BREAKDOWN_DIR.exists():
        return {"schemes_processed": 0, "rows_upserted": 0, "unmatched_equities": [],
                "skipped_isins": [], "errors": ["Directory data/mf_portfolio_breakdown/ not found"]}

    csv_files = list(BREAKDOWN_DIR.glob("*.csv"))
    schemes_processed = 0
    rows_upserted = 0
    unmatched: list[dict] = []
    skipped_isins: list[str] = []
    errors: list[str] = []
    seen_isins: set[str] = set()

    for csv_path in csv_files:
        scheme_isin = csv_path.stem.strip()
        if scheme_isin not in held_isins:
            skipped_isins.append(scheme_isin)
            continue

        seen_isins.add(scheme_isin)
        is_debt_fund = scheme_isin in debt_fund_isins
        equity_override = ETF_CAP_OVERRIDE.get(scheme_isin)

        try:
            text = csv_path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            text = csv_path.read_text(encoding="latin-1")

        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            errors.append(f"{csv_path.name}: empty or no header")
            continue

        dedup: dict[tuple[str, str], dict] = {}
        for row_num, row in enumerate(reader, start=2):
            name = (row.get("Name") or "").strip()
            htype = (row.get("Type") or "").strip()
            pct_raw = row.get("Holdings") or ""
            if not name or not htype:
                continue
            pct = _parse_holdings_pct(pct_raw)
            if pct is None:
                errors.append(f"{csv_path.name} row {row_num}: bad Holdings '{pct_raw}'")
                continue

            key = (name[:255], htype[:50])
            if key in dedup:
                dedup[key]["holdings_pct"] += pct
            else:
                if is_debt_fund:
                    category = "Debt"
                else:
                    category = _classify_type(htype, name, amfi_by_name, amfi_names, equity_override)
                if category == "Unclassified Equity":
                    unmatched.append({"name": name, "scheme_isin": scheme_isin})
                dedup[key] = {
                    "scheme_isin": scheme_isin,
                    "name": key[0],
                    "holding_type": key[1],
                    "holdings_pct": pct,
                    "category": category,
                    "updated_at": now_ist(),
                }

        values = list(dedup.values())
        if values:
            stmt = pg_insert(MfSchemeBreakdown).values(values)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_mf_breakdown_scheme_name_type",
                set_={
                    "holdings_pct": stmt.excluded.holdings_pct,
                    "category": stmt.excluded.category,
                    "updated_at": stmt.excluded.updated_at,
                },
            )
            await db.execute(stmt)
            rows_upserted += len(values)

        schemes_processed += 1

    # Remove rows for schemes whose CSV was deleted.
    if seen_isins:
        await db.execute(
            delete(MfSchemeBreakdown).where(MfSchemeBreakdown.scheme_isin.notin_(seen_isins))
        )
    else:
        await db.execute(delete(MfSchemeBreakdown))

    await db.commit()

    return {
        "schemes_processed": schemes_processed,
        "rows_upserted": rows_upserted,
        "unmatched_equities": unmatched,
        "skipped_isins": skipped_isins,
        "errors": errors[:30],
    }


_SGB_RE = re.compile(r"^SGB", re.IGNORECASE)


async def get_stock_holdings_table(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF")))
    )
    all_holdings = result.all()

    holding_values: dict[str, float] = {}
    for h, i in all_holdings:
        if not i.isin:
            continue
        ltp = float(h.last_price) if h.last_price else None
        holding_values[i.isin] = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)

    if not holding_values:
        return []

    breakdown_rows = (await db.execute(
        select(MfSchemeBreakdown).where(
            MfSchemeBreakdown.scheme_isin.in_(list(holding_values.keys())),
            MfSchemeBreakdown.holding_type == "Equity",
        )
    )).scalars().all()

    stock_totals: dict[str, float] = {}
    for row in breakdown_rows:
        hv = holding_values.get(row.scheme_isin, 0)
        contribution = hv * (float(row.holdings_pct) / 100.0)
        stock_totals[row.name] = stock_totals.get(row.name, 0) + contribution

    total_portfolio = sum(holding_values.values())
    if total_portfolio <= 0:
        return []

    amfi_rows = (await db.execute(select(AmfiMarketCap))).scalars().all()
    ticker_lookup: dict[str, str] = {}
    for a in amfi_rows:
        ticker_lookup[normalize_company_name(a.company_name)] = a.nse_symbol or a.bse_symbol or ""

    stocks = []
    for name, value in stock_totals.items():
        if value <= 0:
            continue
        ticker = ticker_lookup.get(normalize_company_name(name), "")
        stocks.append({
            "name": name,
            "ticker": ticker,
            "weight_pct": round(value / total_portfolio * 100, 4),
            "value": round(value, 2),
        })

    stocks.sort(key=lambda s: s["value"], reverse=True)
    return stocks


async def get_breakdown_chart_data(db: AsyncSession) -> dict:
    from app.services.manual_assets import get_manual_assets_summary

    result = await db.execute(
        select(Holding, Instrument)
        .join(Instrument, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF", "BOND")))
    )
    all_holdings = result.all()

    category_totals: dict[str, float] = {}
    fund_isins: list[str] = []

    for h, i in all_holdings:
        ltp = float(h.last_price) if h.last_price else None
        value = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)

        if i.instrument_type == "BOND" and i.tradingsymbol and _SGB_RE.match(i.tradingsymbol):
            category_totals["Gold"] = category_totals.get("Gold", 0) + value
        elif i.instrument_type in ("MF", "ETF") and i.isin:
            fund_isins.append(i.isin)

    holding_values: dict[str, float] = {}
    for h, i in all_holdings:
        if i.isin and i.isin in fund_isins:
            ltp = float(h.last_price) if h.last_price else None
            holding_values[i.isin] = float(h.quantity) * ltp if ltp else float(h.total_cost or 0)

    if holding_values:
        breakdown_rows = (await db.execute(
            select(MfSchemeBreakdown).where(
                MfSchemeBreakdown.scheme_isin.in_(list(holding_values.keys()))
            )
        )).scalars().all()

        for row in breakdown_rows:
            hv = holding_values.get(row.scheme_isin, 0)
            contribution = hv * (float(row.holdings_pct) / 100.0)
            category_totals[row.category] = category_totals.get(row.category, 0) + contribution

    manual = await get_manual_assets_summary(db)
    debt_from_manual = manual["total_fd"] + manual["total_ppf"]
    if manual["nps"]:
        nps_val = manual["nps"]["current_value"]
        category_totals["Large Cap"] = category_totals.get("Large Cap", 0) + nps_val * 0.75
        debt_from_manual += nps_val * 0.25
    if debt_from_manual > 0:
        category_totals["Debt"] = category_totals.get("Debt", 0) + debt_from_manual
    if manual.get("total_cash", 0) > 0:
        category_totals["Cash"] = category_totals.get("Cash", 0) + manual["total_cash"]

    if not category_totals:
        return {"labels": [], "values": [], "total": 0}

    order = [
        "Large Cap", "Mid Cap", "Small Cap", "Unclassified Equity",
        "Gold", "Debt", "Cash", "Other",
    ]
    labels = []
    values = []
    for cat in order:
        v = category_totals.get(cat, 0)
        if v > 0:
            labels.append(cat)
            values.append(round(v, 2))

    return {
        "labels": labels,
        "values": values,
        "total": round(sum(values), 2),
    }
