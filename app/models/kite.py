from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.time_util import now_ist


class KiteConfig(Base):
    """Singleton — at most one row (id = 1). Enforced at the DB level so even
    direct SQL inserts can't create a second set of credentials."""

    __tablename__ = "kite_config"
    __table_args__ = (
        CheckConstraint("id = 1", name="ck_kite_config_singleton"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    api_key: Mapped[str] = mapped_column(String(50))
    api_secret: Mapped[str] = mapped_column(String(100))
    access_token: Mapped[str | None] = mapped_column(String(200))
    access_token_expiry: Mapped[datetime | None] = mapped_column(DateTime)
    redirect_url: Mapped[str | None] = mapped_column(String(300))
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)


class KiteSyncLog(Base):
    __tablename__ = "kite_sync_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
    status: Mapped[str] = mapped_column(String(10))  # SUCCESS / FAILED / PARTIAL
    holdings_count: Mapped[int | None] = mapped_column(Integer)
    positions_count: Mapped[int | None] = mapped_column(Integer)
    error_message: Mapped[str | None] = mapped_column(Text)
    access_token_hint: Mapped[str | None] = mapped_column(String(10))  # last 6 chars only
