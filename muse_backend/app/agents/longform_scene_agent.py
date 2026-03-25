"""
Long-form scene generation agent (LangGraph).

Generates scenes in batches with continuation context (e.g. scenes 1-24, then 25-48)
for 90-minute movie style flows. Streams scene payloads via callback; frontend persists.
"""

from __future__ import annotations

import logging
import re
import time
import uuid
from typing import Any, Callable, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import END, START, StateGraph

from app.agents.base import LongformSceneState
from app.agents.llm_bridge import get_chat_model, is_provider_available

logger = logging.getLogger(__name__)

BATCH_SIZE_DEFAULT = 24
MAX_TOTAL_DEFAULT = 120

# ── Scene block parser (port from Next.js) ─────────────────────────────────────

def _extract_field(block: str, field_name: str) -> str:
    """Match FIELD_NAME: value (multi-line until next UPPERCASE_FIELD: or end)."""
    pattern = rf"^{field_name}:\s*([\s\S]*?)(?=^[A-Z_]+:|$)"
    match = re.search(pattern, block, re.MULTILINE | re.IGNORECASE)
    return (match.group(1).strip() if match else "") or ""


def _parse_scene_block(block: str, fallback_number: int) -> Optional[dict[str, Any]]:
    """Parse a single <<<SCENE>>>...<<<END>>> block into a scene dict."""
    title = _extract_field(block, "TITLE")
    heading = _extract_field(block, "HEADING")
    description = _extract_field(block, "DESCRIPTION")
    if not title or not heading or not description:
        return None

    raw_num = _extract_field(block, "SCENE_NUM") or _extract_field(block, "NUMBER")
    scene_number = int(raw_num) if raw_num and raw_num.isdigit() else fallback_number
    dialogue = _extract_field(block, "DIALOGUE")
    technical_notes = _extract_field(block, "NOTES")

    return {
        "sceneNumber": scene_number,
        "title": title,
        "heading": heading,
        "description": description,
        "dialogue": dialogue or None,
        "technicalNotes": technical_notes or None,
    }


def _parse_scene_blocks(text: str, start_number: int) -> list[dict[str, Any]]:
    """Extract all <<<SCENE>>>...<<<END>>> blocks from LLM output."""
    scenes: list[dict[str, Any]] = []
    accumulated = text
    fallback = start_number

    while True:
        end_idx = accumulated.find("<<<END>>>")
        if end_idx == -1:
            break
        start_idx = accumulated.rfind("<<<SCENE>>>", 0, end_idx)
        if start_idx == -1:
            break
        block = accumulated[start_idx + 11 : end_idx].strip()
        accumulated = accumulated[end_idx + 9 :]

        parsed = _parse_scene_block(block, fallback)
        if parsed:
            scenes.append(parsed)
            fallback = parsed["sceneNumber"] + 1
    return scenes


# ── Prompts ────────────────────────────────────────────────────────────────────

def _build_system_prompt(batch_size: int) -> str:
    n = max(1, batch_size)
    return f"""You are Story Muse, a professional screenplay writer.

Given a film storyline (and optionally "Scenes so far"), generate approximately {n} scene scripts that faithfully adapt the story arc.

CRITICAL: Format each scene using EXACTLY this structure. Use <<<SCENE>>> and <<<END>>> as delimiters — nothing else:

<<<SCENE>>>
SCENE_NUM: 1
TITLE: The exact scene title
HEADING: INT./EXT. LOCATION NAME — TIME OF DAY
DESCRIPTION: 2–4 sentences of vivid visual description — what happens, atmosphere, character actions, emotional beats.
DIALOGUE: CHARACTER_NAME: (optional stage direction) Dialogue line.
ANOTHER_CHARACTER: Response line.
NOTES: Brief cinematography / lighting / technical notes.
<<<END>>>

You must generate AT LEAST {max(1, n - 1)} scenes and AT MOST {n + 2} scenes. Do NOT add any text or commentary outside the <<<SCENE>>> blocks."""


def _build_user_message(
    storyline: dict[str, Any],
    existing_scenes: list[dict[str, Any]],
    start_num: int,
    end_num: int,
) -> str:
    """Build user message: storyline + optional "Scenes so far" + instruction for this batch."""
    logline = storyline.get("logline") or ""
    plot = storyline.get("plotOutline") or storyline.get("plot") or ""
    characters = storyline.get("characters") or []
    themes = storyline.get("themes") or []
    genre = storyline.get("genre") or ""

    parts = [
        "PROJECT STORYLINE",
        f"LOGLINE: {logline}" if logline else "",
        f"PLOT OUTLINE:\n{plot}",
        "CHARACTERS:\n" + "\n".join(f"- {c}" for c in characters) if characters else "",
        f"THEMES: {', '.join(themes)}" if themes else "",
        f"GENRE: {genre}" if genre else "",
    ]
    parts = [p for p in parts if p]

    if existing_scenes:
        summary_lines = []
        for s in existing_scenes[-10:]:  # last 10 scenes as context
            summary_lines.append(
                f"Scene {s.get('sceneNumber', '?')}: {s.get('title', '')} — {str(s.get('description', ''))[:150]}..."
            )
        parts.append("SCENES SO FAR (for continuity):\n" + "\n".join(summary_lines))

    parts.append(
        f"Generate scenes {start_num} through {end_num} (approximately {end_num - start_num + 1} scenes). "
        "Number them correctly with SCENE_NUM. Continue the story from where the previous scenes left off."
    )
    return "\n\n".join(parts)


def _new_scene_id() -> str:
    return f"scene-{int(time.time() * 1000):x}-{uuid.uuid4().hex[:6]}"


# ── Graph node ─────────────────────────────────────────────────────────────────

def generate_batch_node(state: LongformSceneState) -> dict[str, Any]:
    """
    Generate one batch of scenes; append to all_generated_scenes.
    Uses continuation context when existing_scenes is non-empty.
    """
    if state.get("error"):
        return {"error": state["error"]}

    project_id = state["project_id"]
    storyline = state["storyline"]
    existing = state.get("existing_scenes") or []
    all_scenes = list(state.get("all_generated_scenes") or [])
    target_total = state.get("target_total") or BATCH_SIZE_DEFAULT
    batch_size = state.get("batch_size") or BATCH_SIZE_DEFAULT
    batch_index = state.get("batch_index") or 0
    stream_callback = state.get("stream_callback")

    start_num = len(existing) + len(all_scenes) + 1
    end_num = min(start_num + batch_size - 1, target_total)
    actual_batch_size = end_num - start_num + 1

    if actual_batch_size <= 0:
        return {"batch_index": batch_index + 1}

    try:
        llm = get_chat_model(
            provider_id=state.get("provider_id"),
            model=state.get("llm_model"),
            temperature=0.75,
            max_tokens=min(32000, max(3000, 500 * actual_batch_size)),
        )
        system_prompt = _build_system_prompt(actual_batch_size)
        user_message = _build_user_message(storyline, existing + all_scenes, start_num, end_num)

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_message),
        ]
        response = llm.invoke(messages)
        content = response.content if hasattr(response, "content") else str(response)

        parsed = _parse_scene_blocks(content, start_num)
        for p in parsed:
            scene_id = _new_scene_id()
            scene_payload = {
                "sceneId": scene_id,
                "sceneNumber": p["sceneNumber"],
                "title": p["title"],
                "heading": p["heading"],
                "description": p["description"],
                "dialogue": p.get("dialogue"),
                "technicalNotes": p.get("technicalNotes"),
            }
            all_scenes.append({**p, "sceneId": scene_id})
            if callable(stream_callback):
                try:
                    stream_callback("scene", scene_payload)
                except Exception as cb_err:
                    logger.warning("stream_callback(scene) failed: %s", cb_err)
        if callable(stream_callback) and parsed:
            try:
                stream_callback("batch_done", {"batch_index": batch_index + 1, "count": len(parsed)})
            except Exception:
                pass

        return {
            "all_generated_scenes": all_scenes,
            "batch_index": batch_index + 1,
        }
    except Exception as e:
        logger.exception("longform generate_batch failed")
        if callable(stream_callback):
            try:
                stream_callback("error", {"message": str(e)})
            except Exception:
                pass
        return {"error": str(e)}


def _should_continue(state: LongformSceneState) -> str:
    """Route: continue to generate_batch or END."""
    if state.get("error"):
        return "end"
    all_scenes = state.get("all_generated_scenes") or []
    target = state.get("target_total") or BATCH_SIZE_DEFAULT
    if len(all_scenes) >= target:
        return "end"
    return "generate_batch"


# ── Graph build ────────────────────────────────────────────────────────────────

def _build_graph():
    graph = StateGraph(LongformSceneState)
    graph.add_node("generate_batch", generate_batch_node)
    graph.add_edge(START, "generate_batch")
    graph.add_conditional_edges("generate_batch", _should_continue, {"generate_batch": "generate_batch", "end": END})
    return graph.compile()


_compiled_graph = None


def get_longform_graph():
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = _build_graph()
    return _compiled_graph


# ── Public API ─────────────────────────────────────────────────────────────────

def run_longform_scene_graph(
    project_id: str,
    storyline: dict[str, Any],
    target_total: int,
    batch_size: int = BATCH_SIZE_DEFAULT,
    existing_scenes: Optional[list[dict[str, Any]]] = None,
    stream_callback: Optional[Callable[[str, dict], None]] = None,
    provider_id: Optional[str] = None,
    llm_model: Optional[str] = None,
) -> dict[str, Any]:
    """
    Run the long-form scene generation graph.
    Does not write to DB; stream_callback is called for each scene and on batch_done/error.
    Returns final state (all_generated_scenes, error, etc.).
    """
    if not is_provider_available(provider_id):
        if callable(stream_callback):
            try:
                stream_callback("error", {"message": "No LLM provider available."})
            except Exception:
                pass
        return {"error": "No LLM provider available.", "all_generated_scenes": []}

    initial: LongformSceneState = {
        "project_id": project_id,
        "storyline": storyline,
        "existing_scenes": existing_scenes or [],
        "target_total": min(target_total, MAX_TOTAL_DEFAULT),
        "batch_size": min(batch_size, BATCH_SIZE_DEFAULT),
        "batch_index": 0,
        "all_generated_scenes": [],
        "stream_callback": stream_callback,
        "provider_id": provider_id,
        "llm_model": llm_model,
    }

    try:
        compiled = get_longform_graph()
        result = compiled.invoke(initial)
        return dict(result)
    except Exception as e:
        logger.exception("longform graph invoke failed")
        if callable(stream_callback):
            try:
                stream_callback("error", {"message": str(e)})
            except Exception:
                pass
        return {"error": str(e), "all_generated_scenes": initial.get("all_generated_scenes") or []}
