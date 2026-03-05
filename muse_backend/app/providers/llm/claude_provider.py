"""
Story Muse — LLM Provider: Anthropic Claude
Streaming text generation using Anthropic's OpenAI-compatible API endpoint.

Requires: ANTHROPIC_API_KEY in .env
Uses the OpenAI SDK pointed at https://api.anthropic.com/v1/ — no extra dependency needed.

Docs: https://platform.claude.com/docs/en/api/openai-sdk
"""

from __future__ import annotations
from typing import Any, AsyncGenerator, Optional

from app.providers.base import LLMProvider, LLMChunk
from app.config import settings

DEFAULT_MODEL = "claude-sonnet-4-6"
CLAUDE_BASE_URL = "https://api.anthropic.com/v1/"

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
    "default": (
        "You are Story Muse, a creative AI assistant for filmmakers. "
        "Help with any aspect of film narrative, script writing, or story development."
    ),
}


class ClaudeProvider(LLMProvider):
    provider_id = "claude"
    display_name = "Anthropic Claude"
    provider_type = "api"

    def _api_key(self) -> str:
        return getattr(settings, "anthropic_api_key", "") or ""

    def is_available(self) -> bool:
        return bool(self._api_key())

    def unavailable_reason(self) -> Optional[str]:
        if not self.is_available():
            return "ANTHROPIC_API_KEY not set in .env file."
        return None

    def capabilities(self) -> dict[str, Any]:
        return {
            "models": ["claude-haiku-3-5", "claude-sonnet-4-6", "claude-opus-4-6"],
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
        """
        Streams LLMChunk objects from Claude via Anthropic's OpenAI-compatible endpoint.
        Uses the standard OpenAI SDK — just swap base_url and api_key.
        """
        if not self.is_available():
            yield LLMChunk(
                text="Error: ANTHROPIC_API_KEY not set in muse_backend/.env", is_final=True
            )
            return

        try:
            from openai import AsyncOpenAI

            model = params.get("claude_model") or DEFAULT_MODEL
            client = AsyncOpenAI(
                api_key=self._api_key(),
                base_url=CLAUDE_BASE_URL,
            )

            system_prompt = SYSTEM_PROMPTS.get(task, SYSTEM_PROMPTS["default"])

            user_message = prompt
            if context:
                context_str = "\n".join(f"{k}: {v}" for k, v in context.items())
                user_message = f"Context:\n{context_str}\n\nRequest:\n{prompt}"

            stream = await client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                max_tokens=params.get("max_tokens", settings.llm.max_tokens),
                temperature=min(params.get("temperature", settings.llm.temperature), 1.0),
                stream=True,
            )

            async for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                is_final = chunk.choices[0].finish_reason is not None
                if delta or is_final:
                    yield LLMChunk(text=delta, is_final=is_final)

        except Exception as exc:
            yield LLMChunk(text=f"\n\n[Claude error: {exc}]", is_final=True)
