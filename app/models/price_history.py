from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Index, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.time_util import now_ist


class PriceHistory(Base):
    """Daily close per instrument. Stocks/ETFs/bonds are fed by Kite historical;
    MFs by mfapi.in. Schema is deliberately shared so the NAV-reconstruction
    service can look up prices for any holding without branching on asset class."""

    __tablename__ = "price_history"
    __table_args__ = (
        UniqueConstraint("instrument_id", "price_date", name="uq_price_history_instr_date"),
        Index("ix_price_history_instr_date", "instrument_id", "price_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    price_date: Mapped[date] = mapped_column(Date)
    close: Mapped[float] = mapped_column(Numeric(18, 6))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)

    instrument: Mapped["Instrument"] = relationship()
