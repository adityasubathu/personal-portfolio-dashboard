"""add_equity_sector_override

Revision ID: e5f6a1b2c3d4
Revises: d4e5f6a1b2c3
Create Date: 2026-07-20 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f6a1b2c3d4'
down_revision = 'd4e5f6a1b2c3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'equity_sector_override',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name_normalized', sa.String(length=255), nullable=False),
        sa.Column('raw_name', sa.String(length=255), nullable=False),
        sa.Column('sector', sa.String(length=60), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name_normalized'),
    )
    op.create_index('ix_equity_sector_override_name_normalized', 'equity_sector_override', ['name_normalized'])


def downgrade() -> None:
    op.drop_index('ix_equity_sector_override_name_normalized', table_name='equity_sector_override')
    op.drop_table('equity_sector_override')
