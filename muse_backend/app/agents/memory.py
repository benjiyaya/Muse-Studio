"""
Agent memory system — short-term, project, user, and workflow memory.

Uses LangGraph's MemorySaver for checkpointing. Custom stores for project/user context.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# In-memory stores for Phase 1.5 — can be replaced with SQLite/Redis later.
_project_memory: dict[str, list[dict[str, Any]]] = {}
_user_memory: dict[str, dict[str, Any]] = {}


def get_project_memory(project_id: str) -> list[dict[str, Any]]:
    """Retrieve past suggestions and feedback for a project."""
    return _project_memory.get(project_id, [])


def add_project_memory(project_id: str, entry: dict[str, Any]) -> None:
    """Append a suggestion or user action to project memory."""
    if project_id not in _project_memory:
        _project_memory[project_id] = []
    _project_memory[project_id].append(entry)
    # Keep last 50 entries
    if len(_project_memory[project_id]) > 50:
        _project_memory[project_id] = _project_memory[project_id][-50:]


def get_user_memory(user_id: Optional[str] = None) -> dict[str, Any]:
    """Retrieve cross-project user preferences."""
    if not user_id:
        return {}
    return _user_memory.get(user_id, {})


def set_user_memory(user_id: str, key: str, value: Any) -> None:
    """Store a user preference."""
    if user_id not in _user_memory:
        _user_memory[user_id] = {}
    _user_memory[user_id][key] = value


def get_workflow_checkpointer():
    """
    Return a LangGraph checkpointer for resuming interrupted workflows.
    Uses MemorySaver for in-process persistence.
    """
    try:
        from langgraph.checkpoint.memory import MemorySaver
        return MemorySaver()
    except ImportError:
        logger.warning("LangGraph MemorySaver not available")
        return None
