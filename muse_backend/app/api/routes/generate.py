"""
POST /generate/* — Core inference endpoints for all three Muse agents.

  POST /generate/draft     → Visual Muse Step 1 (Qwen Image Edit)
  POST /generate/refine    → Visual Muse Step 2 (Z-Image Turbo)
  POST /generate/video     → Motion Muse (async job, returns job_id)
  POST /generate/story     → Story Muse (streaming SSE response)
  POST /generate/comfyui   → ComfyUI (async job, returns job_id)
"""

import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse

from app.schemas import (
    ImageDraftRequest,
    ImageDraftResponse,
    ImageAsset,
    ImageRefineRequest,
    ImageRefineResponse,
    VideoGenerateRequest,
    VideoGenerateResponse,
    StoryGenerateRequest,
    JobStatus,
)
from app.registry import (
    get_image_draft_provider,
    get_image_refine_provider,
    get_video_provider,
    get_llm_provider,
)
from app.config import settings
from app.comfyui_runner import ComfyUIRunner


def _agent_log(message: str, data: dict[str, Any], location: str, hypothesis_id: str) -> None:
    """Append a single NDJSON log line for the debug agent."""
    payload = {
        "sessionId": "ccff78",
        "runId": "generate",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    log_path = Path(__file__).resolve().parents[2] / "debug-ccff78.log"
    try:
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        # Logging must never break generation
        return

router = APIRouter(prefix="/generate", tags=["Generation"])

# In-memory job store (replace with Redis or DB in production)
_jobs: dict[str, dict] = {}


# ── Visual Muse — Step 1: Draft ───────────────────────────────────────────────

@router.post("/draft", response_model=ImageDraftResponse)
async def generate_image_draft(request: ImageDraftRequest):
    """
    Visual Muse Step 1: Generate draft keyframe(s) using Qwen Image Edit.
    Accepts reference images + scene prompt. Returns 1–4 draft variations.
    """
    provider = get_image_draft_provider(request.provider_id)

    if not provider.is_available():
        raise HTTPException(
            status_code=503,
            detail={
                "error": f"Provider '{provider.provider_id}' is not available.",
                "reason": provider.unavailable_reason(),
            },
        )

    params = {
        "aspect_ratio": request.aspect_ratio,
        "style_strength": request.style_strength,
        "num_variations": request.num_variations,
    }

    result = await provider.generate(
        prompt=request.prompt,
        reference_image_paths=request.reference_image_paths,
        params=params,
    )

    if not result.success:
        raise HTTPException(status_code=500, detail={"error": result.error})

    return ImageDraftResponse(
        scene_id=request.scene_id,
        provider_id=provider.provider_id,
        variations=[
            ImageAsset(path=p, width=1920, height=1080)
            for p in result.output_paths
        ],
        generation_params={**params, "prompt": request.prompt},
    )


# ── Visual Muse — Step 2: Refine ──────────────────────────────────────────────

@router.post("/refine", response_model=ImageRefineResponse)
async def refine_image(request: ImageRefineRequest):
    """
    Visual Muse Step 2: Refine draft keyframe via img2img (Z-Image Turbo).
    Low denoise preserves Step 1 composition while enhancing quality.
    """
    provider = get_image_refine_provider(request.provider_id)

    if not provider.is_available():
        raise HTTPException(
            status_code=503,
            detail={
                "error": f"Provider '{provider.provider_id}' is not available.",
                "reason": provider.unavailable_reason(),
            },
        )

    params = {"denoise_strength": request.denoise_strength}
    result = await provider.refine(
        draft_image_path=request.draft_image_path,
        prompt=request.prompt,
        params=params,
    )

    if not result.success:
        raise HTTPException(status_code=500, detail={"error": result.error})

    return ImageRefineResponse(
        scene_id=request.scene_id,
        provider_id=provider.provider_id,
        final_image=ImageAsset(
            path=result.output_paths[0],
            width=1920,
            height=1080,
        ),
        generation_params=params,
    )


# ── Motion Muse — Video generation (async job) ────────────────────────────────

@router.post("/video", response_model=VideoGenerateResponse)
async def generate_video(request: VideoGenerateRequest, background_tasks: BackgroundTasks):
    """
    Motion Muse: Submit a video generation job. Returns immediately with job_id.
    Poll GET /jobs/{job_id} for status updates and the final output path.
    """
    provider = get_video_provider(request.provider_id)

    if not provider.is_available():
        raise HTTPException(
            status_code=503,
            detail={
                "error": f"Provider '{provider.provider_id}' is not available.",
                "reason": provider.unavailable_reason(),
            },
        )

    job_id = f"job_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    _jobs[job_id] = {
        "job_id": job_id,
        "scene_id": request.scene_id,
        "provider_id": provider.provider_id,
        "status": JobStatus.QUEUED,
        "progress_percent": 0,
        "message": "Job queued",
        "output_path": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
        "comfy_prompt_id": None,
    }

    params = {
        "duration_seconds": request.duration_seconds,
        "fps": request.fps,
        "motion_strength": request.motion_strength,
    }
    if request.aspect_ratio is not None:
        params["aspect_ratio"] = request.aspect_ratio

    async def _run_job():
        _jobs[job_id]["status"] = JobStatus.RUNNING
        _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

        async def on_progress(percent: int, message: str):
            _jobs[job_id]["progress_percent"] = percent
            _jobs[job_id]["message"] = message
            _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

        try:
            result = await provider.generate(
                script=request.script,
                keyframe_paths=request.keyframe_paths,
                params=params,
                on_progress=on_progress,
            )
        except Exception as _bg_exc:
            _jobs[job_id]["status"] = JobStatus.FAILED
            _jobs[job_id]["error"] = str(_bg_exc)
            return

        _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        if result.success:
            _jobs[job_id]["status"] = JobStatus.COMPLETED
            _jobs[job_id]["output_path"] = result.output_path
            _jobs[job_id]["progress_percent"] = 100
            _jobs[job_id]["message"] = "Generation complete"
        else:
            _jobs[job_id]["status"] = JobStatus.FAILED
            _jobs[job_id]["error"] = result.error

    background_tasks.add_task(_run_job)

    return VideoGenerateResponse(
        job_id=job_id,
        scene_id=request.scene_id,
        provider_id=provider.provider_id,
        status=JobStatus.QUEUED,
    )


# ── ComfyUI — Generic workflow execution (async job) ──────────────────────────


@router.post("/comfyui")
async def generate_comfyui(request: dict[str, Any], background_tasks: BackgroundTasks):
    """
    Submit a pre-patched ComfyUI workflow JSON and track it as a background job.

    The Next.js frontend is responsible for:
      - Parsing the workflow JSON for dynamic inputs/outputs.
      - Patching user-provided values into the workflow graph.

    This endpoint:
      - Submits the graph to ComfyUI.
      - Waits for completion (via websocket or polling).
      - Downloads the first image/video output into `outputs/`.
      - Exposes job status via GET /jobs/{job_id}.
    """
    scene_id = request.get("scene_id")
    kind = request.get("kind")
    workflow = request.get("workflow")
    project_id_raw = request.get("project_id")

    if not scene_id or kind not in ("image", "video") or not isinstance(workflow, dict):
        raise HTTPException(status_code=400, detail={"error": "Invalid ComfyUI request payload."})

    job_id = f"comfy_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()

    # region agent log
    _agent_log(
        "comfyui_request_received",
        {"job_id": job_id, "scene_id": scene_id, "kind": kind},
        "api/routes/generate.py:generate_comfyui",
        "H1",
    )
    # endregion

    _jobs[job_id] = {
        "job_id": job_id,
        "scene_id": scene_id,
        "provider_id": "comfyui",
        "status": JobStatus.QUEUED,
        "progress_percent": 0,
        "message": "Job queued",
        "output_path": None,
        "error": None,
        "created_at": now,
        "updated_at": now,
        # For debugging / correlation with ComfyUI UI
        "comfy_prompt_id": None,
    }

    # Playground / sandbox: drafts/playground[/projectId]/ when scene_id is playground.
    _playground_id = str(scene_id).strip().lower()
    if _playground_id == "playground":
        sub: str | None = None
        if isinstance(project_id_raw, str):
            s = project_id_raw.strip()
            if s and len(s) <= 120 and re.fullmatch(r"[a-zA-Z0-9_-]+", s):
                sub = s
        if sub:
            output_dir = settings.outputs_path / "drafts" / "playground" / sub
        else:
            output_dir = settings.outputs_path / "drafts" / "playground"
    else:
        output_dir = settings.outputs_path / ("videos" if kind == "video" else "drafts")

    async def _run_job() -> None:
        base_url = os.getenv("COMFYUI_BASE_URL", "http://127.0.0.1:8188")
        runner = ComfyUIRunner(base_url=base_url)

        async def _on_progress(percent: int, message: str) -> None:
            _jobs[job_id]["progress_percent"] = percent
            _jobs[job_id]["message"] = message
            _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

        _jobs[job_id]["status"] = JobStatus.RUNNING
        _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()

        # region agent log
        _agent_log(
            "comfyui_job_started",
            {"job_id": job_id, "scene_id": scene_id, "kind": kind, "base_url": base_url},
            "api/routes/generate.py:generate_comfyui._run_job",
            "H1",
        )
        # endregion

        try:
            success, out_path, error, prompt_id = await runner.run(
                workflow=workflow,
                kind=kind,
                output_dir=output_dir,
                on_progress=_on_progress,
            )
        except Exception as exc:  # noqa: BLE001
            _jobs[job_id]["status"] = JobStatus.FAILED
            _jobs[job_id]["error"] = str(exc)
            _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
            # region agent log
            _agent_log(
                "comfyui_job_exception",
                {"job_id": job_id, "error": str(exc)},
                "api/routes/generate.py:generate_comfyui._run_job",
                "H1",
            )
            # endregion
            return

        _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
        if prompt_id:
            _jobs[job_id]["comfy_prompt_id"] = prompt_id
        if success and out_path is not None:
            # Only mark as completed if the file is actually present (prevents "black screen" cases).
            try:
                if not out_path.exists() or out_path.stat().st_size <= 0:
                    _jobs[job_id]["status"] = JobStatus.FAILED
                    _jobs[job_id]["error"] = (
                        "ComfyUI reported success but the downloaded output file is missing or empty."
                    )
                    _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
                    return
            except Exception as exc:  # noqa: BLE001
                _jobs[job_id]["status"] = JobStatus.FAILED
                _jobs[job_id]["error"] = f"Failed to validate downloaded output file: {exc}"
                _jobs[job_id]["updated_at"] = datetime.now(timezone.utc).isoformat()
                return

            # Return path relative to the shared `outputs/` root so Next.js can serve it via /api/outputs.
            # Prefer relative_to(settings.outputs_path), but fall back to a robust "after /outputs/" approach
            # to avoid losing the videos/drafts directory segment.
            try:
                rel = out_path.relative_to(settings.outputs_path).as_posix()
            except ValueError:
                parts = out_path.as_posix().split("/")
                last_outputs_idx = None
                for i in range(len(parts) - 1, -1, -1):
                    if parts[i].lower() == "outputs":
                        last_outputs_idx = i
                        break
                if last_outputs_idx is not None and last_outputs_idx + 1 < len(parts):
                    rel = Path(*parts[last_outputs_idx + 1 :]).as_posix()
                else:
                    rel = out_path.name

            _jobs[job_id]["status"] = JobStatus.COMPLETED
            _jobs[job_id]["output_path"] = rel
            _jobs[job_id]["progress_percent"] = 100
            _jobs[job_id]["message"] = "ComfyUI generation complete"
            # region agent log
            _agent_log(
                "comfyui_job_completed",
                {"job_id": job_id, "scene_id": scene_id, "output_path": rel},
                "api/routes/generate.py:generate_comfyui._run_job",
                "H1",
            )
            # endregion
        else:
            _jobs[job_id]["status"] = JobStatus.FAILED
            _jobs[job_id]["error"] = error or "Unknown ComfyUI error"
            # region agent log
            _agent_log(
                "comfyui_job_failed",
                {"job_id": job_id, "scene_id": scene_id, "error": error},
                "api/routes/generate.py:generate_comfyui._run_job",
                "H1",
            )
            # endregion

    background_tasks.add_task(_run_job)

    # Keep response shape simple; the frontend only needs job_id + scene_id + status.
    return {
        "job_id": job_id,
        "scene_id": scene_id,
        "provider_id": "comfyui",
        "status": JobStatus.QUEUED,
    }


# ── Story Muse — Streaming LLM generation ────────────────────────────────────

@router.post("/story")
async def generate_story(request: StoryGenerateRequest):
    """
    Story Muse: Generate narrative content with streaming SSE response.
    Next.js reads this as a ReadableStream for real-time text display.

    Response format: Server-Sent Events (text/event-stream)
      data: {"text": "...", "is_final": false}
      data: {"text": "...", "is_final": true}
    """
    provider = get_llm_provider(request.provider_id)

    if not provider.is_available():
        raise HTTPException(
            status_code=503,
            detail={
                "error": f"Provider '{provider.provider_id}' is not available.",
                "reason": provider.unavailable_reason(),
            },
        )

    params = {
        "max_tokens": request.max_tokens,
        "temperature": request.temperature,
        "ollama_base_url": request.ollama_base_url,
        "ollama_model": request.ollama_model,
        "openai_model": request.openai_model,
        "claude_model": request.claude_model,
        "lmstudio_base_url": request.lmstudio_base_url,
        "lmstudio_model": request.lmstudio_model,
        "openrouter_model": request.openrouter_model,
        "openrouter_base_url": request.openrouter_base_url,
    }

    async def event_stream() -> AsyncGenerator[str, None]:
        async for chunk in provider.generate_stream(
            task=request.task,
            prompt=request.prompt,
            context=request.context,
            params={k: v for k, v in params.items() if v is not None},
        ):
            data = json.dumps({"text": chunk.text, "is_final": chunk.is_final})
            yield f"data: {data}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
