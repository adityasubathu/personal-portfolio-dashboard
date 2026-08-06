"""add_trade_order_id

Revision ID: 330edc09963d
Revises: f6a1b2c3d4e5
Create Date: 2026-08-06 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '330edc09963d'
down_revision = 'f6a1b2c3d4e5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('trades', sa.Column('order_id', sa.String(length=50), nullable=True))
    op.create_index(op.f('ix_trades_order_id'), 'trades', ['order_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_trades_order_id'), table_name='trades')
    op.drop_column('trades', 'order_id')
