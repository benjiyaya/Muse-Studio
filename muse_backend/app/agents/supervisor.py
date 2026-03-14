"""
Multi-agent orchestration — Supervisor pattern.

Routes tasks to Story Muse, Visual Muse, or Motion Muse.
Phase 2.5: Stub. Full implementation with handoff protocols in Phase 2.5.
"""

from __future__ import annotations

from typing import Any, Literal

TaskType = Literal["storyline", "script", "keyframe", "visual", "video", "motion"]


def route_task(task: str, project: dict[str, Any]) -> str:
    """
    Route a task to the appropriate Muse subgraph.
    Returns: "story" | "visual" | "motion"
    """
    task_lower = task.lower()
    if task_lower in ("storyline", "script", "dialogue", "story"):
        return "story"
    if task_lower in ("keyframe", "visual", "image"):
        return "visual"
    if task_lower in ("video", "motion"):
        return "motion"
    return "story"  # default
