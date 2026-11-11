"""Job summary lines — pure functions, no DB, no network."""
from app.services.job_runners import summarize_mf_nav_history


class TestSummarizeMfNavHistory:
    def test_history_success(self):
        result = {"source": "mfapi", "funds_synced": 12, "rows_added": 340, "latest_nav_date": "2026-11-10", "failed": []}
        assert summarize_mf_nav_history(result) == "12 funds · 340 rows · latest 2026-11-10"

    def test_history_with_failures(self):
        result = {"source": "finapi", "funds_synced": 10, "rows_added": 0, "latest_nav_date": None, "failed": ["A: x", "B: y"]}
        assert summarize_mf_nav_history(result) == "10 funds · 0 rows · latest — · 2 failed"

    def test_amfi_success(self):
        result = {"source": "amfi", "updated": 9, "missing": [], "latest_nav_date": "2026-11-10"}
        assert summarize_mf_nav_history(result) == "AMFI: 9 updated · latest 2026-11-10"

    def test_amfi_missing(self):
        result = {"source": "amfi", "updated": 9, "missing": ["X", "Y", "Z"], "latest_nav_date": "2026-11-10"}
        assert summarize_mf_nav_history(result) == "AMFI: 9 updated · latest 2026-11-10 · 3 missing"
