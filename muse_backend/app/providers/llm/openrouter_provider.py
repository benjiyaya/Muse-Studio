"""
Story Muse — LLM Provider: OpenRouter

OpenAI-compatible streaming at https://openrouter.ai/api/v1/chat/completions.
Requires OPENROUTER_API_KEY in muse_backend/.env.

Optional attribution headers (recommended by OpenRouter):
  OPENROUTER_HTTP_REFERER, OPENROUTER_APP_TITLE
"""

from __future__ import annotations

import json
import os
from typing import Any, AsyncGenerator, Optional

from app.providers.base import LLMProvider, LLMChunk
from app.config import settings

DEFAULT_BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openai/gpt-4o-mini"

SYSTEM_PROMPTS: dict[str, str] = {
    "generate_storyline": (
        "You are Story Muse, a creative AI assistant specializing in film narrative development. "
        "Generate a rich, structured storyline outline including: logline, plot outline, "
        "character descriptions, themes, and genre. Be cinematic, evocative, and precise."
    ),
    "write_scene_script": (
        "You are Story Muse, a professional screenwriter AI. "
        "Write a properly formatted scene script including: scene heading (INT./EXT. LOCATION — TIME), "
        "action description, and dialogue with character names and parentheticals. "
        "Follow standard screenplay format."
    ),
    "refine_dialogue": (
        "You are Story Muse, an expert dialogue editor. "
        "Improve the provided dialogue for naturalness, character voice, and dramatic impact. "
        "Preserve the original intent while enhancing subtext and rhythm."
    ),
    "add_tension": (
        "You are Story Muse, a dramatic tension specialist. "
        "Enhance the provided scene to increase dramatic tension, stakes, or conflict. "
        "Suggest specific additions or modifications."
    ),
    "general_query": (
        "You are Story Muse, a creative AI assistant for filmmakers. "
        "Help with any aspect of film narrative, script writing, or story development."
    ),
    "default": (
        "You are Story Muse, a creative AI assistant for filmmakers. "
        "Help with any aspect of film narrative, script writing, or story development."
    ),
}


def _api_key() -> Optional[str]:
    return settings.openrouter_api_key or os.getenv("OPENROUTER_API_KEY")


def _resolve_base_url(params: Optional[dict]) -> str:
    if params and params.get("openrouter_base_url"):
        return str(params["openrouter_base_url"]).rstrip("/")
    return os.getenv("OPENROUTER_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def _resolve_model(params: Optional[dict]) -> str:
    if params and params.get("openrouter_model"):
        return str(params["openrouter_model"])
    return os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL)


def _extra_headers() -> dict[str, str]:
    h: dict[str, str] = {}
    ref = os.getenv("OPENROUTER_HTTP_REFERER")
    title = os.getenv("OPENROUTER_APP_TITLE")
    if ref:
        h["HTTP-Referer"] = ref
    if title:
        h["X-Title"] = title
    return h


class OpenRouterProvider(LLMProvider):
    provider_id = "openrouter"
    display_name = "OpenRouter"
    provider_type = "api"

    def is_available(self) -> bool:
        return bool(_api_key())

    def unavailable_reason(self) -> Optional[str]:
        if not self.is_available():
            return "OPENROUTER_API_KEY not set in muse_backend/.env."
        return None

    def capabilities(self) -> dict[str, Any]:
        return {
            "models": [DEFAULT_MODEL, "anthropic/claude-3.5-sonnet", "google/gemini-pro-1.5"],
            "streaming": True,
            "max_context_tokens": 200000,
        }

    async def generate_stream(
        self,
        task: str,
        prompt: str,
        context: Optional[dict[str, Any]],
        params: dict[str, Any],
    ) -> AsyncGenerator[LLMChunk, None]:
        import httpx

        key = _api_key()
        if not key:
            yield LLMChunk(text="Error: OPENROUTER_API_KEY not set in muse_backend/.env", is_final=True)
            return

        base_url = _resolve_base_url(params)
        model = _resolve_model(params)
        system_prompt = SYSTEM_PROMPTS.get(task, SYSTEM_PROMPTS["default"])

        user_message = prompt
        if context:
            context_lines = "\n".join(f"{k}: {v}" for k, v in context.items())
            user_message = f"Context:\n{context_lines}\n\nRequest:\n{prompt}"

        temperature = float(params.get("temperature", 0.8)) if params else 0.8
        max_tokens = int(params.get("max_tokens", 2048)) if params else 2048

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "stream": True,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
            **_extra_headers(),
        }

        chat_url = f"{base_url}/chat/completions"

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=15.0)) as client:
                async with client.stream("POST", chat_url, json=payload, headers=headers) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        raise RuntimeError(
                            f"OpenRouter returned HTTP {response.status_code}: {error_body.decode()[:500]}"
                        )

                    async for raw_line in response.aiter_lines():
                        if not raw_line.strip():
                            continue

                        line = raw_line.strip()
                        if line.startswith("data:"):
                            data_str = line[len("data:") :].strip()
                        else:
                            data_str = line

                        if data_str == "[DONE]":
                            yield LLMChunk(text="", is_final=True)
                            break

                        try:
                            data = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue

                        choices = data.get("choices") or []
                        if not choices:
                            continue

                        delta = choices[0].get("delta", {}) or {}
                        content = delta.get("content") or ""
                        finish_reason = choices[0].get("finish_reason")
                        is_done = finish_reason is not None

                        if content:
                            yield LLMChunk(text=content, is_final=is_done)
                        elif is_done:
                            yield LLMChunk(text="", is_final=True)

        except httpx.ConnectError:
            yield LLMChunk(
                text="\n\n[Story Muse Error: Cannot connect to OpenRouter. Check your network and base URL.]",
                is_final=True,
            )
        except httpx.ReadTimeout:
            yield LLMChunk(
                text="\n\n[Story Muse Error: OpenRouter response timeout.]",
                is_final=True,
            )
        except Exception as exc:
            yield LLMChunk(
                text=f"\n\n[Story Muse Error (OpenRouter): {exc}]",
                is_final=True,
            )
