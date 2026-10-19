"""Tests for the NAV-series day walk — pure function, no DB required."""
from datetime import date

from app.models.trade import Trade
from app.services.nav_history import UNIT_NAV_BASE, add_benchmark_series, build_nav_series


def trade(trade_date, instrument_id, trade_type, qty, price, brokerage=0.0):
    return Trade(
        instrument_id=instrument_id,
        trade_date=date.fromisoformat(trade_date),
        trade_type=trade_type,
        quantity=qty,
        price=price,
        brokerage=brokerage,
        source="TEST",
    )


def by_date(rows):
    out = {}
    for d, iid, close in rows:
        out.setdefault(date.fromisoformat(d), []).append((iid, close))
    return out


def test_empty_trades_gives_empty_series():
    assert build_nav_series([], {}, date(2023, 1, 10)) == []


def test_value_forward_fills_across_gaps():
    trades = [trade("2023-01-01", 1, "BUY", 10, 100)]
    closes = by_date([("2023-01-01", 1, 100.0), ("2023-01-03", 1, 120.0)])
    series = build_nav_series(trades, closes, date(2023, 1, 4))

    assert [p["date"] for p in series] == [
        "2023-01-01", "2023-01-02", "2023-01-03", "2023-01-04",
    ]
    # 02 Jan has no close of its own — it forward-fills 01 Jan's 100.
    assert [p["value"] for p in series] == [1000.0, 1000.0, 1200.0, 1200.0]
    # Cost basis is flat: 10 x 100, no brokerage.
    assert all(p["invested"] == 1000.0 for p in series)


def test_trade_price_seeds_value_when_no_close_yet():
    trades = [trade("2023-01-01", 1, "BUY", 10, 100, brokerage=25)]
    series = build_nav_series(trades, {}, date(2023, 1, 1))
    assert series[0]["value"] == 1000.0      # seeded from the trade price
    assert series[0]["invested"] == 1025.0   # brokerage is part of the basis


def test_sell_shrinks_cost_basis_proportionally():
    trades = [
        trade("2023-01-01", 1, "BUY", 10, 100),
        trade("2023-01-02", 1, "SELL", 4, 150),
    ]
    closes = by_date([("2023-01-01", 1, 100.0), ("2023-01-02", 1, 150.0)])
    series = build_nav_series(trades, closes, date(2023, 1, 2))
    assert series[1]["value"] == 900.0      # 6 units x 150
    assert series[1]["invested"] == 600.0   # 6/10 of the original 1000 basis


def test_full_exit_zeroes_qty_and_cost():
    trades = [
        trade("2023-01-01", 1, "BUY", 10, 100),
        trade("2023-01-02", 1, "SELL", 10, 150),
    ]
    closes = by_date([("2023-01-01", 1, 100.0), ("2023-01-02", 1, 150.0)])
    series = build_nav_series(trades, closes, date(2023, 1, 2))
    assert series[1]["value"] == 0.0
    assert series[1]["invested"] == 0.0


def test_unit_nav_is_null_before_base_date_and_ignores_cash_flows():
    # Base date is 2022-11-05; start before it so unit_nav is null for a while.
    trades = [
        trade("2022-11-03", 1, "BUY", 10, 100),
        trade("2022-11-07", 1, "BUY", 10, 110),   # contribution, not a return
    ]
    closes = by_date([
        ("2022-11-03", 1, 100.0),
        ("2022-11-05", 1, 100.0),
        ("2022-11-06", 1, 110.0),
        ("2022-11-07", 1, 110.0),
    ])
    series = build_nav_series(trades, closes, date(2022, 11, 7))
    nav = {p["date"]: p["unit_nav"] for p in series}

    assert nav["2022-11-03"] is None
    assert nav["2022-11-04"] is None
    assert nav["2022-11-05"] == UNIT_NAV_BASE          # base date itself
    assert nav["2022-11-06"] == 110.0                  # +10% organic move
    assert nav["2022-11-07"] == 110.0                  # buying more is not a return


def test_nav_row_wins_over_price_row_on_the_same_day():
    # compute_nav_series appends nav_history rows after price_history rows, so
    # the last write for a day is the NAV. Assert the walk honours that order.
    trades = [trade("2023-01-01", 1, "BUY", 10, 100)]
    closes = {date(2023, 1, 1): [(1, 100.0), (1, 105.0)]}
    series = build_nav_series(trades, closes, date(2023, 1, 1))
    assert series[0]["value"] == 1050.0


def points(*rows):
    return [{"date": d, "unit_nav": nav} for d, nav in rows]


def test_benchmark_anchors_on_last_close_before_a_weekend_base_date():
    # 5 Nov 2022 is a Saturday: the anchor is Friday's close, forward-filled.
    series = points(("2022-11-05", 100.0), ("2022-11-06", 100.0), ("2022-11-07", 101.0))
    closes = {date(2022, 11, 4): 18000.0, date(2022, 11, 7): 18360.0}
    add_benchmark_series(series, "nifty50", closes)
    assert [p["nifty50"] for p in series] == [100.0, 100.0, 102.0]


def test_benchmark_is_null_before_unit_nav_starts():
    series = points(("2022-11-03", None), ("2022-11-04", None), ("2022-11-05", 100.0), ("2022-11-07", 100.0))
    closes = {date(2022, 11, 3): 500.0, date(2022, 11, 4): 400.0, date(2022, 11, 7): 440.0}
    add_benchmark_series(series, "nifty500", closes)
    # Earlier closes don't move the anchor: it's the 4 Nov close carried to 5 Nov.
    assert [p["nifty500"] for p in series] == [None, None, 100.0, 110.0]


def test_benchmark_is_all_null_without_closes():
    series = points(("2022-11-05", 100.0), ("2022-11-06", 103.0))
    add_benchmark_series(series, "nifty50", {})
    assert [p["nifty50"] for p in series] == [None, None]


def test_benchmark_starting_after_unit_nav_anchors_on_that_days_unit_nav():
    series = points(("2023-01-01", 100.0), ("2023-01-02", 105.0), ("2023-01-03", 110.0))
    closes = {date(2023, 1, 2): 200.0, date(2023, 1, 3): 220.0}
    add_benchmark_series(series, "nifty50", closes)
    assert [p["nifty50"] for p in series] == [None, 105.0, 115.5]
