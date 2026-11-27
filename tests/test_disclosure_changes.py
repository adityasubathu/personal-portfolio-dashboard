import pytest

from app.services.composition import NON_EQUITY_LABEL
from app.services.disclosure_changes import (
    DIMENSIONS, Position, bucket_changes, bucket_labels, combine, fund_type_label, sort_buckets, to_positions,
)
from app.services.mf_ingest import _AmfiLookups, _map_scheme_holdings


def pos(mv, qty, label="X"):
    return Position(mv, qty, {d: label for d in DIMENSIONS})


def by_label(buckets):
    return {b["label"]: b for b in buckets}


class TestBucketChanges:
    def test_price_move_only_is_all_drift(self):
        prev = {"a": pos(50, 5, "A"), "b": pos(50, 5, "B")}
        latest = {"a": pos(60, 5, "A"), "b": pos(40, 5, "B")}
        s = by_label(bucket_changes(prev, latest)["sector"])
        assert s["A"]["trade_pp"] == pytest.approx(0)
        assert s["A"]["drift_pp"] == pytest.approx(10)
        assert s["B"]["drift_pp"] == pytest.approx(-10)

    def test_proportional_inflow_is_not_a_trade(self):
        prev = {"a": pos(50, 5, "A"), "b": pos(50, 5, "B")}
        latest = {"a": pos(110, 11, "A"), "b": pos(110, 11, "B")}
        for b in bucket_changes(prev, latest)["sector"]:
            assert b["trade_pp"] == pytest.approx(0)
            assert b["delta_pp"] == pytest.approx(0)

    def test_new_holding_is_a_trade(self):
        prev = {"a": pos(100, 10, "A")}
        latest = {"a": pos(100, 10, "A"), "c": pos(100, 5, "C")}
        s = by_label(bucket_changes(prev, latest)["sector"])
        assert s["C"]["before_pct"] == 0
        assert s["C"]["trade_pp"] == pytest.approx(50)
        assert s["A"]["trade_pp"] == pytest.approx(-50)
        assert s["A"]["drift_pp"] == pytest.approx(0)

    def test_exit_is_a_trade(self):
        prev = {"a": pos(50, 5, "A"), "b": pos(50, 5, "B")}
        latest = {"a": pos(100, 10, "A")}
        s = by_label(bucket_changes(prev, latest)["sector"])
        assert s["B"]["after_pct"] == 0
        assert s["B"]["trade_pp"] == pytest.approx(-50)
        assert s["A"]["trade_pp"] == pytest.approx(50)

    def test_quantity_less_cash_change_is_a_trade(self):
        prev = {"a": pos(90, 9, "A"), "cash": pos(10, None, "Cash")}
        latest = {"a": pos(90, 9, "A"), "cash": pos(20, None, "Cash")}
        s = by_label(bucket_changes(prev, latest)["sector"])
        assert s["Cash"]["trade_pp"] == pytest.approx(20 / 110 * 100 - 10)
        assert s["Cash"]["drift_pp"] == pytest.approx(0)

    def test_trade_and_drift_each_sum_to_zero(self):
        prev = {"a": pos(40, 4, "A"), "b": pos(35, 7, "B"), "c": pos(25, None, "C")}
        latest = {"a": pos(55, 5, "A"), "b": pos(20, 5, "B"), "d": pos(30, 3, "D")}
        for buckets in bucket_changes(prev, latest).values():
            assert sum(b["trade_pp"] for b in buckets) == pytest.approx(0, abs=1e-9)
            assert sum(b["drift_pp"] for b in buckets) == pytest.approx(0, abs=1e-9)

    def test_shared_key_uses_latest_label(self):
        prev = {"a": pos(100, 10, "Old")}
        latest = {"a": pos(100, 10, "New")}
        labels = {b["label"] for b in bucket_changes(prev, latest)["sector"]}
        assert labels == {"New"}

    def test_empty_book_returns_none(self):
        assert bucket_changes({}, {"a": pos(1, 1)}) is None


class TestCombine:
    def test_value_weighted(self):
        f1 = {d: [{"label": "X", "before_pct": 0, "after_pct": 0, "delta_pp": 1, "trade_pp": 1, "drift_pp": 0, "trade_value": 1}] for d in DIMENSIONS}
        f2 = {d: [{"label": "X", "before_pct": 0, "after_pct": 0, "delta_pp": 3, "trade_pp": 3, "drift_pp": 0, "trade_value": 9}] for d in DIMENSIONS}
        x = combine([(100, f1), (300, f2)])["sector"][0]
        assert x["trade_pp"] == pytest.approx(2.5)
        assert x["trade_value"] == pytest.approx(10)

    def test_bucket_missing_from_one_fund(self):
        f1 = {d: [{"label": "X", "before_pct": 0, "after_pct": 4, "delta_pp": 4, "trade_pp": 4, "drift_pp": 0, "trade_value": 0}] for d in DIMENSIONS}
        f2 = {d: [] for d in DIMENSIONS}
        assert combine([(100, f1), (100, f2)])["sector"][0]["after_pct"] == pytest.approx(2)


class TestLabels:
    def test_mid_cap_missing_sector(self):
        labels = bucket_labels({"category": "Mid Cap", "macro_sector": "Industrials", "sector": None, "industry": None, "basic_industry": None})
        assert labels["asset_class"] == "Equity"
        assert labels["market_cap"] == "Mid Cap"
        assert labels["macro_sector"] == "Industrials"
        assert labels["sector"] == "Unknown"

    def test_cash_is_non_equity(self):
        labels = bucket_labels({"category": "Cash", "macro_sector": "Liquid / Money Market", "sector": "Liquid / Money Market", "industry": None, "basic_industry": None})
        assert labels["asset_class"] == "Cash"
        assert labels["market_cap"] == NON_EQUITY_LABEL
        assert labels["sector"] == NON_EQUITY_LABEL

    def test_reit_keeps_sector_but_no_market_cap(self):
        labels = bucket_labels({"category": "Real Estate Trust", **{lvl: "Real Estate Trust" for lvl in ("macro_sector", "sector", "industry", "basic_industry")}})
        assert labels["asset_class"] == "Real Estate Trust"
        assert labels["market_cap"] == NON_EQUITY_LABEL
        assert labels["sector"] == "Real Estate Trust"


class TestToPositions:
    def row(self, name, isin, mv, qty, holding_type="Equity"):
        return {"name": name, "isin": isin, "holding_type": holding_type, "category": "Large Cap",
                "market_value": mv, "quantity": qty, "macro_sector": None, "sector": None, "industry": None, "basic_industry": None}

    def test_same_isin_merges(self):
        p = to_positions([self.row("A", "INE1", 10, 1), self.row("A Ltd", "INE1", 5, 2)])
        assert len(p) == 1
        only = next(iter(p.values()))
        assert only.market_value == 15 and only.quantity == 3

    def test_missing_quantity_poisons_merge(self):
        p = to_positions([self.row("A", "INE1", 10, 1), self.row("A", "INE1", 5, None)])
        assert next(iter(p.values())).quantity is None

    def test_equity_and_derivative_same_isin_stay_apart(self):
        p = to_positions([self.row("A", "INE1", 10, 1), self.row("A", "INE1", -5, -1, holding_type="Derivative")])
        assert len(p) == 2

    def test_no_isin_keys_by_name(self):
        p = to_positions([self.row("TREPS", None, 10, None), self.row("TREPS", None, 5, None)])
        assert len(p) == 1


def test_sort_puts_non_equity_last():
    buckets = [
        {"label": NON_EQUITY_LABEL, "trade_pp": 9, "delta_pp": 9},
        {"label": "A", "trade_pp": -1, "delta_pp": 0},
        {"label": "B", "trade_pp": 2, "delta_pp": 0},
    ]
    assert [b["label"] for b in sort_buckets(buckets)] == ["B", "A", NON_EQUITY_LABEL]


@pytest.mark.parametrize("category,expected", [
    ("Open Ended Schemes ( Equity Scheme - Small Cap Fund )", "Small Cap"),
    ("Open Ended Schemes ( Equity Scheme - ELSS )", "ELSS"),
    ("Open Ended Schemes ( Equity Scheme - Flexi Cap Fund )", "Flexi Cap"),
    (None, None),
])
def test_fund_type_label(category, expected):
    assert fund_type_label(category) == expected


def test_mapping_keeps_quantity():
    lookups = _AmfiLookups([], {}, {})
    rows, _ = _map_scheme_holdings("INF000000000", [{
        "holding_type": "equity", "instrument": "ICICI Bank Limited", "isin": "INE090A01021",
        "section": "(a) Listed", "industry": "Banks", "market_value": 100.0, "quantity": 10, "instrument_yield": None,
    }], 1.0, {}, lookups, False)
    assert rows[0]["quantity"] == 10
