"""
Apply user-edited FilmTimeline to produce a new master in final_cuts/ (Remotion or ffmpeg).
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from app.config import settings
from app.film_timeline_schema import FilmTimeline, validate_timeline_dict
from app.video_editor_tools import VideoEditorError, concat_clips, cut_clip

logger = logging.getLogger(__name__)

OutputKind = Literal["remotion", "ffmpeg"]


def _preview_src_to_rel(preview_src: str) -> str:
    prefix = "/api/outputs/"
    if not preview_src.startswith(prefix):
        raise ValueError(f"previewSrc must start with {prefix!r}, got {preview_src!r}")
    return preview_src[len(prefix) :].lstrip("/")


def clear_transition_on_last_sequence(tl: FilmTimeline) -> FilmTimeline:
    if not tl.sequences:
        return tl
    last = tl.sequences[-1]
    if last.transition_out is None:
        return tl
    seqs = list(tl.sequences)
    seqs[-1] = last.model_copy(update={"transition_out": None})
    return tl.model_copy(update={"sequences": seqs})


def apply_film_timeline(
    project_id: str,
    film_timeline_dict: dict[str, Any],
    output_kind: OutputKind,
) -> dict[str, Any]:
    """
    Validate timeline, normalize, render.

    Returns dict with status, outputPath (relative under outputs/), totalDuration, filmTimeline (JSON), error.
    """
    try:
        tl = validate_timeline_dict(film_timeline_dict)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Invalid film timeline: %s", exc)
        return {
            "status": "failed",
            "error": f"Invalid film timeline: {exc}",
        }

    tl = clear_transition_on_last_sequence(tl)
    if not tl.sequences:
        return {"status": "failed", "error": "Timeline has no sequences."}

    if output_kind == "remotion":
        try:
            from app.remotion_render import remotion_cli_available, run_remotion_render_safe

            if not remotion_cli_available():
                return {
                    "status": "failed",
                    "error": "npx not found on PATH; cannot run Remotion render.",
                }
            out_rel = run_remotion_render_safe(project_id, tl)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Remotion apply timeline failed")
            return {"status": "failed", "error": str(exc)}

        total_dur = sum(s.trim_end_sec - s.trim_start_sec for s in tl.sequences)
        return {
            "status": "completed",
            "outputPath": out_rel,
            "totalDuration": total_dur,
            "clipCount": len(tl.sequences),
            "filmTimeline": tl.model_dump_for_json(),
        }

    # ffmpeg: cut each window from previewSrc files, concat (hard cuts; transitionOut ignored).
    clip_rels: list[str] = []
    try:
        for seq in tl.sequences:
            rel_in = _preview_src_to_rel(seq.preview_src)
            trimmed = cut_clip(
                input_rel_path=rel_in,
                project_id=project_id,
                scene_id=seq.scene_id,
                start=seq.trim_start_sec,
                end=seq.trim_end_sec,
                reencode=False,
            )
            try:
                rel_trim = trimmed.path.relative_to(settings.outputs_path.resolve()).as_posix()
            except ValueError:
                rel_trim = trimmed.path.name
            clip_rels.append(rel_trim)

        info = concat_clips(
            clip_rel_paths=clip_rels,
            project_id=project_id,
            target_name=f"{project_id}_smart_edit",
            reencode=False,
        )
        try:
            out_rel = info.path.relative_to(settings.outputs_path.resolve()).as_posix()
        except ValueError:
            out_rel = info.path.name
    except VideoEditorError as exc:
        logger.warning("ffmpeg timeline apply failed: %s", exc)
        return {"status": "failed", "error": str(exc)}
    except Exception as exc:  # noqa: BLE001
        logger.exception("ffmpeg timeline apply failed")
        return {"status": "failed", "error": str(exc)}

    return {
        "status": "completed",
        "outputPath": out_rel,
        "totalDuration": info.duration,
        "clipCount": len(tl.sequences),
        "filmTimeline": tl.model_dump_for_json(),
    }
