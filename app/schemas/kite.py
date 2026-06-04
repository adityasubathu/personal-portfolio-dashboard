from typing import Optional
from pydantic import BaseModel


class KiteLastSync(BaseModel):
    synced_at: str
    status: str
    holdings_count: Optional[int] = None
    positions_count: Optional[int] = None
    error_message: Optional[str] = None


class KiteStatus(BaseModel):
    configured: bool
    api_key: Optional[str] = None
    token_valid: bool
    token_expiry: Optional[str] = None
    last_sync: Optional[KiteLastSync] = None
    login_url: Optional[str] = None


class KiteSyncResult(BaseModel):
    synced_at: str
    status: str
    holdings_count: int
    positions_count: int
    error_message: Optional[str] = None
