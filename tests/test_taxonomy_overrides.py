"""Tests for manual taxonomy overrides — pure functions, no DB, no network."""
from app.services.nse_industry import CLASSIFICATION_LEVELS, cascade_levels

PARENTS = {
    "macro_sector": {},
    "sector": {"Metals & Mining": {"macro_sector": "Commodities"}},
    "industry": {
        "Diversified Metals": {"macro_sector": "Commodities", "sector": "Metals & Mining"},
    },
    "basic_industry": {
        "Copper": {
            "macro_sector": "Commodities",
            "sector": "Metals & Mining",
            "industry": "Diversified Metals",
        },
    },
}


class TestCascadeLevels:
    def test_fills_ancestors_and_leaves_descendants_unknown(self):
        assert cascade_levels(PARENTS, "industry", "Diversified Metals") == {
            "macro_sector": "Commodities",
            "sector": "Metals & Mining",
            "industry": "Diversified Metals",
            "basic_industry": None,
        }

    def test_basic_industry_fills_all_four(self):
        out = cascade_levels(PARENTS, "basic_industry", "Copper")
        assert all(out[level] for level in CLASSIFICATION_LEVELS)
        assert out["macro_sector"] == "Commodities"

    def test_macro_has_no_ancestors(self):
        assert cascade_levels(PARENTS, "macro_sector", "Commodities") == {
            "macro_sector": "Commodities",
            "sector": None,
            "industry": None,
            "basic_industry": None,
        }

    def test_unknown_value_still_sets_its_own_level(self):
        out = cascade_levels(PARENTS, "sector", "Something NSE Never Told Us")
        assert out["sector"] == "Something NSE Never Told Us"
        assert out["macro_sector"] is None


class TestMergeSemantics:
    """save_sector_overrides folds cascade_levels results for the same company into
    one entry, later non-blank values winning per level. No DB — this mirrors the
    merge loop over pure cascade_levels output."""

    def _merge(self, *cascades):
        entry = {lvl: None for lvl in CLASSIFICATION_LEVELS}
        for cascade in cascades:
            for lvl, val in cascade.items():
                if val:
                    entry[lvl] = val
        return entry

    def test_two_saves_at_different_levels_both_survive(self):
        first = cascade_levels(PARENTS, "sector", "Metals & Mining")
        second = cascade_levels(PARENTS, "basic_industry", "Copper")
        merged = self._merge(first, second)
        assert merged["sector"] == "Metals & Mining"
        assert merged["basic_industry"] == "Copper"
        assert merged["industry"] == "Diversified Metals"

    def test_blank_value_is_skipped(self):
        merged = self._merge({"sector": "Metals & Mining", "macro_sector": None, "industry": None, "basic_industry": None})
        assert merged["sector"] == "Metals & Mining"
        assert merged["macro_sector"] is None
