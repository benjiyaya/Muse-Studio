"""Integration-style tests for Remotion helpers (skipped unless REMOTION_RENDER=1)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from app.film_timeline_schema import FilmSequenceItem, FilmTimeline
from app.remotion_render import remotion_cli_available, timeline_with_http_video_sources


def test_timeline_http_rewrite() -> None:
    seq = FilmSequenceItem(
        id="a",
        sceneId="s",
        sceneNumber=1,
        title="T",
        renderSrc="file:///ignored/local.mp4",
        previewSrc="/api/outputs/videos/x.mp4",
        trimStartSec=0.0,
        trimEndSec=1.0,
    )
    tl = FilmTimeline(
        version=1,
        fps=24,
        width=1920,
        height=1080,
        sequences=[seq],
        overlays=[],
    )
    out = timeline_with_http_video_sources(tl, "http://127.0.0.1:3000")
    assert out.sequences[0].render_src == "http://127.0.0.1:3000/api/outputs/videos/x.mp4"


@pytest.mark.integration
def test_remotion_cli_optional() -> None:
    if os.environ.get("REMOTION_RENDER") != "1":
        pytest.skip("Set REMOTION_RENDER=1 to run Remotion CLI integration test.")
    if not remotion_cli_available():
        pytest.skip("npx not on PATH")

    from app.remotion_render import _remotion_package_dir, run_remotion_render

    pkg = _remotion_package_dir()
    if not (pkg / "src" / "index.ts").is_file():
        pytest.skip(f"Remotion package missing at {pkg}")

    props = Path(pkg / "timeline.fixtures.json")
    if not props.is_file():
        pytest.skip("timeline.fixtures.json missing; run npm run write-fixture in packages/remotion-film")

    out = pkg / "out" / "pytest-remotion-out.mp4"
    run_remotion_render(props, out, timeout_sec=600)
    assert out.is_file()
