"""add nav_tracked_instruments

Revision ID: 510f12168ff5
Revises: 0001
Create Date: 2026-05-11 17:43:23.029295

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '510f12168ff5'
down_revision: Union[str, Sequence[str], None] = '0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'nav_tracked_instruments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('instrument_id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(['instrument_id'], ['instruments.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        op.f('ix_nav_tracked_instruments_instrument_id'),
        'nav_tracked_instruments', ['instrument_id'], unique=True,
    )


def downgrade() -> None:
    op.drop_index(op.f('ix_nav_tracked_instruments_instrument_id'), table_name='nav_tracked_instruments')
    op.drop_table('nav_tracked_instruments')
