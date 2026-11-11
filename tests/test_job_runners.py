"""Job summary lines — pure functions, no DB, no network."""
from datetime import timedelta
from types import SimpleNamespace

from app.services.job_runners import summarize_kite_price_history, summarize_mf_disclosures, summarize_mf_nav_history
from app.services.kite_sync import is_token_valid
from app.time_util import now_ist


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


class TestSummarizeKitePriceHistory:
    def test_success(self):
        result = {"result": {"instruments_synced": 5, "rows_added": 120, "latest_price_date": "2026-11-10", "failed": []}, "index": None, "ltp": None}
        assert summarize_kite_price_history(result) == "5 instruments · 120 rows · latest 2026-11-10"

    def test_failures(self):
        result = {"result": {"instruments_synced": 3, "rows_added": 0, "latest_price_date": None, "failed": ["X"]}, "index": None, "ltp": None}
        assert summarize_kite_price_history(result) == "3 instruments · 0 rows · latest — · 1 failed"


class TestSummarizeMfDisclosures:
    def test_amfi_error_wins(self):
        result = {"amfi": {"error": "xlsx missing"}, "ingest": {"error": "Skipped"}, "nse": {}}
        assert summarize_mf_disclosures(result) == "AMFI: xlsx missing"

    def test_already_current(self):
        result = {"amfi": {}, "ingest": {"already_current": True, "unmatched_equities": []}, "nse": {}}
        assert summarize_mf_disclosures(result) == "All schemes up to date"

    def test_updated_with_untagged_deduped_by_name(self):
        unmatched = [{"name": "A", "scheme_isin": "1"}, {"name": "A", "scheme_isin": "2"}, {"name": "B", "scheme_isin": "1"}]
        result = {"amfi": {}, "ingest": {"schemes_processed": 3, "rows_upserted": 410, "unmatched_equities": unmatched}, "nse": {}}
        assert summarize_mf_disclosures(result) == "3 scheme(s) updated · 410 rows · 2 untagged"

    def test_catalog_errors(self):
        result = {"amfi": {}, "ingest": {"schemes_processed": 0, "rows_upserted": 0, "errors": ["catalog down"]}, "nse": {}}
        assert summarize_mf_disclosures(result) == "0 scheme(s) updated · 0 rows · 1 error(s)"


class TestIsTokenValid:
    def test_no_token(self):
        assert not is_token_valid(SimpleNamespace(access_token=None, access_token_expiry=None))

    def test_expired(self):
        assert not is_token_valid(SimpleNamespace(access_token="t", access_token_expiry=now_ist() - timedelta(minutes=1)))

    def test_valid(self):
        assert is_token_valid(SimpleNamespace(access_token="t", access_token_expiry=now_ist() + timedelta(hours=1)))

    def test_no_expiry_counts_as_valid(self):
        assert is_token_valid(SimpleNamespace(access_token="t", access_token_expiry=None))
