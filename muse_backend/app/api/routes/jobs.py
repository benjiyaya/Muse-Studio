"""
GET /jobs/{job_id} — Poll video generation job status.
Next.js polls this endpoint every few seconds while a video is generating.
"""

from fastapi import APIRouter, HTTPException
from app.schemas import JobResult

router = APIRouter(prefix="/jobs", tags=["Jobs"])

# Shared in-memory job store (imported from generate.py)
# In production, replace with Redis or a database
from app.api.routes.generate import _jobs


@router.get("/{job_id}", response_model=JobResult)
async def get_job_status(job_id: str):
    """Poll a video generation job. Returns current status, progress, and output path when done."""
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found.")
    return JobResult(**job)


@router.get("")
async def list_jobs(limit: int = 20):
    """List recent jobs (most recent first)."""
    recent = list(reversed(list(_jobs.values())))[:limit]
    return {"jobs": recent, "total": len(_jobs)}
