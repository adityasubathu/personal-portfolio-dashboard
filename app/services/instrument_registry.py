import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.instrument import Instrument

# Kite symbols for Indian govt bonds / T-bills don't carry ISINs in tradebooks.
# Covers: SGB*, 734GS2064-GS (n-year G-Sec), 706GS2028, 182D301123 (T-bills), *-GB/*-GS suffix.
_BOND_SYMBOL_RE = re.compile(r"^(SGB|\d{2,4}(GS|D|GOI))|(?:GOI|-GB|-GS)$")

# Canonical bond-dedup patterns — the same bond appears under multiple symbol forms
# (e.g. 734GOI2064 in EQX, 734GS2064-GS in regular EQ, SGBFEB32 vs SGBFEB32IV-GB).
_GSEC_RE = re.compile(r"^(\d{2,4})[A-Z]+(\d{4})(?:-[A-Z]+)?$")  # coupon + letters + maturity year + optional suffix
_SGB_RE = re.compile(r"^(SGB[A-Z]{3}\d{2})")            # SGB + 3-letter month + 2-digit year


SYMBOL_ALIASES: dict[str, str] = {
    "ZOMATO": "ETERNAL",
}


def _is_bond_symbol(symbol: str) -> bool:
    return bool(_BOND_SYMBOL_RE.search(symbol.upper()))


def _bond_like_pattern(symbol: str) -> str | None:
    """SQL LIKE pattern for bond-dedup lookup. Returns None for unique-per-security symbols (T-bills)."""
    sym = symbol.upper()
    m = _GSEC_RE.match(sym)
    if m:
        return f"{m.group(1)}%{m.group(2)}"
    m = _SGB_RE.match(sym)
    if m:
        return f"{m.group(1)}%"
    return None


async def find_or_create(
    db: AsyncSession,
    *,
    isin: str | None = None,
    tradingsymbol: str | None = None,
    exchange: str | None = None,
    instrument_type: str = "STOCK",
    name: str | None = None,
) -> Instrument:
    """
    Look up an instrument by ISIN (preferred) or symbol (+ exchange if known).
    Creates a new record if not found.
    """
    if tradingsymbol:
        tradingsymbol = SYMBOL_ALIASES.get(tradingsymbol.upper(), tradingsymbol)

    if isin:
        result = await db.execute(select(Instrument).where(Instrument.isin == isin))
        inst = result.scalar_one_or_none()
        if inst:
            return inst

    # Bond dedup: same bond appears under symbol variants (734GOI2064 vs 734GS2064-GS)
    # and EQX rows lack ISINs. Match on a canonical pattern so either direction dedupes.
    if instrument_type == "BOND" and tradingsymbol:
        pattern = _bond_like_pattern(tradingsymbol)
        if pattern:
            result = await db.execute(
                select(Instrument).where(
                    Instrument.instrument_type == "BOND",
                    Instrument.tradingsymbol.ilike(pattern),
                )
            )
            candidates = result.scalars().all()
            if len(candidates) == 1:
                inst = candidates[0]
                if isin and not inst.isin:
                    inst.isin = isin
                return inst

    if tradingsymbol and exchange:
        result = await db.execute(
            select(Instrument).where(
                Instrument.tradingsymbol == tradingsymbol,
                Instrument.exchange == exchange,
            )
        )
        inst = result.scalar_one_or_none()
        if inst:
            if isin and not inst.isin:
                inst.isin = isin
            return inst

    # No exchange hint (e.g. Kite EQX IPO/bond-issue rows): dedupe by symbol alone.
    if tradingsymbol and not exchange:
        result = await db.execute(
            select(Instrument).where(Instrument.tradingsymbol == tradingsymbol)
        )
        candidates = result.scalars().all()
        if len(candidates) == 1:
            inst = candidates[0]
            if isin and not inst.isin:
                inst.isin = isin
            return inst

    inst = Instrument(
        isin=isin,
        tradingsymbol=tradingsymbol,
        exchange=exchange or None,
        instrument_type=instrument_type,
        name=name or tradingsymbol,
    )
    db.add(inst)
    await db.flush()
    return inst


def infer_instrument_type(
    segment: str | None,
    series: str | None,
    isin: str | None = None,
    symbol: str | None = None,
) -> str:
    if segment == "MF":
        return "MF"
    if series in ("BE", "GB", "GS") or segment == "BOND":
        return "BOND"

    # ISINs starting with INF belong to mutual fund / ETF universe.
    # If the segment is EQ and the ISIN is INF*, it's an ETF (traded on exchange).
    if isin and isin.startswith("INF") and segment == "EQ":
        return "ETF"

    # Govt bonds, SGBs, and T-bills: no ISIN in Kite tradebook — detect by symbol.
    if symbol and _is_bond_symbol(symbol):
        return "BOND"

    return "STOCK"
