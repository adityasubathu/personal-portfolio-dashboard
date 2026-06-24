from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.time_util import now_ist


class Holding(Base):
    __tablename__ = "holdings"

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), unique=True, index=True)
    quantity: Mapped[float] = mapped_column(Numeric(18, 6))
    average_price: Mapped[float | None] = mapped_column(Numeric(18, 6))
    total_cost: Mapped[float | None] = mapped_column(Numeric(18, 6))
    last_price: Mapped[float | None] = mapped_column(Numeric(18, 6))
    last_price_at: Mapped[datetime | None] = mapped_column(DateTime)
    unrealised_pnl: Mapped[float | None] = mapped_column(Numeric(18, 6))
    kite_synced: Mapped[bool] = mapped_column(Boolean, default=False)
    kite_synced_at: Mapped[datetime | None] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)
    xirr: Mapped[float | None] = mapped_column(Numeric(10, 6), nullable=True)
    xirr_as_of: Mapped[date | None] = mapped_column(Date, nullable=True)

    instrument: Mapped["Instrument"] = relationship(back_populates="holding")
