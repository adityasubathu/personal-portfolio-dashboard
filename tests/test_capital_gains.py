"""Tests for capital_gains rule engine — pure functions, no DB required."""
from datetime import date

import pytest

from app.services.capital_gains import (
    CII,
    _apply_setoff,
    _cii_fy,
    _classify_mf_orientation,
    _date_to_fy,
    _fifo_match,
    _holding_months,
    classify_lot,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def trade(trade_date, trade_type, qty, price, brokerage=0.0):
    return {
        "trade_date": date.fromisoformat(trade_date),
        "trade_type": trade_type,
        "quantity": qty,
        "price": price,
        "brokerage": brokerage,
    }


def realized(trades, symbol="TEST", name=None, category="equity", fmv=None):
    lots, attention, intraday = _fifo_match(trades, symbol, name, category, fmv)
    return lots, attention, intraday


# ── _holding_months ───────────────────────────────────────────────────────────

def test_holding_months_exact_year():
    assert _holding_months(date(2023, 1, 15), date(2024, 1, 15)) == 12


def test_holding_months_just_under_year():
    assert _holding_months(date(2023, 1, 15), date(2024, 1, 14)) == 11


def test_holding_months_boundary_day():
    # 1 Jan to 31 Jan: sell day (31) >= buy day (1) → 0 months? No: (0*12 + 0) = 0 → 0 months
    assert _holding_months(date(2024, 1, 1), date(2024, 1, 31)) == 0


def test_holding_months_cross_year():
    # 15 Apr 2022 to 15 Apr 2023 = exactly 12 months
    assert _holding_months(date(2022, 4, 15), date(2023, 4, 15)) == 12


# ── classify_lot ─────────────────────────────────────────────────────────────

class TestEquityClassification:
    def test_stcg_old_rate(self):
        # Sell on 22 Jul 2024 (before budget), held 6 months → STCG at 15%
        assert classify_lot("equity", date(2024, 1, 22), date(2024, 7, 22)) == "equity_stcg_15"

    def test_ltcg_old_rate(self):
        # Sell on 22 Jul 2024, held 13 months → LTCG at 10%
        assert classify_lot("equity", date(2023, 6, 1), date(2024, 7, 22)) == "equity_ltcg_10"

    def test_stcg_new_rate(self):
        # Sell on 23 Jul 2024 (budget day), held 6 months → STCG at 20%
        assert classify_lot("equity", date(2024, 1, 23), date(2024, 7, 23)) == "equity_stcg_20"

    def test_ltcg_new_rate(self):
        # Sell on 23 Jul 2024, held 13 months → LTCG at 12.5%
        assert classify_lot("equity", date(2023, 6, 1), date(2024, 7, 23)) == "equity_ltcg_125"

    def test_exactly_12_months_is_ltcg(self):
        # Bought 1 Jul 2023, sold 1 Jul 2024 = exactly 12 months, before budget → LTCG 10%
        assert classify_lot("equity", date(2023, 7, 1), date(2024, 7, 1)) == "equity_ltcg_10"

    def test_exactly_12_months_post_budget_is_ltcg(self):
        # Bought 23 Jul 2023, sold 23 Jul 2024 = exactly 12 months, on budget day → LTCG 12.5%
        assert classify_lot("equity", date(2023, 7, 23), date(2024, 7, 23)) == "equity_ltcg_125"

    def test_11_months_is_stcg(self):
        # Sell 1 Jul 2024 (before budget) → old rate 15%
        assert classify_lot("equity", date(2023, 8, 1), date(2024, 7, 1)) == "equity_stcg_15"


class TestDebtMFClassification:
    def test_50aa_new_buy_always_slab(self):
        # Bought 1 Apr 2023 (boundary) → §50AA applies
        assert classify_lot("debt_mf", date(2023, 4, 1), date(2025, 1, 1)) == "debt_slab"

    def test_50aa_old_buy_pre_budget_short(self):
        # Bought 31 Mar 2023 (old), sold before 23 Jul 2024, held 20m → slab
        assert classify_lot("debt_mf", date(2023, 3, 31), date(2024, 7, 22)) == "debt_slab"

    def test_50aa_old_buy_pre_budget_long(self):
        # Bought 31 Mar 2023, sold before 23 Jul 2024, held 37m → LTCG 20% indexed
        assert classify_lot("debt_mf", date(2021, 1, 1), date(2024, 7, 22)) == "debt_ltcg_20_indexed"

    def test_50aa_old_buy_post_budget_short(self):
        # Bought 31 Mar 2023, sold 23 Jul 2024, held 15m → slab (need 24m for LTCG)
        assert classify_lot("debt_mf", date(2023, 3, 31), date(2024, 7, 23)) == "debt_slab"

    def test_50aa_old_buy_post_budget_long(self):
        # Bought 31 Mar 2023, sold 23 Jul 2024, held >24m → LTCG 12.5%
        assert classify_lot("debt_mf", date(2022, 1, 1), date(2024, 7, 23)) == "debt_ltcg_125"

    def test_boundary_36_months_pre_budget(self):
        # Exactly 36 months before 23 Jul 2024 → LTCG 20% indexed
        buy = date(2021, 7, 22)
        sell = date(2024, 7, 22)
        assert _holding_months(buy, sell) == 36
        assert classify_lot("debt_mf", buy, sell) == "debt_ltcg_20_indexed"

    def test_boundary_24_months_post_budget(self):
        # Exactly 24 months, sell post-23-Jul-2024
        buy = date(2022, 7, 23)
        sell = date(2024, 7, 23)
        assert _holding_months(buy, sell) == 24
        assert classify_lot("debt_mf", buy, sell) == "debt_ltcg_125"


class TestBondClassification:
    def test_stcg_pre_budget(self):
        assert classify_lot("bond", date(2024, 5, 1), date(2024, 7, 22)) == "bond_stcg_slab"

    def test_ltcg_pre_budget(self):
        assert classify_lot("bond", date(2023, 1, 1), date(2024, 7, 22)) == "bond_ltcg_10"

    def test_stcg_post_budget(self):
        assert classify_lot("bond", date(2024, 5, 1), date(2024, 7, 23)) == "bond_stcg_slab"

    def test_ltcg_post_budget(self):
        assert classify_lot("bond", date(2023, 1, 1), date(2024, 7, 23)) == "bond_ltcg_125"


# ── FIFO matching ─────────────────────────────────────────────────────────────

class TestFifoBasic:
    def test_simple_buy_sell(self):
        # Sell Feb 2024 (before budget) → held 13m → LTCG at 10%
        trades = [
            trade("2023-01-01", "BUY", 10, 100.0),
            trade("2024-02-01", "SELL", 10, 150.0),
        ]
        lots, attention, intraday = realized(trades)
        assert len(lots) == 1
        assert lots[0].qty == 10
        assert lots[0].buy_value == pytest.approx(1000.0)
        assert lots[0].sell_value == pytest.approx(1500.0)
        assert lots[0].gain == pytest.approx(500.0)
        assert lots[0].tax_bucket == "equity_ltcg_10"
        assert intraday["trades"] == 0

    def test_partial_lot(self):
        trades = [
            trade("2023-01-01", "BUY", 10, 100.0),
            trade("2024-02-01", "SELL", 4, 150.0),
        ]
        lots, attention, _ = realized(trades)
        assert len(lots) == 1
        assert lots[0].qty == pytest.approx(4.0)
        assert lots[0].buy_value == pytest.approx(400.0)
        assert lots[0].gain == pytest.approx(200.0)

    def test_multi_lot_sell(self):
        """Sell spans two buy lots (FIFO)."""
        trades = [
            trade("2022-01-01", "BUY", 5, 100.0),
            trade("2023-06-01", "BUY", 5, 120.0),
            trade("2024-02-01", "SELL", 8, 150.0),
        ]
        lots, attention, _ = realized(trades)
        assert len(lots) == 2
        assert lots[0].qty == pytest.approx(5.0)  # first lot fully consumed
        assert lots[0].buy_value == pytest.approx(500.0)
        assert lots[1].qty == pytest.approx(3.0)  # 3 from second lot
        assert lots[1].buy_value == pytest.approx(360.0)

    def test_missing_cost_basis(self):
        """Sell without any buys → attention item."""
        trades = [trade("2024-02-01", "SELL", 10, 150.0)]
        lots, attention, _ = realized(trades)
        assert len(lots) == 0
        assert len(attention) == 1
        assert "missing_cost_basis" in attention[0]["flags"]

    def test_brokerage_apportioned(self):
        trades = [
            trade("2023-01-01", "BUY", 10, 100.0, brokerage=20.0),
            trade("2024-02-01", "SELL", 10, 150.0, brokerage=30.0),
        ]
        lots, _, _ = realized(trades)
        # expenses = (20/10 + 30/10) * 10 = 50
        assert lots[0].expenses == pytest.approx(50.0)
        assert lots[0].gain == pytest.approx(450.0)

    def test_intraday_detection(self):
        """Same-day buy+sell → intraday, not capital gain."""
        trades = [
            trade("2024-01-01", "BUY", 10, 100.0),
            trade("2024-01-01", "SELL", 10, 110.0),
        ]
        lots, attention, intraday = realized(trades)
        assert len(lots) == 0
        assert intraday["trades"] == 2
        assert intraday["pnl"] == pytest.approx(100.0)

    def test_intraday_partial_then_fifo(self):
        """Buy 10, same-day sell 6 → 6 intraday, 4 into queue."""
        trades = [
            trade("2024-01-01", "BUY", 10, 100.0),
            trade("2024-01-01", "SELL", 6, 110.0),
            trade("2024-08-01", "SELL", 4, 120.0),
        ]
        lots, attention, intraday = realized(trades)
        assert intraday["trades"] == 2  # both original trades on intraday day
        assert len(lots) == 1
        assert lots[0].qty == pytest.approx(4.0)
        assert lots[0].sell_value == pytest.approx(480.0)


# ── Grandfathering §112A ──────────────────────────────────────────────────────

class TestGrandfathering:
    def test_no_grandfathering_post_2018_buy(self):
        trades = [
            trade("2018-02-01", "BUY", 10, 100.0),  # on boundary → NOT pre-2018
            trade("2024-01-01", "SELL", 10, 200.0),
        ]
        lots, _, _ = realized(trades)
        assert "grandfathered" not in lots[0].flags

    def test_grandfathering_fmv_higher_than_cost(self):
        # Cost=100, FMV=150, Sale=200 → effective cost = max(100, min(150,200)) = max(100,150) = 150
        trades = [
            trade("2017-06-01", "BUY", 1, 100.0),
            trade("2024-01-01", "SELL", 1, 200.0),
        ]
        lots, _, _ = realized(trades, fmv=150.0)
        assert lots[0].buy_value == pytest.approx(150.0)
        assert lots[0].gain == pytest.approx(50.0)
        assert "grandfathered" in lots[0].flags

    def test_grandfathering_fmv_higher_than_sale(self):
        # Cost=100, FMV=250, Sale=200 → lower_of(FMV,sale)=200 → effective=max(100,200)=200
        trades = [
            trade("2017-06-01", "BUY", 1, 100.0),
            trade("2024-01-01", "SELL", 1, 200.0),
        ]
        lots, _, _ = realized(trades, fmv=250.0)
        # lower_of(250, 200) = 200 = sell_value → gain = 0
        assert lots[0].buy_value == pytest.approx(200.0)
        assert lots[0].gain == pytest.approx(0.0)

    def test_grandfathering_cost_higher_than_fmv(self):
        # Cost=180, FMV=150, Sale=200 → lower_of(150,200)=150 → max(180,150)=180 → cost stays
        trades = [
            trade("2017-06-01", "BUY", 1, 180.0),
            trade("2024-01-01", "SELL", 1, 200.0),
        ]
        lots, _, _ = realized(trades, fmv=150.0)
        assert lots[0].buy_value == pytest.approx(180.0)

    def test_grandfathering_fmv_unavailable_flag(self):
        trades = [
            trade("2017-06-01", "BUY", 1, 100.0),
            trade("2024-01-01", "SELL", 1, 200.0),
        ]
        lots, _, _ = realized(trades, fmv=None)
        assert "grandfathering_fmv_unavailable" in lots[0].flags

    def test_grandfathering_only_for_ltcg(self):
        # Bought before 1 Feb 2018, but held only 10 months → STCG, no grandfathering
        trades = [
            trade("2017-06-01", "BUY", 1, 100.0),
            trade("2018-03-01", "SELL", 1, 200.0),
        ]
        lots, _, _ = realized(trades, fmv=300.0)
        assert "grandfathered" not in lots[0].flags


# ── Debt indexation ───────────────────────────────────────────────────────────

class TestDebtIndexation:
    def test_indexed_gain_calculation(self):
        """Debt MF: old buy, sell pre-23-Jul-2024, held >36m → indexed cost."""
        # Buy 1 Apr 2020 (FY 2020-21, CII=301), sell 1 Apr 2024 (FY 2024-25, CII=363)
        # Cost = 1000, Indexed cost = 1000 * 363/301 = 1205.98
        trades = [
            trade("2020-04-01", "BUY", 1, 1000.0),
            trade("2024-04-01", "SELL", 1, 1400.0),
        ]
        lots, _, _ = _fifo_match(trades, "DEBT", None, "debt_mf", None)
        # sell is after 23 Jul 2024? No — 1 Apr 2024 is before. Wait, 1 Apr 2024 < 23 Jul 2024.
        # Held: Apr 2020 → Apr 2024 = 48m → debt_ltcg_20_indexed
        assert lots[0].tax_bucket == "debt_ltcg_20_indexed"
        buy_cii = CII["2020-21"]   # 301
        sell_cii = CII["2024-25"]  # 363
        expected_indexed_cost = 1000.0 * (sell_cii / buy_cii)
        assert lots[0].buy_value == pytest.approx(expected_indexed_cost, rel=1e-4)
        assert lots[0].gain == pytest.approx(1400.0 - expected_indexed_cost, rel=1e-4)


# ── Set-off and §112A exemption ───────────────────────────────────────────────

class TestSetoff:
    def test_stcl_offsets_stcg(self):
        # STCG 10k, STCL (loss bucket) -4k → net STCG 6k
        gains = {"equity_stcg_20": 10_000, "equity_stcg_15": -4_000}
        result = {b["key"]: b for b in _apply_setoff(gains, "2024-25")}
        # equity_stcg_20: gross 10k, setoff 4k (proportional), taxable 6k
        assert result["equity_stcg_20"]["taxable"] == pytest.approx(6_000, abs=1)
        # loss bucket: taxable 0
        assert result["equity_stcg_15"]["taxable"] == pytest.approx(0)

    def test_stcl_offsets_ltcg_after_stcg(self):
        # STCG 0, STCL 5k, non-112A LTCG 200k → STCL reduces LTCG; net taxable ≈ 195k
        # Use bond LTCG to avoid §112A exemption interfering with the set-off test.
        gains = {"equity_stcg_20": -5_000, "bond_ltcg_125": 200_000}
        result = {b["key"]: b for b in _apply_setoff(gains, "2024-25")}
        assert result["bond_ltcg_125"]["taxable"] == pytest.approx(195_000, abs=1)

    def test_ltcl_only_offsets_ltcg(self):
        # LTCL 5k, STCG 10k, non-112A LTCG 50k → LTCL reduces only LTCG
        # Use bond buckets to avoid §112A exemption interfering.
        gains = {"bond_ltcg_10": -5_000, "equity_stcg_15": 10_000, "bond_ltcg_125": 50_000}
        result = {b["key"]: b for b in _apply_setoff(gains, "2024-25")}
        # STCG unaffected by LTCL
        assert result["equity_stcg_15"]["taxable"] == pytest.approx(10_000)
        # LTCG 50k - LTCL 5k = 45k taxable
        assert result["bond_ltcg_125"]["taxable"] == pytest.approx(45_000, abs=100)

    def test_112a_exemption_fy2425(self):
        # Equity LTCG 2L → exemption 1.25L → taxable 75k
        gains = {"equity_ltcg_125": 200_000}
        result = {b["key"]: b for b in _apply_setoff(gains, "2024-25")}
        assert result["equity_ltcg_125"]["exemption_applied"] == pytest.approx(125_000)
        assert result["equity_ltcg_125"]["taxable"] == pytest.approx(75_000)

    def test_112a_exemption_pre_fy2425(self):
        # FY 2023-24: exemption limit is 1L
        gains = {"equity_ltcg_10": 200_000}
        result = {b["key"]: b for b in _apply_setoff(gains, "2023-24")}
        assert result["equity_ltcg_10"]["exemption_applied"] == pytest.approx(100_000)
        assert result["equity_ltcg_10"]["taxable"] == pytest.approx(100_000)

    def test_112a_exemption_capped_at_gain(self):
        # Gain smaller than exemption limit → fully exempt
        gains = {"equity_ltcg_125": 50_000}
        result = {b["key"]: b for b in _apply_setoff(gains, "2024-25")}
        assert result["equity_ltcg_125"]["exemption_applied"] == pytest.approx(50_000)
        assert result["equity_ltcg_125"]["taxable"] == pytest.approx(0)

    def test_estimated_tax_computed(self):
        gains = {"equity_ltcg_125": 200_000}
        result = {b["key"]: b for b in _apply_setoff(gains, "2024-25")}
        # taxable = 75k, rate 12.5%, tax = 9375
        assert result["equity_ltcg_125"]["est_tax"] == pytest.approx(9_375)

    def test_slab_rate_bucket_no_est_tax(self):
        gains = {"debt_slab": 50_000}
        result = {b["key"]: b for b in _apply_setoff(gains, "2024-25")}
        assert result["debt_slab"]["est_tax"] is None
        assert result["debt_slab"]["rate"] is None


# ── MF classification ─────────────────────────────────────────────────────────

class TestMFClassification:
    def test_equity_keywords(self):
        assert _classify_mf_orientation("Axis Bluechip Equity Fund", None) == "equity"
        assert _classify_mf_orientation("Mirae Asset ELSS Tax Saver Fund", None) == "equity"
        # tradingsymbol "NIFTYBEES" contains "nifty" (no trailing word-boundary needed)
        assert _classify_mf_orientation(None, "NIFTYBEES") == "equity"
        assert _classify_mf_orientation("Mirae Nifty 50 ETF", None) == "equity"

    def test_debt_keywords(self):
        assert _classify_mf_orientation("HDFC Liquid Fund", None) == "debt_mf"
        assert _classify_mf_orientation("Kotak Gilt Fund", None) == "debt_mf"
        assert _classify_mf_orientation("SBI Overnight Fund", None) == "debt_mf"

    def test_unknown(self):
        assert _classify_mf_orientation("Aditya Birla Sun Life Special Opportunities Fund", None) == "unknown_mf"


# ── CII helpers ───────────────────────────────────────────────────────────────

def test_cii_fy():
    assert _cii_fy(date(2024, 4, 1)) == "2024-25"
    assert _cii_fy(date(2024, 3, 31)) == "2023-24"
    assert _cii_fy(date(2020, 4, 1)) == "2020-21"


def test_date_to_fy():
    assert _date_to_fy(date(2024, 7, 23)) == "2024-25"
    assert _date_to_fy(date(2024, 3, 31)) == "2023-24"
    assert _date_to_fy(date(2021, 4, 1)) == "2021-22"
