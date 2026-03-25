"""
Shared state types and configuration for Muse agents.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Optional, TypedDict


class LongformSceneState(TypedDict, total=False):
    """State for the long-form scene generation graph."""

    project_id: str
    storyline: dict[str, Any]
    existing_scenes: list[dict[str, Any]]
    target_total: int
    batch_size: int
    batch_index: int
    all_generated_scenes: list[dict[str, Any]]
    error: Optional[str]
    stream_callback: Optional[Callable[[str, dict], None]]
    provider_id: Optional[str]
    llm_model: Optional[str]


@dataclass
class SuggestionState:
    """State for the suggestion agent graph."""

    project_summary: str = ""
    control_level: str = "ASSISTANT"
    messages: list[dict[str, Any]] = field(default_factory=list)
    raw_suggestions: list[dict[str, Any]] = field(default_factory=list)
    formatted_suggestions: list[dict[str, Any]] = field(default_factory=list)
    error: Optional[str] = None


NextTaskType = str  # "storyline" | "script" | "script_longform" | "keyframe" | "video" | "done"


class OrchestratorState(TypedDict, total=False):
    """State for the Supervisor graph (orchestrate Muses)."""

    project: dict[str, Any]
    current_phase: str  # storyline | script | keyframe | video
    goal: str  # full_pipeline | next_step | generate_scenes
    history: list[dict[str, Any]]  # [{ task, result }]
    next_task: NextTaskType
    error: Optional[str]
    target_total: Optional[int]  # for script_longform


@dataclass
class SuggestionItem:
    """A single Muse suggestion (matches frontend NewSuggestion)."""

    type: str  # CONSISTENCY | ENHANCEMENT | VISUAL_STYLE | PACING
    muse: str  # STORY_MUSE | VISUAL_MUSE | MOTION_MUSE
    message: str
    scene_id: Optional[str] = None
    actions: list[str] = field(default_factory=lambda: ["REVIEW", "EDIT", "DISMISS"])
