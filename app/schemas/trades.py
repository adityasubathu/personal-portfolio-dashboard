from typing import Optional
from pydantic import BaseModel


class TradeRow(BaseModel):
    id: int
    instrument_id: int
    symbol: Optional[str] = None
    isin: Optional[str] = None
    trade_date: str
    trade_type: str
    quantity: float
    price: float
    amount: Optional[float] = None
    brokerage: float
    exchange: Optional[str] = None
    segment: Optional[str] = None
    notes: Optional[str] = None
    source: str
    import_batch_id: Optional[str] = None


class TradesListResponse(BaseModel):
    rows: list[TradeRow]
    page: int
    per_page: int
    total: int
    total_pages: int
    q: str


class ImportFileResult(BaseModel):
    filename: str
    batch_id: str
    row_count: int
    success_count: int
    errors: list[dict]


class Violation(BaseModel):
    symbol: Optional[str] = None
    isin: Optional[str] = None
    kind: str
    detail: Optional[str] = None


class ImportResponse(BaseModel):
    results: list[ImportFileResult]
    holdings_count: int
    violations: list[dict]


class ImportBatch(BaseModel):
    id: int
    batch_id: str
    filename: Optional[str] = None
    imported_at: str
    row_count: Optional[int] = None
    success_count: Optional[int] = None
    error_count: Optional[int] = None
