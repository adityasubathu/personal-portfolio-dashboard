from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.time_util import now_ist


class NavHistory(Base):
    """Daily NAV per MF/ETF instrument from mfapi.in / AMFI.
    Separate from PriceHistory (Kite OHLC) so ETF market prices
    and fund NAVs don't collide."""

    __tablename__ = "nav_history"
    __table_args__ = (
        UniqueConstraint("instrument_id", "nav_date", name="uq_nav_history_instr_date"),
        Index("ix_nav_history_instr_date", "instrument_id", "nav_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    nav_date: Mapped[date] = mapped_column(Date)
    nav: Mapped[float] = mapped_column(Numeric(18, 6))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)

    instrument: Mapped["Instrument"] = relationship()
