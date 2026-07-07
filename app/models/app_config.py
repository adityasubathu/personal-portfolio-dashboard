from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppConfig(Base):
    """Simple key-value config store for app-level settings (e.g. cached USDINR rate)."""

    __tablename__ = "app_config"

    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value_json: Mapped[str | None] = mapped_column(Text)
