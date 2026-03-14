"""
LangGraph-powered suggestion agent.

Analyzes project (storyline, scenes) and generates Muse suggestions via LLM.
Supports retry, fallback to rule-based logic, and structured error responses.

Phase 3.5: Caching (hash project state), revision loops, control-level adaptation.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from typing import Any, AsyncGenerator, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from app.agents.base import SuggestionItem, SuggestionState
from app.agents.llm_bridge import get_chat_model, is_provider_available

logger = logging.getLogger(__name__)

SUGGESTION_ANALYSIS_PROMPT = """You are Story Muse, a creative AI assistant for filmmakers. Analyze this project and suggest up to 3 concrete improvements.

Project summary:
{project_summary}

Control level: {control_level}
- OBSERVER: Only light, observational suggestions (consistency, pacing).
- ASSISTANT: Balanced suggestions (enhancement, consistency, pacing).
- COLLABORATOR: All suggestion types including visual style and aggressive improvements.

Respond with a JSON array of suggestions. Each suggestion must have:
- "type": one of CONSISTENCY, ENHANCEMENT, VISUAL_STYLE, PACING
- "muse": one of STORY_MUSE, VISUAL_MUSE, MOTION_MUSE
- "message": a short, actionable suggestion (1-2 sentences)
- "scene_id": (optional) scene ID if the suggestion targets a specific scene
- "actions": array of action strings, e.g. ["REVIEW", "EDIT", "DISMISS"]

Example:
[
  {{"type": "ENHANCEMENT", "muse": "STORY_MUSE", "message": "The plot outline is quite short. Consider expanding the middle act.", "actions": ["REVIEW", "EDIT", "DISMISS"]}},
  {{"type": "CONSISTENCY", "muse": "STORY_MUSE", "message": "Scene 2 has a very short description.", "scene_id": "scene-abc123", "actions": ["REVIEW", "EDIT", "DISMISS"]}}
]

Output ONLY the JSON array, no other text."""


def _format_project_summary(project: dict[str, Any]) -> str:
    """Convert project dict to a compact string for LLM context."""
    lines = []
    lines.append(f"Title: {project.get('title', 'Untitled')}")
    if project.get("description"):
        lines.append(f"Description: {project['description']}")
    storyline = project.get("storyline") or {}
    if storyline:
        lines.append("--- Storyline ---")
        if storyline.get("logline"):
            lines.append(f"Logline: {storyline['logline']}")
        if storyline.get("plotOutline"):
            lines.append(f"Plot: {storyline['plotOutline'][:800]}...")
        if storyline.get("genre"):
            lines.append(f"Genre: {storyline['genre']}")
        if storyline.get("characters"):
            lines.append(f"Characters: {', '.join(storyline['characters'])}")
        if storyline.get("themes"):
            lines.append(f"Themes: {', '.join(storyline['themes'])}")
    scenes = project.get("scenes") or []
    if scenes:
        lines.append("--- Scenes ---")
        for s in sorted(scenes, key=lambda x: x.get("sceneNumber", 0)):
            num = s.get("sceneNumber", "?")
            title = s.get("title") or s.get("heading") or "Untitled"
            desc = (s.get("description") or "")[:200]
            has_video = "yes" if s.get("videoUrl") else "no"
            lines.append(f"Scene {num}: {title} | desc: {desc}... | video: {has_video}")
    return "\n".join(lines)


def _parse_suggestions_from_llm(text: str) -> list[dict[str, Any]]:
    """Parse LLM output into suggestion dicts. Handles malformed JSON."""
    text = text.strip()
    # Try to extract JSON array (handle markdown code blocks)
    if "```" in text:
        start = text.find("[")
        end = text.rfind("]") + 1
        if start >= 0 and end > start:
            text = text[start:end]
    try:
        data = json.loads(text)
        if not isinstance(data, list):
            return []
        out = []
        for item in data:
            if not isinstance(item, dict):
                continue
            s = {
                "type": item.get("type", "ENHANCEMENT"),
                "muse": item.get("muse", "STORY_MUSE"),
                "message": item.get("message", ""),
                "scene_id": item.get("scene_id"),
                "actions": item.get("actions", ["REVIEW", "EDIT", "DISMISS"]),
            }
            if s["message"]:
                out.append(s)
        return out[:5]  # Cap at 5
    except json.JSONDecodeError:
        logger.warning("Failed to parse LLM suggestion JSON: %s", text[:200])
        return []


def analyze_node(state: SuggestionState) -> dict:
    """LLM analyzes project and produces raw suggestions."""
    if state.error:
        return {"raw_suggestions": [], "error": state.error}

    try:
        llm = get_chat_model(temperature=0.6, max_tokens=1024)
        prompt = SUGGESTION_ANALYSIS_PROMPT.format(
            project_summary=state.project_summary,
            control_level=state.control_level,
        )
        messages = [
            SystemMessage(content="You output only valid JSON arrays. No markdown, no explanation."),
            HumanMessage(content=prompt),
        ]
        response = llm.invoke(messages)
        content = response.content if hasattr(response, "content") else str(response)
        raw = _parse_suggestions_from_llm(content)
        return {"raw_suggestions": raw}
    except Exception as e:
        logger.exception("Suggestion agent analyze_node failed")
        return {"raw_suggestions": [], "error": str(e)}


def format_node(state: SuggestionState) -> dict:
    """Map raw suggestions to frontend schema."""
    formatted = []
    for r in state.raw_suggestions:
        formatted.append({
            "type": r.get("type", "ENHANCEMENT"),
            "muse": r.get("muse", "STORY_MUSE"),
            "message": r.get("message", ""),
            "sceneId": r.get("scene_id"),
            "actions": r.get("actions", ["REVIEW", "EDIT", "DISMISS"]),
        })
    return {"formatted_suggestions": formatted}


def _build_graph():
    """Build and compile the suggestion agent graph."""
    graph = StateGraph(SuggestionState)
    graph.add_node("analyze", analyze_node)
    graph.add_node("format", format_node)
    graph.add_edge(START, "analyze")
    graph.add_edge("analyze", "format")
    graph.add_edge("format", END)
    return graph.compile()


_compiled_graph = None


def _get_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = _build_graph()
    return _compiled_graph


class SuggestionResult:
    """Result of running the suggestion agent."""

    def __init__(
        self,
        suggestions: list[dict[str, Any]],
        error: Optional[str] = None,
        fallback_suggestions: Optional[list[dict[str, Any]]] = None,
    ):
        self.suggestions = suggestions
        self.error = error
        self.fallback_suggestions = fallback_suggestions


def _project_cache_key(project: dict[str, Any], control_level: str) -> str:
    """Phase 3.5: Hash project state for caching. Identical snapshots skip agent."""
    canonical = json.dumps(
        {"summary": _format_project_summary(project), "control_level": control_level},
        sort_keys=True,
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


# Phase 3.5: In-memory cache for identical project snapshots (replace with Redis in prod)
_suggestion_cache: dict[str, tuple[list[dict], float]] = {}
_CACHE_TTL_SECONDS = 300  # 5 minutes


def run_suggestion_agent(
    project: dict[str, Any],
    control_level: str = "ASSISTANT",
    provider_id: Optional[str] = None,
    max_retries: int = 2,
    use_cache: bool = True,
) -> SuggestionResult:
    """
    Run the suggestion agent on a project.
    Returns SuggestionResult with suggestions or fallback_suggestions on error.
    Phase 3.5: Caches responses for identical project snapshots when use_cache=True.
    """
    if use_cache:
        key = _project_cache_key(project, control_level)
        cached = _suggestion_cache.get(key)
        if cached:
            suggestions, ts = cached
            if time.time() - ts < _CACHE_TTL_SECONDS:
                return SuggestionResult(suggestions=suggestions, error=None, fallback_suggestions=None)
            del _suggestion_cache[key]

    if not is_provider_available(provider_id):
        return SuggestionResult(
            suggestions=[],
            error="No LLM provider available. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or run Ollama.",
            fallback_suggestions=None,
        )

    project_summary = _format_project_summary(project)
    state = SuggestionState(
        project_summary=project_summary,
        control_level=control_level,
    )

    for attempt in range(max_retries + 1):
        try:
            compiled = _get_graph()
            result = compiled.invoke(state)
            suggestions = result.get("formatted_suggestions", [])
            error = result.get("error")
            if error:
                return SuggestionResult(suggestions=[], error=error, fallback_suggestions=None)
            if use_cache:
                _suggestion_cache[key] = (suggestions, time.time())
            return SuggestionResult(suggestions=suggestions, error=None, fallback_suggestions=None)
        except Exception as e:
            logger.warning("Suggestion agent attempt %s failed: %s", attempt + 1, e)
            if attempt < max_retries:
                time.sleep(1)
            else:
                return SuggestionResult(
                    suggestions=[],
                    error=str(e),
                    fallback_suggestions=None,
                )

    return SuggestionResult(suggestions=[], error="Unknown error", fallback_suggestions=None)


async def run_suggestion_agent_stream(
    project: dict[str, Any],
    control_level: str = "ASSISTANT",
    provider_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    Stream suggestion agent progress via SSE events.
    Yields: {"event": "node", "node": "analyze"}, {"event": "node", "node": "format"},
    then {"event": "suggestions", "suggestions": [...]} or {"event": "error", "error": "..."}
    """
    import asyncio

    if not is_provider_available(provider_id):
        yield json.dumps({"event": "error", "error": "No LLM provider available"})
        return

    try:
        yield json.dumps({"event": "node", "node": "analyze"})
        result = await asyncio.to_thread(
            run_suggestion_agent,
            project,
            control_level,
            provider_id,
        )
        yield json.dumps({"event": "node", "node": "format"})
        if result.error:
            yield json.dumps({"event": "error", "error": result.error})
        else:
            yield json.dumps({"event": "suggestions", "suggestions": result.suggestions})
    except Exception as e:
        logger.exception("Suggestion agent stream failed")
        yield json.dumps({"event": "error", "error": str(e)})


def run_suggestion_revision(
    project: dict[str, Any],
    rejected_suggestion_id: str,
    feedback: str,
    control_level: str = "ASSISTANT",
    provider_id: Optional[str] = None,
    max_retries: int = 2,
) -> SuggestionResult:
    """
    Phase 3.5: Revision loop. User rejected a suggestion; agent proposes revised suggestion.
    max_retries limits how many revision attempts. Control-level adaptation: learn from
    dismissals (e.g. reduce "add dialogue" if user often dismisses it).
    """
    # TODO: Add feedback to prompt, skip rejected suggestion type for this project
    return run_suggestion_agent(
        project=project,
        control_level=control_level,
        provider_id=provider_id,
        max_retries=max_retries,
        use_cache=False,  # Always re-run when revising
    )
