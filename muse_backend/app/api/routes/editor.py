from __future__ import annotations

"""
Editor API routes — thin HTTP wrappers around video_editor_tools.

Primary API for agents is still the Python module `app.video_editor_tools`.
These routes exist for the Next.js frontend and any external clients that
cannot import Python code directly.
"""

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from app.api.routes.generate import _jobs
from app.config import settings
from app.schemas import JobStatus
from app.video_editor_tools import (
    VideoEditorError,
    concat_clips,
    cut_clip,
    get_scene_video_from_url,
    sample_frames,
    transcribe_video,
)


router = APIRouter(prefix="/editor", tags=["Editor"])

OUTPUTS_ROOT = settings.outputs_path


def _rel_from_outputs(path: Path) -> str:
    """Return a path relative to outputs/ for JSON responses."""
    try:
        rel = path.relative_to(OUTPUTS_ROOT).as_posix()
    except ValueError:
        rel = path.name
    return rel


def _rel_from_video_url(video_url: str) -> str:
    """
    Convert a Next.js `videoUrl` like `/api/outputs/videos/foo.mp4`
    into a relative path under the outputs root (`videos/foo.mp4`).
    """
    prefix = "/api/outputs/"
    if not video_url.startswith(prefix):
        raise ValueError(f"Unexpected videoUrl format: {video_url}")
    return video_url[len(prefix) :]


class SceneVideoRequest(BaseModel):
    sceneId: str = Field(..., alias="sceneId")
    videoUrl: str


class SampleFramesRequest(BaseModel):
    sceneId: str = Field(..., alias="sceneId")
    videoUrl: str
    maxFrames: int = 8
    strategy: str = "uniform"


class CutClipRequest(BaseModel):
    projectId: str = Field(..., alias="projectId")
    sceneId: str = Field(..., alias="sceneId")
    inputVideoUrl: str = Field(..., alias="inputVideoUrl")
    start: float
    end: float
    reencode: bool = False


class ConcatClipsRequest(BaseModel):
    projectId: str = Field(..., alias="projectId")
    clipUrls: list[str] = Field(..., alias="clipUrls")
    targetName: str = Field(..., alias="targetName")
    reencode: bool = False


class TranscribeRequest(BaseModel):
    sceneId: str = Field(..., alias="sceneId")
    videoUrl: str


@router.post("/scene-video")
def get_scene_video(req: SceneVideoRequest) -> dict[str, Any]:
    """Return basic metadata for a scene video."""
    try:
        info = get_scene_video_from_url(scene_id=req.sceneId, video_url=req.videoUrl)
    except VideoEditorError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    rel = _rel_from_outputs(info.path)
    return {
        "sceneId": info.scene_id,
        "videoUrl": f"/api/outputs/{rel}",
        "duration": info.duration,
        "width": info.width,
        "height": info.height,
        "fps": info.fps,
        "codec": info.codec,
    }


@router.post("/sample-frames")
def sample_frames_route(req: SampleFramesRequest) -> dict[str, Any]:
    """Extract a small number of representative frames for a scene."""
    try:
        frames = sample_frames(
            scene_id=req.sceneId,
            video_url=req.videoUrl,
            max_frames=req.maxFrames,
            strategy=req.strategy,  # type: ignore[arg-type]
        )
    except VideoEditorError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    formatted: list[dict[str, Any]] = []
    for frame in frames:
        path: Path = frame["path"]
        rel = _rel_from_outputs(path)
        formatted.append(
            {
                "url": f"/api/outputs/{rel}",
                "time": frame["time"],
            }
        )

    return {"sceneId": req.sceneId, "frames": formatted}


@router.post("/cut-clip")
def cut_clip_route(req: CutClipRequest) -> dict[str, Any]:
    """Trim a segment from a video and return the new clip URL."""
    try:
        rel_input = _rel_from_video_url(req.inputVideoUrl)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    try:
        seg = cut_clip(
            input_rel_path=rel_input,
            project_id=req.projectId,
            scene_id=req.sceneId,
            start=req.start,
            end=req.end,
            reencode=req.reencode,
        )
    except VideoEditorError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    rel = _rel_from_outputs(seg.path)
    return {
        "projectId": seg.project_id,
        "sceneId": seg.scene_id,
        "clipUrl": f"/api/outputs/{rel}",
        "start": seg.start,
        "end": seg.end,
        "duration": seg.duration,
    }


@router.post("/concat-clips")
async def concat_clips_route(req: ConcatClipsRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    """
    Start a background job that concatenates multiple clips into a single video.

    Clips are provided as `/api/outputs/...` URLs and converted to relative
    paths for `concat_clips`. Poll `/jobs/{job_id}` for completion.
    """
    if not req.clipUrls:
        raise HTTPException(status_code=400, detail={"error": "clipUrls must not be empty."})

    try:
        rel_paths: Iterable[str] = [_rel_from_video_url(u) for u in req.clipUrls]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    job_id = f"editor_concat_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()

    _jobs[job_id] = {
        "job_id": job_id,
        "scene_id": req.projectId,  # reuse scene_id field to carry projectId
        "provider_id": "video_editor_concat",
        "status": JobStatus.QUEUED,
        "progress_percent": 0,
        "message": "Concat job queued",
        "output_path": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
        "comfy_prompt_id": None,
    }

    async def _run_job() -> None:
        _jobs[job_id]["status"] = JobStatus.RUNNING
        _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            info = concat_clips(
                clip_rel_paths=rel_paths,
                project_id=req.projectId,
                target_name=req.targetName,
                reencode=req.reencode,
            )
            rel = _rel_from_outputs(info.path)
            _jobs[job_id]["status"] = JobStatus.COMPLETED
            _jobs[job_id]["output_path"] = rel
            _jobs[job_id]["progress_percent"] = 100
            _jobs[job_id]["message"] = "Concat job complete"
            _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        except Exception as exc:  # noqa: BLE001
            _jobs[job_id]["status"] = JobStatus.FAILED
            _jobs[job_id]["error"] = str(exc)
            _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

    background_tasks.add_task(_run_job)

    return {
        "job_id": job_id,
        "scene_id": req.projectId,
        "provider_id": "video_editor_concat",
        "status": JobStatus.QUEUED,
    }


@router.post("/transcribe")
async def transcribe_route(req: TranscribeRequest, background_tasks: BackgroundTasks) -> dict[str, Any]:
    """
    Start a background ASR job for a scene.

    The transcription JSON is written under `outputs/editor/transcripts/<sceneId>.json`.
    Poll `/jobs/{job_id}` for completion and read `output_path` to fetch the JSON
    via `/api/outputs/<output_path>`.
    """
    job_id = f"editor_asr_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()

    _jobs[job_id] = {
        "job_id": job_id,
        "scene_id": req.sceneId,
        "provider_id": "video_editor_asr",
        "status": JobStatus.QUEUED,
        "progress_percent": 0,
        "message": "Transcription job queued",
        "output_path": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
        "comfy_prompt_id": None,
    }

    async def _run_job() -> None:
        _jobs[job_id]["status"] = JobStatus.RUNNING
        _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

        try:
            data = transcribe_video(scene_id=req.sceneId, video_url=req.videoUrl)

            transcripts_dir = OUTPUTS_ROOT / "editor" / "transcripts"
            transcripts_dir.mkdir(parents=True, exist_ok=True)
            out_path = transcripts_dir / f"{req.sceneId}.json"
            out_path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

            rel = _rel_from_outputs(out_path)
            _jobs[job_id]["status"] = JobStatus.COMPLETED
            _jobs[job_id]["output_path"] = rel
            _jobs[job_id]["progress_percent"] = 100
            _jobs[job_id]["message"] = "Transcription complete"
            _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        except Exception as exc:  # noqa: BLE001
            _jobs[job_id]["status"] = JobStatus.FAILED
            _jobs[job_id]["error"] = str(exc)
            _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

    background_tasks.add_task(_run_job)

    return {
        "job_id": job_id,
        "scene_id": req.sceneId,
        "provider_id": "video_editor_asr",
        "status": JobStatus.QUEUED,
    }

