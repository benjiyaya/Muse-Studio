"""
Supervisor graph: routes and invokes Story, Visual, and Motion Muse sub-agents.

Rule-based routing: given project state and goal, sets next_task to
storyline | script | script_longform | keyframe | video | done.
Script_longform is handled by the API layer (stream long-form scenes);
other nodes are stubs or call into providers.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from langgraph.graph import END, START, StateGraph
from langgraph.checkpoint.memory import MemorySaver

from app.agents.base import OrchestratorState
from app.agents.story_muse import run_story_muse
from app.agents.visual_muse import run_visual_muse
from app.agents.motion_muse import run_motion_muse

logger = logging.getLogger(__name__)

NextTask = Literal["storyline", "script", "script_longform", "keyframe", "video", "done"]


def _route_node(state: OrchestratorState) -> dict[str, Any]:
    """
    Set next_task from project state and goal.
    Rule-based: no storyline -> storyline; no scenes -> script/script_longform; etc.
    """
    project = state.get("project") or {}
    goal = state.get("goal") or "next_step"
    history = state.get("history") or []
    target_total = state.get("target_total")

    storyline = project.get("storyline") or {}
    plot_outline = storyline.get("plotOutline") or storyline.get("plot")
    storyline_confirmed = project.get("storylineConfirmed", False)
    scenes = project.get("scenes") or []

    # Has any scene a keyframe (draft image or video)?
    has_keyframes = any(
        s.get("draftImagePath") or s.get("keyframePath") or s.get("imagePath")
        for s in scenes
    )
    has_videos = any(bool(s.get("videoUrl")) for s in scenes)

    next_task: NextTask = "done"

    if not (plot_outline and storyline_confirmed):
        next_task = "storyline"
    elif len(scenes) == 0:
        next_task = "script_longform" if (target_total and target_total > 24) else "script"
    elif not has_keyframes:
        next_task = "keyframe"
    elif not has_videos:
        next_task = "video"

    # For next_step goal, only one step then done
    if goal == "next_step" and history:
        next_task = "done"

    return {"next_task": next_task, "current_phase": next_task if next_task != "done" else state.get("current_phase", "")}


def _story_muse_node(state: OrchestratorState) -> dict[str, Any]:
    """Story Muse: storyline/script. Calls story_muse module."""
    project = state.get("project") or {}
    result = run_story_muse("storyline", project, context=None)
    return {
        "history": (state.get("history") or []) + [{"task": "storyline", "result": result}],
    }


def _script_longform_node(state: OrchestratorState) -> dict[str, Any]:
    """
    Script long-form: record that we deferred to API. The API layer runs the
    long-form scene graph and streams when next_task is script_longform.
    """
    return {
        "history": (state.get("history") or []) + [
            {"task": "script_longform", "result": "deferred", "target_total": state.get("target_total")}
        ],
    }


def _visual_muse_node(state: OrchestratorState) -> dict[str, Any]:
    """Visual Muse: keyframe generation. Calls visual_muse module."""
    project = state.get("project") or {}
    result = run_visual_muse("keyframe", project, scene_id=None, context=None)
    return {
        "history": (state.get("history") or []) + [{"task": "keyframe", "result": result}],
    }


def _motion_muse_node(state: OrchestratorState) -> dict[str, Any]:
    """Motion Muse: video generation. Calls motion_muse module."""
    project = state.get("project") or {}
    result = run_motion_muse("video", project, scene_id=None, context=None)
    return {
        "history": (state.get("history") or []) + [{"task": "video", "result": result}],
    }


def _route_edges(state: OrchestratorState) -> str:
    """Conditional edge from route to the next node or END."""
    next_task = state.get("next_task") or "done"
    if next_task == "done":
        return "done"
    if next_task == "storyline":
        return "storyline"
    if next_task in ("script", "script_longform"):
        return "script_longform"
    if next_task == "keyframe":
        return "keyframe"
    if next_task == "video":
        return "video"
    return "done"


def build_supervisor_graph():
    """Build and compile the Supervisor graph."""
    graph = StateGraph(OrchestratorState)

    graph.add_node("route", _route_node)
    graph.add_node("storyline", _story_muse_node)
    graph.add_node("script_longform", _script_longform_node)
    graph.add_node("keyframe", _visual_muse_node)
    graph.add_node("video", _motion_muse_node)

    graph.add_edge(START, "route")
    graph.add_conditional_edges("route", _route_edges, {
        "done": END,
        "storyline": "storyline",
        "script_longform": "script_longform",
        "keyframe": "keyframe",
        "video": "video",
    })
    graph.add_edge("storyline", "route")
    graph.add_edge("script_longform", END)  # API streams longform; no loop
    graph.add_edge("keyframe", "route")
    graph.add_edge("video", "route")

    memory = MemorySaver()
    return graph.compile(checkpointer=memory)


def run_supervisor(
    project: dict[str, Any],
    goal: str = "next_step",
    target_total: int | None = None,
    thread_id: str = "default",
) -> dict[str, Any]:
    """
    Run the supervisor graph for one step (or until script_longform).
    Returns state after the step; if next_task was script_longform, the API
    should run the long-form scene stream separately.
    """
    compiled = build_supervisor_graph()
    initial: OrchestratorState = {
        "project": project,
        "goal": goal,
        "history": [],
        "target_total": target_total,
    }
    config = {"configurable": {"thread_id": thread_id}}
    final = None
    for event in compiled.stream(initial, config=config, stream_mode="values"):
        final = event
    return final or initial
