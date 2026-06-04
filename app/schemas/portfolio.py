from typing import Optional
from pydantic import BaseModel


class SummaryCards(BaseModel):
    total_cost: float
    total_value: float
    total_pnl: float
    last_sync: Optional[str] = None
    xirr: Optional[float] = None


class HoldingRow(BaseModel):
    instrument_id: int
    symbol: str
    type: str
    isin: Optional[str] = None
    name: Optional[str] = None
    qty: float
    avg_price: Optional[float] = None
    cost: float
    ltp: Optional[float] = None
    as_of: Optional[str] = None
    value: float
    pnl: float
    pnl_pct: Optional[float] = None
    xirr: Optional[float] = None
    nav: Optional[float] = None
    nav_as_of: Optional[str] = None
    nav_premium: Optional[float] = None
    prev_close: Optional[float] = None
    prev_close_date: Optional[str] = None
    day_chg_pct: Optional[float] = None
    day_chg_abs: Optional[float] = None


class HoldingsSection(BaseModel):
    label: Optional[str] = None
    rows: list[HoldingRow]
    day_chg_abs_min: Optional[float] = None
    day_chg_abs_max: Optional[float] = None


class DirectHoldingsResponse(BaseModel):
    groups: list[HoldingsSection]
    sections_enabled: bool
    current_sort: str
    current_dir: str
    total_cost: float
    total_value: float
    total_day_chg: float
    total_day_chg_pct: Optional[float] = None
    compare: str
    pnl_min: Optional[float] = None
    pnl_max: Optional[float] = None
    pnl_pct_min: Optional[float] = None
    pnl_pct_max: Optional[float] = None
    xirr_min: Optional[float] = None
    xirr_max: Optional[float] = None
    day_chg_abs_min: Optional[float] = None
    day_chg_abs_max: Optional[float] = None


class InstrumentListItem(BaseModel):
    id: int
    symbol: Optional[str] = None
    isin: Optional[str] = None
    name: Optional[str] = None
    type: str
    n_prices: int
