"""add_equity_category_override

Revision ID: 741e04602a60
Revises: c4e5cf3746ed
Create Date: 2026-05-17 09:33:59.292415

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '741e04602a60'
down_revision: Union[str, Sequence[str], None] = 'c4e5cf3746ed'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'equity_category_override',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name_normalized', sa.String(length=255), nullable=False),
        sa.Column('raw_name', sa.String(length=255), nullable=False),
        sa.Column('category', sa.String(length=30), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_equity_category_override_name_normalized',
        'equity_category_override', ['name_normalized'], unique=True,
    )


def downgrade() -> None:
    op.drop_index('ix_equity_category_override_name_normalized', table_name='equity_category_override')
    op.drop_table('equity_category_override')
