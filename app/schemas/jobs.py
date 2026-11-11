from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel

JobKind = Literal["mf_nav_history", "kite_price_history", "mf_disclosures"]
JobStatus = Literal["running", "waiting_login", "done", "failed"]


class JobStartRequest(BaseModel):
    kind: JobKind
    params: dict[str, Any] = {}


class JobSummary(BaseModel):
    id: int
    kind: JobKind
    status: JobStatus
    params: dict[str, Any]
    summary: str | None
    last_log: str | None
    error: str | None
    started_at: datetime
    finished_at: datetime | None
    read_at: datetime | None


class JobDetail(JobSummary):
    logs: list[str]
    result: dict[str, Any] | None
