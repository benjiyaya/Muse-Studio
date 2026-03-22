"""
Story Muse Agent — storyline and script generation.

Invoked by the Supervisor when next_task is "storyline" or "script".
Phase 3: Stub. Full implementation will call LLM (generate_storyline / write_scene_script)
via app.providers or app.api.routes.generate.
"""

from __future__ import annotations

from typing import Any


def run_story_muse(
    task: str,
    project: dict[str, Any],
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Story Muse: generate storyline or script content.
    Stub: returns placeholder. Later will call LLM provider (generate_storyline, etc.).
    """
    return {
        "muse": "story",
        "status": "stub",
        "message": "Story Muse agent stub. Use frontend storyline/scene generation or POST /generate/story.",
        "task": task,
    }
