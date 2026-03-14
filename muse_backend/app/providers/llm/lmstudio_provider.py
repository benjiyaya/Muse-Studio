"""
Story Muse — LLM Provider: LM Studio (Local)

Streams text generation from a locally-running LM Studio server using the
OpenAI-compatible `/v1/chat/completions` endpoint.

LM Studio docs: see https://lmstudio.ai/docs/developer/api-changelog and the
OpenAI-compatible API section in the developer docs.

Defaults:
  - Base URL: http://127.0.0.1:1234
  - Model:    the first available model from /v1/models, or "gpt-4o-mini"

You can override via environment variables:
  - LMSTUDIO_BASE_URL
  - LMSTUDIO_MODEL
  - LMSTUDIO_API_KEY  (optional API token, if auth is enabled)

Or per-call parameters:
  - lmstudio_base_url
  - lmstudio_model
"""

from __future__ import annotations

import json
import os
from typing import Any, AsyncGenerator, Optional

from app.providers.base import LLMProvider, LLMChunk


# ── System prompts (aligned with OpenAI provider for consistency) ───────────────

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


DEFAULT_BASE_URL = "http://localhost:1234"
DEFAULT_FALLBACK_MODEL = "gpt-4o-mini"


def _resolve_base_url(params: Optional[dict]) -> str:
    if params:
        if params.get("lmstudio_base_url"):
            return str(params["lmstudio_base_url"]).rstrip("/")
        # Fallback: allow reuse of a generic "base_url" param if provided
        if params.get("base_url"):
            return str(params["base_url"]).rstrip("/")
    return os.getenv("LMSTUDIO_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def _resolve_model(params: Optional[dict]) -> str:
    if params:
        if params.get("lmstudio_model"):
            return str(params["lmstudio_model"])
        # Also honor openai_model when LM Studio is used as an OpenAI-compatible server
        if params.get("openai_model"):
            return str(params["openai_model"])
    env_model = os.getenv("LMSTUDIO_MODEL")
    if env_model:
        return env_model
    # Fallback when no explicit model: let LM Studio decide or use a common default
    return DEFAULT_FALLBACK_MODEL


def _auth_headers() -> dict[str, str]:
    api_key = os.getenv("LMSTUDIO_API_KEY")
    if not api_key:
        return {}
    return {"Authorization": f"Bearer {api_key}"}


class LMStudioProvider(LLMProvider):
    provider_id = "lmstudio"
    display_name = "LM Studio (Local)"
    provider_type = "local"

    def is_available(self) -> bool:
        """
        Synchronous connectivity check — tries to reach LM Studio's /v1/models.
        Returns True if the server responds within 2 seconds.
        """
        import urllib.request
        import urllib.error

        base_url = _resolve_base_url(None)
        try:
            req = urllib.request.Request(
                f"{base_url}/v1/models",
                headers={"Accept": "application/json", **_auth_headers()},
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                return resp.status == 200
        except Exception:
            return False

    def unavailable_reason(self) -> Optional[str]:
        if not self.is_available():
            base_url = _resolve_base_url(None)
            return (
                f"LM Studio server not reachable at {base_url}. "
                "Start LM Studio with the local server enabled (OpenAI-compatible API)."
            )
        return None

    def capabilities(self) -> dict[str, Any]:
        models = self._list_models_sync()
        return {
            "models": models or [DEFAULT_FALLBACK_MODEL],
            "streaming": True,
            "local": True,
            "base_url": _resolve_base_url(None),
        }

    def _list_models_sync(self) -> list[str]:
        """Returns available model ids from LM Studio's /v1/models."""
        import urllib.request
        import urllib.error

        base_url = _resolve_base_url(None)
        try:
            req = urllib.request.Request(
                f"{base_url}/v1/models",
                headers={"Accept": "application/json", **_auth_headers()},
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read())
                return [m["id"] for m in data.get("data", []) if m.get("id")]
        except Exception:
            return []

    async def generate_stream(
        self,
        task: str,
        prompt: str,
        context: Optional[dict[str, Any]],
        params: dict[str, Any],
    ) -> AsyncGenerator[LLMChunk, None]:
        """
        Streams tokens from LM Studio's OpenAI-compatible /v1/chat/completions endpoint.
        """
        import httpx

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
            **_auth_headers(),
        }

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=5.0)) as client:
                async with client.stream(
                    "POST",
                    f"{base_url}/v1/chat/completions",
                    json=payload,
                    headers=headers,
                ) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        raise RuntimeError(
                            f"LM Studio returned HTTP {response.status_code}: {error_body.decode()[:200]}"
                        )

                    async for raw_line in response.aiter_lines():
                        if not raw_line.strip():
                            continue

                        line = raw_line.strip()
                        # OpenAI-compatible streaming uses SSE: lines start with "data: ..."
                        if line.startswith("data:"):
                            data_str = line[len("data:") :].strip()
                        else:
                            data_str = line

                        if data_str == "[DONE]":
                            # Explicit stream end
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
                text=(
                    f"\n\n[Story Muse Error: Cannot connect to LM Studio at {base_url}. "
                    "Make sure the LM Studio local server is running with the OpenAI-compatible API enabled.]"
                ),
                is_final=True,
            )
        except httpx.ReadTimeout:
            yield LLMChunk(
                text="\n\n[Story Muse Error: LM Studio response timeout. Try a smaller model or shorter prompt.]",
                is_final=True,
            )
        except Exception as exc:
            yield LLMChunk(
                text=f"\n\n[Story Muse Error (LM Studio): {exc}]",
                is_final=True,
            )

