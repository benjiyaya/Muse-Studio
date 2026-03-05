"""
Story Muse — LLM Provider: Ollama (Local)

Streams text generation from a locally-running Ollama instance.

Ollama must be installed and running:
  Windows: https://ollama.com/download
  Linux:   curl -fsSL https://ollama.com/install.sh | sh
  Start:   ollama serve
  Pull a model: ollama pull llama3.2  (or mistral, qwen2.5, gemma3, etc.)

Default endpoint: http://localhost:11434
Override via env:  OLLAMA_BASE_URL, OLLAMA_MODEL
Override per-call: pass 'ollama_base_url' / 'ollama_model' in params dict.
"""

from __future__ import annotations

import json
import os
from typing import Any, AsyncGenerator, Optional

from app.providers.base import LLMProvider, LLMChunk


# ── System prompts (same as OpenAI provider for task consistency) ─────────────

SYSTEM_PROMPTS: dict[str, str] = {
    "generate_storyline": (
        "You are Story Muse, a creative AI assistant specializing in film narrative development. "
        "Generate a rich, structured storyline outline. Return the result in this exact JSON format:\n"
        "{\n"
        '  "logline": "One-sentence logline",\n'
        '  "plotOutline": "2-3 paragraph plot outline",\n'
        '  "characters": ["Character 1 — description", "Character 2 — description"],\n'
        '  "themes": ["Theme 1", "Theme 2"],\n'
        '  "genre": "Genre"\n'
        "}\n"
        "Be cinematic, evocative, and precise. Return ONLY valid JSON, no markdown code blocks."
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

DEFAULT_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "llama3.2"


def _resolve_base_url(params: Optional[dict]) -> str:
    if params and params.get("ollama_base_url"):
        return str(params["ollama_base_url"]).rstrip("/")
    return os.getenv("OLLAMA_BASE_URL", DEFAULT_BASE_URL).rstrip("/")


def _resolve_model(params: Optional[dict]) -> str:
    if params and params.get("ollama_model"):
        return str(params["ollama_model"])
    return os.getenv("OLLAMA_MODEL", DEFAULT_MODEL)


class OllamaProvider(LLMProvider):
    provider_id = "ollama"
    display_name = "Ollama (Local)"
    provider_type = "local"

    def is_available(self) -> bool:
        """
        Synchronous connectivity check — tries to reach Ollama's /api/tags.
        Returns True if the server responds within 2 seconds.
        """
        import urllib.request
        import urllib.error
        base_url = _resolve_base_url(None)
        try:
            req = urllib.request.Request(
                f"{base_url}/api/tags",
                headers={"Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=2) as resp:
                return resp.status == 200
        except Exception:
            return False

    def unavailable_reason(self) -> Optional[str]:
        if not self.is_available():
            base_url = _resolve_base_url(None)
            return (
                f"Ollama server not reachable at {base_url}. "
                "Install Ollama (https://ollama.com/download) and run: ollama serve"
            )
        return None

    def capabilities(self) -> dict[str, Any]:
        models = self._list_models_sync()
        return {
            "models": models,
            "streaming": True,
            "local": True,
            "base_url": _resolve_base_url(None),
        }

    def _list_models_sync(self) -> list[str]:
        """Returns available model names from Ollama's /api/tags."""
        import urllib.request
        import urllib.error
        base_url = _resolve_base_url(None)
        try:
            req = urllib.request.Request(
                f"{base_url}/api/tags",
                headers={"Accept": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=3) as resp:
                data = json.loads(resp.read())
                return [m["name"] for m in data.get("models", [])]
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
        Streams tokens from Ollama's /api/chat endpoint.

        Uses the 'chat' endpoint (vs. 'generate') for better multi-turn support
        and consistent system prompt handling across model families.
        """
        import httpx

        base_url = _resolve_base_url(params)
        model = _resolve_model(params)
        system_prompt = SYSTEM_PROMPTS.get(task, SYSTEM_PROMPTS["default"])

        # Build user message, optionally enriched with context
        user_message = prompt
        if context:
            context_lines = "\n".join(f"{k}: {v}" for k, v in context.items())
            user_message = f"Context:\n{context_lines}\n\nRequest:\n{prompt}"

        temperature = float(params.get("temperature", 0.8)) if params else 0.8
        num_predict = int(params.get("max_tokens", 2048)) if params else 2048

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_message},
            ],
            "stream": True,
            "options": {
                "temperature": temperature,
                "num_predict": num_predict,
            },
        }

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=5.0)) as client:
                async with client.stream(
                    "POST",
                    f"{base_url}/api/chat",
                    json=payload,
                ) as response:
                    if response.status_code != 200:
                        error_body = await response.aread()
                        raise RuntimeError(
                            f"Ollama returned HTTP {response.status_code}: {error_body.decode()[:200]}"
                        )

                    async for raw_line in response.aiter_lines():
                        if not raw_line.strip():
                            continue
                        try:
                            data = json.loads(raw_line)
                        except json.JSONDecodeError:
                            continue

                        content = data.get("message", {}).get("content", "")
                        is_done = data.get("done", False)

                        if content:
                            yield LLMChunk(text=content, is_final=is_done)
                        elif is_done:
                            # Final empty chunk signals completion
                            yield LLMChunk(text="", is_final=True)

        except httpx.ConnectError:
            yield LLMChunk(
                text=(
                    f"\n\n[Story Muse Error: Cannot connect to Ollama at {base_url}. "
                    "Make sure Ollama is running: ollama serve]"
                ),
                is_final=True,
            )
        except httpx.ReadTimeout:
            yield LLMChunk(
                text="\n\n[Story Muse Error: Ollama response timeout. Try a smaller model or shorter prompt.]",
                is_final=True,
            )
        except Exception as exc:
            yield LLMChunk(
                text=f"\n\n[Story Muse Error: {exc}]",
                is_final=True,
            )


# ── Async helper for the /llm/models endpoint ─────────────────────────────────

async def list_ollama_models(base_url: str) -> list[dict[str, str]]:
    """
    Fetches the list of available models from a running Ollama instance.
    Returns a list of dicts: [{"name": "llama3.2", "size": "2.0 GB", ...}, ...]
    """
    import httpx
    clean_url = base_url.rstrip("/")
    async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
        response = await client.get(f"{clean_url}/api/tags")
        response.raise_for_status()
        data = response.json()

    models = []
    for m in data.get("models", []):
        size_bytes = m.get("size", 0)
        size_gb = f"{size_bytes / 1e9:.1f} GB" if size_bytes else "unknown"
        models.append({
            "name": m.get("name", ""),
            "size": size_gb,
            "modified_at": m.get("modified_at", ""),
        })

    return models


async def test_ollama_connection(base_url: str, model: str) -> dict[str, Any]:
    """
    Tests Ollama connectivity and optionally verifies a specific model is available.
    Returns {"ok": bool, "message": str, "models": list, "latency_ms": int}
    """
    import httpx
    import time

    clean_url = base_url.rstrip("/")
    start = time.monotonic()

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5.0)) as client:
            response = await client.get(f"{clean_url}/api/tags")
            response.raise_for_status()
            data = response.json()

        latency_ms = int((time.monotonic() - start) * 1000)
        available_models = [m["name"] for m in data.get("models", [])]

        if model and model not in available_models:
            # Check for partial match (e.g. "llama3.2" matches "llama3.2:latest")
            partial = next((m for m in available_models if m.startswith(model.split(":")[0])), None)
            if not partial:
                return {
                    "ok": False,
                    "message": (
                        f"Model '{model}' not found. "
                        f"Available: {', '.join(available_models[:5]) or 'none'}. "
                        f"Run: ollama pull {model}"
                    ),
                    "models": available_models,
                    "latency_ms": latency_ms,
                }

        return {
            "ok": True,
            "message": f"Connected to Ollama at {clean_url} ({latency_ms}ms). "
                       f"{len(available_models)} model(s) available.",
            "models": available_models,
            "latency_ms": latency_ms,
        }

    except httpx.ConnectError:
        return {
            "ok": False,
            "message": f"Cannot connect to Ollama at {clean_url}. Run: ollama serve",
            "models": [],
            "latency_ms": -1,
        }
    except Exception as exc:
        return {
            "ok": False,
            "message": f"Connection error: {exc}",
            "models": [],
            "latency_ms": -1,
        }
