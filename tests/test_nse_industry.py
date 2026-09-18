"""Parser tests for the NSE adapter — pure functions, no network."""
from app.services.composition import _resolve_level
from app.services.nse_industry import (
    STATUS_API_ERROR,
    STATUS_CLASSIFIED,
    STATUS_ISIN_MISMATCH,
    STATUS_UNCLASSIFIED,
    decide_status,
    extract_classification,
    parse_equity_master,
)

_MASTER = (
    b"SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT,"
    b" ISIN NUMBER, FACE VALUE\n"
    b"VENUSPIPES,Venus Pipes & Tubes Limited,EQ,24-05-2022,10,1,INE00BK01011,10\n"
    b"KAMDHENU,Kamdhenu Limited,BE,10-11-2005,1,1,INE390H01020,1\n"
    b"DUMMYHEG,Dummy HEG Ltd.,EQ,01-01-2020,10,1,DUM545A01024,10\n"
    b"SMEONE,Some SME Limited,SM,01-01-2023,10,1,INE111A01011,10\n"
)


class TestParseEquityMaster:
    def test_indexes_allowed_series_by_isin(self):
        index = parse_equity_master(_MASTER)
        assert index["INE00BK01011"]["symbol"] == "VENUSPIPES"
        assert index["INE390H01020"]["series"] == "BE"

    def test_skips_placeholder_isins_and_other_series(self):
        index = parse_equity_master(_MASTER)
        assert "DUM545A01024" not in index   # placeholder ISIN, not a real security
        assert "INE111A01011" not in index   # SM series is not main board

    def test_handles_empty_payload(self):
        assert parse_equity_master(b"") == {}


class TestExtractClassification:
    def test_maps_all_four_levels(self):
        out = extract_classification({
            "equityResponse": [{
                "secInfo": {
                    "macro": "Industrials",
                    "sector": "Capital Goods",
                    "industryInfo": "Electrical Equipment",
                    "basicIndustry": "Heavy Electrical Equipment",
                },
                "metaData": {"isinCode": "INE921L01032", "companyName": "Powerica Limited"},
            }]
        })
        assert out == {
            "macro_sector": "Industrials",
            "sector": "Capital Goods",
            "industry": "Electrical Equipment",
            "basic_industry": "Heavy Electrical Equipment",
            "isin": "INE921L01032",
            "company_name": "Powerica Limited",
        }

    def test_blank_and_missing_fields_become_none(self):
        out = extract_classification({"equityResponse": [{"secInfo": {"macro": "  "}}]})
        assert out["macro_sector"] is None
        assert out["basic_industry"] is None
        assert out["isin"] is None

    def test_empty_response_does_not_raise(self):
        out = extract_classification({})
        assert all(v is None for v in out.values())


class TestClassificationStatus:
    def test_error_yields_api_error_with_error_text(self):
        status, message = decide_status("INE009A01021", None, "HTTP 500")
        assert status == STATUS_API_ERROR
        assert message == "HTTP 500"

    def test_isin_mismatch_names_both_isins(self):
        result = {level: "x" for level in
                  ("macro_sector", "sector", "industry", "basic_industry")}
        result["isin"] = "INE999Z01099"
        status, message = decide_status("INE009A01021", result, None)
        assert status == STATUS_ISIN_MISMATCH
        assert "INE009A01021" in message
        assert "INE999Z01099" in message

    def test_all_four_levels_yields_classified(self):
        result = {
            "macro_sector": "Information Technology",
            "sector": "Information Technology",
            "industry": "IT - Software",
            "basic_industry": "Computers - Software & Consulting",
            "isin": "INE009A01021",
        }
        status, message = decide_status("INE009A01021", result, None)
        assert status == STATUS_CLASSIFIED
        assert message is None

    def test_no_levels_yields_unclassified(self):
        result = {
            "macro_sector": None, "sector": None, "industry": None,
            "basic_industry": None, "isin": "INE009A01021",
        }
        status, _ = decide_status("INE009A01021", result, None)
        assert status == STATUS_UNCLASSIFIED

    def test_missing_isin_is_not_a_mismatch(self):
        result = {
            "macro_sector": "Industrials", "sector": "Capital Goods",
            "industry": "Electrical Equipment", "basic_industry": "Heavy Electrical Equipment",
            "isin": None,
        }
        status, _ = decide_status("INE009A01021", result, None)
        assert status == STATUS_CLASSIFIED


class TestResolveLevel:
    def test_each_level_name_returns_itself(self):
        for level in ("macro_sector", "sector", "industry", "basic_industry"):
            assert _resolve_level(level) == level

    def test_unrecognised_values_fall_back_to_sector(self):
        assert _resolve_level("nonsense") == "sector"
        assert _resolve_level("") == "sector"
        assert _resolve_level(None) == "sector"
