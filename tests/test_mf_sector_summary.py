"""Tests for the per-fund sector donut grouping — pure function, no DB required."""
import pytest

from app.services.composition import NON_EQUITY_LABEL, _summarize_sectors


def row(category, sector, pct, value=None):
    return {
        "category": category,
        "sector": sector,
        "pct": pct,
        "value": pct * 100 if value is None else value,
    }


class TestEquityBucketing:
    def test_groups_equity_rows_by_sector_across_market_caps(self):
        out = _summarize_sectors([
            row("Large Cap", "Financial Services", 10.0),
            row("Mid Cap", "Financial Services", 5.0),
            row("Small Cap", "Healthcare", 3.0),
        ])
        assert out == [
            {"sector": "Financial Services", "pct": 15.0, "value": 1500.0},
            {"sector": "Healthcare", "pct": 3.0, "value": 300.0},
        ]

    def test_null_sector_becomes_unknown(self):
        out = _summarize_sectors([
            row("Small Cap", None, 4.0),
            row("Unclassified Equity", None, 1.0),
        ])
        assert out == [{"sector": "Unknown", "pct": 5.0, "value": 500.0}]

    def test_real_estate_trust_stays_a_real_sector(self):
        out = _summarize_sectors([row("Real Estate Trust", "Real Estate Trust", 4.21)])
        assert out == [{"sector": "Real Estate Trust", "pct": 4.21, "value": 421.0}]

    def test_sorted_by_pct_descending(self):
        out = _summarize_sectors([
            row("Large Cap", "Healthcare", 2.0),
            row("Large Cap", "Financial Services", 9.0),
            row("Large Cap", "Power", 5.0),
        ])
        assert [s["sector"] for s in out] == ["Financial Services", "Power", "Healthcare"]


class TestNonEquityBucket:
    @pytest.mark.parametrize("category", ["Debt", "Cash", "Gold", "Silver", "Other"])
    def test_non_equity_categories_merge(self, category):
        out = _summarize_sectors([row(category, "Fixed Income", 20.0)])
        assert out == [{"sector": NON_EQUITY_LABEL, "pct": 20.0, "value": 2000.0}]

    def test_arbitrage_and_derivatives_merge_into_non_equity(self):
        out = _summarize_sectors([
            row("Equity - Arbitrage", "Financial Services", 73.64),
            row("Derivatives - Leveraged", "Financial Services", -0.14),
            row("Debt", "Fixed Income", 25.95),
            row("Large Cap", "Financial Services", 0.41),
        ])
        assert out == [
            {"sector": "Financial Services", "pct": 0.41, "value": 41.0},
            {"sector": NON_EQUITY_LABEL, "pct": 99.45, "value": 9945.0},
        ]

    def test_non_equity_always_sorts_last_even_when_largest(self):
        out = _summarize_sectors([
            row("Debt", "Fixed Income", 80.0),
            row("Large Cap", "Healthcare", 20.0),
        ])
        assert [s["sector"] for s in out] == ["Healthcare", NON_EQUITY_LABEL]

    def test_gold_etf_is_entirely_non_equity(self):
        out = _summarize_sectors([row("Gold", "Gold", 100.0)])
        assert out == [{"sector": NON_EQUITY_LABEL, "pct": 100.0, "value": 10000.0}]


class TestDropRules:
    def test_empty_input(self):
        assert _summarize_sectors([]) == []

    def test_zero_and_negative_buckets_dropped(self):
        out = _summarize_sectors([
            row("Large Cap", "Financial Services", 10.0),
            row("Large Cap", "Textiles", 0.0),
            row("Mid Cap", "Chemicals", -1.0),
        ])
        assert out == [{"sector": "Financial Services", "pct": 10.0, "value": 1000.0}]

    def test_net_negative_non_equity_bucket_dropped(self):
        out = _summarize_sectors([
            row("Large Cap", "Power", 100.0),
            row("Derivatives - Leveraged", "Power", -0.5),
        ])
        assert out == [{"sector": "Power", "pct": 100.0, "value": 10000.0}]
