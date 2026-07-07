from typing import Optional
from pydantic import BaseModel


class FdAsset(BaseModel):
    id: int
    label: Optional[str] = None
    principal: float
    interest_rate: float
    start_date: Optional[str] = None
    maturity_date: Optional[str] = None
    current_value: float
    maturity_value: float
    is_emergency_fund: bool


class SimpleAsset(BaseModel):
    id: int
    label: Optional[str] = None
    current_value: float


class ForeignEquityAsset(BaseModel):
    id: int
    label: str
    value_usd: float
    invested_usd: float
    value_inr: float


class ManualAssetsSummary(BaseModel):
    fds: list[FdAsset]
    ppf: Optional[SimpleAsset] = None
    nps: Optional[SimpleAsset] = None
    cash: Optional[SimpleAsset] = None
    foreign_equities: list[ForeignEquityAsset] = []
    total_fd: float
    emergency_total: float
    total_ppf: float
    total_nps: float
    total_cash: float
    total_foreign_equity_usd: float = 0.0
    total_foreign_equity_inr: float = 0.0
    usdinr_rate: float = 85.0
    total_manual: float
