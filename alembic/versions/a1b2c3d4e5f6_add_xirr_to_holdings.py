"""add_xirr_to_holdings

Revision ID: a1b2c3d4e5f6
Revises: 741e04602a60
Create Date: 2026-06-23 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = '741e04602a60'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('holdings', sa.Column('xirr', sa.Numeric(10, 6), nullable=True))
    op.add_column('holdings', sa.Column('xirr_as_of', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('holdings', 'xirr_as_of')
    op.drop_column('holdings', 'xirr')
