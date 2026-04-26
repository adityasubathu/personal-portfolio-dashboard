from datetime import datetime

from sqlalchemy import DateTime, Index, Numeric, String, UniqueConstraint
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
    categorization: Mapped[str] = mapped_column(String(20))
    name_normalized: Mapped[str] = mapped_column(String(255), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)


class MfSchemeBreakdown(Base):
    __tablename__ = "mf_scheme_breakdown"
    __table_args__ = (
        UniqueConstraint("scheme_isin", "name", "holding_type", name="uq_mf_breakdown_scheme_name_type"),
        Index("ix_mf_breakdown_scheme_isin", "scheme_isin"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    scheme_isin: Mapped[str] = mapped_column(String(12))
    name: Mapped[str] = mapped_column(String(255))
    holding_type: Mapped[str] = mapped_column(String(50))
    holdings_pct: Mapped[float] = mapped_column(Numeric(8, 4))
    category: Mapped[str] = mapped_column(String(30))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)
