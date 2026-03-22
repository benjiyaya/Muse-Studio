"""Parse Editor LLM JSON (segments + optional sceneTitle / transitionOut)."""

from __future__ import annotations

import json
from typing import Any

FADE_SEC_MIN = 0.05
FADE_SEC_MAX = 2.0


def normalize_transition_out(raw: Any) -> dict[str, Any] | None:
    """
    Coerce LLM transition output to a dict valid for FilmTimeline TransitionOut.
    Returns {"type": "cut", "durationSec": 0} for cuts; fade with duration in [FADE_SEC_MIN, FADE_SEC_MAX].
    """
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return {"type": "cut", "durationSec": 0.0}
    t = raw.get("type")
    if t is None:
        t = raw.get("Type")
    kind = str(t or "cut").strip().lower()
    if kind not in ("fade", "cut"):
        kind = "cut"
    dur_raw = raw.get("durationSec", raw.get("duration_sec", 0))
    try:
        dur = float(dur_raw)
    except (TypeError, ValueError):
        dur = 0.0
    if kind != "fade" or dur <= 0:
        return {"type": "cut", "durationSec": 0.0}
    dur = max(FADE_SEC_MIN, min(FADE_SEC_MAX, dur))
    return {"type": "fade", "durationSec": dur}


def parse_editor_payload(
    llm_content: str, duration_sec: float
) -> tuple[list[tuple[float, float]], dict[str, Any]]:
    """
    Parse LLM JSON: either a bare array of segments, or an object:
      { "segments": [...], "sceneTitle": "...", "transitionOut": {"type":"fade","durationSec":0.5} }
    """
    meta: dict[str, Any] = {}
    segments: list[tuple[float, float]] = []
    try:
        raw = json.loads(llm_content)
        if isinstance(raw, dict):
            inner = raw.get("segments")
            if isinstance(inner, list):
                if "sceneTitle" in raw:
                    meta["sceneTitle"] = raw["sceneTitle"]
                elif "scene_title" in raw:
                    meta["sceneTitle"] = raw["scene_title"]
                tr_raw = raw.get("transitionOut", raw.get("transition_out"))
                if tr_raw is not None:
                    meta["transitionOut"] = normalize_transition_out(tr_raw)
                raw_list = inner
            else:
                raw_list = []
        elif isinstance(raw, list):
            raw_list = raw
        else:
            return [], meta

        for item in raw_list:
            if not isinstance(item, dict):
                continue
            start = item.get("start")
            end = item.get("end")
            if start is None or end is None:
                continue
            try:
                s = float(start)
                e = float(end)
            except (TypeError, ValueError):
                continue
            if s < 0:
                s = 0.0
            if e > duration_sec:
                e = duration_sec
            if e <= s or (e - s) < 0.1:
                continue
            segments.append((s, e))
    except json.JSONDecodeError:
        return [], meta

    if not segments:
        return [], meta
    segments.sort(key=lambda x: x[0])
    return segments, meta
