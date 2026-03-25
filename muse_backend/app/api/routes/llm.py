"""
GET  /llm/models   — List available models from a running Ollama instance.
POST /llm/test     — Test Ollama connectivity and model availability.
GET  /llm/config   — Current active LLM provider config.
POST /llm/config   — Persist active provider (and optional Ollama settings) to muse_config.json; hot-reload.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

router = APIRouter(prefix="/llm", tags=["LLM"])
logger = logging.getLogger(__name__)

_CONFIG_FILE = Path(__file__).resolve().parent.parent.parent.parent / "muse_config.json"


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
    openrouter_configured: bool = False


class LLMConfigUpdate(BaseModel):
    """Body for POST /llm/config — sync Settings → backend so Video Editor and other agents use the same provider."""
    active_provider: str  # "ollama" | "openai" | "claude" | "lmstudio" | "openrouter"
    ollama_base_url: Optional[str] = None
    ollama_model: Optional[str] = None
    lmstudio_base_url: Optional[str] = None
    lmstudio_model: Optional[str] = None
    openai_model: Optional[str] = None
    claude_model: Optional[str] = None
    openrouter_model: Optional[str] = None
    openrouter_base_url: Optional[str] = None


def _read_config() -> dict:
    if _CONFIG_FILE.exists():
        with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _write_config(data: dict) -> None:
    _CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


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

    cfg = _read_config()
    ollama_cfg = cfg.get("llm") or {}
    return LLMConfigResponse(
        active_provider=settings.providers.llm,
        ollama_base_url=ollama_cfg.get("ollama_base_url") or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        ollama_model=ollama_cfg.get("ollama_model") or os.getenv("OLLAMA_MODEL", "llama3.2"),
        openai_configured=bool(settings.openai_api_key),
        openrouter_configured=bool(settings.openrouter_api_key),
    )


@router.post("/config", response_model=LLMConfigResponse)
async def update_llm_config(body: LLMConfigUpdate):
    """
    Persist the active LLM provider (and optional Ollama URL/model) to muse_config.json
    and hot-reload. Called by Settings → LLM when the user clicks Save, so the backend
    (Video Editor Agent, suggestion agent, etc.) uses the same provider as the UI.
    """
    from app.config import settings

    cfg = _read_config()
    if "providers" not in cfg:
        cfg["providers"] = {}
    cfg["providers"]["llm"] = body.active_provider
    if "llm" not in cfg:
        cfg["llm"] = {}
    if body.ollama_base_url is not None:
        cfg["llm"]["ollama_base_url"] = body.ollama_base_url
    if body.ollama_model is not None:
        cfg["llm"]["ollama_model"] = body.ollama_model
    if body.lmstudio_base_url is not None:
        cfg["llm"]["lmstudio_base_url"] = body.lmstudio_base_url
    if body.lmstudio_model is not None:
        cfg["llm"]["lmstudio_model"] = body.lmstudio_model
    if body.openai_model is not None:
        cfg["llm"]["openai_model"] = body.openai_model
    if body.claude_model is not None:
        cfg["llm"]["claude_model"] = body.claude_model
    if body.openrouter_model is not None:
        cfg["llm"]["openrouter_model"] = body.openrouter_model
    if body.openrouter_base_url is not None:
        cfg["llm"]["openrouter_base_url"] = body.openrouter_base_url
    _write_config(cfg)
    settings.reload_from_file()
    logger.info("[LLM] Persisted active_provider=%s to muse_config.json", body.active_provider)

    cfg = _read_config()
    ollama_cfg = cfg.get("llm") or {}
    return LLMConfigResponse(
        active_provider=body.active_provider,
        ollama_base_url=ollama_cfg.get("ollama_base_url") or os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"),
        ollama_model=ollama_cfg.get("ollama_model") or os.getenv("OLLAMA_MODEL", "llama3.2"),
        openai_configured=bool(settings.openai_api_key),
        openrouter_configured=bool(settings.openrouter_api_key),
    )
