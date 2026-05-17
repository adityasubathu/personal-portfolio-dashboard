"""add_company_master_columns_to_amfi

Revision ID: c4e5cf3746ed
Revises: 7e8107bd1083
Create Date: 2026-05-17 09:08:57.974794

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c4e5cf3746ed'
down_revision: Union[str, Sequence[str], None] = '7e8107bd1083'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('amfi_market_cap', sa.Column('msei_symbol', sa.String(length=20), nullable=True))
    op.add_column('amfi_market_cap', sa.Column('primary_ticker', sa.String(length=20), nullable=True))
    op.add_column('amfi_market_cap', sa.Column('exchanges', sa.String(length=50), nullable=True))
    op.add_column('amfi_market_cap', sa.Column('aliases', sa.Text(), nullable=True))
    op.create_index('ix_amfi_market_cap_primary_ticker', 'amfi_market_cap', ['primary_ticker'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_amfi_market_cap_primary_ticker', table_name='amfi_market_cap')
    op.drop_column('amfi_market_cap', 'aliases')
    op.drop_column('amfi_market_cap', 'exchanges')
    op.drop_column('amfi_market_cap', 'primary_ticker')
    op.drop_column('amfi_market_cap', 'msei_symbol')
