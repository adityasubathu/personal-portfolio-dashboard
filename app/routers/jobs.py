from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.jobs import JobDetail, JobStartRequest, JobSummary
from app.services import background_jobs

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


@router.get("", response_model=list[JobSummary])
async def list_jobs(db: AsyncSession = Depends(get_db)):
    return await background_jobs.list_jobs(db)


@router.post("", response_model=JobSummary)
async def start_job(body: JobStartRequest, db: AsyncSession = Depends(get_db)):
    try:
        job_id = await background_jobs.start_job(body.kind, body.params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await background_jobs.get_summary(db, job_id)


@router.delete("")
async def clear_jobs(db: AsyncSession = Depends(get_db)):
    return {"deleted": await background_jobs.delete_finished(db)}


@router.get("/{job_id}", response_model=JobDetail)
async def get_job(job_id: int, db: AsyncSession = Depends(get_db)):
    job = await background_jobs.get_detail(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/{job_id}/read", response_model=JobSummary)
async def mark_read(job_id: int, db: AsyncSession = Depends(get_db)):
    job = await background_jobs.mark_read(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: int):
    try:
        await background_jobs.cancel_job(job_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"ok": True}


@router.delete("/{job_id}")
async def delete_job(job_id: int, db: AsyncSession = Depends(get_db)):
    if not await background_jobs.delete_job(db, job_id):
        raise HTTPException(status_code=404, detail="Job not found or still running")
    return {"ok": True}
