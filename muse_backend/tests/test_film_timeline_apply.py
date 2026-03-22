"""Tests for user timeline apply (ffmpeg / validation helpers)."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.film_timeline_apply import _preview_src_to_rel, apply_film_timeline, clear_transition_on_last_sequence
from app.film_timeline_schema import FilmSequenceItem, FilmTimeline, TransitionOut


def test_preview_src_to_rel() -> None:
    assert _preview_src_to_rel("/api/outputs/videos/a.mp4") == "videos/a.mp4"


def test_preview_src_to_rel_rejects_bad_prefix() -> None:
    with pytest.raises(ValueError):
        _preview_src_to_rel("https://x/videos/a.mp4")


def test_clear_transition_on_last_sequence() -> None:
    s0 = FilmSequenceItem(
        id="a",
        sceneId="s1",
        sceneNumber=1,
        title="A",
        renderSrc="file:///x/a.mp4",
        previewSrc="/api/outputs/videos/a.mp4",
        trimStartSec=0.0,
        trimEndSec=1.0,
        transitionOut=TransitionOut(type="fade", durationSec=0.5),
    )
    s1 = FilmSequenceItem(
        id="b",
        sceneId="s2",
        sceneNumber=2,
        title="B",
        renderSrc="file:///x/b.mp4",
        previewSrc="/api/outputs/videos/b.mp4",
        trimStartSec=0.0,
        trimEndSec=2.0,
        transitionOut=TransitionOut(type="fade", durationSec=0.3),
    )
    tl = FilmTimeline(version=1, fps=24, width=1920, height=1080, sequences=[s0, s1])
    out = clear_transition_on_last_sequence(tl)
    assert out.sequences[0].transition_out is not None
    assert out.sequences[1].transition_out is None


def test_apply_empty_sequences_fails() -> None:
    r = apply_film_timeline(
        "p1",
        {"version": 1, "fps": 24, "width": 1920, "height": 1080, "sequences": []},
        "ffmpeg",
    )
    assert r["status"] == "failed"


def test_apply_ffmpeg_success_monkeypatched(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.film_timeline_apply as fta

    monkeypatch.setattr(
        fta,
        "settings",
        type("S", (), {"outputs_path": tmp_path.resolve()})(),
    )

    vdir = tmp_path / "videos"
    vdir.mkdir(parents=True)
    (vdir / "a.mp4").write_bytes(b"fake")
    (vdir / "b.mp4").write_bytes(b"fake")

    calls: list[tuple[str, float, float]] = []

    def fake_cut(
        input_rel_path: str,
        project_id: str,
        scene_id: str,
        start: float,
        end: float,
        reencode: bool = False,
    ):
        from app.video_editor_tools import TrimmedClipInfo

        calls.append((input_rel_path, start, end))
        seg_dir = tmp_path / "editor" / "segments" / project_id / scene_id
        seg_dir.mkdir(parents=True, exist_ok=True)
        out = seg_dir / f"seg_{start}_{end}.mp4"
        out.write_bytes(b"x")
        return TrimmedClipInfo(
            project_id=project_id,
            scene_id=scene_id,
            path=out,
            start=start,
            end=end,
            duration=end - start,
        )

    def fake_concat(clip_rel_paths, project_id: str, target_name: str, reencode: bool = False):
        from app.video_editor_tools import ConcatenatedClipInfo

        final_dir = tmp_path / "final_cuts"
        final_dir.mkdir(parents=True, exist_ok=True)
        outp = final_dir / f"{target_name}.mp4"
        outp.write_bytes(b"master")
        return ConcatenatedClipInfo(
            project_id=project_id,
            path=outp,
            duration=3.0,
            clip_count=len(list(clip_rel_paths)),
        )

    monkeypatch.setattr(fta, "cut_clip", fake_cut)
    monkeypatch.setattr(fta, "concat_clips", fake_concat)

    tl_dict = {
        "version": 1,
        "fps": 24,
        "width": 1920,
        "height": 1080,
        "sequences": [
            {
                "id": "1",
                "sceneId": "sc-a",
                "sceneNumber": 1,
                "title": "A",
                "renderSrc": "file:///ignored",
                "previewSrc": "/api/outputs/videos/a.mp4",
                "trimStartSec": 0.1,
                "trimEndSec": 1.0,
                "transitionOut": {"type": "cut", "durationSec": 0},
            },
            {
                "id": "2",
                "sceneId": "sc-b",
                "sceneNumber": 2,
                "title": "B",
                "renderSrc": "file:///ignored",
                "previewSrc": "/api/outputs/videos/b.mp4",
                "trimStartSec": 0.0,
                "trimEndSec": 2.0,
            },
        ],
    }
    r = apply_film_timeline("proj1", tl_dict, "ffmpeg")
    assert r["status"] == "completed"
    assert r["outputPath"] == "final_cuts/proj1_smart_edit.mp4"
    assert len(calls) == 2
    assert calls[0][0] == "videos/a.mp4"
