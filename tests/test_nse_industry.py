"""Parser tests for the NSE adapter — pure functions, no network."""
from app.services.nse_industry import extract_classification, parse_equity_master

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
