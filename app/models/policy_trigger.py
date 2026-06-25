from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.time_util import now_ist


class PolicyTriggerState(Base):
    __tablename__ = "policy_trigger_state"

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(80), unique=True)
    value_bool: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    value_num: Mapped[float | None] = mapped_column(Numeric(18, 4), nullable=True)
    value_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist, onupdate=now_ist)


class PolicyTriggerEvent(Base):
    __tablename__ = "policy_trigger_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    trigger_key: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(10))
    detail: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
