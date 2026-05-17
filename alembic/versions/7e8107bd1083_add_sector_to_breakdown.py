"""add_sector_to_breakdown

Revision ID: 7e8107bd1083
Revises: 510f12168ff5
Create Date: 2026-05-17 07:09:48.415306

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "7e8107bd1083"
down_revision: Union[str, Sequence[str], None] = "510f12168ff5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("amfi_market_cap", sa.Column("sector", sa.String(length=60), nullable=True))
    op.add_column("mf_scheme_breakdown", sa.Column("sector", sa.String(length=60), nullable=True))


def downgrade() -> None:
    op.drop_column("mf_scheme_breakdown", "sector")
    op.drop_column("amfi_market_cap", "sector")
