"""
Backend project sync API — Phase 2.5.

Frontend pushes project JSON; backend stores mirror for agent access.
Option B: POST /projects/sync (simpler migration).
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

router = APIRouter(prefix="/projects", tags=["Projects"])


class ProjectSyncRequest(BaseModel):
    project_id: str
    project: dict = Field(..., description="Full project JSON from frontend")


class ProjectSyncResponse(BaseModel):
    ok: bool
    message: str


@router.post("/sync", response_model=ProjectSyncResponse)
async def sync_project(request: ProjectSyncRequest):
    """
    Sync project from frontend to backend. Used for agent data access.
    Phase 2.5: Stub. Full implementation with SQLite/PostgreSQL in Phase 2.5.
    """
    # TODO: Store project in backend DB (app/db/ or app/data/)
    return ProjectSyncResponse(ok=True, message="Sync received (not yet persisted)")


@router.get("/{project_id}")
async def get_project(project_id: str):
    """Get project from backend. Phase 2.5: Stub."""
    # TODO: Return project from backend DB
    return {"error": "Backend project storage not yet implemented"}
