from __future__ import annotations

"""
Low-level video editing utilities for the Video Editor Agent.

These functions wrap ffmpeg / ffprobe and operate strictly on files under
`settings.outputs_path`. They are intentionally stateless and deterministic so
that higher-level agents (Director / Editor) can call them as tools.

NOTE: These are Python helpers only. HTTP/Job wrappers can be added in a
separate router module (e.g. app/api/routes/editor.py) when needed.
"""

import json
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Literal

from app.config import settings

logger = logging.getLogger(__name__)


OUTPUTS_ROOT = settings.outputs_path

try:  # Optional dependency for local ASR (onnx-asr + ONNX Whisper)
    import onnx_asr  # type: ignore[import]
except ImportError:  # pragma: no cover - handled at runtime
    onnx_asr = None  # type: ignore[assignment]

_ASR_MODEL: Any | None = None


class VideoEditorError(RuntimeError):
    """Raised when a video editing tool fails."""


@dataclass
class SceneVideoInfo:
    scene_id: str
    path: Path
    duration: float
    width: int
    height: int
    fps: float
    codec: str


@dataclass
class TrimmedClipInfo:
    project_id: str
    scene_id: str
    path: Path
    start: float
    end: float
    duration: float


@dataclass
class ConcatenatedClipInfo:
    project_id: str
    path: Path
    duration: float
    clip_count: int


def _get_asr_model() -> Any:
    """
    Lazy-load the ONNX ASR model used by transcribe_video.

    The model identifier can be overridden via the MUSE_ASR_MODEL_ID environment
    variable; by default it loads \"OpenVoiceOS/whisper-small-pt-onnx\".
    """
    global _ASR_MODEL  # noqa: PLW0603

    if onnx_asr is None:
        raise VideoEditorError(
            "onnx-asr is not installed; cannot run transcribe_video. "
            "Install onnx-asr and an ONNX Whisper model (e.g. OpenVoiceOS/whisper-small-pt-onnx)."
        )

    if _ASR_MODEL is None:
        model_id = os.getenv("MUSE_ASR_MODEL_ID", "OpenVoiceOS/whisper-small-pt-onnx")
        logger.info("Loading ASR model via onnx_asr: %s", model_id)
        try:
            _ASR_MODEL = onnx_asr.load_model(model_id)
        except Exception as exc:  # noqa: BLE001
            raise VideoEditorError(f"Failed to load ASR model '{model_id}': {exc}") from exc

    return _ASR_MODEL


def _ensure_under_outputs(path: Path) -> Path:
    """Normalize and verify that a path stays within the outputs root."""
    path = path.resolve()
    if not str(path).startswith(str(OUTPUTS_ROOT)):
        raise VideoEditorError(f"Path {path} is outside outputs root {OUTPUTS_ROOT}")
    return path


def _run_command(args: list[str]) -> None:
    """Run a subprocess command, logging on failure."""
    logger.debug("Running command: %s", " ".join(args))
    try:
        completed = subprocess.run(
            args,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:  # e.g. ffmpeg not found
        raise VideoEditorError(f"Failed to execute command {args[0]}: {exc}") from exc

    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace")
        raise VideoEditorError(
            f"Command {args[0]} failed with exit code {completed.returncode}: {stderr[:4000]}"
        )


def _run_ffprobe(video_path: Path) -> dict[str, Any]:
    """Return basic metadata for a video file using ffprobe."""
    video_path = _ensure_under_outputs(video_path)
    if not video_path.exists():
        raise VideoEditorError(f"Video file does not exist: {video_path}")

    args = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate,codec_name",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(video_path),
    ]

    logger.debug("Probing video with ffprobe: %s", video_path)
    try:
        completed = subprocess.run(
            args,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        raise VideoEditorError(f"Failed to execute ffprobe: {exc}") from exc

    if completed.returncode != 0:
        stderr = completed.stderr.decode("utf-8", errors="replace")
        raise VideoEditorError(f"ffprobe failed for {video_path}: {stderr[:4000]}")

    try:
        data = json.loads(completed.stdout.decode("utf-8", errors="replace"))
    except json.JSONDecodeError as exc:
        raise VideoEditorError(f"Invalid ffprobe JSON for {video_path}") from exc

    return data


def _parse_ffprobe_info(scene_id: str, video_path: Path, data: dict[str, Any]) -> SceneVideoInfo:
    """Convert ffprobe JSON to SceneVideoInfo."""
    streams = data.get("streams") or []
    if not streams:
        raise VideoEditorError(f"No video streams found for {video_path}")
    stream = streams[0]
    format_info = data.get("format") or {}

    width = int(stream.get("width") or 0)
    height = int(stream.get("height") or 0)

    # r_frame_rate can be like "24/1"
    fps_str = stream.get("r_frame_rate") or "0/1"
    try:
        num, den = fps_str.split("/")
        fps = float(num) / float(den) if float(den) != 0 else 0.0
    except Exception:  # noqa: BLE001
        fps = 0.0

    try:
        duration = float(format_info.get("duration") or 0.0)
    except (TypeError, ValueError):
        duration = 0.0

    codec = str(stream.get("codec_name") or "")

    return SceneVideoInfo(
        scene_id=scene_id,
        path=video_path,
        duration=duration,
        width=width,
        height=height,
        fps=fps,
        codec=codec,
    )


def _relative_path_from_video_url(video_url: str) -> Path:
    """
    Convert a Next.js `videoUrl` like `/api/outputs/videos/foo.mp4`
    into a relative path under the outputs root (`videos/foo.mp4`).
    """
    prefix = "/api/outputs/"
    if not video_url.startswith(prefix):
        raise VideoEditorError(f"Unexpected videoUrl format: {video_url}")
    rel = video_url[len(prefix) :]
    return Path(rel)


def get_scene_video_from_url(scene_id: str, video_url: str) -> SceneVideoInfo:
    """
    Resolve a scene's videoUrl to an absolute file path and metadata.

    This helper does NOT talk to the database; the caller is expected to
    supply the sceneId and videoUrl (e.g. from the project JSON).
    """
    rel_path = _relative_path_from_video_url(video_url)
    video_path = _ensure_under_outputs(OUTPUTS_ROOT / rel_path)
    info = _run_ffprobe(video_path)
    return _parse_ffprobe_info(scene_id=scene_id, video_path=video_path, data=info)


def get_scene_video_from_scene(scene: dict[str, Any]) -> SceneVideoInfo:
    """
    Convenience wrapper when working directly with Muse project JSON.

    Expects:
      - scene['id']
      - scene['videoUrl'] (Next.js URL under /api/outputs)
    """
    scene_id = str(scene.get("id") or "")
    video_url = str(scene.get("videoUrl") or "")
    if not scene_id or not video_url:
        raise VideoEditorError("Scene must have 'id' and 'videoUrl' to resolve video.")
    return get_scene_video_from_url(scene_id=scene_id, video_url=video_url)


def sample_frames(
    scene_id: str,
    video_url: str,
    max_frames: int = 8,
    strategy: Literal["uniform", "key_moments", "from_edit_plan"] = "uniform",
) -> list[dict[str, Any]]:
    """
    Extract a small number of representative frames for a scene.

    Currently only supports the 'uniform' strategy. Other strategies are
    reserved for future use.
    """
    if max_frames <= 0:
        return []

    info = get_scene_video_from_url(scene_id=scene_id, video_url=video_url)
    duration = max(info.duration, 0.01)  # avoid division by zero

    frames_dir = _ensure_under_outputs(OUTPUTS_ROOT / "editor" / "frames" / scene_id)
    frames_dir.mkdir(parents=True, exist_ok=True)

    if strategy != "uniform":
        logger.warning("sample_frames: strategy %s not implemented, falling back to uniform", strategy)

    # Use fps such that we get at most `max_frames` over the whole clip.
    fps = max_frames / duration
    fps = max(fps, 0.1)  # avoid absurdly low/zero values

    output_pattern = frames_dir / "frame_%04d.jpg"
    args = [
        "ffmpeg",
        "-y",
        "-i",
        str(info.path),
        "-vf",
        f"fps={fps}",
        "-frames:v",
        str(max_frames),
        str(output_pattern),
    ]
    _run_command(args)

    # Build list of actual frames written (up to max_frames)
    frames: list[dict[str, Any]] = []
    for idx in range(1, max_frames + 1):
        path = frames_dir / f"frame_{idx:04d}.jpg"
        if not path.exists():
            break
        # Approximate timestamp by evenly spacing over duration
        t = (idx - 0.5) * (duration / max_frames)
        frames.append({"path": path, "time": t})

    return frames


def cut_clip(
    input_rel_path: str,
    project_id: str,
    scene_id: str,
    start: float,
    end: float,
    reencode: bool = False,
) -> TrimmedClipInfo:
    """
    Trim a segment from a video under outputs/.

    Args:
        input_rel_path: Relative path under outputs/, e.g. "videos/foo.mp4".
        project_id: Project identifier for directory naming.
        scene_id: Scene identifier for directory naming.
        start: Start time in seconds.
        end: End time in seconds (must be > start).
        reencode: If True, re-encode the segment instead of stream copy.
    """
    if end <= start:
        raise VideoEditorError(f"Invalid trim range: start={start}, end={end}")

    input_path = _ensure_under_outputs(OUTPUTS_ROOT / input_rel_path)
    if not input_path.exists():
        raise VideoEditorError(f"Input video not found: {input_path}")

    # Probe duration to clamp the end
    meta = _run_ffprobe(input_path)
    info = _parse_ffprobe_info(scene_id=scene_id, video_path=input_path, data=meta)
    clamped_end = min(end, info.duration or end)

    seg_dir = _ensure_under_outputs(OUTPUTS_ROOT / "editor" / "segments" / project_id / scene_id)
    seg_dir.mkdir(parents=True, exist_ok=True)

    # Simple deterministic filename based on start/end (rounded to 3 decimals)
    start_tag = f"{start:.3f}".replace(".", "_")
    end_tag = f"{clamped_end:.3f}".replace(".", "_")
    output_path = seg_dir / f"seg_{start_tag}_{end_tag}.mp4"

    # Build ffmpeg command
    args = ["ffmpeg", "-y", "-ss", f"{start:.3f}", "-to", f"{clamped_end:.3f}", "-i", str(input_path)]
    if reencode:
        args += ["-c:v", "libx264", "-c:a", "aac"]
    else:
        args += ["-c", "copy"]
    args.append(str(output_path))

    _run_command(args)

    duration = max(clamped_end - start, 0.0)
    return TrimmedClipInfo(
        project_id=project_id,
        scene_id=scene_id,
        path=output_path,
        start=start,
        end=clamped_end,
        duration=duration,
    )


def concat_clips(
    clip_rel_paths: Iterable[str],
    project_id: str,
    target_name: str,
    reencode: bool = False,
) -> ConcatenatedClipInfo:
    """
    Concatenate multiple clips (under outputs/) into a single video.

    Args:
        clip_rel_paths: Iterable of relative paths under outputs/, in order.
        project_id: Project identifier.
        target_name: Base filename (without extension) for output.
        reencode: If True, re-encode to a common format (libx264/aac).
    """
    clips = [p for p in clip_rel_paths if p]
    if not clips:
        raise VideoEditorError("concat_clips called with no input clips.")

    abs_paths = [str(_ensure_under_outputs(OUTPUTS_ROOT / p)) for p in clips]

    final_dir = _ensure_under_outputs(OUTPUTS_ROOT / "final_cuts")
    final_dir.mkdir(parents=True, exist_ok=True)
    output_path = final_dir / f"{target_name}.mp4"

    # Write a temporary concat list file
    tmp_list = final_dir / f"{target_name}_concat.txt"
    with tmp_list.open("w", encoding="utf-8") as f:
        for p in abs_paths:
            f.write(f"file '{p}'\n")

    args = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(tmp_list)]
    if reencode:
        args += ["-c:v", "libx264", "-c:a", "aac"]
    else:
        args += ["-c", "copy"]
    args.append(str(output_path))

    _run_command(args)

    # Approximate duration as sum of input durations
    total_duration = 0.0
    for p in abs_paths:
        meta = _run_ffprobe(Path(p))
        info = _parse_ffprobe_info(scene_id="concat", video_path=Path(p), data=meta)
        total_duration += info.duration or 0.0

    # Clean up the list file but don't fail if it cannot be removed
    try:
        tmp_list.unlink(missing_ok=True)  # type: ignore[arg-type]
    except Exception:  # noqa: BLE001
        logger.debug("Failed to remove temporary concat list: %s", tmp_list)

    return ConcatenatedClipInfo(
        project_id=project_id,
        path=output_path,
        duration=total_duration,
        clip_count=len(abs_paths),
    )


def add_transition(
    clip_a_rel: str,
    clip_b_rel: str,
    project_id: str,
    scene_id: str,
    trans_type: Literal["cut", "crossfade", "dip_to_black", "dip_to_white"] = "cut",
    duration: float = 0.5,
) -> Path:
    """
    Simple transition helper between two clips.

    Currently only implements:
      - 'cut'       → just concatenates A then B
      - 'crossfade' → basic video crossfade using ffmpeg xfade (no audio mixing yet)

    Other types will raise VideoEditorError for now.
    """
    duration = max(duration, 0.1)

    a_path = _ensure_under_outputs(OUTPUTS_ROOT / clip_a_rel)
    b_path = _ensure_under_outputs(OUTPUTS_ROOT / clip_b_rel)

    out_dir = _ensure_under_outputs(OUTPUTS_ROOT / "editor" / "segments" / project_id / scene_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    if trans_type == "cut":
        # Reuse concat_clips implementation
        info = concat_clips(
            clip_rel_paths=[clip_a_rel, clip_b_rel],
            project_id=project_id,
            target_name=f"{scene_id}_cut_{a_path.stem}_{b_path.stem}",
            reencode=False,
        )
        return info.path

    if trans_type != "crossfade":
        raise VideoEditorError(f"Transition type '{trans_type}' is not implemented yet.")

    # Basic crossfade implementation (video only)
    output_path = out_dir / f"trans_{a_path.stem}_{b_path.stem}_xfade.mp4"

    # Determine an offset: fade starts at (duration of A - duration_of_transition)
    meta_a = _run_ffprobe(a_path)
    info_a = _parse_ffprobe_info(scene_id=scene_id, video_path=a_path, data=meta_a)
    offset = max(info_a.duration - duration, 0.0)

    args = [
        "ffmpeg",
        "-y",
        "-i",
        str(a_path),
        "-i",
        str(b_path),
        "-filter_complex",
        f"[0:v][1:v]xfade=transition=fade:duration={duration:.3f}:offset={offset:.3f}[v]",
        "-map",
        "[v]",
        "-an",
        str(output_path),
    ]
    _run_command(args)

    return output_path


def transcribe_video(scene_id: str, video_url: str) -> dict[str, Any]:
    """
    Transcribe a scene's audio using a local ONNX ASR model (onnx-asr).

    The current implementation:
      - Extracts mono 16 kHz PCM audio from the scene video using ffmpeg.
      - Runs onnx-asr.load_model(...).recognize(audio_path) to obtain a transcript.
      - Returns a single segment covering the entire clip, since the simple
        recognize() API does not expose word-level timestamps.

    When a more detailed API is available, this function can be extended to
    return multiple segments with finer-grained start/end times.
    """
    info = get_scene_video_from_url(scene_id=scene_id, video_url=video_url)

    # Extract audio track to a temporary WAV file under outputs/editor/audio
    audio_dir = _ensure_under_outputs(OUTPUTS_ROOT / "editor" / "audio")
    audio_dir.mkdir(parents=True, exist_ok=True)
    audio_path = audio_dir / f"{scene_id}.wav"

    # 16 kHz mono PCM is a common ASR input format
    args = [
        "ffmpeg",
        "-y",
        "-i",
        str(info.path),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        str(audio_path),
    ]
    _run_command(args)

    model = _get_asr_model()

    try:
        # onnx-asr example: text = model.recognize("test.wav")
        text = model.recognize(str(audio_path))
    except Exception as exc:  # noqa: BLE001
        raise VideoEditorError(f"ASR transcription failed for {audio_path}: {exc}") from exc

    transcript_text = str(text).strip()
    if not transcript_text:
        segments: list[dict[str, Any]] = []
    else:
        segments = [
            {
                "start": 0.0,
                "end": float(info.duration or 0.0),
                "text": transcript_text,
            }
        ]

    return {
        "sceneId": scene_id,
        "language": "und",  # Language detection can be added later.
        "segments": segments,
        "duration": info.duration,
    }

