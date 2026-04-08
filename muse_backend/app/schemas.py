"""
Pydantic request/response schemas for all Muse Backend API endpoints.
These define the API contract between Next.js and the Python backend.
"""

from __future__ import annotations
from enum import Enum
from typing import Any, Optional
from pydantic import BaseModel, Field


# ── Enums ─────────────────────────────────────────────────────────────────────

class ProviderType(str, Enum):
    LOCAL = "local"
    API = "api"


class ProviderCategory(str, Enum):
    IMAGE_DRAFT = "image_draft"
    IMAGE_REFINE = "image_refine"
    VIDEO = "video"
    LLM = "llm"


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


# ── Provider info ──────────────────────────────────────────────────────────────

class ProviderInfo(BaseModel):
    provider_id: str
    display_name: str
    provider_type: ProviderType
    category: ProviderCategory
    is_available: bool
    unavailable_reason: Optional[str] = None
    capabilities: dict[str, Any] = Field(default_factory=dict)


class ProvidersResponse(BaseModel):
    image_draft: list[ProviderInfo]
    image_refine: list[ProviderInfo]
    video: list[ProviderInfo]
    llm: list[ProviderInfo]


# ── Image generation ───────────────────────────────────────────────────────────

class ImageDraftRequest(BaseModel):
    """
    Legacy endpoint schema. Draft/refine generation moved to MCP Extensions / ComfyUI.
    """
    scene_id: str
    prompt: str = Field(..., description="Scene description derived from script content")
    reference_image_paths: list[str] = Field(
        default_factory=list,
        description="Paths to reference images (max 5). Establishes style/mood."
    )
    aspect_ratio: str = Field(default="16:9")
    style_strength: float = Field(default=0.75, ge=0.0, le=1.0)
    provider_id: Optional[str] = Field(
        default=None,
        description="Override default provider. Uses muse_config.json value if None."
    )
    num_variations: int = Field(default=2, ge=1, le=4)


class ImageRefineRequest(BaseModel):
    """
    Legacy endpoint schema. Draft/refine generation moved to MCP Extensions / ComfyUI.
    """
    scene_id: str
    draft_image_path: str = Field(..., description="Path to Step 1 draft image")
    prompt: Optional[str] = None
    denoise_strength: float = Field(
        default=0.35,
        ge=0.1,
        le=0.6,
        description="Lower = more faithful to draft. Recommended: 0.3–0.4"
    )
    provider_id: Optional[str] = None


class ImageAsset(BaseModel):
    path: str
    width: int
    height: int
    file_size_bytes: Optional[int] = None


class ImageDraftResponse(BaseModel):
    scene_id: str
    provider_id: str
    variations: list[ImageAsset]
    generation_params: dict[str, Any]


class ImageRefineResponse(BaseModel):
    scene_id: str
    provider_id: str
    final_image: ImageAsset
    generation_params: dict[str, Any]


# ── Video generation ───────────────────────────────────────────────────────────

class VideoGenerateRequest(BaseModel):
    """
    Async video generation job. Returns a job_id immediately;
    poll GET /jobs/{job_id} for status and result.
    """
    scene_id: str
    script: str = Field(..., description="Full scene script text")
    keyframe_paths: list[str] = Field(
        default_factory=list,
        description="Approved keyframe images to guide video generation"
    )
    duration_seconds: Optional[int] = Field(default=None, description="Override default duration")
    fps: Optional[int] = Field(default=None)
    motion_strength: float = Field(default=0.7, ge=0.0, le=1.0)
    provider_id: Optional[str] = Field(
        default=None,
        description="e.g. 'wan2.2', 'kling', 'seeddance', 'runway'"
    )
    aspect_ratio: Optional[str] = Field(
        default=None,
        description="Optional provider-specific aspect ratio hint."
    )


class VideoGenerateResponse(BaseModel):
    job_id: str
    scene_id: str
    provider_id: str
    status: JobStatus = JobStatus.QUEUED
    message: str = "Video generation job queued"


# ── LLM / Story generation ────────────────────────────────────────────────────

class StoryGenerateRequest(BaseModel):
    """
    Story Muse: Generate or refine narrative content.
    Response is streamed (Server-Sent Events) for real-time display.
    """
    task: str = Field(
        ...,
        description="e.g. 'generate_storyline', 'write_scene_script', 'refine_dialogue'"
    )
    prompt: str
    context: Optional[dict[str, Any]] = Field(
        default=None,
        description="Optional context: scene info, existing script, characters, etc."
    )
    provider_id: Optional[str] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None
    # Ollama-specific overrides (used when provider_id = "ollama")
    ollama_base_url: Optional[str] = Field(
        default=None,
        description="Override OLLAMA_BASE_URL env var for this request."
    )
    ollama_model: Optional[str] = Field(
        default=None,
        description="Override OLLAMA_MODEL env var for this request."
    )
    # OpenAI model override (used when provider_id = "openai")
    openai_model: Optional[str] = Field(
        default=None,
        description="e.g. 'gpt-4o', 'gpt-4o-mini', 'gpt-5.0'"
    )
    # Claude model override (used when provider_id = "claude")
    claude_model: Optional[str] = Field(
        default=None,
        description="e.g. 'claude-sonnet-4-6', 'claude-opus-4-6'"
    )
    # LM Studio overrides (used when provider_id = "lmstudio")
    lmstudio_base_url: Optional[str] = Field(
        default=None,
        description="Override LMSTUDIO_BASE_URL env var for this request."
    )
    lmstudio_model: Optional[str] = Field(
        default=None,
        description="Override LMSTUDIO_MODEL env var for this request."
    )
    # OpenRouter (used when provider_id = "openrouter")
    openrouter_model: Optional[str] = Field(
        default=None,
        description="OpenRouter model id, e.g. openai/gpt-4o-mini"
    )
    openrouter_base_url: Optional[str] = Field(
        default=None,
        description="Override OpenRouter API base URL (default https://openrouter.ai/api/v1)."
    )


# ── Job polling ───────────────────────────────────────────────────────────────

class JobResult(BaseModel):
    job_id: str
    scene_id: str
    provider_id: str
    status: JobStatus
    progress_percent: Optional[int] = None
    message: Optional[str] = None
    output_path: Optional[str] = None
    error: Optional[str] = None
    created_at: str
    updated_at: str
    comfy_prompt_id: Optional[str] = None


# ── Agent suggestions ─────────────────────────────────────────────────────────

class AgentSuggestionItem(BaseModel):
    type: str  # CONSISTENCY | ENHANCEMENT | VISUAL_STYLE | PACING
    muse: str  # STORY_MUSE | VISUAL_MUSE | MOTION_MUSE
    message: str
    sceneId: Optional[str] = None
    actions: list[str] = Field(default_factory=lambda: ["REVIEW", "EDIT", "DISMISS"])


class AgentSuggestionsRequest(BaseModel):
    project: dict = Field(..., description="Full project JSON from frontend")
    control_level: str = Field(default="ASSISTANT")
    provider_id: Optional[str] = Field(default=None)


class AgentSuggestionsResponse(BaseModel):
    suggestions: list[AgentSuggestionItem] = Field(default_factory=list)
    error: Optional[str] = None
    fallback_suggestions: Optional[list[AgentSuggestionItem]] = None


class AgentExecuteRequest(BaseModel):
    suggestion_id: str
    action: str  # ACCEPT, FIX, etc.
    project: dict = Field(..., description="Full project JSON")
    scene_id: Optional[str] = None


class AgentExecuteResponse(BaseModel):
    job_id: Optional[str] = None
    status: str  # queued | running | completed | failed
    message: str
    error: Optional[str] = None


class AgentRevisionRequest(BaseModel):
    project: dict = Field(..., description="Full project JSON")
    rejected_suggestion_id: str
    feedback: str
    control_level: str = "ASSISTANT"


# ── Health check ──────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "1.5.5"
    models_path: str
    models_path_exists: bool
    available_providers: dict[str, list[str]]
