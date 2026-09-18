"""add nse industry classification

Revision ID: b8c9d0e1f2a3
Revises: 58d3324ee86b
Create Date: 2026-09-18 00:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = "b8c9d0e1f2a3"
down_revision = "58d3324ee86b"
branch_labels = None
depends_on = None

_LEVELS = ("macro_sector", "industry", "basic_industry")


def upgrade() -> None:
    op.create_table(
        "nse_industry_classification",
        sa.Column("isin", sa.String(12), primary_key=True),
        sa.Column("symbol", sa.String(20), nullable=True),
        sa.Column("company_name", sa.String(255), nullable=True),
        sa.Column("series", sa.String(5), nullable=True),
        sa.Column("macro_sector", sa.String(100), nullable=True),
        sa.Column("sector", sa.String(100), nullable=True),
        sa.Column("industry", sa.String(100), nullable=True),
        sa.Column("basic_industry", sa.String(100), nullable=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_nse_industry_symbol", "nse_industry_classification", ["symbol"])

    for table in ("amfi_market_cap", "mf_scheme_breakdown"):
        for col in _LEVELS:
            op.add_column(table, sa.Column(col, sa.String(100), nullable=True))
        op.alter_column(
            table, "sector", existing_type=sa.String(60), type_=sa.String(100), existing_nullable=True
        )

    op.add_column("mf_scheme_breakdown", sa.Column("isin", sa.String(12), nullable=True))
    op.create_index("ix_mf_breakdown_isin", "mf_scheme_breakdown", ["isin"])


def downgrade() -> None:
    op.drop_index("ix_mf_breakdown_isin", table_name="mf_scheme_breakdown")
    op.drop_column("mf_scheme_breakdown", "isin")
    for table in ("amfi_market_cap", "mf_scheme_breakdown"):
        op.alter_column(
            table, "sector", existing_type=sa.String(100), type_=sa.String(60), existing_nullable=True
        )
        for col in _LEVELS:
            op.drop_column(table, col)
    op.drop_index("ix_nse_industry_symbol", table_name="nse_industry_classification")
    op.drop_table("nse_industry_classification")
