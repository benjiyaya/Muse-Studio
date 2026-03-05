"""
GET  /inference/settings  — Read current inference settings from muse_config.json.
POST /inference/settings  — Update inference settings, reload config, optionally unload pipeline.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/inference", tags=["Inference Settings"])
logger = logging.getLogger(__name__)

_CONFIG_FILE = Path(__file__).parent.parent.parent.parent / "muse_config.json"

FluxOffloadMode = Literal["none", "model", "sequential"]


# ── Schemas ────────────────────────────────────────────────────────────────────

class InferenceSettingsResponse(BaseModel):
    flux_klein_offload: FluxOffloadMode
    pipeline_loaded: bool
    video_default: str          # e.g. "ltx2", "wan2.2", "runway"


class InferenceSettingsUpdate(BaseModel):
    flux_klein_offload: FluxOffloadMode
    unload_pipeline: bool = True   # unload so next generation picks up new setting
    video_default: str | None = None   # if provided, update providers.video_default


# ── Helpers ────────────────────────────────────────────────────────────────────

def _read_config() -> dict:
    if _CONFIG_FILE.exists():
        with open(_CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _write_config(data: dict) -> None:
    with open(_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/settings", response_model=InferenceSettingsResponse)
async def get_inference_settings():
    """Return current inference settings and whether the pipeline is loaded."""
    from app.providers.image.flux_klein_provider import FluxKleinProvider

    cfg = _read_config()
    offload = cfg.get("inference", {}).get("flux_klein_offload", "none")
    video_default = cfg.get("providers", {}).get("video_default", "ltx2")
    return InferenceSettingsResponse(
        flux_klein_offload=offload,
        pipeline_loaded=FluxKleinProvider._pipeline is not None,
        video_default=video_default,
    )


@router.post("/settings", response_model=InferenceSettingsResponse)
async def update_inference_settings(body: InferenceSettingsUpdate):
    """
    Persist the new inference settings to muse_config.json and hot-reload.
    If unload_pipeline is True (default), unloads the FLUX.2-Klein pipeline so
    the next generation call loads it fresh with the new offload strategy.
    """
    from app.config import settings
    from app.providers.image.flux_klein_provider import FluxKleinProvider

    # Read existing config, patch the inference block, write back
    cfg = _read_config()
    if "inference" not in cfg:
        cfg["inference"] = {}
    cfg["inference"]["flux_klein_offload"] = body.flux_klein_offload

    if body.video_default is not None:
        if "providers" not in cfg:
            cfg["providers"] = {}
        cfg["providers"]["video_default"] = body.video_default
        logger.info("[InferenceSettings] Wrote providers.video_default=%s", body.video_default)

    _write_config(cfg)
    logger.info("[InferenceSettings] Wrote flux_klein_offload=%s", body.flux_klein_offload)

    # Hot-reload so _get() returns new values on next _load_pipeline() call
    settings.reload_from_file()

    if body.unload_pipeline and FluxKleinProvider._pipeline is not None:
        logger.info("[InferenceSettings] Unloading pipeline so next call uses new offload mode.")
        FluxKleinProvider.unload_pipeline()

    video_default = cfg.get("providers", {}).get("video_default", "ltx2")
    return InferenceSettingsResponse(
        flux_klein_offload=body.flux_klein_offload,
        pipeline_loaded=FluxKleinProvider._pipeline is not None,
        video_default=video_default,
    )
