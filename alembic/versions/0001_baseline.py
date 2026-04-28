"""baseline schema and data migrations

Revision ID: 0001
Revises:
Create Date: 2026-04-28

Captures the full schema as of this commit plus all one-time data migrations
that were previously in app/main.py lifespan.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- instruments ---
    op.create_table(
        "instruments",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("isin", sa.String(12), unique=True, index=True),
        sa.Column("tradingsymbol", sa.String(100), index=True),
        sa.Column("exchange", sa.String(10)),
        sa.Column("instrument_type", sa.String(10), nullable=False),
        sa.Column("name", sa.String(255)),
        sa.Column("amfi_scheme_code", sa.String(20), index=True),
        sa.Column("kite_instrument_token", sa.Integer, index=True),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
        if_not_exists=True,
    )

    # --- holdings ---
    op.create_table(
        "holdings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("instrument_id", sa.Integer, sa.ForeignKey("instruments.id"), unique=True, index=True),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("average_price", sa.Numeric(18, 6)),
        sa.Column("total_cost", sa.Numeric(18, 6)),
        sa.Column("last_price", sa.Numeric(18, 6)),
        sa.Column("last_price_at", sa.DateTime),
        sa.Column("unrealised_pnl", sa.Numeric(18, 6)),
        sa.Column("kite_synced", sa.Boolean, server_default="false"),
        sa.Column("kite_synced_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
        if_not_exists=True,
    )

    # --- trades ---
    op.create_table(
        "trades",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("instrument_id", sa.Integer, sa.ForeignKey("instruments.id"), index=True),
        sa.Column("trade_date", sa.Date, index=True, nullable=False),
        sa.Column("trade_type", sa.String(4), nullable=False),
        sa.Column("quantity", sa.Numeric(18, 6), nullable=False),
        sa.Column("price", sa.Numeric(18, 6), nullable=False),
        sa.Column("amount", sa.Numeric(18, 6)),
        sa.Column("brokerage", sa.Numeric(18, 6), server_default="0"),
        sa.Column("exchange", sa.String(10)),
        sa.Column("segment", sa.String(10)),
        sa.Column("notes", sa.String(500)),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("import_batch_id", sa.String(36), index=True),
        sa.Column("created_at", sa.DateTime),
        if_not_exists=True,
    )

    # --- price_history ---
    op.create_table(
        "price_history",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("instrument_id", sa.Integer, sa.ForeignKey("instruments.id"), index=True),
        sa.Column("price_date", sa.Date, nullable=False),
        sa.Column("open", sa.Numeric(18, 6)),
        sa.Column("high", sa.Numeric(18, 6)),
        sa.Column("low", sa.Numeric(18, 6)),
        sa.Column("close", sa.Numeric(18, 6), nullable=False),
        sa.Column("created_at", sa.DateTime),
        sa.UniqueConstraint("instrument_id", "price_date", name="uq_price_history_instr_date"),
        if_not_exists=True,
    )
    op.create_index("ix_price_history_instr_date", "price_history", ["instrument_id", "price_date"], if_not_exists=True)

    # --- nav_history ---
    op.create_table(
        "nav_history",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("instrument_id", sa.Integer, sa.ForeignKey("instruments.id"), index=True),
        sa.Column("nav_date", sa.Date, nullable=False),
        sa.Column("nav", sa.Numeric(18, 6), nullable=False),
        sa.Column("created_at", sa.DateTime),
        sa.UniqueConstraint("instrument_id", "nav_date", name="uq_nav_history_instr_date"),
        if_not_exists=True,
    )
    op.create_index("ix_nav_history_instr_date", "nav_history", ["instrument_id", "nav_date"], if_not_exists=True)

    # --- kite_config ---
    op.create_table(
        "kite_config",
        sa.Column("id", sa.Integer, primary_key=True, default=1),
        sa.Column("api_key", sa.String(50), nullable=False),
        sa.Column("api_secret", sa.String(100), nullable=False),
        sa.Column("access_token", sa.String(200)),
        sa.Column("access_token_expiry", sa.DateTime),
        sa.Column("redirect_url", sa.String(300)),
        sa.Column("updated_at", sa.DateTime),
        sa.CheckConstraint("id = 1", name="ck_kite_config_singleton"),
        if_not_exists=True,
    )

    # --- kite_sync_log ---
    op.create_table(
        "kite_sync_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("synced_at", sa.DateTime),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("holdings_count", sa.Integer),
        sa.Column("positions_count", sa.Integer),
        sa.Column("mf_holdings_count", sa.Integer),
        sa.Column("error_message", sa.Text),
        sa.Column("access_token_hint", sa.String(10)),
        if_not_exists=True,
    )

    # --- csv_import_log ---
    op.create_table(
        "csv_import_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("batch_id", sa.String(36), unique=True, index=True),
        sa.Column("filename", sa.String(255)),
        sa.Column("imported_at", sa.DateTime),
        sa.Column("row_count", sa.Integer),
        sa.Column("success_count", sa.Integer),
        sa.Column("error_count", sa.Integer),
        sa.Column("errors_json", sa.Text),
        if_not_exists=True,
    )

    # --- amfi_market_cap ---
    op.create_table(
        "amfi_market_cap",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("company_name", sa.String(255), nullable=False),
        sa.Column("isin", sa.String(12), index=True),
        sa.Column("bse_symbol", sa.String(20)),
        sa.Column("nse_symbol", sa.String(20)),
        sa.Column("categorization", sa.String(20), nullable=False),
        sa.Column("name_normalized", sa.String(255), index=True),
        sa.Column("updated_at", sa.DateTime),
        if_not_exists=True,
    )

    # --- mf_scheme_breakdown ---
    op.create_table(
        "mf_scheme_breakdown",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("scheme_isin", sa.String(12), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("holding_type", sa.String(50), nullable=False),
        sa.Column("holdings_pct", sa.Numeric(8, 4), nullable=False),
        sa.Column("category", sa.String(30), nullable=False),
        sa.Column("updated_at", sa.DateTime),
        sa.UniqueConstraint("scheme_isin", "name", "holding_type", name="uq_mf_breakdown_scheme_name_type"),
        if_not_exists=True,
    )
    op.create_index("ix_mf_breakdown_scheme_isin", "mf_scheme_breakdown", ["scheme_isin"], if_not_exists=True)

    # --- manual_assets ---
    op.create_table(
        "manual_assets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("asset_type", sa.String(10), nullable=False),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("principal", sa.Numeric(18, 2)),
        sa.Column("interest_rate", sa.Numeric(6, 4)),
        sa.Column("start_date", sa.Date),
        sa.Column("maturity_date", sa.Date),
        sa.Column("current_value", sa.Numeric(18, 2)),
        sa.Column("is_emergency_fund", sa.Boolean, server_default="false"),
        sa.Column("created_at", sa.DateTime),
        sa.Column("updated_at", sa.DateTime),
        if_not_exists=True,
    )

    # --- allocation_targets ---
    op.create_table(
        "allocation_targets",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("category", sa.String(30), unique=True, nullable=False),
        sa.Column("target_pct", sa.Numeric(6, 2), nullable=False),
        if_not_exists=True,
    )

    # ---- Data migrations (idempotent) ----

    # Migrate MF/ETF NAV rows from price_history → nav_history
    op.execute("""
        INSERT INTO nav_history (instrument_id, nav_date, nav, created_at)
        SELECT ph.instrument_id, ph.price_date, ph.close, ph.created_at
        FROM price_history ph
        JOIN instruments i ON i.id = ph.instrument_id
        WHERE i.instrument_type IN ('MF', 'ETF')
          AND ph.open IS NULL
        ON CONFLICT (instrument_id, nav_date) DO NOTHING
    """)
    op.execute("""
        DELETE FROM price_history
        WHERE open IS NULL
          AND instrument_id IN (
              SELECT id FROM instruments WHERE instrument_type IN ('MF', 'ETF')
          )
    """)

    # Rename instruments
    op.execute("UPDATE instruments SET tradingsymbol = '734GS2064-GS', name = '734GS2064-GS' WHERE tradingsymbol = '734GOI2064'")
    op.execute("UPDATE instruments SET tradingsymbol = 'SGBFEB32IV-GB', name = 'SGBFEB32IV-GB' WHERE tradingsymbol = 'SGBFEB32IV'")
    op.execute("UPDATE instruments SET tradingsymbol = 'ETERNAL', name = 'ETERNAL' WHERE tradingsymbol = 'ZOMATO'")


def downgrade() -> None:
    op.execute("UPDATE instruments SET tradingsymbol = 'ZOMATO', name = 'ZOMATO' WHERE tradingsymbol = 'ETERNAL'")
    op.execute("UPDATE instruments SET tradingsymbol = 'SGBFEB32IV', name = 'SGBFEB32IV' WHERE tradingsymbol = 'SGBFEB32IV-GB'")
    op.execute("UPDATE instruments SET tradingsymbol = '734GOI2064', name = '734GOI2064' WHERE tradingsymbol = '734GS2064-GS'")

    op.drop_table("allocation_targets")
    op.drop_table("manual_assets")
    op.drop_table("mf_scheme_breakdown")
    op.drop_table("amfi_market_cap")
    op.drop_table("csv_import_log")
    op.drop_table("kite_sync_log")
    op.drop_table("kite_config")
    op.drop_table("nav_history")
    op.drop_table("price_history")
    op.drop_table("trades")
    op.drop_table("holdings")
    op.drop_table("instruments")
