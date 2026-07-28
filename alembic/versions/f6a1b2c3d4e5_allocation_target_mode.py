"""allocation_target_mode

Revision ID: f6a1b2c3d4e5
Revises: e5f6a1b2c3d4
Create Date: 2026-07-28 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 'f6a1b2c3d4e5'
down_revision = 'e5f6a1b2c3d4'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add alloc_mode column with default so existing rows become 'anchored'
    op.add_column('allocation_targets', sa.Column('alloc_mode', sa.String(20), nullable=False, server_default='anchored'))
    # Drop old unique constraint on category alone
    op.drop_constraint('allocation_targets_category_key', 'allocation_targets', type_='unique')
    # New unique constraint on (category, alloc_mode)
    op.create_unique_constraint('uq_allocation_target_category_mode', 'allocation_targets', ['category', 'alloc_mode'])
    # Seed free_float defaults
    op.execute("""
        INSERT INTO allocation_targets (category, target_pct, alloc_mode) VALUES
            ('Large Cap',        26.0, 'free_float'),
            ('Mid Cap',          18.2, 'free_float'),
            ('Small Cap',         7.8, 'free_float'),
            ('Equity - Foreign', 13.0, 'free_float'),
            ('Debt',             25.0, 'free_float'),
            ('Precious Metals',  10.0, 'free_float')
        ON CONFLICT DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM allocation_targets WHERE alloc_mode = 'free_float'")
    op.drop_constraint('uq_allocation_target_category_mode', 'allocation_targets', type_='unique')
    op.create_unique_constraint('allocation_targets_category_key', 'allocation_targets', ['category'])
    op.drop_column('allocation_targets', 'alloc_mode')
