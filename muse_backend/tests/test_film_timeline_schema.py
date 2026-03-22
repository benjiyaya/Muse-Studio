"""Tests for FilmTimeline schema and editor payload parsing."""

from __future__ import annotations

import pytest

from app.film_timeline_schema import (
    FilmSequenceItem,
    FilmTimeline,
    seconds_to_frames,
    timeline_from_smart_edit_segments,
    validate_timeline_dict,
)


def test_seconds_to_frames() -> None:
    assert seconds_to_frames(0, 24) == 0
    assert seconds_to_frames(1.0, 24) == 24
    assert seconds_to_frames(0.5, 24) == 12


def test_sequence_validation_end_after_start() -> None:
    with pytest.raises(ValueError):
        FilmSequenceItem(
            id="a",
            sceneId="s1",
            sceneNumber=1,
            title="T",
            renderSrc="file:///tmp/x.mp4",
            previewSrc="/api/outputs/videos/x.mp4",
            trimStartSec=5.0,
            trimEndSec=2.0,
        )


def test_validate_timeline_dict_roundtrip() -> None:
    data = {
        "version": 1,
        "fps": 24,
        "width": 1920,
        "height": 1080,
        "projectTitle": "Test",
        "sequences": [
            {
                "id": "s1-1",
                "sceneId": "sc1",
                "sceneNumber": 1,
                "title": "One",
                "renderSrc": "file:///C:/tmp/video.mp4",
                "previewSrc": "/api/outputs/videos/a.mp4",
                "trimStartSec": 0,
                "trimEndSec": 2,
            }
        ],
        "overlays": [],
    }
    tl = validate_timeline_dict(data)
    assert isinstance(tl, FilmTimeline)
    assert len(tl.sequences) == 1
    dumped = tl.model_dump_for_json()
    assert dumped["sequences"][0]["sceneId"] == "sc1"


def test_validate_timeline_end_fade_out_sec() -> None:
    data = {
        "version": 1,
        "fps": 24,
        "width": 1920,
        "height": 1080,
        "endFadeOutSec": 0.5,
        "sequences": [
            {
                "id": "s1-1",
                "sceneId": "sc1",
                "sceneNumber": 1,
                "title": "One",
                "renderSrc": "file:///C:/tmp/video.mp4",
                "previewSrc": "/api/outputs/videos/a.mp4",
                "trimStartSec": 0,
                "trimEndSec": 2,
            }
        ],
        "overlays": [],
    }
    tl = validate_timeline_dict(data)
    assert tl.end_fade_out_sec == 0.5
    assert tl.model_dump_for_json()["endFadeOutSec"] == 0.5


def test_timeline_from_smart_edit_segments_builds_sequences(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.film_timeline_schema as fts

    video_rel = "videos/unit_test_clip.mp4"
    abs_video = tmp_path / video_rel
    abs_video.parent.mkdir(parents=True, exist_ok=True)
    abs_video.write_bytes(b"fake")

    monkeypatch.setattr(fts, "settings", type("S", (), {"outputs_path": tmp_path.resolve()})())

    project = {"id": "p1", "title": "My Film", "storyline": {}}
    scene = {
        "id": "sc1",
        "sceneNumber": 1,
        "title": "Scene A",
        "videoUrl": f"/api/outputs/{video_rel}",
        "status": "FINAL",
    }
    rows = [
        {
            "scene": scene,
            "segments": [(0.0, 1.5)],
            "transition_out": None,
        }
    ]
    tl = timeline_from_smart_edit_segments(project, rows)
    assert len(tl.sequences) == 1
    assert tl.sequences[0].lower_third_title is None
    assert tl.sequences[0].preview_src == f"/api/outputs/{video_rel}"
    assert tl.sequences[0].render_src.startswith("file:")


def test_timeline_transition_only_on_last_segment_per_scene(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.film_timeline_schema as fts

    for rel in ("videos/t_a.mp4", "videos/t_b.mp4"):
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x")
    monkeypatch.setattr(fts, "settings", type("S", (), {"outputs_path": tmp_path.resolve()})())

    project = {"id": "p1", "title": "Film", "storyline": {}}
    scene1 = {
        "id": "sc1",
        "sceneNumber": 1,
        "title": "A",
        "videoUrl": "/api/outputs/videos/t_a.mp4",
        "status": "FINAL",
    }
    scene2 = {
        "id": "sc2",
        "sceneNumber": 2,
        "title": "B",
        "videoUrl": "/api/outputs/videos/t_b.mp4",
        "status": "FINAL",
    }
    rows = [
        {
            "scene": scene1,
            "segments": [(0.0, 1.0), (2.0, 3.0)],
            "transition_out": {"type": "fade", "durationSec": 0.5},
        },
        {
            "scene": scene2,
            "segments": [(0.0, 2.0)],
            "transition_out": {"type": "fade", "durationSec": 0.3},
        },
    ]
    tl = timeline_from_smart_edit_segments(project, rows)
    assert len(tl.sequences) == 3
    assert tl.sequences[0].transition_out is None
    assert tl.sequences[1].transition_out is not None
    assert tl.sequences[1].transition_out.type == "fade"
    assert tl.sequences[2].transition_out is None


def test_timeline_clamps_segments_to_video_duration(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.film_timeline_schema as fts

    video_rel = "videos/clamp_test.mp4"
    abs_video = tmp_path / video_rel
    abs_video.parent.mkdir(parents=True, exist_ok=True)
    abs_video.write_bytes(b"x")
    monkeypatch.setattr(fts, "settings", type("S", (), {"outputs_path": tmp_path.resolve()})())

    project = {"id": "p1", "title": "", "storyline": {}}
    scene = {
        "id": "sc1",
        "sceneNumber": 1,
        "title": "A",
        "videoUrl": f"/api/outputs/{video_rel}",
        "status": "FINAL",
    }
    rows = [
        {
            "scene": scene,
            "segments": [(0.0, 99.0)],
            "video_duration_sec": 5.0,
            "transition_out": None,
        }
    ]
    tl = timeline_from_smart_edit_segments(project, rows)
    assert len(tl.sequences) == 1
    assert tl.sequences[0].trim_end_sec == 5.0
    assert tl.sequences[0].trim_start_sec == 0.0
