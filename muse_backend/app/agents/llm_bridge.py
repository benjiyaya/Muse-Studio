"""
Bridge from Muse backend settings to LangChain ChatModels.

Uses Option A: LangChain's built-in clients (ChatOpenAI, ChatAnthropic, ChatOllama).
API keys and URLs come from app.config.settings, muse_config.json, and environment variables.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

from app.config import settings

_CONFIG_FILE = Path(__file__).resolve().parent.parent.parent / "muse_config.json"


def _get_llm_config() -> dict:
    """Read llm section from muse_config.json if present."""
    if _CONFIG_FILE.exists():
        try:
            with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data.get("llm") or {}
        except Exception:
            pass
    return {}


def _get_ollama_config() -> tuple[str, str]:
    """Read Ollama base_url and model from muse_config.json if present; else env vars."""
    base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    model = os.getenv("OLLAMA_MODEL", "llama3.2")
    llm = _get_llm_config()
    if llm.get("ollama_base_url"):
        base_url = llm["ollama_base_url"]
    if llm.get("ollama_model"):
        model = llm["ollama_model"]
    return base_url, model


def get_chat_model(
    provider_id: Optional[str] = None,
    model: Optional[str] = None,
    temperature: float = 0.7,
    max_tokens: int = 2048,
):
    """
    Return a LangChain ChatModel for the given provider.
    Falls back to settings.providers.llm if provider_id is None.
    """
    pid = provider_id or settings.providers.llm

    if pid == "openai":
        from langchain_openai import ChatOpenAI

        api_key = settings.openai_api_key or os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY not set")
        llm_cfg = _get_llm_config()
        openai_model_name = model or llm_cfg.get("openai_model") or "gpt-4o-mini"
        return ChatOpenAI(
            api_key=api_key,
            model=openai_model_name,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    if pid == "claude" or pid == "anthropic":
        from langchain_anthropic import ChatAnthropic

        api_key = settings.anthropic_api_key or os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY not set")
        llm_cfg = _get_llm_config()
        claude_model_name = model or llm_cfg.get("claude_model") or "claude-3-5-sonnet-20241022"
        return ChatAnthropic(
            api_key=api_key,
            model=claude_model_name,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    if pid == "ollama":
        base_url, default_model = _get_ollama_config()
        ollama_model = model or default_model
        try:
            from langchain_ollama import ChatOllama
        except ImportError:
            from langchain_community.chat_models import ChatOllama  # deprecated: use langchain-ollama
        return ChatOllama(
            base_url=base_url.rstrip("/"),
            model=ollama_model,
            temperature=temperature,
            num_predict=max_tokens,
        )

    if pid == "lmstudio":
        from langchain_openai import ChatOpenAI

        llm_cfg = _get_llm_config()
        base_url = llm_cfg.get("lmstudio_base_url") or os.getenv("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234")
        lmstudio_model = model or llm_cfg.get("lmstudio_model") or os.getenv("LMSTUDIO_MODEL", "gpt-4o-mini")
        api_key = os.getenv("LMSTUDIO_API_KEY") or "lmstudio-local"
        return ChatOpenAI(
            api_key=api_key,
            base_url=base_url.rstrip("/") + "/v1",
            model=lmstudio_model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    if pid == "openrouter":
        from langchain_openai import ChatOpenAI

        api_key = settings.openrouter_api_key or os.getenv("OPENROUTER_API_KEY")
        if not api_key:
            raise ValueError("OPENROUTER_API_KEY not set")
        llm_cfg = _get_llm_config()
        base_raw = (
            llm_cfg.get("openrouter_base_url")
            or os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        ).rstrip("/")
        # ChatOpenAI expects the OpenAI root that ends with /v1
        base_url = base_raw if base_raw.endswith("/v1") else f"{base_raw}/v1"
        or_model = model or llm_cfg.get("openrouter_model") or os.getenv(
            "OPENROUTER_MODEL", "openai/gpt-4o-mini"
        )
        default_headers: dict[str, str] = {}
        ref = os.getenv("OPENROUTER_HTTP_REFERER")
        title = os.getenv("OPENROUTER_APP_TITLE")
        if ref:
            default_headers["HTTP-Referer"] = ref
        if title:
            default_headers["X-Title"] = title
        return ChatOpenAI(
            api_key=api_key,
            base_url=base_url,
            model=or_model,
            temperature=temperature,
            max_tokens=max_tokens,
            default_headers=default_headers or None,
        )

    raise ValueError(f"Unknown LLM provider: {pid}")


def is_provider_available(provider_id: Optional[str] = None) -> bool:
    """Check if the given provider has required config (API key, etc.)."""
    pid = provider_id or settings.providers.llm
    if pid == "openai":
        return bool(settings.openai_api_key or os.getenv("OPENAI_API_KEY"))
    if pid in ("claude", "anthropic"):
        return bool(settings.anthropic_api_key or os.getenv("ANTHROPIC_API_KEY"))
    if pid == "ollama":
        return True  # Ollama is typically always "available" if running
    if pid == "lmstudio":
        # Consider LM Studio available when a base URL is configured.
        return bool(os.getenv("LMSTUDIO_BASE_URL"))
    if pid == "openrouter":
        return bool(settings.openrouter_api_key or os.getenv("OPENROUTER_API_KEY"))
    return False
