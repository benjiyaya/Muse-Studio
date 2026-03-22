"""
Run Remotion CLI to render FilmMaster from a saved FilmTimeline JSON.

Requires Node.js, npx, and the `packages/remotion-film` project. Set
MUSE_REMOTION_PACKAGE_PATH to override the package directory.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path

from app.config import settings
from app.film_timeline_schema import FilmTimeline, FilmSequenceItem

logger = logging.getLogger(__name__)


def timeline_with_http_video_sources(timeline: FilmTimeline, http_base: str) -> FilmTimeline:
    """
    Remotion's renderer only loads video from http(s) URLs, not file://.
    Build renderSrc from previewSrc (/api/outputs/...) + Muse Studio public URL.
    """
    base = (http_base or "").strip().rstrip("/")
    if not base:
        base = "http://127.0.0.1:3000"
    new_sequences: list[FilmSequenceItem] = []
    for seq in timeline.sequences:
        ps = seq.preview_src
        if ps.startswith("http://") or ps.startswith("https://"):
            url = ps
        else:
            path = ps if ps.startswith("/") else f"/{ps}"
            url = f"{base}{path}"
        new_sequences.append(seq.model_copy(update={"render_src": url}))
    return timeline.model_copy(update={"sequences": new_sequences})


def _remotion_package_dir() -> Path:
    env = os.environ.get("MUSE_REMOTION_PACKAGE_PATH")
    if env:
        return Path(env).resolve()
    # muse_backend/app/remotion_render.py -> repo root is parent.parent.parent
    repo_root = Path(__file__).resolve().parent.parent.parent
    return (repo_root / "packages" / "remotion-film").resolve()


def save_timeline_json(project_id: str, timeline: FilmTimeline) -> Path:
    """Write timeline JSON under outputs/editor/timelines/."""
    root = settings.outputs_path.resolve()
    out = root / "editor" / "timelines" / f"{project_id}.json"
    timeline.write_json(out)
    return out


def run_remotion_render(
    timeline_json_path: Path,
    output_mp4: Path,
    *,
    timeout_sec: int | None = 3600,
) -> None:
    """
    Invoke `npx remotion render` for composition FilmMaster.

    Props file must be the JSON object Remotion passes as defaultProps (root = timeline fields).
    """
    pkg = _remotion_package_dir()
    entry_ts = pkg / "src" / "index.ts"
    entry_tsx = pkg / "src" / "index.tsx"
    if entry_ts.is_file():
        entry_rel = "src/index.ts"
    elif entry_tsx.is_file():
        entry_rel = "src/index.tsx"
    else:
        raise RuntimeError(
            f"Remotion package not found at {pkg} (missing src/index.ts). "
            "Install packages/remotion-film or set MUSE_REMOTION_PACKAGE_PATH."
        )

    if not pkg.is_dir():
        raise RuntimeError(f"Remotion package directory missing: {pkg}")

    timeline_json_path = timeline_json_path.resolve()
    output_mp4 = output_mp4.resolve()
    output_mp4.parent.mkdir(parents=True, exist_ok=True)

    props_arg = str(timeline_json_path)
    cmd = [
        "npx",
        "--yes",
        "remotion",
        "render",
        entry_rel,
        "FilmMaster",
        str(output_mp4),
        "--props",
        props_arg,
    ]

    logger.info("Running Remotion render: cwd=%s cmd=%s", pkg, " ".join(cmd))
    try:
        # Windows: `npx` is npx.cmd; list-form CreateProcess often fails with WinError 2.
        if os.name == "nt":
            completed = subprocess.run(
                subprocess.list2cmdline(cmd),
                cwd=str(pkg),
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                shell=True,
            )
        else:
            completed = subprocess.run(
                cmd,
                cwd=str(pkg),
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout_sec,
                shell=False,
            )
    except FileNotFoundError as exc:
        raise RuntimeError(
            "npx/remotion not found. Install Node.js and ensure npx is on PATH."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"Remotion render timed out after {timeout_sec}s") from exc

    if completed.returncode != 0:
        err = (completed.stderr or "") + "\n" + (completed.stdout or "")
        raise RuntimeError(f"Remotion render failed (exit {completed.returncode}): {err[:8000]}")

    if not output_mp4.is_file():
        raise RuntimeError(f"Remotion reported success but output missing: {output_mp4}")


def run_remotion_render_safe(project_id: str, timeline: FilmTimeline) -> str:
    """
    Render to outputs/final_cuts/<project_id>_remotion.mp4.
    Returns relative path under outputs/ for API URLs.
    """
    http_base = os.environ.get("MUSE_VIDEO_HTTP_BASE", "http://127.0.0.1:3000")
    tl_http = timeline_with_http_video_sources(timeline, http_base)
    props_path = save_timeline_json(f"{project_id}_remotion_props", tl_http)

    root = settings.outputs_path.resolve()
    final_dir = root / "final_cuts"
    final_dir.mkdir(parents=True, exist_ok=True)
    out = final_dir / f"{project_id}_remotion.mp4"

    run_remotion_render(props_path, out)

    try:
        return out.relative_to(root).as_posix()
    except ValueError:
        return out.name


def remotion_cli_available() -> bool:
    return shutil.which("npx") is not None
