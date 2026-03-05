"""
GET /providers — Returns all registered providers and their availability status.
The Next.js frontend uses this to build the dynamic model selector dropdown.
"""

from fastapi import APIRouter
from app.registry import get_all_provider_info
from app.schemas import ProvidersResponse, ProviderInfo, ProviderType, ProviderCategory

router = APIRouter(prefix="/providers", tags=["Providers"])


@router.get("", response_model=ProvidersResponse)
async def list_all_providers():
    """
    Returns all registered providers grouped by category,
    with real-time availability status (model files exist / API key set).
    """
    info = get_all_provider_info()
    return ProvidersResponse(
        image_draft=[ProviderInfo(**p) for p in info["image_draft"]],
        image_refine=[ProviderInfo(**p) for p in info["image_refine"]],
        video=[ProviderInfo(**p) for p in info["video"]],
        llm=[ProviderInfo(**p) for p in info["llm"]],
    )


@router.get("/video")
async def list_video_providers():
    """Returns only video providers, including unavailability reasons for the UI."""
    info = get_all_provider_info()
    return {"video": info["video"]}


@router.get("/available")
async def list_available_providers():
    """Returns only providers that are ready to accept requests right now."""
    info = get_all_provider_info()
    return {
        category: [p for p in providers if p["is_available"]]
        for category, providers in info.items()
    }
