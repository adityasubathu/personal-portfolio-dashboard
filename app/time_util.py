"""IST time helpers — the app stores and displays wall-clock India Standard Time."""
from datetime import datetime
from zoneinfo import ZoneInfo

IST = ZoneInfo("Asia/Kolkata")


def now_ist() -> datetime:
    """Current IST wall-clock as a naive datetime (DB columns are tz-naive)."""
    return datetime.now(IST).replace(tzinfo=None)
