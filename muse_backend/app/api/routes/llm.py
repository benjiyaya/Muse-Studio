"""
GET  /llm/models   — List available models from a running Ollama instance.
POST /llm/test     — Test Ollama connectivity and model availability.
GET  /llm/config   — Current active LLM provider config.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter(prefix="/llm", tags=["LLM"])


# ── Schemas ────────────────────────────────────────────────────────────────────

class OllamaModel(BaseModel):
    name: str
    size: str
    modified_at: str


class OllamaModelsResponse(BaseModel):
    ok: bool
    base_url: str
    models: list[OllamaModel]
    error: Optional[str] = None


class OllamaTestRequest(BaseModel):
    base_url: str = "http://localhost:11434"
    model: str = ""


class OllamaTestResponse(BaseModel):
    ok: bool
    message: str
    models: list[str]
    latency_ms: int


class LLMConfigResponse(BaseModel):
    active_provider: str
    ollama_base_url: str
    ollama_model: str
    openai_configured: bool


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/models", response_model=OllamaModelsResponse)
async def get_ollama_models(
    base_url: str = Query(
        default="",
        description="Ollama base URL. Defaults to OLLAMA_BASE_URL env var or http://localhost:11434",
    )
):
    """
    Returns the list of models available in a running Ollama instance.
    Used by the Settings → LLM page to populate the model selector.
    """
    from app.providers.llm.ollama_provider import list_ollama_models

    resolved_url = base_url.strip() or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")

    try:
        raw_models = await list_ollama_models(resolved_url)
        return OllamaModelsResponse(
            ok=True,
            base_url=resolved_url,
            models=[OllamaModel(**m) for m in raw_models],
        )
    except Exception as exc:
        return OllamaModelsResponse(
            ok=False,
            base_url=resolved_url,
            models=[],
            error=str(exc),
        )


@router.post("/test", response_model=OllamaTestResponse)
async def test_ollama(body: OllamaTestRequest):
    """
    Tests connectivity to an Ollama instance and verifies a model is available.
    Returns latency in milliseconds and the full model list.
    Used by Settings → LLM → "Test Connection" button.
    """
    from app.providers.llm.ollama_provider import test_ollama_connection

    result = await test_ollama_connection(
        base_url=body.base_url,
        model=body.model,
    )
    return OllamaTestResponse(**result)


@router.get("/config", response_model=LLMConfigResponse)
async def get_llm_config():
    """
    Returns the current LLM provider configuration from env vars / muse_config.json.
    """
    from app.config import settings

    return LLMConfigResponse(
        active_provider=settings.providers.llm,
        ollama_base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        ollama_model=os.getenv("OLLAMA_MODEL", "llama3.2"),
        openai_configured=bool(settings.openai_api_key),
    )
