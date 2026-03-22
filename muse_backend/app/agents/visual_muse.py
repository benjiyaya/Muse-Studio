"""
Visual Muse Agent — keyframe / image generation.

Invoked by the Supervisor when next_task is "keyframe".
Uses app.providers (image_draft, image_refine) when implemented.
"""

from __future__ import annotations

from typing import Any


def run_visual_muse(
    task: str,
    project: dict[str, Any],
    scene_id: str | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Visual Muse: generate or refine keyframe images for a scene.
    Stub: returns placeholder. Later will wrap get_image_draft_provider / get_image_refine_provider.
    """
    return {
        "muse": "visual",
        "status": "stub",
        "message": "Visual Muse agent stub. Use ComfyUI or POST /generate/draft for keyframes.",
        "task": task,
        "scene_id": scene_id,
    }
