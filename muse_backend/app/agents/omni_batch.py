"""
Phase 3.5: Batch Omni jobs and cost/usage tracking.

- Queue multiple create/edit video jobs with rate limiting
- Log token and API usage per project for transparency
"""

from __future__ import annotations

import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class UsageRecord:
    """Single usage record for cost/usage tracking."""

    project_id: str
    provider_id: str
    job_type: str  # create_scene_video | edit_scene_video
    tokens_input: int = 0
    tokens_output: int = 0
    api_calls: int = 1
    timestamp: float = field(default_factory=time.time)


# In-memory usage log (replace with DB in production)
_usage_log: deque[UsageRecord] = deque(maxlen=10_000)


def log_usage(record: UsageRecord) -> None:
    """Log usage for cost/usage tracking. Phase 3.5."""
    _usage_log.append(record)
    logger.debug("Usage: %s", record)


def get_project_usage(project_id: str) -> list[dict[str, Any]]:
    """Return usage summary for a project. Phase 3.5."""
    records = [r for r in _usage_log if r.project_id == project_id]
    return [
        {
            "provider_id": r.provider_id,
            "job_type": r.job_type,
            "tokens_input": r.tokens_input,
            "tokens_output": r.tokens_output,
            "api_calls": r.api_calls,
            "timestamp": r.timestamp,
        }
        for r in records[-100:]  # Last 100
    ]


# Batch job queue (stub — full implementation with rate limiting in Phase 3.5)
_batch_queue: list[dict[str, Any]] = []


def enqueue_omni_job(
    project_id: str,
    scene_id: str,
    job_type: str,
    params: dict[str, Any],
) -> str:
    """
    Phase 3.5: Enqueue a video job for batch processing.
    Returns a batch job ID. Full implementation: process queue with rate limiting.
    """
    job_id = f"batch-{int(time.time() * 1000)}"
    _batch_queue.append({
        "job_id": job_id,
        "project_id": project_id,
        "scene_id": scene_id,
        "job_type": job_type,
        "params": params,
        "status": "queued",
        "created_at": time.time(),
    })
    return job_id


def get_batch_job_status(job_id: str) -> Optional[dict[str, Any]]:
    """Phase 3.5: Get status of a batch job."""
    for j in _batch_queue:
        if j.get("job_id") == job_id:
            return j
    return None
