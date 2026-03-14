from __future__ import annotations

"""
Video Editor Agent (Director) — Simple Stitch and Smart Edit modes.

- SIMPLE_STITCH: concatenate all FINAL scene videos in order into one master.
- SMART_EDIT: Director derives a global brief; per-scene Editor (LLM) produces
  an edit plan (start/end segments) from transcript + metadata; we trim each
  segment via cut_clip and concatenate (optional transitions between scenes).
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from langgraph.graph import END, START, StateGraph

from app.config import settings
from app.video_editor_tools import (
    VideoEditorError,
    concat_clips,
    cut_clip,
    get_scene_video_from_scene,
    sample_frames,
    transcribe_video,
)

logger = logging.getLogger(__name__)


@dataclass
class VideoEditorState:
    """State for the Video Editor Agent (Simple Stitch / Smart Edit)."""

    project: dict[str, Any]
    mode: str = "SIMPLE_STITCH"

    # Optional callback for streaming progress to the client (message: str) -> None
    progress_callback: Optional[Callable[[str], None]] = field(default=None, repr=False)

    # Derived fields
    clip_rel_paths: list[str] = field(default_factory=list)
    clip_count: int = 0

    # Result / status
    status: str = "pending"  # pending | no_final_scenes | clips_collected | completed | failed
    output_path: Optional[str] = None
    total_duration: float = 0.0
    error: Optional[str] = None


_compiled_graph_simple: Any | None = None
_compiled_graph_smart: Any | None = None


def _relative_path_from_video_url(video_url: str) -> str:
    """
    Convert a Next.js `videoUrl` like `/api/outputs/videos/foo.mp4`
    into a relative path under the outputs root (`videos/foo.mp4`).
    """
    prefix = "/api/outputs/"
    if not isinstance(video_url, str) or not video_url:
        raise ValueError("videoUrl must be a non-empty string.")
    idx = video_url.find(prefix)
    if idx == -1:
        raise ValueError(f"Unexpected videoUrl format: {video_url}")
    return video_url[idx + len(prefix) :]


# ─── Director: global editing brief ──────────────────────────────────────────


def derive_global_brief(project: dict[str, Any]) -> str:
    """
    Director: derive a short global editing brief from storyline and project context.
    Used by the Editor sub-agent to keep pacing and tone consistent.
    """
    storyline = project.get("storyline") or {}
    if isinstance(storyline, str):
        storyline = {}
    genre = storyline.get("genre") or "drama"
    themes = storyline.get("themes")
    if isinstance(themes, list):
        themes_str = ", ".join(str(t) for t in themes[:5])
    else:
        themes_str = str(themes) if themes else ""
    logline = storyline.get("logline") or ""
    plot = storyline.get("plotOutline") or ""
    parts = [f"Genre: {genre}."]
    if themes_str:
        parts.append(f"Themes: {themes_str}.")
    if logline:
        parts.append(f"Logline: {logline[:300]}.")
    if plot:
        parts.append(f"Plot: {plot[:400]}.")
    return " ".join(parts)


# ─── Editor sub-agent: edit plan from LLM ───────────────────────────────────


def _parse_editor_segments(llm_content: str, duration_sec: float) -> list[tuple[float, float]]:
    """
    Parse LLM JSON output into a list of (start, end) segments in seconds.
    Validates and clamps to [0, duration_sec]. Returns empty or invalid → use full clip.
    """
    segments: list[tuple[float, float]] = []
    try:
        raw = json.loads(llm_content)
        if not isinstance(raw, list):
            return []
        for item in raw:
            if not isinstance(item, dict):
                continue
            start = item.get("start")
            end = item.get("end")
            if start is None or end is None:
                continue
            try:
                s = float(start)
                e = float(end)
            except (TypeError, ValueError):
                continue
            if s < 0:
                s = 0.0
            if e > duration_sec:
                e = duration_sec
            if e <= s or (e - s) < 0.1:
                continue
            segments.append((s, e))
    except json.JSONDecodeError:
        return []
    if not segments:
        return []
    segments.sort(key=lambda x: x[0])
    return segments


def run_editor_agent(
    scene: dict[str, Any],
    global_brief: str,
    transcript_text: str,
    duration_sec: float,
) -> list[tuple[float, float]]:
    """
    Editor sub-agent: use LLM to produce an edit plan (list of (start, end) segments)
    from scene metadata, global brief, and transcript. Falls back to full clip on failure.
    """
    title = scene.get("title") or "Scene"
    heading = scene.get("heading") or ""
    description = scene.get("description") or ""
    dialogue = scene.get("dialogue") or ""
    notes = scene.get("technicalNotes") or ""

    prompt = f"""You are a film editor. Given a scene's script and the transcript of its current video, suggest which segments of the video to KEEP (start and end time in seconds). Your goal is to trim dead space and keep the story beats and dialogue.

Project brief: {global_brief[:500]}

Scene: {title}. {heading}
Description: {description[:400]}
Dialogue: {dialogue[:300]}
Notes: {notes[:200]}

Transcript of the video (what was said/heard): {transcript_text[:600]}

Video duration: {duration_sec:.1f} seconds.

Respond with ONLY a JSON array of segments to keep. Each item: {{"start": <seconds>, "end": <seconds>, "reason": "<short reason>"}}.
Example: [{{"start": 0, "end": 5.2, "reason": "Opening"}}, {{"start": 8.1, "end": 12, "reason": "Dialogue"}}]
Segments must be within [0, {duration_sec:.1f}], start < end, and can overlap the transcript. If the transcript or script is empty, suggest one segment that keeps the middle 80% of the clip (trim head and tail). Output only valid JSON, no markdown."""

    try:
        from app.agents.llm_bridge import get_chat_model

        llm = get_chat_model(temperature=0.3, max_tokens=1024)
        message = llm.invoke(prompt)
        content = message.content if hasattr(message, "content") else str(message)
        if not content:
            return [(0.0, duration_sec)]
        # Strip markdown code block if present
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        segments = _parse_editor_segments(content, duration_sec)
        if segments:
            return segments
    except Exception as e:  # noqa: BLE001
        err_msg = str(e)
        logger.warning("Editor agent failed for scene %s: %s", scene.get("id"), err_msg)
        logger.debug("Editor agent exception detail", exc_info=True)
        if "500" in err_msg or "Internal Server Error" in err_msg:
            logger.info(
                "Ollama/LLM returned 500. Check: model is pulled (ollama list), server has enough memory, and Settings → LLM has the correct model name."
            )
    return [(0.0, duration_sec)]


def collect_clips(state: VideoEditorState) -> dict:
    """
    Node: collect all FINAL scenes with videoUrl and compute their relative paths.
    """
    cb = getattr(state, "progress_callback", None)
    if callable(cb):
        cb("Collecting final scene clips…")
    project = state.project or {}
    scenes = project.get("scenes") or []

    # Filter scenes that are FINAL and have a non-empty videoUrl
    final_scenes = [
        s
        for s in scenes
        if (s.get("status") == "FINAL" and isinstance(s.get("videoUrl"), str) and s.get("videoUrl"))
    ]

    if not final_scenes:
        return {
            "status": "no_final_scenes",
            "clip_rel_paths": [],
            "clip_count": 0,
            "error": "No FINAL scenes with videoUrl found; nothing to stitch.",
        }

    # Sort by sceneNumber (fallback to 0 if missing)
    final_scenes.sort(key=lambda s: s.get("sceneNumber") or 0)

    rel_paths: list[str] = []
    for scene in final_scenes:
        video_url = scene.get("videoUrl") or ""
        rel_paths.append(_relative_path_from_video_url(str(video_url)))

    return {
        "status": "clips_collected",
        "clip_rel_paths": rel_paths,
        "clip_count": len(rel_paths),
    }


def stitch_clips(state: VideoEditorState) -> dict:
    """
    Node: run concat_clips on the collected clip paths to build the master video.
    """
    cb = getattr(state, "progress_callback", None)
    if callable(cb):
        cb("Stitching clips into master video…")
    if not state.clip_rel_paths:
        return {
            "status": "no_final_scenes",
            "error": state.error or "No clips to stitch.",
        }

    project_id = state.project.get("id") or "project"
    target_name = f"{project_id}_simple_stitch"

    try:
        info = concat_clips(
            clip_rel_paths=state.clip_rel_paths,
            project_id=project_id,
            target_name=target_name,
            reencode=False,
        )
    except VideoEditorError as exc:
        return {
            "status": "failed",
            "error": str(exc),
        }

    # Convert absolute path to relative path under outputs/ for frontend URL building
    try:
        rel = info.path.relative_to(settings.outputs_path).as_posix()
    except ValueError:
        rel = info.path.name

    return {
        "status": "completed",
        "output_path": rel,
        "total_duration": info.duration,
        "clip_count": info.clip_count,
    }


def smart_edit_and_stitch(state: VideoEditorState) -> dict:
    """
    Node: Smart Edit — Director brief + per-scene Editor (LLM) edit plan, trim segments, stitch.

    For each FINAL scene:
      - Transcribe video and optionally sample frames.
      - Editor agent (LLM) gets scene metadata + global brief + transcript, returns
        edit plan: list of (start, end) segments to keep.
      - cut_clip() for each segment; collect all clip paths.
    Optionally add_transition between scenes (v1: disabled). Then concat all clips.
    """
    project = state.project or {}
    scenes = project.get("scenes") or []

    final_scenes = [
        s
        for s in scenes
        if (s.get("status") == "FINAL" and isinstance(s.get("videoUrl"), str) and s.get("videoUrl"))
    ]

    if not final_scenes:
        return {
            "status": "no_final_scenes",
            "clip_rel_paths": [],
            "clip_count": 0,
            "error": "No FINAL scenes with videoUrl found; nothing to smart-edit.",
        }

    final_scenes.sort(key=lambda s: s.get("sceneNumber") or 0)
    project_id = project.get("id") or "project"
    cb = getattr(state, "progress_callback", None)

    # Director: global editing brief
    if callable(cb):
        cb("Director: deriving global editing brief…")
    global_brief = derive_global_brief(project)
    edited_rel_paths: list[str] = []

    for idx, scene in enumerate(final_scenes, start=1):
        scene_id = str(scene.get("id") or "")
        video_url = str(scene.get("videoUrl") or "")
        if not scene_id or not video_url:
            continue

        try:
            info = get_scene_video_from_scene(scene)
        except VideoEditorError:
            continue

        duration = float(info.duration or 0.0)
        if duration <= 0.0:
            continue

        if callable(cb):
            cb(f"Scene {idx}/{len(final_scenes)}: Transcribing audio…")
        # Transcript for Editor
        transcript_text = ""
        try:
            trans_result = transcribe_video(scene_id=scene_id, video_url=video_url)
            segs = trans_result.get("segments") or []
            if segs:
                transcript_text = " ".join(str(s.get("text", "")) for s in segs).strip()
        except VideoEditorError:
            pass

        # Optional: sample frames for future VLM use (side-effect only for now)
        try:
            sample_frames(scene_id=scene_id, video_url=video_url, max_frames=8, strategy="uniform")
        except VideoEditorError:
            pass

        if callable(cb):
            cb(f"Scene {idx}/{len(final_scenes)}: Editor (LLM) planning segments…")
        # Editor: LLM returns edit plan (list of (start, end)); fallback full clip
        segments = run_editor_agent(scene, global_brief, transcript_text, duration)
        input_rel = _relative_path_from_video_url(video_url)

        if callable(cb) and len(segments) > 0:
            cb(f"Scene {idx}/{len(final_scenes)}: Cutting {len(segments)} segment(s)…")
        for start, end in segments:
            try:
                trimmed = cut_clip(
                    input_rel_path=input_rel,
                    project_id=project_id,
                    scene_id=scene_id,
                    start=start,
                    end=end,
                    reencode=False,
                )
            except VideoEditorError:
                continue
            try:
                rel_trim = trimmed.path.relative_to(settings.outputs_path).as_posix()
            except ValueError:
                rel_trim = trimmed.path.name
            edited_rel_paths.append(rel_trim)

    if not edited_rel_paths:
        return {
            "status": "failed",
            "clip_rel_paths": [],
            "clip_count": 0,
            "error": "Smart Edit produced no edited clips.",
        }

    if callable(cb):
        cb("Stitching final film…")
    try:
        info = concat_clips(
            clip_rel_paths=edited_rel_paths,
            project_id=project_id,
            target_name=f"{project_id}_smart_edit",
            reencode=False,
        )
    except VideoEditorError as exc:
        return {
            "status": "failed",
            "error": str(exc),
        }

    try:
        rel_master = info.path.relative_to(settings.outputs_path).as_posix()
    except ValueError:
        rel_master = info.path.name

    return {
        "status": "completed",
        "output_path": rel_master,
        "total_duration": info.duration,
        "clip_count": info.clip_count,
        "clip_rel_paths": edited_rel_paths,
    }


def _build_graph_simple() -> Any:
    """Compile the LangGraph for the Video Editor Agent (SIMPLE_STITCH)."""
    graph = StateGraph(VideoEditorState)
    graph.add_node("collect_clips", collect_clips)
    graph.add_node("stitch_clips", stitch_clips)

    graph.add_edge(START, "collect_clips")
    graph.add_edge("collect_clips", "stitch_clips")
    graph.add_edge("stitch_clips", END)
    return graph.compile()


def _build_graph_smart() -> Any:
    """Compile the LangGraph for the Video Editor Agent (SMART_EDIT)."""
    graph = StateGraph(VideoEditorState)
    graph.add_node("smart_edit_and_stitch", smart_edit_and_stitch)
    graph.add_edge(START, "smart_edit_and_stitch")
    graph.add_edge("smart_edit_and_stitch", END)
    return graph.compile()


def _get_graph_simple() -> Any:
    global _compiled_graph_simple  # noqa: PLW0603
    if _compiled_graph_simple is None:
        _compiled_graph_simple = _build_graph_simple()
    return _compiled_graph_simple


def _get_graph_smart() -> Any:
    global _compiled_graph_smart  # noqa: PLW0603
    if _compiled_graph_smart is None:
        _compiled_graph_smart = _build_graph_smart()
    return _compiled_graph_smart


def run_video_editor_agent(
    project: dict[str, Any],
    mode: str = "SIMPLE_STITCH",
    progress_callback: Optional[Callable[[str], None]] = None,
) -> dict[str, Any]:
    """
    Run the Video Editor Agent.

    Args:
        project: Full project JSON as sent by the frontend (title, scenes, etc.).
        mode:
          - "SIMPLE_STITCH": concatenate FINAL scene videos as-is.
          - "SMART_EDIT": per-scene Editor pass (transcript + frames + full-length clips),
            then stitch edited clips into a master.
        progress_callback: Optional callback(message: str) for streaming progress to the client.

    Returns:
        A dict with:
          - mode: the requested mode
          - status: "completed" | "no_final_scenes" | "failed"
          - clipCount: number of clips stitched
          - outputPath: relative path under outputs/
          - totalDuration: approximate total duration in seconds
          - error: optional error message
    """
    state = VideoEditorState(project=project, mode=mode, progress_callback=progress_callback)

    if mode == "SIMPLE_STITCH":
        compiled = _get_graph_simple()
    elif mode == "SMART_EDIT":
        compiled = _get_graph_smart()
    else:
        return {
            "mode": mode,
            "status": "failed",
            "clipCount": 0,
            "outputPath": None,
            "totalDuration": 0.0,
            "error": f"Unsupported mode '{mode}'. Supported modes: SIMPLE_STITCH, SMART_EDIT.",
        }

    result = compiled.invoke(state)

    # LangGraph may return state as a dict after merging node returns
    if isinstance(result, dict):
        return {
            "mode": mode,
            "status": result.get("status", "failed"),
            "clipCount": result.get("clip_count", 0),
            "outputPath": result.get("output_path"),
            "totalDuration": result.get("total_duration", 0.0),
            "error": result.get("error"),
        }
    return {
        "mode": mode,
        "status": result.status,
        "clipCount": result.clip_count,
        "outputPath": result.output_path,
        "totalDuration": result.total_duration,
        "error": result.error,
    }


