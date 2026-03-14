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
from pydantic import BaseModel

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


class VideoEditorAgentRequest(BaseModel):
    """Request body for the Video Editor Agent."""

    project: dict
    mode: str = "SIMPLE_STITCH"


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
