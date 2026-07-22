import csv
import io
import re
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path

import openpyxl
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.holding import Holding
from app.models.instrument import Instrument
from app.models.mf_breakdown import AmfiMarketCap, EquityCategoryOverride, EquitySectorOverride, MfSchemeBreakdown
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
# Fallback cap category for holdings in these ETFs that AMFI doesn't recognise.
# AMFI always takes priority; this only applies when AMFI returns Unclassified Equity.
ETF_CAP_OVERRIDE: dict[str, str] = {
    "INF204KB14I2": "Large Cap",   # NIFTYBEES
    "INF732E01045": "Large Cap",   # JUNIORBEES (Nifty Next 50)
    "INF769K01IC9": "Mid Cap",     # MIDCAPETF
    "INF0R8F01141": "Small Cap",   # SML100CASE
}

# Funds whose equity holdings are entirely foreign; bypasses AMFI market-cap lookup.
FOREIGN_FUND_ISINS: set[str] = {
    "INF247L01AP3",   # MON100 / Nasdaq 100
}

# Individual company names (normalised, lowercase substrings) that are always foreign equity,
# regardless of which fund holds them.
FOREIGN_COMPANY_SUBSTRINGS: set[str] = {
    "alphabet", "amazon", "apple", "meta platforms", "microsoft",
}

# Commodity ETFs whose entire value maps to a single non-equity category.
# These bypass MF breakdown CSV lookup entirely.
COMMODITY_ETF_CATEGORY: dict[str, str] = {
    "INF109KC1Y56": "Silver",   # SILVERIETF
    "INF204KB17I5": "Gold",     # GOLDBEES
    "INF0R8F01042": "Gold",     # GOLDCASE
}

# Matches Sovereign Gold Bond tradingsymbols (used across allocation and composition).
_SGB_RE = re.compile(r"^SGB", re.IGNORECASE)

_BRACKET_RE = re.compile(r"[\[(].*?[\])]")
_GLUED_DOT = re.compile(r"\.(?=[a-z])")
_ABBREV_MAP = [
    (re.compile(r"\bltd\.?(?=\W|$)", re.IGNORECASE), "limited"),
    (re.compile(r"\bcorpn?\.?(?=\W|$)", re.IGNORECASE), "corporation"),
    (re.compile(r"\bpvt\.?(?=\W|$)", re.IGNORECASE), "private"),
    (re.compile(r"\bco\.?(?=\W|$)", re.IGNORECASE), "company"),
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


def _load_sector_master() -> tuple[dict[str, str], dict[str, str], dict[str, str]]:
    """Returns ({isin: sector}, {normalized_name: sector}, {nse_symbol: sector})."""
    path = BREAKDOWN_DIR / "sector_master.csv"
    if not path.exists():
        return {}, {}, {}
    try:
        text = path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        text = path.read_text(encoding="latin-1")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return {}, {}, {}
    reader.fieldnames = [f.strip() for f in reader.fieldnames]
    isin_sector: dict[str, str] = {}
    name_sector: dict[str, str] = {}
    symbol_sector: dict[str, str] = {}
    for row in reader:
        isin = (row.get("ISIN Code") or "").strip()
        sector = (row.get("Industry") or "").strip()
        company = (row.get("Company Name") or "").strip()
        symbol = (row.get("Symbol") or "").strip()
        if not sector:
            continue
        if isin:
            isin_sector[isin] = sector
        if company:
            name_sector[normalize_company_name(company)] = sector
        if symbol:
            symbol_sector[symbol] = sector
    return isin_sector, name_sector, symbol_sector


def _write_company_master(rows: list[dict]) -> None:
    master_path = BREAKDOWN_DIR / "company_master.csv"
    BREAKDOWN_DIR.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "isin", "canonical_name", "primary_ticker", "nse_symbol", "bse_symbol",
        "msei_symbol", "exchanges", "mcap_category", "sector", "aliases",
    ]
    cat_order = {"Large Cap": 0, "Mid Cap": 1, "Small Cap": 2}
    sorted_rows = sorted(rows, key=lambda r: (cat_order.get(r["categorization"], 9), r["name_normalized"]))
    with master_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in sorted_rows:
            writer.writerow({
                "isin": r.get("isin") or "",
                "canonical_name": r.get("company_name") or "",
                "primary_ticker": r.get("primary_ticker") or "",
                "nse_symbol": r.get("nse_symbol") or "",
                "bse_symbol": r.get("bse_symbol") or "",
                "msei_symbol": r.get("msei_symbol") or "",
                "exchanges": r.get("exchanges") or "",
                "mcap_category": r.get("categorization") or "",
                "sector": r.get("sector") or "",
                "aliases": r.get("aliases") or "",
            })


async def sync_amfi_market_cap(db: AsyncSession, on_progress=None) -> dict:
    xlsx_path = _find_amfi_xlsx()
    if not xlsx_path:
        return {"error": "No AverageMarketCapitalization*.xlsx found in data/mf_portfolio_breakdown/"}

    file_date = _parse_amfi_date(xlsx_path.name)
    stale_warning = None
    if file_date:
        age_days = (date.today() - file_date).days
        if age_days > 180:
            stale_warning = f"Classification file is {age_days} days old ({file_date:%d %b %Y}). Consider updating from AMFI website."

    # Preserve user-edited aliases from existing company_master.csv
    master_path = BREAKDOWN_DIR / "company_master.csv"
    preserved_aliases: dict[str, str] = {}
    if master_path.exists():
        try:
            text = master_path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            text = master_path.read_text(encoding="latin-1")
        r = csv.DictReader(io.StringIO(text))
        for mrow in r:
            isin_key = (mrow.get("isin") or "").strip()
            alias_val = (mrow.get("aliases") or "").strip()
            if isin_key and alias_val:
                preserved_aliases[isin_key] = alias_val

    if on_progress:
        await on_progress(f"Loading AMFI data from {xlsx_path.name}…")

    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]

    rows_to_insert: list[dict] = []
    counts = {"Large Cap": 0, "Mid Cap": 0, "Small Cap": 0}

    _DASH = {"-", "–", "—"}

    for row in ws.iter_rows(min_row=3, values_only=True):
        company = str(row[1] or "").strip()
        isin = str(row[2] or "").strip() or None
        bse_raw = str(row[3] or "").strip()
        nse_raw = str(row[5] or "").strip()
        msei_raw = str(row[7] or "").strip()
        cat = str(row[10] or "").strip()
        if not company or cat not in counts:
            continue

        bse_sym = bse_raw if bse_raw and bse_raw not in _DASH else None
        nse_sym = nse_raw if nse_raw and nse_raw not in _DASH else None
        msei_sym = msei_raw if msei_raw and msei_raw not in _DASH else None

        primary_ticker = nse_sym or bse_sym or msei_sym

        exchanges_parts: list[str] = []
        if nse_sym:
            exchanges_parts.append("NSE")
        if bse_sym:
            exchanges_parts.append("BSE")
        if msei_sym:
            exchanges_parts.append("MSEI")
        exchanges = ",".join(exchanges_parts) or None

        counts[cat] += 1
        rows_to_insert.append({
            "company_name": company,
            "isin": isin,
            "bse_symbol": bse_sym,
            "nse_symbol": nse_sym,
            "msei_symbol": msei_sym,
            "primary_ticker": primary_ticker,
            "exchanges": exchanges,
            "aliases": preserved_aliases.get(isin or "") or None,
            "categorization": cat,
            "sector": None,
            "name_normalized": normalize_company_name(company),
            "updated_at": now_ist(),
        })

    wb.close()

    if on_progress:
        await on_progress(
            f"Parsed {len(rows_to_insert)} companies "
            f"(Large: {counts['Large Cap']}, Mid: {counts['Mid Cap']}, Small: {counts['Small Cap']})"
        )

    # Enrich with sector: ISIN → NSE symbol → normalized name
    isin_sector, name_sector, symbol_sector = _load_sector_master()
    sectors_loaded = len(isin_sector)
    if isin_sector or name_sector or symbol_sector:
        for row in rows_to_insert:
            sec = isin_sector.get(row["isin"] or "")
            if not sec and row["nse_symbol"]:
                sec = symbol_sector.get(row["nse_symbol"])
            if not sec:
                sec = name_sector.get(row["name_normalized"] or "")
            if sec:
                row["sector"] = sec
        if on_progress:
            await on_progress(f"Sector enrichment: {sectors_loaded} ISIN mappings applied")

    await db.execute(delete(AmfiMarketCap))
    if rows_to_insert:
        await db.execute(AmfiMarketCap.__table__.insert(), rows_to_insert)
    await db.flush()

    _write_company_master(rows_to_insert)
    if on_progress:
        await on_progress("Company master CSV updated")

    result = {
        "rows_loaded": len(rows_to_insert),
        "large": counts["Large Cap"],
        "mid": counts["Mid Cap"],
        "small": counts["Small Cap"],
        "sectors_loaded": sectors_loaded,
        "file": xlsx_path.name,
    }
    if file_date:
        result["file_date"] = file_date.strftime("%d %b %Y")
    if stale_warning:
        result["stale_warning"] = stale_warning
    return result


def _resolve_equity_category(
    name: str,
    alias_to_isin: dict[str, str],
    name_to_isin: dict[str, str],
    isin_to_mcap: dict[str, str],
    amfi_by_name: dict[str, str],
) -> str:
    norm = normalize_company_name(name)
    for lookup in (alias_to_isin, name_to_isin):
        isin = lookup.get(norm)
        if isin and isin in isin_to_mcap:
            return isin_to_mcap[isin]
    cat = amfi_by_name.get(norm)
    if cat:
        return cat
    best_r, best_cat = 0.0, None
    for amfi_norm, amfi_cat in amfi_by_name.items():
        r = SequenceMatcher(None, norm, amfi_norm).ratio()
        if r > best_r:
            best_r, best_cat = r, amfi_cat
    if best_r >= 0.85 and best_cat:
        return best_cat
    return "Unclassified Equity"


def _resolve_equity_sector(
    name: str,
    alias_to_isin: dict[str, str],
    name_to_isin: dict[str, str],
    isin_to_sector: dict[str, str],
    name_to_sector: dict[str, str],
) -> str | None:
    norm = normalize_company_name(name)
    for lookup in (alias_to_isin, name_to_isin):
        isin = lookup.get(norm)
        if isin and isin in isin_to_sector:
            return isin_to_sector[isin]
    sec = name_to_sector.get(norm)
    if sec:
        return sec
    best_r, best_s = 0.0, None
    for amfi_norm, amfi_sec in name_to_sector.items():
        r = SequenceMatcher(None, norm, amfi_norm).ratio()
        if r > best_r:
            best_r, best_s = r, amfi_sec
    if best_r >= 0.85:
        return best_s
    return None


_MF_DEBT_RE = re.compile(r"\b(liquid|money\s+market|savings\s+fund|low\s+duration)\b", re.IGNORECASE)
_REIT_RE = re.compile(r"\b(reit|real\s+estate\s+trust)\b", re.IGNORECASE)


def _classify_type(holding_type: str, name: str) -> str:
    t = holding_type.strip()
    if t.startswith("Bond"):
        return "Debt"
    if t.startswith("Cash") or t == "Cash":
        return "Cash"
    if t.startswith("Mutual Fund") and (_MF_DEBT_RE.search(t) or _MF_DEBT_RE.search(name)):
        return "Debt"
    return "Other"


def _parse_holdings_pct(s: str) -> float | None:
    s = s.strip().rstrip("%").strip()
    try:
        return float(s)
    except ValueError:
        return None


def _sector_for_type(holding_type: str, name: str) -> str | None:
    t = holding_type.strip()
    if t.startswith("Bond"):
        return "Fixed Income"
    if t.startswith("Cash") or t == "Cash":
        return "Liquid / Money Market"
    if t.startswith("Mutual Fund") and (_MF_DEBT_RE.search(t) or _MF_DEBT_RE.search(name)):
        return "Liquid / Money Market"
    return None


async def ingest_scheme_csvs(db: AsyncSession, on_progress=None) -> dict:
    amfi_all = (await db.execute(select(AmfiMarketCap))).scalars().all()

    alias_to_isin: dict[str, str] = {}
    name_to_isin: dict[str, str] = {}
    isin_to_mcap: dict[str, str] = {}
    isin_to_sector: dict[str, str] = {}
    amfi_by_name: dict[str, str] = {}
    amfi_name_sector: dict[str, str] = {}

    for a in amfi_all:
        amfi_by_name[a.name_normalized] = a.categorization
        if a.sector:
            amfi_name_sector[a.name_normalized] = a.sector
        if a.isin:
            isin_to_mcap[a.isin] = a.categorization
            name_to_isin[a.name_normalized] = a.isin
            if a.sector:
                isin_to_sector[a.isin] = a.sector
            if a.aliases:
                for alias in a.aliases.split("|"):
                    alias_norm = normalize_company_name(alias.strip())
                    if alias_norm:
                        alias_to_isin[alias_norm] = a.isin

    overrides: dict[str, str] = {
        o.name_normalized: o.category
        for o in (await db.execute(select(EquityCategoryOverride))).scalars().all()
    }

    sector_override_rows = (await db.execute(select(EquitySectorOverride))).scalars().all()
    sector_overrides: dict[str, str] = {o.name_normalized: o.sector for o in sector_override_rows}

    # Auto-prune: if AMFI now has a sector for an override, the override is stale
    pruned = 0
    for o in sector_override_rows:
        if _resolve_equity_sector(o.raw_name, alias_to_isin, name_to_isin, isin_to_sector, amfi_name_sector) is not None:
            await db.execute(delete(EquitySectorOverride).where(EquitySectorOverride.id == o.id))
            sector_overrides.pop(o.name_normalized, None)
            pruned += 1
    if on_progress and pruned:
        await on_progress(f"Auto-removed {pruned} stale sector override(s)")

    held_funds = (await db.execute(
        select(Instrument)
        .join(Holding, Holding.instrument_id == Instrument.id)
        .where(Instrument.instrument_type.in_(("MF", "ETF")))
    )).scalars().all()
    held_isins = {i.isin for i in held_funds if i.isin}

    # Match "liquid" at a word start (no trailing boundary — catches LIQUIDCASE, LIQUIDBEES, etc.)
    _DEBT_KEYWORDS = re.compile(r"\b(debt|liquid)", re.IGNORECASE)
    _ARBITRAGE_RE = re.compile(r"\barbitrage\b", re.IGNORECASE)
    # No trailing \b — catches compound names like GoldCase, Silvercase, etc.
    _GOLD_RE = re.compile(r"\bgold", re.IGNORECASE)
    _SILVER_RE = re.compile(r"\bsilver", re.IGNORECASE)
    debt_fund_isins: set[str] = set()
    arbitrage_fund_isins: set[str] = set()
    gold_fund_isins: set[str] = set()
    silver_fund_isins: set[str] = set()
    for i in held_funds:
        name_to_check = " ".join(filter(None, [i.tradingsymbol, i.name]))
        if i.isin and _DEBT_KEYWORDS.search(name_to_check):
            debt_fund_isins.add(i.isin)
        if i.isin and _ARBITRAGE_RE.search(name_to_check):
            arbitrage_fund_isins.add(i.isin)
        if i.isin and _GOLD_RE.search(name_to_check):
            gold_fund_isins.add(i.isin)
        if i.isin and _SILVER_RE.search(name_to_check):
            silver_fund_isins.add(i.isin)

    if not BREAKDOWN_DIR.exists():
        return {"schemes_processed": 0, "rows_upserted": 0, "unmatched_equities": [],
                "missing_funds": [], "errors": ["Directory data/mf_portfolio_breakdown/ not found"]}

    csv_files = [p for p in BREAKDOWN_DIR.glob("*.csv") if p.stem.strip().startswith("IN")]
    schemes_processed = 0
    rows_upserted = 0
    unmatched: list[dict] = []
    errors: list[str] = []
    seen_isins: set[str] = set()

    isin_to_name = {i.isin: (i.tradingsymbol or i.name or i.isin) for i in held_funds if i.isin}
    if on_progress:
        await on_progress(f"Found {len(csv_files)} CSV file(s) starting with IN")

    for csv_path in csv_files:
        scheme_isin = csv_path.stem.strip()
        fund_name = isin_to_name.get(scheme_isin, scheme_isin)
        if on_progress:
            await on_progress(f"[{schemes_processed + 1}/{len(csv_files)}] {fund_name}")

        seen_isins.add(scheme_isin)
        is_debt_fund = scheme_isin in debt_fund_isins
        is_gold_fund = scheme_isin in gold_fund_isins
        is_silver_fund = scheme_isin in silver_fund_isins
        is_foreign_fund = scheme_isin in FOREIGN_FUND_ISINS
        equity_override = ETF_CAP_OVERRIDE.get(scheme_isin)

        try:
            text = csv_path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            text = csv_path.read_text(encoding="latin-1")

        reader = csv.DictReader(io.StringIO(text))
        if not reader.fieldnames:
            errors.append(f"{csv_path.name}: empty or no header")
            continue
        reader.fieldnames = [f.strip() for f in reader.fieldnames]

        dedup: dict[tuple[str, str], dict] = {}
        for row_num, row in enumerate(reader, start=2):
            name = (row.get("Name") or "").strip().rstrip("*^")
            htype = (row.get("Type") or "").strip()
            pct_raw = row.get("Holdings") or ""
            if not name or not htype:
                continue
            pct = _parse_holdings_pct(pct_raw)
            if pct is None:
                errors.append(f"{csv_path.name} row {row_num}: bad Holdings '{pct_raw}'")
                continue

            if scheme_isin in arbitrage_fund_isins and htype.strip() in ("Equity - Future", "Cash - General Offset"):
                continue

            key = (name[:255], htype[:50])
            if key in dedup:
                dedup[key]["holdings_pct"] += pct
            else:
                is_arb_holding = scheme_isin in arbitrage_fund_isins and htype.strip() == "Equity"
                is_reit = bool(_REIT_RE.search(name) or _REIT_RE.search(htype))
                if is_reit:
                    category = "Real Estate Trust"
                elif is_gold_fund:
                    category = "Gold"
                elif is_silver_fund:
                    category = "Silver"
                elif is_debt_fund:
                    category = "Debt"
                elif is_arb_holding:
                    category = "Equity - Arbitrage"
                elif htype.strip() == "Equity":
                    name_lower = name.lower()
                    if is_foreign_fund or any(s in name_lower for s in FOREIGN_COMPANY_SUBSTRINGS):
                        category = "Equity - Foreign"
                    else:
                        category = _resolve_equity_category(name, alias_to_isin, name_to_isin, isin_to_mcap, amfi_by_name)
                        if category == "Unclassified Equity":
                            # AMFI has no record — fall back to the fund's index cap tier, then manual overrides
                            category = overrides.get(normalize_company_name(name)) or equity_override or "Unclassified Equity"
                else:
                    category = _classify_type(htype, name)
                if category == "Unclassified Equity":
                    unmatched.append({"name": name, "scheme_isin": scheme_isin})

                # Sector classification
                if is_reit:
                    sector: str | None = "Real Estate Trust"
                elif is_gold_fund:
                    sector = "Gold"
                elif is_silver_fund:
                    sector = "Silver"
                else:
                    sector = _sector_for_type(htype, name)
                    if sector is None and htype.strip() == "Equity":
                        sector = _resolve_equity_sector(name, alias_to_isin, name_to_isin, isin_to_sector, amfi_name_sector)
                        if sector is None:
                            sector = sector_overrides.get(normalize_company_name(name))

                dedup[key] = {
                    "scheme_isin": scheme_isin,
                    "name": key[0],
                    "holding_type": key[1],
                    "holdings_pct": pct,
                    "category": category,
                    "sector": sector,
                    "updated_at": now_ist(),
                }

        values = list(dedup.values())
        await db.execute(delete(MfSchemeBreakdown).where(MfSchemeBreakdown.scheme_isin == scheme_isin))
        if values:
            await db.execute(MfSchemeBreakdown.__table__.insert(), values)
            rows_upserted += len(values)

        schemes_processed += 1
        if on_progress:
            unmatched_here = sum(1 for u in unmatched if u["scheme_isin"] == scheme_isin)
            msg = f"  → {len(values)} rows"
            if unmatched_here:
                msg += f", {unmatched_here} unmatched"
            await on_progress(msg)

    # Synthesize 100% rows for commodity ETFs with no CSV (gold/silver trackers need no breakdown).
    for isin, commodity_cat in COMMODITY_ETF_CATEGORY.items():
        if isin not in held_isins or isin in seen_isins:
            continue
        await db.execute(delete(MfSchemeBreakdown).where(MfSchemeBreakdown.scheme_isin == isin))
        await db.execute(MfSchemeBreakdown.__table__.insert(), [{
            "scheme_isin": isin,
            "name": commodity_cat,
            "holding_type": commodity_cat,
            "holdings_pct": 100.0,
            "category": commodity_cat,
            "sector": commodity_cat,
            "updated_at": now_ist(),
        }])
        seen_isins.add(isin)
        rows_upserted += 1
        if on_progress:
            await on_progress(f"  → {isin_to_name.get(isin, isin)}: synthesized 100% {commodity_cat} (no CSV needed)")

    # Remove rows for schemes whose CSV was deleted.
    if seen_isins:
        await db.execute(
            delete(MfSchemeBreakdown).where(MfSchemeBreakdown.scheme_isin.notin_(seen_isins))
        )
    else:
        await db.execute(delete(MfSchemeBreakdown))

    await db.commit()

    # Warn about held funds that have no CSV file.
    missing_funds = [
        {"isin": isin, "name": isin_to_name.get(isin, isin)}
        for isin in sorted(held_isins - seen_isins)
    ]

    return {
        "schemes_processed": schemes_processed,
        "rows_upserted": rows_upserted,
        "unmatched_equities": unmatched,
        "missing_funds": missing_funds,
        "errors": errors[:30],
    }
