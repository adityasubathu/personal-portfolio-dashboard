"""add_policy_trigger_tables

Revision ID: c3d4e5f6a1b2
Revises: b2c3d4e5f6a1
Create Date: 2026-06-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = 'c3d4e5f6a1b2'
down_revision = 'b2c3d4e5f6a1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'policy_trigger_state',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key', sa.String(length=80), nullable=False),
        sa.Column('value_bool', sa.Boolean(), nullable=True),
        sa.Column('value_num', sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column('value_text', sa.Text(), nullable=True),
        sa.Column('acknowledged_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('key'),
    )
    op.create_table(
        'policy_trigger_events',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('trigger_key', sa.String(length=80), nullable=False),
        sa.Column('status', sa.String(length=10), nullable=False),
        sa.Column('detail', JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('policy_trigger_events')
    op.drop_table('policy_trigger_state')
