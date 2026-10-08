"""Tests for the target-table Debt rule — pure function, no DB required."""
from app.services.allocation import _investable_debt


def manual(total_cash=0.0, emergency_total=0.0):
    return {"total_cash": total_cash, "emergency_total": emergency_total}


class TestInvestableDebt:
    def test_sums_debt_and_arbitrage(self):
        totals = {"Debt": 1000.0, "Equity - Arbitrage": 500.0, "Large Cap": 9999.0}
        assert _investable_debt(totals, manual()) == 1500.0

    def test_mf_cash_counts_towards_debt(self):
        totals = {"Debt": 1000.0, "Cash": 300.0}
        assert _investable_debt(totals, manual(total_cash=0.0)) == 1300.0

    def test_savings_and_wallet_cash_excluded(self):
        # Cash = 200 MF cash + 500 savings/INDmoney cash folded in by _build_category_totals_full
        totals = {"Debt": 1000.0, "Cash": 700.0}
        assert _investable_debt(totals, manual(total_cash=500.0)) == 1200.0

    def test_emergency_fund_subtracted(self):
        totals = {"Debt": 1000.0, "Cash": 100.0}
        assert _investable_debt(totals, manual(total_cash=100.0, emergency_total=400.0)) == 600.0

    def test_negative_mf_cash_reduces_debt(self):
        totals = {"Debt": 1000.0, "Cash": 450.0}
        assert _investable_debt(totals, manual(total_cash=500.0)) == 950.0

    def test_clamped_at_zero(self):
        totals = {"Debt": 100.0}
        assert _investable_debt(totals, manual(emergency_total=500.0)) == 0.0

    def test_missing_keys_default_to_zero(self):
        assert _investable_debt({}, {}) == 0.0
