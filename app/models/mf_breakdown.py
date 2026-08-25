from datetime import date, datetime

from sqlalchemy import Date, DateTime, Index, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.time_util import now_ist


class AmfiMarketCap(Base):
    __tablename__ = "amfi_market_cap"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_name: Mapped[str] = mapped_column(String(255))
    isin: Mapped[str | None] = mapped_column(String(12), index=True)
    bse_symbol: Mapped[str | None] = mapped_column(String(20))
    nse_symbol: Mapped[str | None] = mapped_column(String(20))
    msei_symbol: Mapped[str | None] = mapped_column(String(20))
    primary_ticker: Mapped[str | None] = mapped_column(String(20), index=True)
    exchanges: Mapped[str | None] = mapped_column(String(50))
    aliases: Mapped[str | None] = mapped_column(Text, nullable=True)
    categorization: Mapped[str] = mapped_column(String(20))
    sector: Mapped[str | None] = mapped_column(String(60), nullable=True)
    name_normalized: Mapped[str] = mapped_column(String(255), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class EquityCategoryOverride(Base):
    __tablename__ = "equity_category_override"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_normalized: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    raw_name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(30))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)


class EquitySectorOverride(Base):
    __tablename__ = "equity_sector_override"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_normalized: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    raw_name: Mapped[str] = mapped_column(String(255))
    sector: Mapped[str] = mapped_column(String(60))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)


class MfSchemeBreakdown(Base):
    __tablename__ = "mf_scheme_breakdown"
    __table_args__ = (
        Index("ix_mf_breakdown_scheme_isin", "scheme_isin"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    scheme_isin: Mapped[str] = mapped_column(String(12))
    name: Mapped[str] = mapped_column(String(255))
    holding_type: Mapped[str] = mapped_column(String(50))
    holdings_pct: Mapped[float] = mapped_column(Numeric(14, 8))
    market_value: Mapped[float | None] = mapped_column(Numeric(18, 2), nullable=True)
    category: Mapped[str] = mapped_column(String(30))
    sector: Mapped[str | None] = mapped_column(String(60), nullable=True)
    as_of: Mapped[date | None] = mapped_column(Date, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)
