"""add level columns to equity_sector_override

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-09-18 17:35:34.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "equity_sector_override",
        "sector",
        existing_type=sa.String(length=60),
        type_=sa.String(length=100),
        existing_nullable=False,
        nullable=True,
    )
    op.add_column("equity_sector_override", sa.Column("macro_sector", sa.String(length=100), nullable=True))
    op.add_column("equity_sector_override", sa.Column("industry", sa.String(length=100), nullable=True))
    op.add_column("equity_sector_override", sa.Column("basic_industry", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("equity_sector_override", "basic_industry")
    op.drop_column("equity_sector_override", "industry")
    op.drop_column("equity_sector_override", "macro_sector")
    op.execute("DELETE FROM equity_sector_override WHERE sector IS NULL")
    op.alter_column(
        "equity_sector_override",
        "sector",
        existing_type=sa.String(length=100),
        type_=sa.String(length=60),
        existing_nullable=True,
        nullable=False,
    )
