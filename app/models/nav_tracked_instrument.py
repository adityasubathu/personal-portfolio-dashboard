from datetime import datetime

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.time_util import now_ist


class NavTrackedInstrument(Base):
    __tablename__ = "nav_tracked_instruments"

    id: Mapped[int] = mapped_column(primary_key=True)
    instrument_id: Mapped[int] = mapped_column(ForeignKey("instruments.id"), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
