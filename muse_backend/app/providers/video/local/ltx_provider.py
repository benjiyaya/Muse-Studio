"""
Motion Muse — Local Video Provider: LTX-Video 2 (19B)

Architecture
────────────
LTX-Video 2 uses an Audio+Video joint diffusion transformer (LTXAV) together
with a Gemma 3 12B text encoder bridged by a learned embeddings connector.

Inference backends (all from diffusers 0.37.0+):
  Stage 1 — LTX2ImageToVideoPipeline       (I2V or T2V at 540p → latent)
  Stage 2 — LTX2LatentUpsamplePipeline     (2× spatial upsample → 720p frames)
  Fallback — LTX2ImageToVideoPipeline      (single-stage at 720p when upsampler absent)

Required model files (models/ltx2/):
  • Merged checkpoint (transformer + VAE + connector in one file) OR split files:
    diffusion_models/  — ltx-2-19b-dev.safetensors (BF16) or ltx-2-19b-dev-Q4_K_M.gguf (GGUF).
                         When using a single merged safetensors, it must include the
                         embeddings connector (video/audio) and optionally video/audio VAE.
  • text_encoders/gemma_3_12B_it_fp8_scaled.safetensors — Gemma 3 12B (required).
  • vae/ — LTX2_video_vae_bf16.safetensors, LTX2_audio_vae_bf16.safetensors
           (if not already inside the merged checkpoint).

No standalone connector file is required when the checkpoint is merged; connector
weights are loaded from the diffusion checkpoint when present.

Video output: saved under muse-studio/outputs/videos; path returned to API is
relative (e.g. videos/ltx2_xxxx.mp4) so the frontend can set scene.video_url and
persist to muse-studio/db/muse.db.

Optional (enables two-stage 720p):
  ltx-2-spatial-upscaler-x2-1.0.safetensors in models/ltx2/ root.

Key notes
─────────
• Gemma3 weights: ComfyUI fp8_scaled (*.weight, *.weight_scale; skip *.comfy_quant).
• Connector keys (model.diffusion_model.video/audio_embeddings_connector.*,
  text_embedding_projection.*) are remapped for diffusers; load from merged checkpoint or optional standalone file.
• Vocoder and audio_vae are optional — pass None when not present.
"""

from __future__ import annotations

import asyncio
import gc
import logging
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from app.providers.base import LocalVideoProvider, VideoResult
from app.config import settings

logger = logging.getLogger(__name__)


def _resolve_keyframe_path(raw: str) -> Path:
    """Resolve a keyframe path that may be relative to outputs_path.

    Paths stored in the DB are like ``drafts/flux_klein_xxx.png`` (relative to
    ``muse-studio/outputs/``).  The backend working directory is ``muse_backend/``,
    so we must prefix with ``settings.outputs_path`` when the path is not absolute
    or otherwise resolvable from cwd.
    """
    p = Path(raw)
    if p.is_absolute() and p.exists():
        return p
    # Try as-is (already absolute or happens to resolve from cwd)
    if p.exists():
        return p
    # Resolve relative to outputs_path
    candidate = settings.outputs_path / p
    if candidate.exists():
        return candidate
    # Last resort — return original path and let the caller surface the error
    return p

# ── Generation defaults ───────────────────────────────────────────────────────

_DEFAULT_FPS           = 24
_DEFAULT_DURATION_S    = 5
_DEFAULT_STEPS         = 40
_DEFAULT_GUIDANCE      = 4.0

# Two-stage resolutions: 540p → 720p (must be multiples of 32 for diffusers)
_S1_HEIGHT, _S1_WIDTH  = 544, 960    # stage-1 target  (≈ 540p 16:9)
_S2_HEIGHT, _S2_WIDTH  = 736, 1280  # stage-2 target  (≈ 720p 16:9)

# Single-stage fallback
_SS_HEIGHT, _SS_WIDTH  = 736, 1280   # 720p 16:9 default

# LTX2 aspect ratio → (width, height). Multiples of 32 for single-stage; two-stage uses 64-aligned.
_LTX2_ASPECT = {
    "16:9": (1280, 720),   # landscape
    "9:16": (720, 1280),    # portrait
}


# ── Utilities ────────────────────────────────────────────────────────────────

def _materialize_meta(module: Any, device: str = "cpu") -> None:
    """Replace any remaining meta-device parameters/buffers with empty CPU tensors.

    When a model is created with ``accelerate.init_empty_weights()`` and loaded via
    ``load_state_dict(assign=True, strict=False)``, any keys that were NOT present
    in the state dict (e.g. Gemma3's ``causal_mask`` buffer) remain on the meta
    device.  Calling ``.to(device)`` on a module that still contains meta tensors
    raises ``NotImplementedError: Cannot copy out of meta tensor``.

    This helper walks the full module tree and allocates empty (uninitialised) CPU
    tensors for every remaining meta parameter/buffer so that ``.to(device)`` can
    subsequently succeed.
    """
    import torch
    for name, param in list(module.named_parameters(recurse=False)):
        if param.is_meta:
            module.register_parameter(
                name,
                torch.nn.Parameter(
                    torch.empty(param.shape, dtype=param.dtype, device=device),
                    requires_grad=False,
                ),
            )
    for name, buf in list(module.named_buffers(recurse=False)):
        if buf is not None and buf.is_meta:
            module.register_buffer(
                name,
                torch.empty(buf.shape, dtype=buf.dtype, device=device),
            )
    for child in module.children():
        _materialize_meta(child, device)


# ── Provider ──────────────────────────────────────────────────────────────────

class LTXProvider(LocalVideoProvider):
    provider_id       = "ltx2"
    display_name      = "LTX-Video 2 (Local)"
    model_folder_name = "ltx2"

    # ── File finders ──────────────────────────────────────────────────────────

    def _find_spatial_upsampler(self) -> Optional[Path]:
        """Returns the 2× spatial upsampler (in models/ltx2/ root, not a sub-folder)."""
        root = self._model_path()
        exact = root / "ltx-2-spatial-upscaler-x2-1.0.safetensors"
        if exact.exists():
            return exact
        for pat in ["*spatial*upscaler*.safetensors", "*upsampler*.safetensors"]:
            m = sorted(root.glob(pat))
            if m:
                return m[0]
        return None

    def _find_gemma_encoder(self) -> Optional[Path]:
        """Prefers fp8_scaled → fp4 → bf16 to minimise VRAM."""
        te_dir = self.text_encoders_path()
        if not te_dir.exists():
            return None
        for pat in ["*gemma*fp8*.safetensors", "*gemma*fp4*.safetensors",
                    "*gemma*.safetensors"]:
            m = sorted(te_dir.glob(pat))
            if m:
                return m[0]
        return None

    def _find_embedding_connectors(self) -> Optional[Path]:
        """Returns the embeddings connector safetensors file."""
        te_dir = self.text_encoders_path()
        if not te_dir.exists():
            return None
        # Matches both *connector* (singular) and *connectors* (plural)
        for pat in ["*connector*.safetensors", "*embed*connect*.safetensors"]:
            m = sorted(te_dir.glob(pat))
            if m:
                return m[0]
        return None

    def _find_video_vae(self) -> Optional[Path]:
        vae_dir = self.vae_path()
        if not vae_dir.exists():
            return None
        for pat in ["*video*vae*.safetensors", "LTX2_video*.safetensors",
                    "*video*.safetensors"]:
            m = sorted(vae_dir.glob(pat))
            if m:
                return m[0]
        return None

    def _find_audio_vae(self) -> Optional[Path]:
        vae_dir = self.vae_path()
        if not vae_dir.exists():
            return None
        for pat in ["*audio*vae*.safetensors", "LTX2_audio*.safetensors",
                    "*audio*.safetensors"]:
            m = sorted(vae_dir.glob(pat))
            if m:
                return m[0]
        return None

    def find_vae(self) -> Optional[Path]:
        """Override base: return video VAE (not audio)."""
        return self._find_video_vae()

    def _has_two_stage_support(self) -> bool:
        return self._find_spatial_upsampler() is not None

    # ── Availability ──────────────────────────────────────────────────────────

    def is_available(self) -> bool:
        """
        Local LTX-Video has been disabled in this ComfyUI-based version.

        Video generation is now routed through ComfyUI workflows instead of
        local diffusers weights under a /models directory, so we skip any
        filesystem checks here.
        """
        return False

    def unavailable_reason(self) -> Optional[str]:
        if self.is_available():
            return None
        return "Local LTX-Video is disabled; use ComfyUI video workflows instead."

    def capabilities(self) -> dict[str, Any]:
        two_stage = self._has_two_stage_support()
        return {
            "max_duration_seconds":  5,
            "supported_fps":         [24, 25],
            "image_guided":          True,
            "text_guided":           True,
            "recommended_vram_gb":   40,
            "inference_backend":     "diffusers",
            "two_stage_upsampler":   two_stage,
            "pipeline":              "ltx2_two_stage_720p" if two_stage else "ltx2_single_stage_720p",
            "max_resolution":        "720p",
            "requires": [
                "diffusion_models/ltx-2-19b-dev.safetensors (merged: transformer+VAE+connector)  OR  ltx-2-19b-dev-Q4_K_M.gguf",
                "text_encoders/gemma_3_12B_it*.safetensors",
                "vae/LTX2_video_vae_bf16.safetensors",
            ],
            "optional_for_720p": ["ltx-2-spatial-upscaler-x2-1.0.safetensors (ltx2/ root)"],
        }

    # ── Pipeline assembly ─────────────────────────────────────────────────────

    def _build_pipeline(self, has_image: bool = True) -> Any:
        """
        Assemble LTX2ImageToVideoPipeline (or LTX2Pipeline for text-only) from
        ComfyUI-packaged safetensors files.

        has_image=True  → LTX2ImageToVideoPipeline (image conditioning required)
        has_image=False → LTX2Pipeline (text-to-video; image=None crashes i2v pipeline)

        Component loading strategy (mirrors FLUX.2-Klein approach):
          Transformer  — from_single_file() with device_map for zero-RAM loading
          Video VAE    — from_single_file()
          Audio VAE    — manual state-dict load (no from_single_file support)
          Gemma3       — fp8 dequant → bf16, init_empty_weights + assign=True
          Connectors   — key-remap from ComfyUI format, then load_state_dict
          Tokenizer    — from_pretrained("google/gemma-3-12b-it")
        """
        import json
        import torch
        from accelerate import init_empty_weights
        from safetensors import safe_open
        from safetensors.torch import load_file as st_load
        from diffusers import (
            LTX2ImageToVideoPipeline,
            LTX2Pipeline,
            LTX2VideoTransformer3DModel,
            AutoencoderKLLTX2Video,
            AutoencoderKLLTX2Audio,
            FlowMatchEulerDiscreteScheduler,
        )
        from diffusers.pipelines.ltx2.connectors import LTX2TextConnectors
        from transformers import Gemma3ForConditionalGeneration, Gemma3Config

        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype  = torch.bfloat16

        diff_model      = self.find_diffusion_model()
        gemma_file      = self._find_gemma_encoder()
        connectors_file = self._find_embedding_connectors()
        video_vae_file  = self._find_video_vae()
        audio_vae_file  = self._find_audio_vae()

        # When using a merged BF16 checkpoint, connector weights can be taken from it.
        conn_raw_from_ckpt: Optional[dict[str, Any]] = None

        def _flush(label: str) -> None:
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            used = torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0.0
            logger.info("[LTX2] %s — VRAM: %.1f GB", label, used)

        # ── 1. Transformer ────────────────────────────────────────────────────
        # GGUF files (e.g. ltx-2-19b-dev-Q4_K_M.gguf) require GGUFQuantizationConfig
        # so diffusers applies its GGUFQuantizer during loading.
        # FP8 safetensors (ComfyUI-scaled) need explicit dequantisation (same as Gemma).
        # BF16 safetensors load with a direct dtype cast.
        is_gguf = str(diff_model).lower().endswith(".gguf")
        is_fp8_st = (not is_gguf) and ("fp8" in diff_model.name.lower())
        _fmt_label = "GGUF" if is_gguf else ("FP8 safetensors" if is_fp8_st else "BF16 safetensors")
        logger.info("[LTX2] Loading transformer (%s, format=%s) ...", diff_model.name, _fmt_label)

        if is_gguf:
            # GGUF files must still go through from_single_file (quantization handled by diffusers).
            try:
                from diffusers import GGUFQuantizationConfig
                gguf_kwargs: dict[str, Any] = {
                    "quantization_config": GGUFQuantizationConfig(compute_dtype=dtype)
                }
                logger.info("[LTX2] GGUF quantization config applied (compute_dtype=bfloat16).")
            except ImportError:
                logger.warning(
                    "[LTX2] GGUFQuantizationConfig not found in this diffusers version. "
                    "Install gguf>=0.10.0 and use diffusers>=0.37.0."
                )
                gguf_kwargs = {}
            transformer = LTX2VideoTransformer3DModel.from_single_file(
                str(diff_model), torch_dtype=dtype, **gguf_kwargs
            ).to(device)
        else:
            # ── BF16 safetensors path: load manually from local file ──────────────
            # from_single_file fetches the model config from HuggingFace
            # (Lightricks/LTX-2/transformer/config.json) at runtime, which can
            # return a config whose caption_channels differs from the actual
            # checkpoint weights (e.g. 4096 vs 3840 in ltx-2-19b-dev).
            # Instead we read the architecture config embedded in the safetensors
            # metadata and build the model locally, completely offline.
            from diffusers.loaders.single_file_utils import convert_ltx2_transformer_to_diffusers

            # 1. Extract transformer architecture config from checkpoint metadata.
            meta_transformer_cfg: dict = {}
            try:
                with safe_open(str(diff_model), framework="pt", device="cpu") as _f:
                    _meta = _f.metadata() or {}
                if "config" in _meta:
                    _full = json.loads(_meta["config"])
                    meta_transformer_cfg = _full.get("transformer", {})
            except Exception as _e:
                logger.warning("[LTX2] Could not read safetensors metadata: %s", _e)

            caption_channels: int = int(meta_transformer_cfg.get("caption_channels", 3840))
            logger.info("[LTX2] caption_channels=%d (from checkpoint metadata).", caption_channels)

            # 2. Create empty model on meta device with the correct architecture.
            with init_empty_weights():
                transformer = LTX2VideoTransformer3DModel(caption_channels=caption_channels)

            # 3. Load raw tensors and convert ComfyUI key names → diffusers names.
            # FP8 ComfyUI checkpoints (e.g. ltx-2-19b-dev-fp8.safetensors) pair each
            # float8_e4m3fn weight with a matching `<key>.weight_scale` F32 tensor and
            # an `<key>.input_scale` F32 tensor.  We must apply weight_scale during
            # loading to recover the original weight magnitudes; input_scale is only
            # needed for live FP8 inference and is discarded here.
            raw_ckpt: dict[str, Any] = {}
            if is_fp8_st:
                logger.info("[LTX2] Streaming FP8 transformer → BF16 via CPU mmap ...")
                with safe_open(str(diff_model), framework="pt", device="cpu") as _f:
                    _all_keys = list(_f.keys())
                    # Pre-cache the per-tensor weight scale factors (tiny F32 tensors).
                    _wscales: dict[str, Any] = {
                        k: _f.get_tensor(k).to(dtype)
                        for k in _all_keys if k.endswith(".weight_scale")
                    }
                    for _k in _all_keys:
                        # Drop scale / activation-scale helper keys.
                        if _k.endswith(".weight_scale") or _k.endswith(".input_scale"):
                            continue
                        _v = _f.get_tensor(_k)
                        if _v.dtype == torch.float8_e4m3fn:
                            _scale_key = _k.replace(".weight", ".weight_scale")
                            _scale = _wscales.get(_scale_key, torch.tensor(1.0, dtype=dtype))
                            raw_ckpt[_k] = (_v.to(dtype) * _scale)
                        else:
                            raw_ckpt[_k] = _v.to(dtype) if _v.is_floating_point() else _v
                    del _wscales
                logger.info("[LTX2] FP8 transformer dequantised: %d tensors → BF16.", len(raw_ckpt))
            else:
                with safe_open(str(diff_model), framework="pt", device="cpu") as _f:
                    for _k in _f.keys():
                        raw_ckpt[_k] = _f.get_tensor(_k)

            # Extract connector weights from merged checkpoint for use when no standalone file.
            for _k in list(raw_ckpt.keys()):
                if "embeddings_connector" in _k or "text_embedding_projection" in _k:
                    if conn_raw_from_ckpt is None:
                        conn_raw_from_ckpt = {}
                    conn_raw_from_ckpt[_k] = raw_ckpt.pop(_k)

            # Merged checkpoints may include audio_vae / video_vae; the transformer
            # converter expects only diffusion_model keys. Drop VAE keys so they
            # are not passed to convert_ltx2_transformer_to_diffusers (avoids 483
            # unexpected keys when loading into LTX2VideoTransformer3DModel).
            for _k in list(raw_ckpt.keys()):
                if _k.startswith("audio_vae.") or _k.startswith("video_vae."):
                    raw_ckpt.pop(_k)

            converted_sd = convert_ltx2_transformer_to_diffusers(raw_ckpt)
            del raw_ckpt

            # Cast any remaining floats to target dtype (BF16 path, or FP8 residuals).
            converted_sd = {
                k: v.to(dtype=dtype) if v.is_floating_point() else v
                for k, v in converted_sd.items()
            }

            # 4. Load weights with assign=True — replaces parameters in-place
            #    without requiring matching shapes, so any residual architecture
            #    differences are handled gracefully.
            missing, unexpected = transformer.load_state_dict(
                converted_sd, strict=False, assign=True
            )
            del converted_sd
            if missing:
                logger.warning(
                    "[LTX2] Transformer: %d missing keys (first 5: %s)", len(missing), missing[:5]
                )
            if unexpected:
                logger.warning(
                    "[LTX2] Transformer: %d unexpected keys (first 5: %s)",
                    len(unexpected), unexpected[:5],
                )

            _materialize_meta(transformer)  # init remaining meta buffers before .to()
            transformer = transformer.to(device=device, dtype=dtype)
            transformer.eval()

        _flush("after transformer")

        # ── 2. Video VAE ─────────────────────────────────────────────────────
        # Same problem as the transformer: from_single_file fetches
        # Lightricks/LTX-2/vae/config.json from HuggingFace which contains
        # 'DownEncoderBlock2D' blocks, incompatible with AutoencoderKLLTX2Video.
        # We create the model with its built-in defaults (already correct) and
        # load the state dict directly from the local safetensors file.
        logger.info("[LTX2] Loading video VAE (%s) ...", video_vae_file.name)
        from diffusers.loaders.single_file_utils import convert_ltx2_vae_to_diffusers

        vae_raw: dict[str, Any] = {}
        with safe_open(str(video_vae_file), framework="pt", device="cpu") as _vf:
            for _k in _vf.keys():
                vae_raw[_k] = _vf.get_tensor(_k)

        vae_converted = convert_ltx2_vae_to_diffusers(vae_raw)
        del vae_raw
        vae_converted = {
            k: v.to(dtype=dtype) if v.is_floating_point() else v
            for k, v in vae_converted.items()
        }

        # The VAE is small enough to create normally on CPU (no init_empty_weights).
        # init_empty_weights would leave registered buffers as meta tensors, breaking
        # .to(device) unless ALL keys — including buffers — are in the state_dict.
        video_vae = AutoencoderKLLTX2Video()
        _v_missing, _v_unexpected = video_vae.load_state_dict(
            vae_converted, strict=False, assign=True
        )
        del vae_converted
        if _v_missing:
            logger.warning("[LTX2] Video VAE: %d missing keys (first 5: %s)", len(_v_missing), _v_missing[:5])
        if _v_unexpected:
            logger.warning("[LTX2] Video VAE: %d unexpected keys", len(_v_unexpected))
        video_vae = video_vae.to(device=device)
        video_vae.eval()
        # The diffusers formula `patch_size × 2^sum(spatio_temporal_scaling)` over-counts
        # because it treats temporal-only downsampling blocks as spatial ones.
        # Actual spatial compression: patch_size(4) × 2^(3 spatial blocks) = 32.
        # Actual temporal compression: patch_size_t(1) × 2^(3 temporal blocks) = 8.
        # Without this correction, pipeline.prepare_latents() computes mask dims using
        # ratio 64 while the VAE encoder actually compresses by 32x, causing a 2×
        # tensor shape mismatch at the interpolation step.
        video_vae.spatial_compression_ratio = 32
        video_vae.temporal_compression_ratio = 8
        logger.info(
            "[LTX2] Video VAE compression ratios patched: spatial=32, temporal=8"
        )
        _flush("after video VAE")

        # ── 3. Audio VAE (no from_single_file — manual state-dict load) ───────
        audio_vae = None
        if audio_vae_file:
            logger.info("[LTX2] Loading audio VAE (%s) ...", audio_vae_file.name)
            try:
                audio_sd = st_load(str(audio_vae_file), device="cpu")
                # Keys in the file are prefixed with "audio_vae." → strip it
                stripped = {
                    k.replace("audio_vae.", "", 1): v.to(dtype) if v.is_floating_point() else v
                    for k, v in audio_sd.items()
                }
                del audio_sd
                with init_empty_weights():
                    audio_vae = AutoencoderKLLTX2Audio()
                audio_vae.load_state_dict(stripped, strict=False, assign=True)
                del stripped
                _materialize_meta(audio_vae)
                audio_vae = audio_vae.to(device=device)
                _flush("after audio VAE")
            except Exception as exc:
                logger.warning("[LTX2] Audio VAE load failed (%s) — audio disabled.", exc)
                audio_vae = None
        else:
            logger.info("[LTX2] No audio VAE found — audio generation disabled.")

        # ── 4. Gemma3 text encoder (fp8_scaled → bf16) ────────────────────────
        # Aggressively purge the CUDA allocator cache before loading the
        # largest new component.  The transformer (~38 GB) and VAE (~0.5 GB)
        # are already resident; we need ~24 GB more for Gemma.  Without this
        # flush, allocator fragmentation causes OOM even when 28+ GB is free.
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
        logger.info(
            "[LTX2] Pre-Gemma VRAM: %.1f GB allocated, %.1f GB free",
            torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0,
            (torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_reserved()) / 1e9
            if torch.cuda.is_available() else 0,
        )
        # ComfyUI fp8_scaled format:
        #   key.weight      float8_e4m3fn  — quantised weight
        #   key.weight_scale float32       — per-tensor scale factor
        #   key.comfy_quant  uint8         — ComfyUI metadata (skip)
        # Dequant: weight_bf16 = fp8_weight.to(bf16) × weight_scale
        #
        # IMPORTANT — load directly to the target device (CUDA) rather than
        # to CPU first.  The old CPU→GPU approach loaded ~24 GB BF16 onto CPU
        # and then called `.to(device)`, which iterates tensors one by one and
        # re-allocates them on an already-fragmented CUDA allocator, causing
        # OOM on a 226 MiB parameter despite 28+ GB being free.
        # Loading FP8 directly to CUDA (12 GB), dequanting on-device, and
        # assigning via assign=True means no separate .to(device) is needed.
        logger.info("[LTX2] Loading Gemma3 text encoder (%s) ...", gemma_file.name)
        gemma_config = Gemma3Config.from_pretrained("google/gemma-3-12b-it")
        # Stream FP8 → BF16 via CPU-backed lazy mmap.
        # st_load(device="cuda") memory-maps the whole ~12 GB file through the Windows
        # CUDA driver, which exhausts the page file (OS error 1455).  Using safe_open
        # with device="cpu" maps the file via normal read-only file pages (no page file
        # involvement), then we dequantise each tensor on CPU and immediately move the
        # BF16 result to CUDA — keeping peak CPU allocation to one tensor at a time.
        logger.info("[LTX2] Streaming Gemma FP8 → BF16 via CPU mmap ...")
        with safe_open(str(gemma_file), framework="pt", device="cpu") as _saf:
            _all_keys = list(_saf.keys())
            # Pre-cache the tiny per-tensor scale factors.
            _scales: dict[str, Any] = {
                k: _saf.get_tensor(k).to(dtype)
                for k in _all_keys if k.endswith(".weight_scale")
            }
            clean_sd: dict[str, Any] = {}
            for _k in _all_keys:
                if _k.endswith(".comfy_quant") or _k.endswith(".weight_scale"):
                    continue
                _v = _saf.get_tensor(_k)
                if _v.dtype == torch.float8_e4m3fn:
                    _scale_key = _k.replace(".weight", ".weight_scale")
                    _scale = _scales.get(_scale_key, torch.tensor(1.0, dtype=dtype))
                    clean_sd[_k] = (_v.to(dtype) * _scale).to(device)  # dequant on CPU → move to CUDA
                else:
                    clean_sd[_k] = _v.to(dtype).to(device) if _v.is_floating_point() else _v.to(device)
            del _scales
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        with init_empty_weights():
            text_encoder = Gemma3ForConditionalGeneration(gemma_config)
        text_encoder.load_state_dict(clean_sd, strict=False, assign=True)
        del clean_sd
        gc.collect()
        # Materialise any remaining meta buffers (e.g. causal_mask) directly on
        # the target device — weights are already on CUDA so no .to(device) needed.
        _materialize_meta(text_encoder, device=device)
        # Cast any remaining float32 buffers (e.g. causal_mask materialised above)
        # to the target dtype.  Weights already in BF16 are a true no-op (.to()
        # returns the same tensor when dtype matches); only float32 buffers pay the
        # small conversion cost.  Without this, Gemma's forward() promotes outputs
        # to float32 via mixed-precision arithmetic, causing a dtype mismatch in
        # the connector's text_proj_in linear layer (float input × BF16 weight).
        text_encoder = text_encoder.to(dtype=dtype)
        text_encoder.eval()
        _flush("after Gemma3 text encoder")

        # ── 5. Tokenizer ──────────────────────────────────────────────────────
        logger.info("[LTX2] Loading GemmaTokenizer ...")
        try:
            from transformers import GemmaTokenizer
            tokenizer = GemmaTokenizer.from_pretrained("google/gemma-3-12b-it")
        except Exception:
            from transformers import AutoTokenizer
            tokenizer = AutoTokenizer.from_pretrained("google/gemma-3-12b-it")

        # ── 6. Text connectors (ComfyUI key remapping) ────────────────────────
        # Load from standalone file if present, else from merged checkpoint (BF16 only).
        if connectors_file:
            logger.info("[LTX2] Loading text connectors (%s) ...", connectors_file.name)
            conn_raw = st_load(str(connectors_file), device="cpu")
        elif conn_raw_from_ckpt:
            logger.info("[LTX2] Loading text connectors from merged checkpoint.")
            conn_raw = conn_raw_from_ckpt
            conn_raw_from_ckpt = None
        else:
            raise RuntimeError(
                "LTX2 connector weights not found. Use a merged BF16 safetensors checkpoint "
                "(with video/audio_embeddings_connector and text_embedding_projection) or "
                "provide a standalone connector safetensors file."
            )
        conn_sd  = _remap_connector_keys(conn_raw, dtype)
        del conn_raw

        # Config derived from file key shapes:
        #   learnable_registers: [128, 3840]  → num_learnable_registers=128
        #   to_k.weight: [3840, 3840]         → 30 heads × 128 head_dim
        connectors = LTX2TextConnectors(
            caption_channels                     = 3840,
            text_proj_in_factor                  = 49,
            video_connector_num_attention_heads  = 30,
            video_connector_attention_head_dim   = 128,
            video_connector_num_layers           = 2,
            video_connector_num_learnable_registers = 128,
            audio_connector_num_attention_heads  = 30,
            audio_connector_attention_head_dim   = 128,
            audio_connector_num_layers           = 2,
            audio_connector_num_learnable_registers = 128,
            connector_rope_base_seq_len          = 4096,
            rope_theta                           = 10000.0,
            rope_double_precision                = True,
            causal_temporal_positioning          = False,
            rope_type                            = "split",
        )
        missing, unexpected = connectors.load_state_dict(conn_sd, strict=False, assign=False)
        if missing:
            logger.debug("[LTX2] Connector missing keys (%d): %s ...", len(missing), missing[:3])
        if unexpected:
            logger.debug("[LTX2] Connector unexpected keys (%d): %s ...", len(unexpected), unexpected[:3])
        del conn_sd
        connectors = connectors.to(device=device, dtype=dtype)
        _flush("after connectors")

        # ── 7. Scheduler ──────────────────────────────────────────────────────
        scheduler = FlowMatchEulerDiscreteScheduler(
            shift=4.0,          # LTX-2 recommended shift (Lightricks official)
            use_dynamic_shifting=False,
        )

        # ── 8. Assemble pipeline ──────────────────────────────────────────────
        # LTX2ImageToVideoPipeline.preprocess() crashes on image=None, so use
        # the text-only LTX2Pipeline when no keyframe image is provided.
        _PipelineClass = LTX2ImageToVideoPipeline if has_image else LTX2Pipeline
        logger.info("[LTX2] Using pipeline class: %s", _PipelineClass.__name__)
        pipe = _PipelineClass(
            scheduler    = scheduler,
            vae          = video_vae,
            audio_vae    = audio_vae,       # None if not present (video-only mode)
            text_encoder = text_encoder,
            tokenizer    = tokenizer,
            connectors   = connectors,
            transformer  = transformer,
            vocoder      = None,            # audio waveform decoder; not needed for video
        )

        # ── 9. CPU offload (from muse_config.json inference.flux_klein_offload) ─
        try:
            from app.config import _get as _cfg_get
            offload = (_cfg_get("inference.flux_klein_offload") or "none").strip().lower()
        except Exception:
            offload = "none"
        if offload == "sequential":
            pipe.enable_sequential_cpu_offload()
            logger.info("[LTX2] Sequential CPU offload enabled.")
        elif offload == "model":
            pipe.enable_model_cpu_offload()
            logger.info("[LTX2] Model CPU offload enabled.")
        else:
            logger.info("[LTX2] All components on %s (no offload).", device)

        _flush("pipeline ready")
        logger.info("[LTX2] Pipeline assembled successfully.")
        return pipe

    def _build_upsampler_pipeline(
        self,
        video_vae_file: Path,
        upsampler_file: Path,
        device: str,
        dtype: Any,
    ) -> Any:
        """
        Assemble LTX2LatentUpsamplePipeline from the spatial upsampler safetensors.

        LTX2LatentUpsamplerModel config (derived from upsampler key shapes):
          initial_conv.weight: [1024, 128, 3,3,3]  → in_channels=128, mid_channels=1024, dims=3
          res_blocks indices: [0,1,2,3]             → num_blocks_per_stage=4
          upsampler.conv.weight present             → rational_spatial_scale=2.0
        """
        import torch
        from safetensors import safe_open
        from safetensors.torch import load_file as st_load
        from diffusers import AutoencoderKLLTX2Video, LTX2LatentUpsamplePipeline
        from diffusers.pipelines.ltx2.latent_upsampler import LTX2LatentUpsamplerModel
        from diffusers.loaders.single_file_utils import convert_ltx2_vae_to_diffusers

        # Shared Video VAE — from_single_file() fails because the local safetensors
        # metadata references 'DownEncoderBlock2D' blocks unsupported by this model.
        # Use the same manual key-conversion + default-config approach as _build_pipeline.
        logger.info("[LTX2] Loading video VAE for upsampler pipeline ...")
        _vae_raw: dict = {}
        with safe_open(str(video_vae_file), framework="pt", device="cpu") as _vf:
            for _k in _vf.keys():
                _vae_raw[_k] = _vf.get_tensor(_k)
        _vae_converted = convert_ltx2_vae_to_diffusers(_vae_raw)
        del _vae_raw
        _vae_converted = {
            k: v.to(dtype=dtype) if v.is_floating_point() else v
            for k, v in _vae_converted.items()
        }
        video_vae = AutoencoderKLLTX2Video()
        video_vae.load_state_dict(_vae_converted, strict=False, assign=True)
        del _vae_converted
        video_vae = video_vae.to(device)
        video_vae.eval()
        video_vae.spatial_compression_ratio = 32
        video_vae.temporal_compression_ratio = 8

        # Latent upsampler (keys match model directly)
        up_sd = st_load(str(upsampler_file), device="cpu")
        up_sd = {
            k: v.to(dtype) if v.is_floating_point() else v
            for k, v in up_sd.items()
        }
        upsampler = LTX2LatentUpsamplerModel(
            in_channels          = 128,
            mid_channels         = 1024,
            num_blocks_per_stage = 4,
            dims                 = 3,
            spatial_upsample     = True,
            temporal_upsample    = False,
            rational_spatial_scale = 2.0,
        )
        missing, unexpected = upsampler.load_state_dict(up_sd, strict=False)
        if missing:
            logger.debug("[LTX2] Upsampler missing keys (%d): %s ...", len(missing), missing[:3])
        del up_sd
        upsampler = upsampler.to(device=device, dtype=dtype)

        return LTX2LatentUpsamplePipeline(vae=video_vae, latent_upsampler=upsampler)

    # ── Progress helper ───────────────────────────────────────────────────────

    def _report(
        self,
        on_progress: Optional[Callable],
        loop: asyncio.AbstractEventLoop,
        pct: int,
        msg: str,
    ) -> None:
        if on_progress:
            asyncio.run_coroutine_threadsafe(on_progress(pct, msg), loop)

    # ── Generation ────────────────────────────────────────────────────────────

    async def generate(
        self,
        script: str,
        keyframe_paths: list[str],
        params: dict[str, Any],
        on_progress: Optional[Callable] = None,
    ) -> VideoResult:
        if not self.is_available():
            return VideoResult(
                success=False,
                error=self.unavailable_reason() or "Required model files not found.",
            )

        duration_s     = params.get("duration_seconds", _DEFAULT_DURATION_S)
        fps_raw        = params.get("fps", _DEFAULT_FPS)
        fps            = int(fps_raw) if fps_raw is not None else _DEFAULT_FPS
        upsampler_file = self._find_spatial_upsampler()
        video_vae_file = self._find_video_vae()

        # LTX2 aspect ratio (only when using LTX2): 16:9 → 1280×720, 9:16 → 720×1280
        aspect_ratio   = params.get("aspect_ratio", "16:9")
        out_width, out_height = _LTX2_ASPECT.get(aspect_ratio, (1280, 720))
        # Two-stage pipeline requires dimensions divisible by 64; single-stage by 32
        s2_width      = (out_width // 64) * 64
        s2_height     = (out_height // 64) * 64
        s1_width      = s2_width // 2
        s1_height     = s2_height // 2

        # LTX-2 frame count must satisfy: (N × 8) + 1
        num_frames = (duration_s * fps // 8) * 8 + 1

        # Persist videos under muse-studio/outputs/videos so the frontend
        # can serve them via /api/outputs/<relative_path>.
        output_dir  = settings.outputs_path / "videos"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"ltx2_{uuid.uuid4().hex[:8]}.mp4"

        # Path returned to the frontend should be relative to outputs_path,
        # e.g. "videos/ltx2_xxxx.mp4" → /api/outputs/videos/ltx2_xxxx.mp4.
        # Use forward slashes so the URL is valid on all platforms.
        try:
            relative_output = output_path.relative_to(settings.outputs_path).as_posix()
        except ValueError:
            # Fallback — should not normally happen, but keep behaviour sane.
            relative_output = output_path.name

        loop = asyncio.get_event_loop()
        try:
            if upsampler_file is not None:
                await loop.run_in_executor(
                    None,
                    self._run_two_stage,
                    script, keyframe_paths, num_frames, fps,
                    output_path, on_progress, loop,
                    upsampler_file, video_vae_file,
                    s1_width, s1_height, s2_width, s2_height,
                )
            else:
                await loop.run_in_executor(
                    None,
                    self._run_single_stage,
                    script, keyframe_paths, num_frames, fps,
                    output_path, on_progress, loop,
                    out_width, out_height,
                )
        except Exception as exc:
            logger.exception("[LTX2] Generation error: %s", exc)
            # Best-effort cleanup even on failure so VRAM is not permanently held.
            import gc as _gc, torch as _torch
            _gc.collect()
            if _torch.cuda.is_available():
                _torch.cuda.empty_cache()
            return VideoResult(success=False, error=str(exc))

        # Final sweep — the thread pool keeps local references alive until GC runs.
        import gc as _gc, torch as _torch
        _gc.collect()
        if _torch.cuda.is_available():
            _torch.cuda.empty_cache()

        return VideoResult(
            success=True,
            output_path=str(relative_output),
            duration_seconds=duration_s,
            metadata={
                "provider":   self.provider_id,
                "pipeline":   "two_stage_720p" if upsampler_file else "single_stage_720p",
                "num_frames": num_frames,
                "fps":        fps,
            },
        )

    # ── Blocking inference helpers (run in thread pool) ───────────────────────

    def _run_single_stage(
        self,
        script: str,
        keyframe_paths: list[str],
        num_frames: int,
        fps: int,
        output_path: Path,
        on_progress: Optional[Callable],
        loop: asyncio.AbstractEventLoop,
        width: int,
        height: int,
    ) -> None:
        import torch
        from diffusers.utils import export_to_video
        from PIL import Image

        # Prefer the Wan2GP TI2Vid one-stage pipeline (uses mmgp offload and
        # the official LTX2 component loader) when available, but fall back
        # to the diffusers-based pipeline if imports or runtime fail.
        try:
            from app.providers.modelpipline.ltx2.ltx_pipelines.ti2vid_one_stage import (
                TI2VidOneStagePipeline,
            )
            from app.providers.modelpipline.ltx2.ltx_pipelines.utils.constants import (
                DEFAULT_CFG_GUIDANCE_SCALE,
                DEFAULT_NEGATIVE_PROMPT,
                AUDIO_SAMPLE_RATE,
            )
            from app.providers.modelpipline.ltx2.ltx_pipelines.utils.media_io import (
                encode_video as _wan_encode_video,
            )

            checkpoint_path = self.find_diffusion_model()
            gemma_root      = self.text_encoders_path()

            pipeline = TI2VidOneStagePipeline(
                checkpoint_path=str(checkpoint_path),
                gemma_root=str(gemma_root),
                loras=[],
            )

            # Prepare keyframe conditioning as image sequence for TI2Vid.
            images: list[tuple[str, int, float]] = []
            if keyframe_paths:
                keyframe_path = _resolve_keyframe_path(keyframe_paths[0])
                images.append((str(keyframe_path), 0, 1.0))

            self._report(
                on_progress,
                loop,
                5,
                "Loading LTX-Video 2 pipeline (TI2Vid one-stage)…",
            )

            video, audio = pipeline(
                prompt=script,
                negative_prompt=DEFAULT_NEGATIVE_PROMPT,
                seed=42,
                height=height,
                width=width,
                num_frames=num_frames,
                frame_rate=float(fps),
                num_inference_steps=_DEFAULT_STEPS,
                cfg_guidance_scale=DEFAULT_CFG_GUIDANCE_SCALE,
                images=images,
            )

            self._report(on_progress, loop, 92, "Encoding video (TI2Vid)…")

            _wan_encode_video(
                video=video,
                fps=float(fps),
                audio=audio,
                audio_sample_rate=AUDIO_SAMPLE_RATE,
                output_path=str(output_path),
                video_chunks_number=1,
            )

            self._report(
                on_progress,
                loop,
                100,
                f"Done — {width}×{height} video saved (TI2Vid).",
            )
            return
        except Exception as exc:
            logger.exception(
                "[LTX2] TI2Vid one-stage pipeline failed, falling back to diffusers: %s",
                exc,
            )

        # Fallback: original diffusers-based single-stage pipeline.
        self._report(on_progress, loop, 5, "Loading LTX-Video 2 pipeline…")
        first_frame = (
            Image.open(_resolve_keyframe_path(keyframe_paths[0])).convert("RGB")
            if keyframe_paths
            else None
        )
        pipe = self._build_pipeline(has_image=first_frame is not None)

        self._report(on_progress, loop, 20, f"Generating {width}×{height} video…")

        step_count = [0]

        def _cb(pipeline, i: int, t, cb_kwargs: dict) -> dict:
            step_count[0] = i
            pct = 20 + int(i / _DEFAULT_STEPS * 70)
            self._report(on_progress, loop, pct, f"Denoising {i}/{_DEFAULT_STEPS}…")
            return cb_kwargs

        gen_kwargs: dict[str, Any] = dict(
            prompt               = script,
            negative_prompt      = (
                "worst quality, inconsistent motion, blurry, jittery, distorted"
            ),
            height               = height,
            width                = width,
            num_frames           = num_frames,
            num_inference_steps  = _DEFAULT_STEPS,
            guidance_scale       = _DEFAULT_GUIDANCE,
            generator            = torch.Generator("cuda").manual_seed(42),
            output_type          = "pil",
            callback_on_step_end = _cb,
        )
        if first_frame is not None:
            gen_kwargs["image"] = first_frame

        out    = pipe(**gen_kwargs)
        frames = out.frames[0]

        self._report(on_progress, loop, 92, "Encoding video…")
        export_to_video(frames, str(output_path), fps=fps)
        self._report(on_progress, loop, 100, f"Done — {width}×{height} video saved.")

    def _run_two_stage(
        self,
        script: str,
        keyframe_paths: list[str],
        num_frames: int,
        fps: int,
        output_path: Path,
        on_progress: Optional[Callable],
        loop: asyncio.AbstractEventLoop,
        upsampler_file: Path,
        video_vae_file: Path,
        s1_width: int,
        s1_height: int,
        s2_width: int,
        s2_height: int,
    ) -> None:
        """
        Two-stage pipeline: Stage 1 at s1 (half of s2), Stage 2 upsample to s2.
        Dimensions must be multiples of 64 (e.g. 1280×704 or 704×1280).
        """
        import gc
        import torch
        from diffusers.utils import export_to_video
        from PIL import Image

        self._report(on_progress, loop, 5, "Loading LTX-Video 2 pipeline (two-stage)…")
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype  = torch.bfloat16

        if keyframe_paths:
            _kf_img = Image.open(_resolve_keyframe_path(keyframe_paths[0])).convert("RGB")
            # Pre-resize to Stage 1 dimensions so the VAE encodes at the exact target
            # spatial resolution — ensures latent dims match prepare_latents mask dims.
            first_frame = _kf_img.resize((s1_width, s1_height), Image.LANCZOS)
            del _kf_img
        else:
            first_frame = None
        pipe   = self._build_pipeline(has_image=first_frame is not None)

        # ── Stage 1: denoise at half-res, output latent ───────────────────────
        self._report(on_progress, loop, 15, f"Stage 1: generating at {s1_width}×{s1_height}…")

        def _cb_s1(pipeline, i: int, t, cb_kwargs: dict) -> dict:
            pct = 15 + int(i / _DEFAULT_STEPS * 40)
            self._report(on_progress, loop, pct, f"Stage 1 — step {i}/{_DEFAULT_STEPS}…")
            return cb_kwargs

        s1_kwargs: dict[str, Any] = dict(
            prompt               = script,
            negative_prompt      = (
                "worst quality, inconsistent motion, blurry, jittery, distorted"
            ),
            height               = s1_height,
            width                = s1_width,
            num_frames           = num_frames,
            num_inference_steps  = _DEFAULT_STEPS,
            guidance_scale       = _DEFAULT_GUIDANCE,
            generator            = torch.Generator("cuda").manual_seed(42),
            output_type          = "latent",
            callback_on_step_end = _cb_s1,
        )
        if first_frame is not None:
            s1_kwargs["image"] = first_frame

        s1_out    = pipe(**s1_kwargs)
        latent_s1 = s1_out.frames      # raw latent tensor from the pipeline

        # Free Stage 1 pipeline (transformer ~38 GB + Gemma ~24 GB + connectors)
        # before loading the lightweight upsampler (~1 GB VAE + upsampler weights).
        del pipe, s1_out
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.synchronize()
            torch.cuda.empty_cache()
        logger.info(
            "[LTX2] Stage 1 done — freed main pipeline. VRAM now: %.1f GB",
            torch.cuda.memory_allocated() / 1e9 if torch.cuda.is_available() else 0,
        )

        # ── Stage 2: 2× spatial upsample → target size ────────────────────────
        self._report(on_progress, loop, 60, f"Stage 2: upsampling to {s2_width}×{s2_height}…")
        upsample_pipe = self._build_upsampler_pipeline(
            video_vae_file, upsampler_file, device, dtype
        )

        s2_out = upsample_pipe(
            latents            = latent_s1,
            latents_normalized = True,     # stage-1 output is already in normalised space
            height             = s2_height,
            width              = s2_width,
            num_frames         = num_frames,
            output_type        = "pil",
        )
        frames = s2_out.frames[0]

        self._report(on_progress, loop, 92, "Encoding video…")
        export_to_video(frames, str(output_path), fps=fps)
        self._report(on_progress, loop, 100, f"Done — {s2_width}×{s2_height} two-stage video saved.")


# ── Key remapping ─────────────────────────────────────────────────────────────

def _remap_connector_keys(
    sd: dict[str, Any],
    dtype: Any,
) -> dict[str, Any]:
    """
    Remap ComfyUI-packaged embeddings connector keys → diffusers LTX2TextConnectors format.

    ComfyUI → diffusers:
      model.diffusion_model.audio_embeddings_connector.transformer_1d_blocks.N.attn1.k_norm.weight
      → audio_connector.transformer_blocks.N.attn1.norm_k.weight

      model.diffusion_model.video_embeddings_connector.transformer_1d_blocks.N.attn1.q_norm.weight
      → video_connector.transformer_blocks.N.attn1.norm_q.weight
    """
    import torch

    out: dict[str, Any] = {}
    for k, v in sd.items():
        # Strip the diffusion model container prefix
        k = k.replace("model.diffusion_model.", "", 1)

        # Rename connector sub-modules
        k = k.replace("audio_embeddings_connector.", "audio_connector.")
        k = k.replace("video_embeddings_connector.", "video_connector.")

        # Block list rename
        k = k.replace(".transformer_1d_blocks.", ".transformer_blocks.")

        # Attention norm key swap (ComfyUI: k_norm / q_norm → diffusers: norm_k / norm_q)
        k = k.replace(".attn1.k_norm.", ".attn1.norm_k.")
        k = k.replace(".attn1.q_norm.", ".attn1.norm_q.")

        # Text projection linear (ComfyUI → diffusers)
        k = k.replace(
            "text_embedding_projection.aggregate_embed.weight",
            "text_proj_in.weight",
        )

        out[k] = v.to(dtype) if v.is_floating_point() else v

    return out
