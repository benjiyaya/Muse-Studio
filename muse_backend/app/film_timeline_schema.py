"""
FilmTimeline — versioned JSON contract between Muse agents, Remotion, and the Player.

Agents produce trim decisions; deterministic code builds this document. Remotion CLI
and @remotion/player consume the same shape.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.config import settings


def seconds_to_frames(seconds: float, fps: float) -> int:
    """Convert seconds to frame index; rounds to nearest frame, minimum 0."""
    if fps <= 0:
        fps = 24.0
    return max(0, int(round(float(seconds) * fps)))


class TransitionOut(BaseModel):
    type: Literal["fade", "cut"] = "cut"
    duration_sec: float = Field(default=0.0, ge=0.0, alias="durationSec")

    model_config = {"populate_by_name": True}


class TitleCardOverlay(BaseModel):
    type: Literal["title_card"] = "title_card"
    text: str
    start_sec: float = Field(alias="startSec")
    duration_sec: float = Field(alias="durationSec", ge=0.0)

    model_config = {"populate_by_name": True}


class FilmSequenceItem(BaseModel):
    """One playable slice: usually one kept segment from a scene source video."""

    id: str
    scene_id: str = Field(alias="sceneId")
    scene_number: int = Field(alias="sceneNumber")
    title: str = ""
    render_src: str = Field(alias="renderSrc", description="file:// URI for headless Remotion render")
    preview_src: str = Field(
        alias="previewSrc",
        description="Browser URL path e.g. /api/outputs/videos/foo.mp4",
    )
    trim_start_sec: float = Field(alias="trimStartSec", ge=0.0)
    trim_end_sec: float = Field(alias="trimEndSec", ge=0.0)
    transition_out: TransitionOut | None = Field(default=None, alias="transitionOut")
    lower_third_title: str | None = Field(
        default=None,
        alias="lowerThirdTitle",
        description="Unused in composition; kept for legacy timeline JSON.",
    )

    model_config = {"populate_by_name": True}

    @model_validator(mode="after")
    def _end_after_start(self) -> FilmSequenceItem:
        if self.trim_end_sec <= self.trim_start_sec:
            raise ValueError("trimEndSec must be greater than trimStartSec")
        return self


class FilmTimeline(BaseModel):
    version: int = 1
    fps: float = 24.0
    width: int = 1920
    height: int = 1080
    project_title: str = Field(default="", alias="projectTitle")
    sequences: list[FilmSequenceItem] = Field(default_factory=list)
    overlays: list[TitleCardOverlay] = Field(default_factory=list)
    end_fade_out_sec: float = Field(
        default=0.0,
        ge=0.0,
        le=5.0,
        alias="endFadeOutSec",
        description="Crossfade last frames of final clip to black (Remotion only; ffmpeg apply ignores).",
    )

    model_config = {"populate_by_name": True}

    def model_dump_for_json(self) -> dict[str, Any]:
        """Serialize with camelCase aliases for Remotion / frontend."""
        return self.model_dump(mode="json", by_alias=True)

    def write_json(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self.model_dump_for_json(), indent=2),
            encoding="utf-8",
        )


def _file_uri_for_outputs_rel(rel_path: str) -> str:
    """Absolute file:// URI for a path under outputs (for Remotion CLI on this machine)."""
    root = settings.outputs_path.resolve()
    abs_path = (root / rel_path).resolve()
    if not str(abs_path).startswith(str(root)):
        raise ValueError(f"Path escapes outputs root: {rel_path}")
    if not abs_path.is_file():
        # Still produce URI so Remotion fails visibly; ffprobe may have validated earlier
        pass
    return abs_path.as_uri()


def timeline_from_smart_edit_segments(
    project: dict[str, Any],
    scene_segments: list[dict[str, Any]],
) -> FilmTimeline:
    """
    Build a FilmTimeline from per-scene edit results.

    scene_segments: ordered list of dicts with keys:
      - scene: full scene dict (id, title, sceneNumber, videoUrl, ...)
      - segments: list of (start_sec, end_sec) tuples
      - video_duration_sec: optional float from ffprobe — trims are clamped to [0, duration]
      - transition_out: optional dict {type, durationSec}
    """
    storyline = project.get("storyline") or {}
    if isinstance(storyline, str):
        storyline = {}
    project_title = str(project.get("title") or storyline.get("title") or "")

    fps = 24.0
    width, height = 1920, 1080

    sequences: list[FilmSequenceItem] = []
    seq_counter = 0

    for row in scene_segments:
        scene = row.get("scene") or {}
        segs = row.get("segments") or []
        if not isinstance(segs, list) or not scene:
            continue

        scene_id = str(scene.get("id") or "")
        video_url = str(scene.get("videoUrl") or "")
        if not scene_id or not video_url:
            continue

        prefix = "/api/outputs/"
        if not video_url.startswith(prefix):
            continue
        rel_path = video_url[len(prefix) :]

        try:
            render_uri = _file_uri_for_outputs_rel(rel_path)
        except ValueError:
            continue

        scene_number = int(scene.get("sceneNumber") or 0)
        default_title = str(scene.get("title") or scene.get("heading") or f"Scene {scene_number}")

        trans_raw = row.get("transition_out")
        transition_out: TransitionOut | None = None
        if isinstance(trans_raw, dict):
            try:
                transition_out = TransitionOut.model_validate(
                    {
                        "type": trans_raw.get("type", "cut"),
                        "durationSec": float(trans_raw.get("durationSec", 0)),
                    }
                )
            except Exception:  # noqa: BLE001
                transition_out = None

        max_d: float | None = None
        raw_dur = row.get("video_duration_sec")
        if raw_dur is not None:
            try:
                md = float(raw_dur)
                if md > 0:
                    max_d = md
            except (TypeError, ValueError):
                max_d = None

        valid_seg_list: list[tuple[float, float]] = []
        for start_sec, end_sec in segs:
            try:
                s = float(start_sec)
                e = float(end_sec)
            except (TypeError, ValueError):
                continue
            if max_d is not None:
                s = max(0.0, min(s, max_d))
                e = max(0.0, min(e, max_d))
            if e <= s:
                continue
            valid_seg_list.append((s, e))

        for idx, (s, e) in enumerate(valid_seg_list):
            is_last_seg = idx == len(valid_seg_list) - 1
            seg_transition = transition_out if is_last_seg else None
            seq_counter += 1
            sequences.append(
                FilmSequenceItem(
                    id=f"{scene_id}-seg-{seq_counter}",
                    sceneId=scene_id,
                    sceneNumber=scene_number,
                    title=default_title,
                    renderSrc=render_uri,
                    previewSrc=video_url,
                    trimStartSec=s,
                    trimEndSec=e,
                    transitionOut=seg_transition,
                    lowerThirdTitle=None,
                )
            )

    # transitionOut means "into the next clip"; the final sequence has no successor.
    if sequences:
        last = sequences[-1]
        sequences[-1] = last.model_copy(update={"transition_out": None})

    return FilmTimeline(
        version=1,
        fps=fps,
        width=width,
        height=height,
        projectTitle=project_title,
        sequences=sequences,
        overlays=[],
    )


def validate_timeline_dict(data: dict[str, Any]) -> FilmTimeline:
    """Parse and validate arbitrary JSON dict."""
    return FilmTimeline.model_validate(data)
