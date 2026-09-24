"""Tests for per-holding XIRR cycle restart — pure functions, no DB required."""
from datetime import date
from types import SimpleNamespace

from app.services.xirr import current_cycle_trades


def trade(trade_date, trade_type, qty):
    return SimpleNamespace(trade_date=date.fromisoformat(trade_date), trade_type=trade_type, quantity=qty)


def dates(trades):
    return [t.trade_date.isoformat() for t in trades]


def test_no_exit_keeps_all_trades():
    trades = [trade("2024-01-01", "BUY", 10), trade("2024-02-01", "SELL", 4), trade("2024-03-01", "BUY", 5)]
    assert current_cycle_trades(trades) == trades


def test_rebuy_after_five_flat_trading_days_restarts():
    # Sold out Mon 2024-01-08; flat Mon–Fri (5 trading days); rebought Mon 2024-01-15.
    trades = [trade("2024-01-01", "BUY", 10), trade("2024-01-08", "SELL", 10), trade("2024-01-15", "BUY", 7)]
    assert dates(current_cycle_trades(trades)) == ["2024-01-15"]


def test_rebuy_after_four_flat_trading_days_keeps_history():
    # Sold out Mon 2024-01-08; rebought Fri 2024-01-12 — flat for only Mon–Thu.
    trades = [trade("2024-01-01", "BUY", 10), trade("2024-01-08", "SELL", 10), trade("2024-01-12", "BUY", 7)]
    assert current_cycle_trades(trades) == trades


def test_weekends_do_not_count_as_trading_days():
    # Sold out Thu 2024-01-11; flat Thu, Fri, Mon, Tue = 4 trading days despite 6 calendar days.
    trades = [trade("2024-01-01", "BUY", 10), trade("2024-01-11", "SELL", 10), trade("2024-01-17", "BUY", 7)]
    assert current_cycle_trades(trades) == trades


def test_restarts_from_latest_qualifying_gap():
    trades = [
        trade("2022-01-03", "BUY", 10),
        trade("2022-06-01", "SELL", 10),
        trade("2023-01-02", "BUY", 5),
        trade("2023-06-01", "SELL", 5),
        trade("2024-01-01", "BUY", 3),
        trade("2024-02-01", "BUY", 2),
    ]
    assert dates(current_cycle_trades(trades)) == ["2024-01-01", "2024-02-01"]


def test_partial_sells_reaching_zero_restart():
    trades = [
        trade("2024-01-01", "BUY", 10),
        trade("2024-02-01", "SELL", 6),
        trade("2024-03-01", "SELL", 4),
        trade("2024-06-03", "BUY", 8),
    ]
    assert dates(current_cycle_trades(trades)) == ["2024-06-03"]


def test_fully_exited_position_keeps_last_cycle():
    trades = [
        trade("2022-01-03", "BUY", 10),
        trade("2022-06-01", "SELL", 10),
        trade("2023-01-02", "BUY", 5),
        trade("2023-06-01", "SELL", 5),
    ]
    assert dates(current_cycle_trades(trades)) == ["2023-01-02", "2023-06-01"]
