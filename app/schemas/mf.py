from typing import Optional
from pydantic import BaseModel


class NavTrackedInstrument(BaseModel):
    instrument_id: int
    name: Optional[str] = None
    isin: Optional[str] = None
    instrument_type: str

