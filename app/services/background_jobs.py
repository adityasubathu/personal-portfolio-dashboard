"""Server-owned background jobs. Each run is an asyncio task detached from any
HTTP request and persisted in background_job, which the header tray reads as
its notification list."""
import asyncio
import json
from datetime import timedelta
from typing import Any

from sqlalchemy import delete, literal_column, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

from app.database import AsyncSessionLocal
from app.models.background_job import BackgroundJob
from app.schemas.jobs import JobDetail, JobSummary
from app.services.job_runners import GRACEFUL_CANCEL, RUNNERS
from app.time_util import now_ist

ACTIVE_STATUSES = ("running", "waiting_login")
READ_RETENTION = timedelta(hours=24)
INTERRUPTED_MSG = "Interrupted — the server restarted"

_tasks: dict[str, asyncio.Task] = {}
_job_ids: dict[str, int] = {}
_start_lock = asyncio.Lock()
# Must stay a literal: asyncpg rejects a bound int for `jsonb ->> $1`.
_LAST_LOG = literal_column("background_job.logs ->> -1").label("last_log")


async def start_job(kind: str, params: dict[str, Any]) -> int:
    """Start a job of `kind`, or return the id of the one already running."""
    if kind not in RUNNERS:
        raise ValueError(f"Unknown job kind: {kind}")
    async with _start_lock:
        task = _tasks.get(kind)
        if task is not None and not task.done():
            return _job_ids[kind]
        async with AsyncSessionLocal() as db:
            job = BackgroundJob(kind=kind, status="running", params=params, logs=[], started_at=now_ist())
            db.add(job)
            await db.commit()
            job_id = job.id
        _job_ids[kind] = job_id
        _tasks[kind] = asyncio.create_task(_run(job_id, kind, params))
        return job_id


async def _run(job_id: int, kind: str, params: dict[str, Any]) -> None:
    runner, summarize = RUNNERS[kind]

    async def on_progress(msg: str) -> None:
        await _append_log(job_id, msg)

    async def set_status(status: str) -> None:
        await _set(job_id, status=status)

    try:
        result = await runner(params, on_progress, set_status)
        await _set(job_id, status="done", result=result, summary=summarize(result), finished_at=now_ist())
    except asyncio.CancelledError:
        await _set(job_id, status="failed", error="Cancelled", summary="Cancelled", finished_at=now_ist())
    except Exception as exc:
        await _set(job_id, status="failed", error=str(exc), summary=str(exc)[:200], finished_at=now_ist())


async def _append_log(job_id: int, msg: str) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE background_job SET logs = logs || CAST(:entry AS jsonb) WHERE id = :id"),
            {"entry": json.dumps([msg]), "id": job_id},
        )
        await db.commit()


async def _set(job_id: int, **values: Any) -> None:
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(BackgroundJob)
            .where(BackgroundJob.id == job_id)
            .values(**values)
            .execution_options(synchronize_session=False)
        )
        await db.commit()


async def cancel_job(job_id: int) -> None:
    kind = next((k for k, jid in _job_ids.items() if jid == job_id), None)
    task = _tasks.get(kind) if kind else None
    if task is None or task.done():
        raise ValueError("Job is not running")
    async with AsyncSessionLocal() as db:
        status = await db.scalar(select(BackgroundJob.status).where(BackgroundJob.id == job_id))
    graceful = GRACEFUL_CANCEL.get(kind)
    if graceful is not None and status == "running":
        graceful()
    else:
        task.cancel()


def _to_summary(job: BackgroundJob, last_log: str | None) -> JobSummary:
    return JobSummary(
        id=job.id,
        kind=job.kind,
        status=job.status,
        params=job.params,
        summary=job.summary,
        last_log=last_log,
        error=job.error,
        started_at=job.started_at,
        finished_at=job.finished_at,
        read_at=job.read_at,
    )


def _summary_query():
    return select(BackgroundJob, _LAST_LOG).options(defer(BackgroundJob.logs), defer(BackgroundJob.result))


async def list_jobs(db: AsyncSession) -> list[JobSummary]:
    await purge_expired(db)
    rows = await db.execute(_summary_query().order_by(BackgroundJob.id.desc()))
    return [_to_summary(job, last_log) for job, last_log in rows.all()]


async def get_summary(db: AsyncSession, job_id: int) -> JobSummary | None:
    row = (await db.execute(_summary_query().where(BackgroundJob.id == job_id))).first()
    return _to_summary(row[0], row[1]) if row else None


async def get_detail(db: AsyncSession, job_id: int) -> JobDetail | None:
    job = await db.get(BackgroundJob, job_id)
    if job is None:
        return None
    summary = _to_summary(job, job.logs[-1] if job.logs else None)
    return JobDetail(**summary.model_dump(), logs=job.logs, result=job.result)


async def mark_read(db: AsyncSession, job_id: int) -> JobSummary | None:
    await db.execute(
        update(BackgroundJob)
        .where(
            BackgroundJob.id == job_id,
            BackgroundJob.status.not_in(ACTIVE_STATUSES),
            BackgroundJob.read_at.is_(None),
        )
        .values(read_at=now_ist())
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return await get_summary(db, job_id)


async def delete_job(db: AsyncSession, job_id: int) -> bool:
    result = await db.execute(
        delete(BackgroundJob)
        .where(BackgroundJob.id == job_id, BackgroundJob.status.not_in(ACTIVE_STATUSES))
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return result.rowcount > 0


async def delete_finished(db: AsyncSession) -> int:
    result = await db.execute(
        delete(BackgroundJob)
        .where(BackgroundJob.status.not_in(ACTIVE_STATUSES))
        .execution_options(synchronize_session=False)
    )
    await db.commit()
    return result.rowcount


async def purge_expired(db: AsyncSession) -> None:
    await db.execute(
        delete(BackgroundJob)
        .where(BackgroundJob.read_at.is_not(None), BackgroundJob.read_at < now_ist() - READ_RETENTION)
        .execution_options(synchronize_session=False)
    )
    await db.commit()


async def mark_interrupted_jobs() -> None:
    """Startup sweep: tasks don't survive a restart, so their rows can't stay active."""
    async with AsyncSessionLocal() as db:
        await db.execute(
            update(BackgroundJob)
            .where(BackgroundJob.status.in_(ACTIVE_STATUSES))
            .values(status="failed", error=INTERRUPTED_MSG, summary=INTERRUPTED_MSG, finished_at=now_ist())
            .execution_options(synchronize_session=False)
        )
        await db.commit()
        await purge_expired(db)
