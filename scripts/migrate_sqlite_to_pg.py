#!/usr/bin/env python3
"""
One-time migration: dump all rows from the SQLite database and load them into
PostgreSQL. Run this AFTER `docker compose up` has started Postgres and the app
has run create_all (i.e. tables exist in PG).

Usage:
  python scripts/migrate_sqlite_to_pg.py <sqlite_db_path> <postgres_url>

Example:
  python scripts/migrate_sqlite_to_pg.py \
    ./data/portfolio.db \
    postgresql://portfolio:portfolio@localhost:5432/portfolio
"""
import sqlite3
import sys

import psycopg2
import psycopg2.extras

TABLES = [
    "instruments",
    "trades",
    "holdings",
    "mf_schemes",
    "mf_holdings",
    "price_history",
    "kite_config",
    "kite_sync_log",
    "csv_import_log",
]


def _get_bool_columns(cur, table: str) -> set[str]:
    """Return the set of column names that are boolean in Postgres."""
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = %s AND data_type = 'boolean'",
        (table,),
    )
    return {row[0] for row in cur.fetchall()}


def _coerce_row(row_dict: dict, bool_cols: set[str]) -> dict:
    """Cast SQLite integer 0/1 to Python bool for Postgres boolean columns."""
    for col in bool_cols:
        if col in row_dict and isinstance(row_dict[col], int):
            row_dict[col] = bool(row_dict[col])
    return row_dict


def migrate(sqlite_path: str, pg_url: str):
    src = sqlite3.connect(sqlite_path)
    src.row_factory = sqlite3.Row
    dst = psycopg2.connect(pg_url)
    dst_cur = dst.cursor()

    # Disable FK checks so we can load tables in any order and handle orphan rows.
    dst_cur.execute("SET session_replication_role = 'replica'")

    for table in TABLES:
        try:
            rows = src.execute(f"SELECT * FROM {table}").fetchall()
        except sqlite3.OperationalError:
            print(f"  {table}: not found in SQLite, skipping")
            continue

        if not rows:
            print(f"  {table}: 0 rows")
            continue

        cols = rows[0].keys()
        bool_cols = _get_bool_columns(dst_cur, table)
        placeholders = ", ".join([f"%({c})s" for c in cols])
        col_names = ", ".join(cols)
        insert_sql = f"INSERT INTO {table} ({col_names}) VALUES ({placeholders}) ON CONFLICT DO NOTHING"

        count = 0
        for row in rows:
            row_dict = _coerce_row(dict(row), bool_cols)
            try:
                dst_cur.execute(insert_sql, row_dict)
                count += 1
            except Exception as e:
                print(f"  {table}: row error: {e}")
                dst.rollback()
                dst_cur = dst.cursor()
                dst_cur.execute("SET session_replication_role = 'replica'")
                continue

        dst.commit()

        if "id" in cols:
            try:
                dst_cur.execute(
                    f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                    f"COALESCE((SELECT MAX(id) FROM {table}), 1))"
                )
                dst.commit()
            except Exception:
                dst.rollback()
                dst_cur = dst.cursor()

        print(f"  {table}: {count} rows migrated")

    # Re-enable FK checks.
    dst_cur.execute("SET session_replication_role = 'origin'")
    dst.commit()

    src.close()
    dst.close()
    print("Done.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <sqlite_db_path> <postgres_url>")
        sys.exit(1)
    migrate(sys.argv[1], sys.argv[2])
