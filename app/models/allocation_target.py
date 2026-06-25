from sqlalchemy import Numeric, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AllocationTarget(Base):
    __tablename__ = "allocation_targets"

    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str] = mapped_column(String(30), unique=True)
    target_pct: Mapped[float] = mapped_column(Numeric(6, 2))


class AssetClassTarget(Base):
    __tablename__ = "asset_class_targets"

    id: Mapped[int] = mapped_column(primary_key=True)
    asset_class: Mapped[str] = mapped_column(String(30), unique=True)
    target_pct: Mapped[float] = mapped_column(Numeric(6, 2))
