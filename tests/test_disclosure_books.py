from datetime import date

from app.services.disclosure_books import dates_to_keep, is_active_equity, months_apart


class TestMonthsApart:
    def test_same_month(self):
        assert months_apart(date(2026, 10, 31), date(2026, 10, 15)) == 0

    def test_across_year(self):
        assert months_apart(date(2027, 1, 31), date(2026, 11, 30)) == 2


class TestDatesToKeep:
    def test_monthly_keeps_three(self):
        available = ["2026-10-31", "2026-09-30", "2026-08-31", "2026-07-31", "2026-06-30"]
        assert dates_to_keep(available) == [date(2026, 10, 31), date(2026, 9, 30), date(2026, 8, 31)]

    def test_fortnightly_keeps_both_halves_of_each_month(self):
        available = [
            "2026-11-15", "2026-10-31", "2026-10-15", "2026-09-30", "2026-09-15",
            "2026-08-31", "2026-08-15", "2026-07-31",
        ]
        assert dates_to_keep(available) == [
            date(2026, 11, 15), date(2026, 10, 31), date(2026, 10, 15),
            date(2026, 9, 30), date(2026, 9, 15),
        ]

    def test_unsorted_and_duplicate_input(self):
        assert dates_to_keep(["2026-08-31", "2026-10-31", "2026-10-31"]) == [date(2026, 10, 31), date(2026, 8, 31)]

    def test_empty(self):
        assert dates_to_keep([]) == []


class TestIsActiveEquity:
    def test_equity_scheme(self):
        assert is_active_equity("Open Ended Schemes ( Equity Scheme - Small Cap Fund )")

    def test_elss(self):
        assert is_active_equity("Open Ended Schemes ( Equity Scheme - ELSS )")

    def test_arbitrage_excluded(self):
        assert not is_active_equity("Open Ended Schemes ( Hybrid Scheme - Arbitrage Fund )")

    def test_etf_excluded(self):
        assert not is_active_equity("Open Ended Schemes ( Exchange Traded Funds (ETFs) - Equity ETF )")
        assert not is_active_equity("Open Ended Schemes ( Other Scheme - Other  ETFs )")

    def test_missing(self):
        assert not is_active_equity(None)
