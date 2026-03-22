import json

from app.editor_segment_parse import parse_editor_payload


def test_parse_editor_payload_object_with_meta() -> None:
    raw = json.dumps(
        {
            "segments": [{"start": 0, "end": 5, "reason": "a"}],
            "sceneTitle": "Opening",
            "transitionOut": {"type": "fade", "durationSec": 0.5},
        }
    )
    segs, meta = parse_editor_payload(raw, duration_sec=10.0)
    assert segs == [(0.0, 5.0)]
    assert meta["sceneTitle"] == "Opening"
    assert meta["transitionOut"]["type"] == "fade"
    assert meta["transitionOut"]["durationSec"] == 0.5


def test_parse_editor_payload_clamps_fade_duration() -> None:
    raw = json.dumps(
        {
            "segments": [{"start": 0, "end": 5}],
            "transitionOut": {"type": "fade", "durationSec": 99.0},
        }
    )
    _, meta = parse_editor_payload(raw, duration_sec=10.0)
    assert meta["transitionOut"]["type"] == "fade"
    assert meta["transitionOut"]["durationSec"] == 2.0


def test_parse_editor_payload_bad_transition_type_becomes_cut() -> None:
    raw = json.dumps(
        {
            "segments": [{"start": 0, "end": 5}],
            "transitionOut": {"type": "wipe", "durationSec": 1.0},
        }
    )
    _, meta = parse_editor_payload(raw, duration_sec=10.0)
    assert meta["transitionOut"]["type"] == "cut"
    assert meta["transitionOut"]["durationSec"] == 0.0


def test_parse_editor_payload_legacy_array() -> None:
    raw = json.dumps([{"start": 1, "end": 3}])
    segs, meta = parse_editor_payload(raw, duration_sec=10.0)
    assert segs == [(1.0, 3.0)]
    assert meta == {}
