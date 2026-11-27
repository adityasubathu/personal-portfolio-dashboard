"""add_mf_disclosure_book

Revision ID: d1e2f3a4b5c6
Revises: a7b8c9d0e1f2
Create Date: 2026-11-27 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'd1e2f3a4b5c6'
down_revision = 'a7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'mf_disclosure_book',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('scheme_isin', sa.String(length=12), nullable=False),
        sa.Column('amfi_code', sa.String(length=20), nullable=False),
        sa.Column('amfi_category', sa.String(length=255), nullable=True),
        sa.Column('as_of', sa.Date(), nullable=False),
        sa.Column('meta', postgresql.JSONB(), nullable=False),
        sa.Column('holdings', postgresql.JSONB(), nullable=False),
        sa.Column('fetched_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('scheme_isin', 'as_of', name='uq_mf_disclosure_book_scheme_as_of'),
    )
    op.create_index('ix_mf_disclosure_book_scheme_isin', 'mf_disclosure_book', ['scheme_isin'])


def downgrade() -> None:
    op.drop_index('ix_mf_disclosure_book_scheme_isin', table_name='mf_disclosure_book')
    op.drop_table('mf_disclosure_book')
