"""
Omni Video Provider — Phase 3.

Unified interface that routes to the configured video provider (Kling, Runway,
SeedDance, Wan, LTX, etc.). Phase 3.5 adds batch jobs and cost/usage tracking.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from app.providers.base import VideoProvider, VideoResult


def _get_video_provider():
    """Lazy import to avoid circular dependency with registry."""
    from app.registry import get_video_provider
    return get_video_provider()


class OmniVideoProvider(VideoProvider):
    """
    Omni provider: routes video generation to the configured default provider.
    Phase 3.5: Batch jobs and cost tracking will be added here.
    """

    provider_id = "omni"
    display_name = "Omni (Video)"
    provider_type = "api"

    def is_available(self) -> bool:
        try:
            p = _get_video_provider()
            return p.is_available()
        except Exception:
            return False

    def unavailable_reason(self) -> Optional[str]:
        try:
            p = _get_video_provider()
            return p.unavailable_reason()
        except Exception as e:
            return str(e)

    def capabilities(self) -> dict[str, Any]:
        try:
            p = _get_video_provider()
            caps = dict(p.capabilities())
            caps["omni"] = True
            caps["routed_provider"] = p.provider_id
            return caps
        except Exception:
            return {"omni": True}

    async def generate(
        self,
        script: str,
        keyframe_paths: list[str],
        params: dict[str, Any],
        on_progress: Optional[Callable] = None,
    ) -> VideoResult:
        """Route to configured video provider."""
        provider = _get_video_provider()
        return await provider.generate(
            script=script,
            keyframe_paths=keyframe_paths,
            params=params,
            on_progress=on_progress,
        )
