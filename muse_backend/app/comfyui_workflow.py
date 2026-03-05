"""
ComfyUI workflow parsing utilities.

This module implements the deterministic parsing logic described in
`COMFYUI-WORKFLOW-PARSING.md`.  It is responsible for:

- Discovering dynamic inputs based on node `_meta.title` suffix `" (Input)"`.
- Discovering named outputs based on `_meta.title` suffix `" (Output)"`.
- Mapping ComfyUI `class_type` values to simple input/output kinds that the
  rest of the system (and the frontend) can work with.

The functions here deliberately avoid any LLM usage — they operate purely on
the JSON structure exported by ComfyUI.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, TypedDict


ComfyInputKind = Literal["number", "text", "textarea", "image", "audio", "boolean"]
ComfyOutputKind = Literal["image", "video", "other"]


class ComfyDynamicInput(TypedDict):
    """Normalized description of a dynamic input node in a ComfyUI workflow."""

    node_id: str       # original node id in the ComfyUI graph (e.g. "102")
    key: str           # base name derived from title, e.g. "Width"
    title: str         # full label to display
    kind: ComfyInputKind
    default_value: Any


class ComfyDynamicOutput(TypedDict):
    """Normalized description of a named output node in a ComfyUI workflow."""

    node_id: str       # original node id
    key: str           # base name derived from title, e.g. "Image"
    title: str         # label to display
    kind: ComfyOutputKind


def _strip_suffix(title: str, suffix: str) -> str:
    """Remove a suffix (e.g. ' (Input)') from a title if present."""
    if title.endswith(suffix):
        return title[: -len(suffix)].strip()
    return title


def parse_dynamic_inputs(workflow: dict[str, Any]) -> list[ComfyDynamicInput]:
    """
    Parse a ComfyUI workflow JSON object and extract all dynamic inputs.

    A node is considered a dynamic input when:
    - It has _meta.title, and
    - The title ends with ' (Input)'.

    The node's class_type then determines the input kind:
      - PrimitiveInt / PrimitiveFloat      → 'number'
      - PrimitiveString                    → 'text'
      - PrimitiveStringMultiline           → 'textarea'
      - LoadImage / LoadImageBase64       → 'image'
      - LoadAudio                         → 'audio'

    Unsupported input node types are ignored.
    """
    inputs: list[ComfyDynamicInput] = []

    for node_id, node in workflow.items():
        meta = node.get("_meta") or {}
        title = meta.get("title")
        if not isinstance(title, str) or not title.endswith(" (Input)"):
            continue

        base = _strip_suffix(title, " (Input)")
        class_type = node.get("class_type")
        raw_inputs: dict[str, Any] = node.get("inputs") or {}

        kind: ComfyInputKind | None = None
        default: Any = None

        if class_type in ("PrimitiveInt", "PrimitiveFloat"):
            kind = "number"
            default = raw_inputs.get("value")
        elif class_type == "PrimitiveString":
            kind = "text"
            default = raw_inputs.get("value", "")
        elif class_type == "PrimitiveStringMultiline":
            kind = "textarea"
            default = raw_inputs.get("value", "")
        elif class_type in ("LoadImage", "LoadImageBase64"):
            # Image file input
            kind = "image"
            default = None
        elif class_type == "LoadAudio":
            # Audio file input (e.g. MP3, WAV)
            # The UI can treat this as a dedicated audio picker or a generic file upload.
            kind = "audio"
            default = None
        # Optional: handle booleans or other primitives if they appear in future workflows.

        if kind is None:
            # Unsupported or non-dynamic input type for now.
            continue

        inputs.append(
            {
                "node_id": str(node_id),
                "key": base,
                "title": base,
                "kind": kind,
                "default_value": default,
            }
        )

    return inputs


def parse_dynamic_outputs(workflow: dict[str, Any]) -> list[ComfyDynamicOutput]:
    """
    Parse a ComfyUI workflow JSON object and extract all named outputs.

    A node is considered a named output when:
    - It has _meta.title, and
    - The title ends with ' (Output)'.

    The node's class_type then determines the output kind:
      - PreviewImage / SaveImage / SaveImageExtended → 'image'
      - PreviewVideo / SaveVideo / VHS_VideoCombine  → 'video'
      - anything else                                → 'other'
    """
    outputs: list[ComfyDynamicOutput] = []

    for node_id, node in workflow.items():
        meta = node.get("_meta") or {}
        title = meta.get("title")
        if not isinstance(title, str) or not title.endswith(" (Output)"):
            continue

        base = _strip_suffix(title, " (Output)")
        class_type = node.get("class_type")

        if class_type in ("PreviewImage", "SaveImage", "SaveImageExtended"):
            kind: ComfyOutputKind = "image"
        elif class_type in ("PreviewVideo", "SaveVideo", "VHS_VideoCombine"):
            # Treat VHS_VideoCombine (e.g. "Video Combine … (Output)") as a video output node.
            kind = "video"
        else:
            kind = "other"

        outputs.append(
            {
                "node_id": str(node_id),
                "key": base,
                "title": base,
                "kind": kind,
            }
        )

    return outputs


__all__ = [
    "ComfyInputKind",
    "ComfyOutputKind",
    "ComfyDynamicInput",
    "ComfyDynamicOutput",
    "parse_dynamic_inputs",
    "parse_dynamic_outputs",
]

