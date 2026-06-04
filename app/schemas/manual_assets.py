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


class ManualAssetsSummary(BaseModel):
    fds: list[FdAsset]
    ppf: Optional[SimpleAsset] = None
    nps: Optional[SimpleAsset] = None
    cash: Optional[SimpleAsset] = None
    total_fd: float
    emergency_total: float
    total_ppf: float
    total_nps: float
    total_cash: float
    total_manual: float
