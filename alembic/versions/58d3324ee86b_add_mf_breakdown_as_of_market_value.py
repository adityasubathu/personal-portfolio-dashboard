"""add_mf_breakdown_as_of_market_value

Revision ID: 58d3324ee86b
Revises: 330edc09963d
Create Date: 2026-08-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '58d3324ee86b'
down_revision = '330edc09963d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('mf_scheme_breakdown', sa.Column('as_of', sa.Date(), nullable=True))
    op.add_column('mf_scheme_breakdown', sa.Column('market_value', sa.Numeric(18, 2), nullable=True))
    op.alter_column(
        'mf_scheme_breakdown', 'holdings_pct',
        existing_type=sa.Numeric(8, 4),
        type_=sa.Numeric(14, 8),
        existing_nullable=False,
    )
    op.drop_constraint('uq_mf_breakdown_scheme_name_type', 'mf_scheme_breakdown', type_='unique')


def downgrade() -> None:
    op.create_unique_constraint(
        'uq_mf_breakdown_scheme_name_type', 'mf_scheme_breakdown', ['scheme_isin', 'name', 'holding_type'],
    )
    op.alter_column(
        'mf_scheme_breakdown', 'holdings_pct',
        existing_type=sa.Numeric(14, 8),
        type_=sa.Numeric(8, 4),
        existing_nullable=False,
    )
    op.drop_column('mf_scheme_breakdown', 'market_value')
    op.drop_column('mf_scheme_breakdown', 'as_of')
