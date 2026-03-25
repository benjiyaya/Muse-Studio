"""
Provider Registry — Central source of truth for all Muse inference providers.

To add a new provider:
  1. Create a new file in providers/image/, providers/video/local/, providers/video/api/, or providers/llm/
  2. Subclass the appropriate base class
  3. Register it here in the appropriate dict

The registry automatically detects which providers are available at startup
based on model files presence (local) or API key configuration (API).
"""

from __future__ import annotations
from typing import Type

from app.providers.base import (
    BaseProvider,
    ImageDraftProvider,
    ImageRefineProvider,
    VideoProvider,
    LLMProvider,
)
from app.providers.image.qwen_provider import QwenImageEditProvider
from app.providers.image.zimage_provider import ZImageTurboProvider
from app.providers.image.flux_klein_provider import FluxKleinProvider
from app.providers.video.local.wan_provider import WanProvider
from app.providers.video.local.ltx_provider import LTXProvider
from app.providers.video.api.kling_provider import KlingProvider
from app.providers.video.api.seeddance_provider import SeedDanceProvider
from app.providers.video.api.runway_provider import RunwayProvider
from app.providers.video.omni_provider import OmniVideoProvider
from app.providers.llm.openai_provider import OpenAIProvider
from app.providers.llm.ollama_provider import OllamaProvider
from app.providers.llm.claude_provider import ClaudeProvider
from app.providers.llm.lmstudio_provider import LMStudioProvider
from app.providers.llm.openrouter_provider import OpenRouterProvider


# ── Provider registries ───────────────────────────────────────────────────────

IMAGE_DRAFT_PROVIDERS: dict[str, Type[ImageDraftProvider]] = {
    "qwen": QwenImageEditProvider,          # img2img editing, Qwen 2.5 VL backbone
    "flux_klein": FluxKleinProvider,        # text2image / reference2image, FLUX.2-klein 9B
    # Add new image draft providers here, e.g.:
    # "sdxl": SDXLProvider,
}

IMAGE_REFINE_PROVIDERS: dict[str, Type[ImageRefineProvider]] = {
    "zimage_turbo": ZImageTurboProvider,
    # Add new refinement providers here
}

VIDEO_PROVIDERS: dict[str, Type[VideoProvider]] = {
    # Omni — routes to configured default (Phase 3)
    "omni": OmniVideoProvider,
    # Local models
    "wan2.2": WanProvider,
    "ltx2": LTXProvider,
    # Cloud APIs
    "kling": KlingProvider,
    "seeddance": SeedDanceProvider,
    "runway": RunwayProvider,
    # Add new providers here — no other files need to change
}

LLM_PROVIDERS: dict[str, Type[LLMProvider]] = {
    "openai": OpenAIProvider,
    "ollama": OllamaProvider,
    "claude": ClaudeProvider,
    "lmstudio": LMStudioProvider,
    "openrouter": OpenRouterProvider,
}


# ── Registry accessor functions ───────────────────────────────────────────────

def get_image_draft_provider(provider_id: str | None = None) -> ImageDraftProvider:
    """Returns an instantiated image draft provider. Uses config default if id is None."""
    from app.config import settings
    pid = provider_id or settings.providers.image_draft
    cls = IMAGE_DRAFT_PROVIDERS.get(pid)
    if not cls:
        raise ValueError(f"Unknown image draft provider: '{pid}'. Available: {list(IMAGE_DRAFT_PROVIDERS)}")
    return cls()


def get_image_refine_provider(provider_id: str | None = None) -> ImageRefineProvider:
    from app.config import settings
    pid = provider_id or settings.providers.image_refine
    cls = IMAGE_REFINE_PROVIDERS.get(pid)
    if not cls:
        raise ValueError(f"Unknown image refine provider: '{pid}'. Available: {list(IMAGE_REFINE_PROVIDERS)}")
    return cls()


def get_video_provider(provider_id: str | None = None) -> VideoProvider:
    from app.config import settings
    pid = provider_id or settings.providers.video_default
    cls = VIDEO_PROVIDERS.get(pid)
    if not cls:
        raise ValueError(f"Unknown video provider: '{pid}'. Available: {list(VIDEO_PROVIDERS)}")
    return cls()


def get_llm_provider(provider_id: str | None = None) -> LLMProvider:
    from app.config import settings
    pid = provider_id or settings.providers.llm
    cls = LLM_PROVIDERS.get(pid)
    if not cls:
        raise ValueError(f"Unknown LLM provider: '{pid}'. Available: {list(LLM_PROVIDERS)}")
    return cls()


def get_all_provider_info() -> dict[str, list[dict]]:
    """
    Returns availability info for all registered providers.
    Used by GET /providers to power the dynamic provider selector in the UI.
    """
    def _info(pid: str, cls: Type[BaseProvider], category: str) -> dict:
        instance = cls()
        return {
            "provider_id": pid,
            "display_name": instance.display_name,
            "provider_type": instance.provider_type,
            "category": category,
            "is_available": instance.is_available(),
            "unavailable_reason": instance.unavailable_reason() if not instance.is_available() else None,
            "capabilities": instance.capabilities(),
        }

    return {
        "image_draft": [_info(pid, cls, "image_draft") for pid, cls in IMAGE_DRAFT_PROVIDERS.items()],
        "image_refine": [_info(pid, cls, "image_refine") for pid, cls in IMAGE_REFINE_PROVIDERS.items()],
        "video": [_info(pid, cls, "video") for pid, cls in VIDEO_PROVIDERS.items()],
        "llm": [_info(pid, cls, "llm") for pid, cls in LLM_PROVIDERS.items()],
    }


def get_available_video_providers() -> list[str]:
    """Returns only video provider IDs that are currently available."""
    return [pid for pid, cls in VIDEO_PROVIDERS.items() if cls().is_available()]
