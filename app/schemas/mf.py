from typing import Optional
from pydantic import BaseModel


class MfSyncResult(BaseModel):
    mode: str
    error: Optional[str] = None
    updated: Optional[int] = None
    skipped: Optional[int] = None


class NavTrackedInstrument(BaseModel):
    instrument_id: int
    name: Optional[str] = None
    isin: Optional[str] = None
    instrument_type: str


class FetchNavResult(BaseModel):
    error: Optional[str] = None
    symbol: Optional[str] = None
    isin: Optional[str] = None
    rows_added: Optional[int] = None
    latest_nav_date: Optional[str] = None
