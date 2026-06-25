"""add_asset_class_targets

Revision ID: b2c3d4e5f6a1
Revises: a1b2c3d4e5f6
Create Date: 2026-06-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a1'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'asset_class_targets',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('asset_class', sa.String(length=30), nullable=False),
        sa.Column('target_pct', sa.Numeric(precision=6, scale=2), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('asset_class'),
    )


def downgrade() -> None:
    op.drop_table('asset_class_targets')
