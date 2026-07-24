from typing import Optional
from pydantic import BaseModel


class GainBucket(BaseModel):
    key: str
    label: str
    gross_gain: float
    setoff_applied: float
    exemption_applied: float
    taxable: float
    rate: Optional[float] = None
    est_tax: Optional[float] = None


class RealizedLotOut(BaseModel):
    symbol: str
    name: Optional[str] = None
    asset_category: str
    buy_date: str
    sell_date: str
    qty: float
    buy_value: float
    sell_value: float
    expenses: float
    gain: float
    holding_days: int
    tax_bucket: str
    flags: list[str]


class AttentionItem(BaseModel):
    symbol: str
    name: Optional[str] = None
    asset_category: str
    sell_date: str
    qty: float
    sell_value: float
    flags: list[str]
    reason: str


class IntradayInfo(BaseModel):
    trades: int
    pnl: float


class CGTotals(BaseModel):
    gross_gain: float
    est_tax: float


class CapitalGainsResponse(BaseModel):
    fy: str
    buckets: list[GainBucket]
    lots: list[RealizedLotOut]
    intraday: IntradayInfo
    attention: list[AttentionItem]
    totals: CGTotals


class AvailableFYsResponse(BaseModel):
    fys: list[str]
