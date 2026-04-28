from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.instrument import Instrument
from app.time_util import now_ist


class Trade(Base):
    __tablename__ = "trades"

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), index=True)
    trade_date: Mapped[date] = mapped_column(Date, index=True)
    trade_type: Mapped[str] = mapped_column(String(4))  # BUY / SELL
    quantity: Mapped[float] = mapped_column(Numeric(18, 6))
    price: Mapped[float] = mapped_column(Numeric(18, 6))
    amount: Mapped[float | None] = mapped_column(Numeric(18, 6))
    brokerage: Mapped[float] = mapped_column(Numeric(18, 6), default=0)
    exchange: Mapped[str | None] = mapped_column(String(10))
    segment: Mapped[str | None] = mapped_column(String(10))  # EQ / MF / ETF / BOND
    notes: Mapped[str | None] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(20))  # CSV_IMPORT / MANUAL
    import_batch_id: Mapped[str | None] = mapped_column(String(36), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)

    instrument: Mapped["Instrument"] = relationship(back_populates="trades")
