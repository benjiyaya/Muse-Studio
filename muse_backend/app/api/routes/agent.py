"""
Agent API routes — LangGraph-powered suggestion and execution endpoints.
"""

from __future__ import annotations

import asyncio
import json
import queue
from queue import Empty

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas import (
    AgentExecuteRequest,
    AgentExecuteResponse,
    AgentRevisionRequest,
    AgentSuggestionItem,
    AgentSuggestionsRequest,
    AgentSuggestionsResponse,
)

router = APIRouter(prefix="/agent", tags=["Agent"])


async def _sse_stream(request: AgentSuggestionsRequest):
    """Async generator for SSE stream."""
    from app.agents.suggestion_agent import run_suggestion_agent_stream

    async for chunk in run_suggestion_agent_stream(
        project=request.project,
        control_level=request.control_level,
        provider_id=request.provider_id,
    ):
        yield f"data: {chunk}\n\n"


@router.post("/suggestions", response_model=AgentSuggestionsResponse)
async def get_agent_suggestions(request: AgentSuggestionsRequest):
    """
    Run the LangGraph suggestion agent on a project.
    Frontend sends full project JSON; backend returns AI-generated suggestions.
    """
    try:
        from app.agents.suggestion_agent import run_suggestion_agent
    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail={
                "error": "LangGraph agent not available.",
                "reason": str(e),
            },
        )

    result = run_suggestion_agent(
        project=request.project,
        control_level=request.control_level,
        provider_id=request.provider_id,
    )

    suggestions = [
        AgentSuggestionItem(
            type=s["type"],
            muse=s["muse"],
            message=s["message"],
            sceneId=s.get("sceneId"),
            actions=s.get("actions", ["REVIEW", "EDIT", "DISMISS"]),
        )
        for s in result.suggestions
    ]

    fallback = None
    if result.fallback_suggestions:
        fallback = [
            AgentSuggestionItem(
                type=s["type"],
                muse=s["muse"],
                message=s["message"],
                sceneId=s.get("sceneId"),
                actions=s.get("actions", ["REVIEW", "EDIT", "DISMISS"]),
            )
            for s in result.fallback_suggestions
        ]

    return AgentSuggestionsResponse(
        suggestions=suggestions,
        error=result.error,
        fallback_suggestions=fallback,
    )


@router.post("/suggestions/stream")
async def get_agent_suggestions_stream(request: AgentSuggestionsRequest):
    """
    Stream suggestion agent progress via Server-Sent Events.
    Events: data: {"event":"node","node":"analyze"}, {"event":"node","node":"format"},
    data: {"event":"suggestions","suggestions":[...]} or data: {"event":"error","error":"..."}
    """
    try:
        from app.agents.suggestion_agent import run_suggestion_agent_stream
    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "LangGraph agent not available.", "reason": str(e)},
        )
    return StreamingResponse(
        _sse_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/execute", response_model=AgentExecuteResponse)
async def execute_agent_action(request: AgentExecuteRequest):
    """
    Execute an agent-suggested action (e.g. create_scene_video, edit_scene_video).
    Phase 2: Stub implementation. Full tool integration in Phase 2.5/3.
    Phase 2.5: Confirmation gates — before executing, return interrupt for Approve/Reject.
    """
    # TODO: Wire to LangGraph agent with tools (create_scene_video, edit_scene_video, get_video_status)
    return AgentExecuteResponse(
        job_id=None,
        status="queued",
        message="Agent execute not yet implemented. Use ComfyUI or video generation directly.",
        error=None,
    )


class GenerateScenesRequest(BaseModel):
    """Request body for long-form scene generation (targetTotal > 24)."""

    projectId: str
    targetTotal: int
    batchSize: int = 24
    storyline: dict | None = None  # required for long-form; frontend sends from project
    existingScenes: list[dict] | None = None
    provider_id: str | None = None
    llm_model: str | None = None


class OrchestrateRequest(BaseModel):
    """Request body for the Supervisor orchestrate endpoint."""

    project: dict
    goal: str = "next_step"  # next_step | full_pipeline | generate_scenes
    targetTotal: int | None = None  # for generate_scenes (e.g. 60)


class VideoEditorAgentRequest(BaseModel):
    """Request body for the Video Editor Agent."""

    project: dict
    mode: str = "SIMPLE_STITCH"


class ApplyFilmTimelineRequest(BaseModel):
    """User-edited film timeline → re-render master (Remotion or ffmpeg)."""

    model_config = ConfigDict(populate_by_name=True)

    project_id: str = Field(validation_alias="projectId")
    film_timeline: dict = Field(validation_alias="filmTimeline")
    output_kind: Literal["remotion", "ffmpeg"] = Field(
        default="remotion",
        validation_alias="outputKind",
    )


async def _generate_scenes_sse(
    project_id: str,
    target_total: int,
    storyline: dict,
    existing_scenes: list[dict],
    batch_size: int,
    provider_id: str | None,
    llm_model: str | None,
):
    """Yield SSE events for long-form scene generation (event: scene, event: batch_done, event: done, event: error)."""
    event_queue: queue.Queue = queue.Queue()

    def stream_callback(event_type: str, payload: dict) -> None:
        event_queue.put((event_type, payload))

    def run_graph() -> None:
        from app.agents.longform_scene_agent import run_longform_scene_graph

        result = run_longform_scene_graph(
            project_id=project_id,
            storyline=storyline,
            target_total=target_total,
            batch_size=batch_size,
            existing_scenes=existing_scenes,
            stream_callback=stream_callback,
            provider_id=provider_id,
            llm_model=llm_model,
        )
        total = len(result.get("all_generated_scenes") or [])
        event_queue.put(("_done", {"totalScenes": total, "error": result.get("error")}))

    loop = asyncio.get_event_loop()
    task = loop.run_in_executor(None, run_graph)

    # Send import/generating once
    yield f"event: import\ndata: {json.dumps({'message': 'Long-form scene generation started'})}\n\n"
    yield f"event: generating\ndata: {json.dumps({'message': 'Story Muse is writing your scene scripts…'})}\n\n"

    def get_event():
        try:
            return event_queue.get(timeout=4.0)
        except Empty:
            return ("_ping", {})

    while True:
        kind, payload = await loop.run_in_executor(None, get_event)
        if kind == "_ping":
            yield ": ping\n\n"
            continue
        if kind == "_done":
            yield f"event: done\ndata: {json.dumps(payload)}\n\n"
            break
        if kind == "error":
            yield f"event: error\ndata: {json.dumps(payload)}\n\n"
            break
        if kind == "scene":
            yield f"event: scene\ndata: {json.dumps(payload)}\n\n"
        elif kind == "batch_done":
            yield f"event: batch_done\ndata: {json.dumps(payload)}\n\n"

    await task


@router.post("/generate-scenes")
async def generate_scenes_stream(request: GenerateScenesRequest):
    """
    Long-form scene generation (targetTotal > 24). Streams SSE events: scene, batch_done, done, error.
    Frontend should send storyline from project; backend does not write to DB — frontend persists each scene.
    """
    if not request.storyline or not request.storyline.get("plotOutline"):
        raise HTTPException(
            status_code=400,
            detail="storyline with plotOutline is required for long-form scene generation.",
        )
    return StreamingResponse(
        _generate_scenes_sse(
            project_id=request.projectId,
            target_total=min(request.targetTotal, 120),
            storyline=request.storyline,
            existing_scenes=request.existingScenes or [],
            batch_size=min(request.batchSize, 24),
            provider_id=request.provider_id,
            llm_model=request.llm_model,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/orchestrate")
async def orchestrate(request: OrchestrateRequest):
    """
    Run the Supervisor graph: route to next task (storyline, script_longform, keyframe, video).
    Returns JSON with next_task, history, and optional targetTotal when the next step is
    script_longform (client should then call POST /agent/generate-scenes with that target).
    """
    try:
        from app.agents.supervisor_graph import run_supervisor
    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "Supervisor graph not available.", "reason": str(e)},
        )

    goal = request.goal or "next_step"
    target_total = request.targetTotal if request.targetTotal is not None else None
    state = run_supervisor(
        project=request.project,
        goal=goal,
        target_total=target_total,
        thread_id="orchestrate",
    )

    next_task = state.get("next_task") or "done"
    history = state.get("history") or []
    error = state.get("error")
    state_target = state.get("target_total") or target_total

    response = {
        "next_task": next_task,
        "current_phase": state.get("current_phase", ""),
        "history": history,
        "error": error,
    }
    if next_task == "script_longform" and state_target:
        response["targetTotal"] = state_target
        response["message"] = f"Next step: generate {state_target} scenes. Call POST /agent/generate-scenes with targetTotal={state_target}."

    return response


@router.post("/video-editor")
async def run_video_editor(request: VideoEditorAgentRequest):
    """
    Run the LangGraph-based Video Editor Agent.

    - mode="SIMPLE_STITCH": collect all FINAL scenes with videoUrl in sceneNumber order,
      call backend concat tools, and return info about the stitched master.

    Returns a JSON object with:
      - mode
      - status: "completed" | "no_final_scenes" | "failed"
      - clipCount
      - outputPath
      - totalDuration
      - error (optional)
    """
    try:
        from app.agents.video_editor_agent import run_video_editor_agent
    except ImportError as e:  # pragma: no cover - defensive
        raise HTTPException(
            status_code=503,
            detail={"error": "Video Editor Agent not available.", "reason": str(e)},
        )

    result = run_video_editor_agent(project=request.project, mode=request.mode)
    status = result.get("status")

    if status == "failed":
        raise HTTPException(
            status_code=400,
            detail=result.get("error") or "Video Editor Agent failed.",
        )

    return result


async def _video_editor_stream_gen(project: dict, mode: str):
    """Yield SSE events: log messages then a final result event."""
    log_queue: queue.Queue = queue.Queue()

    def progress_callback(msg: str) -> None:
        log_queue.put(("log", msg))

    def run_agent() -> None:
        from app.agents.video_editor_agent import run_video_editor_agent
        result = run_video_editor_agent(project=project, mode=mode, progress_callback=progress_callback)
        log_queue.put(("done", result))

    loop = asyncio.get_event_loop()
    task = loop.run_in_executor(None, run_agent)

    def get_next(timeout: float = 0.25):
        try:
            return log_queue.get(timeout=timeout)
        except Empty:
            return None

    while True:
        item = await loop.run_in_executor(None, get_next)
        if item is None:
            yield ": keepalive\n\n"
            continue
        kind, payload = item
        if kind == "done":
            yield f"data: {json.dumps(payload)}\n\n"
            break
        yield f"data: {json.dumps({'type': 'log', 'text': payload})}\n\n"

    await task  # ensure executor task is done


@router.post("/video-editor/stream")
async def run_video_editor_stream(request: VideoEditorAgentRequest):
    """
    Run the Video Editor Agent and stream progress as Server-Sent Events.

    Events: data: {"type":"log","text":"..."} for progress; final event is the result JSON.
    """
    try:
        from app.agents.video_editor_agent import run_video_editor_agent
    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "Video Editor Agent not available.", "reason": str(e)},
        )

    return StreamingResponse(
        _video_editor_stream_gen(project=request.project, mode=request.mode),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/film/apply-timeline")
async def apply_film_timeline_route(request: ApplyFilmTimelineRequest):
    """
    Apply trims / transitions from an edited FilmTimeline JSON (no LLM).
    - outputKind=remotion: Re-run Remotion render to final_cuts/<projectId>_remotion.mp4
    - outputKind=ffmpeg: Re-cut each segment from previewSrc and concat to final_cuts/<projectId>_smart_edit.mp4
      (fade transitions are not applied in ffmpeg; use Remotion for crossfades.)
    """
    from app.film_timeline_apply import apply_film_timeline

    result = apply_film_timeline(
        project_id=request.project_id,
        film_timeline_dict=request.film_timeline,
        output_kind=request.output_kind,
    )
    if result.get("status") == "failed":
        raise HTTPException(
            status_code=400,
            detail={"error": result.get("error", "Apply timeline failed.")},
        )
    return result


@router.post("/suggestions/revision", response_model=AgentSuggestionsResponse)
async def get_agent_suggestions_revision(request: AgentRevisionRequest):
    """
    Phase 3.5: Revision loop. User rejected a suggestion; agent proposes revised suggestion.
    """
    try:
        from app.agents.suggestion_agent import run_suggestion_revision
    except ImportError as e:
        raise HTTPException(
            status_code=503,
            detail={"error": "LangGraph agent not available.", "reason": str(e)},
        )

    result = run_suggestion_revision(
        project=request.project,
        rejected_suggestion_id=request.rejected_suggestion_id,
        feedback=request.feedback,
        control_level=request.control_level,
    )

    suggestions = [
        AgentSuggestionItem(
            type=s["type"],
            muse=s["muse"],
            message=s["message"],
            sceneId=s.get("sceneId"),
            actions=s.get("actions", ["REVIEW", "EDIT", "DISMISS"]),
        )
        for s in result.suggestions
    ]

    return AgentSuggestionsResponse(
        suggestions=suggestions,
        error=result.error,
        fallback_suggestions=None,
    )
