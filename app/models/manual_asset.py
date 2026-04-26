from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.time_util import now_ist


class ManualAsset(Base):
    __tablename__ = "manual_assets"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_type: Mapped[str] = mapped_column(String(10))  # FD / PPF / NPS
    label: Mapped[str] = mapped_column(String(100))
    principal: Mapped[float | None] = mapped_column(Numeric(18, 2))
    interest_rate: Mapped[float | None] = mapped_column(Numeric(6, 4))
    start_date: Mapped[date | None] = mapped_column(Date)
    maturity_date: Mapped[date | None] = mapped_column(Date)
    current_value: Mapped[float | None] = mapped_column(Numeric(18, 2))
    is_emergency_fund: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)
