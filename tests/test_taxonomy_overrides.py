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
