"""
Shared state types and configuration for Muse agents.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class SuggestionState:
    """State for the suggestion agent graph."""

    project_summary: str = ""
    control_level: str = "ASSISTANT"
    messages: list[dict[str, Any]] = field(default_factory=list)
    raw_suggestions: list[dict[str, Any]] = field(default_factory=list)
    formatted_suggestions: list[dict[str, Any]] = field(default_factory=list)
    error: Optional[str] = None


@dataclass
class SuggestionItem:
    """A single Muse suggestion (matches frontend NewSuggestion)."""

    type: str  # CONSISTENCY | ENHANCEMENT | VISUAL_STYLE | PACING
    muse: str  # STORY_MUSE | VISUAL_MUSE | MOTION_MUSE
    message: str
    scene_id: Optional[str] = None
    actions: list[str] = field(default_factory=lambda: ["REVIEW", "EDIT", "DISMISS"])
