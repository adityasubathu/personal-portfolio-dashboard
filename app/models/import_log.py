from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.time_util import now_ist


class CSVImportLog(Base):
    __tablename__ = "csv_import_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    filename: Mapped[str | None] = mapped_column(String(255))
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=now_ist)
    row_count: Mapped[int | None] = mapped_column(Integer)
    success_count: Mapped[int | None] = mapped_column(Integer)
    error_count: Mapped[int | None] = mapped_column(Integer)
    errors_json: Mapped[str | None] = mapped_column(Text)  # JSON array of {row, message}
