from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.holding import Holding
from app.models.trade import Trade
from app.time_util import now_ist


class Instrument(Base):
    __tablename__ = "instruments"

    id: Mapped[int] = mapped_column(primary_key=True)
    isin: Mapped[str | None] = mapped_column(String(12), unique=True, index=True)
    tradingsymbol: Mapped[str | None] = mapped_column(String(100), index=True)
    exchange: Mapped[str | None] = mapped_column(String(10))  # NSE / BSE / MCX
    instrument_type: Mapped[str] = mapped_column(String(10))  # STOCK / ETF / BOND / MF
    name: Mapped[str | None] = mapped_column(String(255))
    amfi_scheme_code: Mapped[str | None] = mapped_column(String(20), index=True)
    kite_instrument_token: Mapped[int | None] = mapped_column(Integer, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)

    trades: Mapped[list["Trade"]] = relationship(back_populates="instrument")
    holding: Mapped["Holding | None"] = relationship(back_populates="instrument")
