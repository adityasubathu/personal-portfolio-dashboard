from datetime import date

from pydantic import BaseModel


class ChangeBucket(BaseModel):
    label: str
    before_pct: float
    after_pct: float
    delta_pp: float
    trade_pp: float
    drift_pp: float
    trade_value: float


class ChangeDimensions(BaseModel):
    asset_class: list[ChangeBucket]
    market_cap: list[ChangeBucket]
    macro_sector: list[ChangeBucket]
    sector: list[ChangeBucket]
    industry: list[ChangeBucket]
    basic_industry: list[ChangeBucket]


class FundChange(BaseModel):
    scheme_isin: str
    name: str
    fund_type: str | None
    latest_as_of: date
    previous_as_of: date | None
    holding_value: float
    dimensions: ChangeDimensions | None


class ChangeRollup(BaseModel):
    fund_count: int
    total_value: float
    latest_as_of: list[date]
    previous_as_of: list[date]
    dimensions: ChangeDimensions


class FundChanges(BaseModel):
    funds: list[FundChange]
    rollup: ChangeRollup | None
