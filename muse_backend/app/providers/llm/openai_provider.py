"""
Story Muse — LLM Provider: OpenAI
Streaming text generation for storyline, scene scripts, and dialogue.

Requires: OPENAI_API_KEY in .env
Supports any OpenAI model (gpt-4o, gpt-4o-mini, gpt-5.0, gpt-5.2, etc.)
via the `openai_model` param passed per-request from the frontend settings.
"""

from __future__ import annotations
from typing import Any, AsyncGenerator, Optional

from app.providers.base import LLMProvider, LLMChunk
from app.config import settings

DEFAULT_MODEL = "gpt-4o"

# Prompt templates for each Story Muse task
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


class OpenAIProvider(LLMProvider):
    provider_id = "openai"
    display_name = "OpenAI"
    provider_type = "api"

    def is_available(self) -> bool:
        return bool(settings.openai_api_key)

    def unavailable_reason(self) -> Optional[str]:
        if not self.is_available():
            return "OPENAI_API_KEY not set in .env file."
        return None

    def capabilities(self) -> dict[str, Any]:
        return {
            "models": ["gpt-4o", "gpt-4o-mini", "gpt-5.0", "gpt-5.2"],
            "streaming": True,
            "max_context_tokens": 128000,
        }

    async def generate_stream(
        self,
        task: str,
        prompt: str,
        context: Optional[dict[str, Any]],
        params: dict[str, Any],
    ) -> AsyncGenerator[LLMChunk, None]:
        """
        Streams LLMChunk objects from OpenAI.
        The model is chosen per-request via params["openai_model"], falling back to DEFAULT_MODEL.
        """
        if not self.is_available():
            yield LLMChunk(text="Error: OPENAI_API_KEY not set in muse_backend/.env", is_final=True)
            return

        try:
            from openai import AsyncOpenAI

            model = params.get("openai_model") or DEFAULT_MODEL
            client = AsyncOpenAI(api_key=settings.openai_api_key)
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
                temperature=params.get("temperature", settings.llm.temperature),
                stream=True,
            )

            async for chunk in stream:
                delta = chunk.choices[0].delta.content or ""
                is_final = chunk.choices[0].finish_reason is not None
                if delta or is_final:
                    yield LLMChunk(text=delta, is_final=is_final)

        except Exception as exc:
            yield LLMChunk(text=f"\n\n[OpenAI error: {exc}]", is_final=True)
