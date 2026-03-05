"""
Visual Muse — Image Provider: FLUX.2-klein-9B
Lightweight 9B text-to-image and reference-to-image generation.

━━━ Pipeline ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  diffusers class:   Flux2KleinPipeline (diffusers 0.37+)
  Transformer:       Flux2Transformer2DModel  — 8 double + 24 single blocks, 4096 dim
  Text encoder:      Qwen 3 8B (hidden states layers 9, 18, 27 → concat → 12288 dim)
  Tokenizer:         Qwen2TokenizerFast (config from HF cache, weights local)
  VAE:               AutoencoderKLFlux2 (custom ComfyUI→diffusers key mapping)
  Scheduler:         FlowMatchEulerDiscreteScheduler

━━━ Local Folder Structure ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  models/flux-klein/
    diffusion_models/
      flux-2-klein-9b.safetensors         (17 GB, bf16)
    text_encoders/
      qwen_3_8b.safetensors               (15.3 GB, bf16)
      OR qwen_3_8b_fp8mixed.safetensors   (8.1 GB, fp8, recommended)
    vae/
      flux2-vae.safetensors               (321 MB)

━━━ Reference ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  HuggingFace: black-forest-labs/FLUX.2-klein-4B (same pipeline, larger 9B variant)
  ComfyUI:     blueprints/Image Edit (Flux.2 Klein 4B).json

━━━ License ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  FLUX Non-Commercial License — not for commercial use.
"""

from __future__ import annotations
import gc
import re
import uuid
import logging
from pathlib import Path
from typing import Any, Optional

from app.providers.base import ImageDraftProvider, ImageResult, LocalModelLoader
from app.config import settings

logger = logging.getLogger(__name__)

# ── FLUX.2-Klein-9B transformer config (derived from weight shapes) ───────────
# 32 heads × 128 head_dim = 4096 inner_dim; text_encoder → 3 × 4096 = 12288
_KLEIN_TRANSFORMER_CFG = dict(
    num_attention_heads=32,
    num_single_layers=24,
    joint_attention_dim=12288,
    low_cpu_mem_usage=False,   # fallback only — primary path uses device_map
)
# Qwen 3 8B has 36 layers; use layers 9, 18, 27 for text conditioning
_KLEIN_TEXT_HIDDEN_LAYERS = (9, 18, 27)

_ASPECT_SIZES: dict[str, tuple[int, int]] = {
    "16:9":  (1280, 720),
    "9:16":  (720, 1280),
    "1:1":   (1024, 1024),
    "4:3":   (1024, 768),
    "21:9":  (1680, 720),
}


# ── VAE ComfyUI → diffusers key conversion ────────────────────────────────────

_NUM_DECODER_BLOCKS = 4


def _convert_vae_state_dict(comfy_sd: dict) -> dict:
    """
    Convert ComfyUI/BFL-format VAE state dict → diffusers AutoencoderKLFlux2 format.

    Key differences vs standard diffusers:
    - quant_conv is prefixed with encoder./decoder. in ComfyUI
    - Decoder up blocks are stored in REVERSED order (ComfyUI up.0 = diffusers up_blocks.3)
    - Attention weights are 4-D Conv2d [C,C,1,1] vs 2-D Linear [C,C]
    - Residual shortcuts are named nin_shortcut vs conv_shortcut
    - Mid-block attention/resnet naming differs
    """
    out = {}
    for k, v in comfy_sd.items():
        new_k = k

        # ── quant/post-quant convs ────────────────────────────────────────
        new_k = re.sub(r"^encoder\.quant_conv\.", "quant_conv.", new_k)
        new_k = re.sub(r"^decoder\.post_quant_conv\.", "post_quant_conv.", new_k)

        # ── nin_shortcut → conv_shortcut ─────────────────────────────────
        new_k = new_k.replace(".nin_shortcut.", ".conv_shortcut.")

        # ── mid block (same structure for encoder and decoder) ────────────
        for prefix in ("encoder", "decoder"):
            new_k = new_k.replace(f"{prefix}.mid.attn_1.q.",        f"{prefix}.mid_block.attentions.0.to_q.")
            new_k = new_k.replace(f"{prefix}.mid.attn_1.k.",        f"{prefix}.mid_block.attentions.0.to_k.")
            new_k = new_k.replace(f"{prefix}.mid.attn_1.v.",        f"{prefix}.mid_block.attentions.0.to_v.")
            new_k = new_k.replace(f"{prefix}.mid.attn_1.proj_out.", f"{prefix}.mid_block.attentions.0.to_out.0.")
            new_k = new_k.replace(f"{prefix}.mid.attn_1.norm.",     f"{prefix}.mid_block.attentions.0.group_norm.")
            new_k = new_k.replace(f"{prefix}.mid.block_1.",         f"{prefix}.mid_block.resnets.0.")
            new_k = new_k.replace(f"{prefix}.mid.block_2.",         f"{prefix}.mid_block.resnets.1.")
            new_k = new_k.replace(f"{prefix}.norm_out.",            f"{prefix}.conv_norm_out.")

        # ── encoder down blocks (direct index) ───────────────────────────
        new_k = re.sub(
            r"encoder\.down\.(\d+)\.block\.(\d+)\.",
            lambda m: f"encoder.down_blocks.{m.group(1)}.resnets.{m.group(2)}.",
            new_k,
        )
        new_k = re.sub(
            r"encoder\.down\.(\d+)\.downsample\.conv\.",
            lambda m: f"encoder.down_blocks.{m.group(1)}.downsamplers.0.conv.",
            new_k,
        )

        # ── decoder up blocks (REVERSED: ComfyUI up.X = diffusers up_blocks.{3-X}) ──
        new_k = re.sub(
            r"decoder\.up\.(\d+)\.block\.(\d+)\.",
            lambda m: f"decoder.up_blocks.{_NUM_DECODER_BLOCKS - 1 - int(m.group(1))}.resnets.{m.group(2)}.",
            new_k,
        )
        new_k = re.sub(
            r"decoder\.up\.(\d+)\.upsample\.conv\.",
            lambda m: f"decoder.up_blocks.{_NUM_DECODER_BLOCKS - 1 - int(m.group(1))}.upsamplers.0.conv.",
            new_k,
        )

        # ── squeeze Conv2d [C,C,1,1] attention weights → Linear [C,C] ────
        if any(tok in new_k for tok in (".to_q.", ".to_k.", ".to_v.", ".to_out.0.")):
            if v.ndim == 4 and v.shape[-2:] == (1, 1):
                v = v.squeeze(-1).squeeze(-1)

        out[new_k] = v
    return out


# ── Provider ─────────────────────────────────────────────────────────────────

class FluxKleinProvider(ImageDraftProvider, LocalModelLoader):
    provider_id = "flux_klein"
    display_name = "FLUX.2-klein 9B"
    provider_type = "local"
    model_folder_name = "flux-klein"

    # Lazy-loaded pipeline shared across all instances (singleton)
    _pipeline: Any = None

    # ── Availability ──────────────────────────────────────────────────────

    def _models_downloaded(self) -> bool:
        """
        Local FLUX.2-Klein has been disabled in this ComfyUI-based version.

        Draft image generation is handled via ComfyUI workflows now, so we no
        longer check for any models/ folder or local weights here.
        """
        return False

    def is_available(self) -> bool:
        return True

    def unavailable_reason(self) -> Optional[str]:
        return None

    def capabilities(self) -> dict[str, Any]:
        return {
            "modes": ["text2image", "reference2image"],
            "model_size": "9B",
            "supported_aspect_ratios": list(_ASPECT_SIZES.keys()),
            "max_reference_images": 4,
            "max_variations": 4,
            "supported_formats": ["bf16", "fp8"],
        }

    # ── Pipeline loading ──────────────────────────────────────────────────

    def _load_pipeline(self) -> Any:
        """
        Load all FLUX.2-Klein components and assemble Flux2KleinPipeline.

        Memory strategy (requires PyTorch ≥ 2.1 + accelerate):
        ─────────────────────────────────────────────────────────────────
        All three heavy components use the same zero-copy pattern:
          1. init_empty_weights()  → model lives on "meta" device (0 RAM, 0 VRAM)
          2. st_load(device=cuda)  → weights land directly in VRAM
          3. load_state_dict(assign=True) → state-dict tensors BECOME model
                                           params — no copy, no RAM spike
          4. del state_dict        → reference released; model owns tensors

        Result: peak RAM ≈ OS overhead only (~2–3 GB).
                peak VRAM ≈ largest single component (~17 GB for transformer).

        Fallback: if init_empty_weights/assign fails for any component,
        the code falls back to CPU-load → .to(device) (the old behavior).
        """
        import torch
        from accelerate import init_empty_weights
        from diffusers import (
            Flux2KleinPipeline,
            Flux2Transformer2DModel,
            AutoencoderKLFlux2,
            FlowMatchEulerDiscreteScheduler,
        )
        from transformers import Qwen3ForCausalLM, Qwen2TokenizerFast, Qwen3Config
        from safetensors.torch import load_file as st_load

        dtype  = torch.bfloat16
        device = "cuda" if torch.cuda.is_available() else "cpu"

        diff_model = self.find_diffusion_model()
        te_file    = self.find_text_encoder()
        vae_file   = self.find_vae()

        if not diff_model or not te_file or not vae_file:
            raise RuntimeError(
                "FLUX.2-Klein model files not found. "
                "Expected: models/flux-klein/{diffusion_models,text_encoders,vae}/"
            )

        def _flush(label: str) -> None:
            """GC + CUDA cache flush between large component loads."""
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            if torch.cuda.is_available():
                used = torch.cuda.memory_allocated() / 1e9
                logger.info("[Flux2Klein] %s — VRAM in use: %.1f GB", label, used)

        def _cast_state_dict(sd: dict) -> dict:
            """Cast all float32 tensors to bfloat16 in-place (saves VRAM)."""
            return {
                k: (v.to(dtype) if v.is_floating_point() and v.dtype != dtype else v)
                for k, v in sd.items()
            }

        # ── 1. Transformer ───────────────────────────────────────────────────
        # Primary: load to CPU then dispatch to VRAM (avoids meta tensors left by
        # load_model_dict_into_meta when device_map is used with low_cpu_mem_usage=True).
        # Fallback: same but without device_map, then .to(device) (RAM spike).
        transformer_model_cfg = {
            k: v for k, v in _KLEIN_TRANSFORMER_CFG.items() if k != "low_cpu_mem_usage"
        }
        logger.info("[Flux2Klein] Loading transformer (%s) ...", diff_model.name)
        try:
            transformer = Flux2Transformer2DModel.from_single_file(
                str(diff_model),
                torch_dtype=dtype,
                device_map={"": device},
                low_cpu_mem_usage=False,  # avoid meta tensors; load to CPU then dispatch to device
                **transformer_model_cfg,
            )
            logger.info("[Flux2Klein] Transformer loaded to %s.", device)
        except Exception as exc:
            logger.warning(
                "[Flux2Klein] Direct-VRAM transformer load failed (%s). "
                "Falling back to CPU→CUDA (RAM spike expected).", exc,
            )
            transformer = Flux2Transformer2DModel.from_single_file(
                str(diff_model),
                torch_dtype=dtype,
                **_KLEIN_TRANSFORMER_CFG,
            ).to(device)
        _flush("after transformer")

        # ── 2. Text encoder (Qwen 3 8B) ──────────────────────────────────────
        # init_empty_weights creates meta tensors (0 memory).
        # st_load puts 15 GB straight into VRAM.
        # assign=True makes those VRAM tensors the model's parameters — no copy.
        logger.info("[Flux2Klein] Loading Qwen3 tokenizer ...")
        tokenizer = Qwen2TokenizerFast.from_pretrained("Qwen/Qwen3-8B")

        logger.info("[Flux2Klein] Loading text encoder (%s) ...", te_file.name)
        te_config = Qwen3Config.from_pretrained("Qwen/Qwen3-8B")
        try:
            with init_empty_weights():
                text_encoder = Qwen3ForCausalLM(te_config)
            te_state = _cast_state_dict(st_load(str(te_file), device=device))
            text_encoder.load_state_dict(te_state, assign=True, strict=True)
            del te_state
            text_encoder.eval()
            logger.info("[Flux2Klein] Text encoder loaded directly to %s (zero RAM).", device)
        except Exception as exc:
            logger.warning(
                "[Flux2Klein] Direct-VRAM text encoder load failed (%s). "
                "Falling back to CPU→CUDA.", exc,
            )
            text_encoder = Qwen3ForCausalLM(te_config).to(dtype)
            te_state = st_load(str(te_file), device="cpu")
            text_encoder.load_state_dict(te_state, strict=True)
            del te_state
            text_encoder = text_encoder.to(device)
            text_encoder.eval()
        _flush("after text encoder")

        # ── 3. VAE (ComfyUI → diffusers key conversion) ──────────────────────
        # Load VAE weights to VRAM, remap keys (squeeze ops on CUDA are fine),
        # then assign directly — no CPU round-trip.
        logger.info("[Flux2Klein] Loading VAE (%s) ...", vae_file.name)
        try:
            vae_raw = _cast_state_dict(st_load(str(vae_file), device=device))
            vae_sd  = _convert_vae_state_dict(vae_raw)
            del vae_raw
            with init_empty_weights():
                vae = AutoencoderKLFlux2()
            vae.load_state_dict(vae_sd, assign=True, strict=True)
            del vae_sd
            logger.info("[Flux2Klein] VAE loaded directly to %s (zero RAM).", device)
        except Exception as exc:
            logger.warning(
                "[Flux2Klein] Direct-VRAM VAE load failed (%s). "
                "Falling back to CPU→CUDA.", exc,
            )
            vae_raw = st_load(str(vae_file), device="cpu")
            vae_sd  = _convert_vae_state_dict(vae_raw)
            del vae_raw
            vae = AutoencoderKLFlux2()
            vae.load_state_dict(vae_sd, strict=True)
            vae = vae.to(device=device, dtype=dtype)
            del vae_sd
        _flush("after VAE")

        # ── 4. Scheduler ─────────────────────────────────────────────────────
        scheduler = FlowMatchEulerDiscreteScheduler(shift=1.0, use_dynamic_shifting=False)

        # ── 5. Assemble pipeline ─────────────────────────────────────────────
        pipe = Flux2KleinPipeline(
            scheduler=scheduler,
            vae=vae,
            text_encoder=text_encoder,
            tokenizer=tokenizer,
            transformer=transformer,
            is_distilled=False,
        )

        # ── 6. Apply CPU offload strategy (from muse_config.json) ────────────
        # Read directly from config at load time so hot-reload via
        # settings.reload_from_file() + unload_pipeline() picks up changes.
        from app.config import _get as _cfg_get
        offload = (_cfg_get("inference.flux_klein_offload") or "none").strip().lower()
        if offload == "sequential":
            pipe.enable_sequential_cpu_offload()
            logger.info("[Flux2Klein] Sequential CPU offload enabled (minimum VRAM).")
        elif offload == "model":
            pipe.enable_model_cpu_offload()
            logger.info("[Flux2Klein] Model CPU offload enabled.")
        else:
            logger.info("[Flux2Klein] No CPU offload — all components on %s.", device)

        _flush("pipeline ready")
        logger.info("[Flux2Klein] Pipeline assembled successfully.")
        return pipe

    def _get_pipeline(self) -> Any:
        if FluxKleinProvider._pipeline is None:
            FluxKleinProvider._pipeline = self._load_pipeline()
        return FluxKleinProvider._pipeline

    @classmethod
    def unload_pipeline(cls) -> None:
        """
        Fully unload the cached pipeline and release all VRAM / RAM.
        Call this when the model is no longer needed (e.g. before loading another large model).
        """
        import torch
        if cls._pipeline is not None:
            logger.info("[Flux2Klein] Unloading pipeline and freeing memory …")
            pipe = cls._pipeline
            cls._pipeline = None
            # Move all sub-models to CPU first so CUDA tensors are freed
            for attr in ("transformer", "text_encoder", "vae"):
                model = getattr(pipe, attr, None)
                if model is not None:
                    try:
                        model.to("cpu")
                    except Exception:
                        pass
            del pipe
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        logger.info("[Flux2Klein] Pipeline unloaded.")

    # ── Inference ─────────────────────────────────────────────────────────

    async def generate(
        self,
        prompt: str,
        reference_image_paths: list[str],
        params: dict[str, Any],
    ) -> ImageResult:
        if self._models_downloaded():
            return await self._generate_real(prompt, reference_image_paths, params)
        else:
            return self._generate_stub(prompt, reference_image_paths, params)

    async def _generate_real(
        self,
        prompt: str,
        reference_image_paths: list[str],
        params: dict[str, Any],
    ) -> ImageResult:
        import asyncio
        import torch
        from PIL import Image as PILImage

        num_variations  = max(1, int(params.get("num_variations", 1)))
        aspect          = params.get("aspect_ratio", "16:9")
        width, height   = _ASPECT_SIZES.get(aspect, (1280, 720))
        mode = "reference2image" if reference_image_paths else "text2image"

        output_dir = settings.outputs_path / "drafts"
        output_dir.mkdir(parents=True, exist_ok=True)

        def _run_sync() -> list[str]:
            pipe = self._get_pipeline()
            dev  = pipe.transformer.device

            # Load reference images (supports up to 4 per FLUX.2-Klein spec)
            ref_images: list[PILImage.Image] = []
            for ref_path in reference_image_paths[:4]:
                try:
                    img = PILImage.open(ref_path).convert("RGB")
                    # Resize to the target resolution so the VAE sees consistent sizes
                    img = img.resize((width, height), PILImage.LANCZOS)
                    ref_images.append(img)
                    logger.info("[Flux2Klein] Loaded reference image: %s (%dx%d)", ref_path, width, height)
                except Exception as exc:
                    logger.warning("[Flux2Klein] Could not load reference %s: %s", ref_path, exc)

            paths: list[str] = []
            try:
                for i in range(num_variations):
                    seed = torch.randint(0, 2**32 - 1, (1,)).item()
                    generator = torch.Generator(device=dev).manual_seed(seed)

                    call_kwargs: dict[str, Any] = dict(
                        prompt=prompt,
                        height=height,
                        width=width,
                        num_inference_steps=20,
                        guidance_scale=3.5,
                        generator=generator,
                        output_type="pil",
                        text_encoder_out_layers=_KLEIN_TEXT_HIDDEN_LAYERS,
                    )
                    if ref_images:
                        call_kwargs["image"] = ref_images

                    logger.info(
                        "[Flux2Klein] Generating variation %d/%d (seed=%d, mode=%s) ...",
                        i + 1, num_variations, seed, mode,
                    )
                    result = pipe(**call_kwargs)

                    # Extract PIL image and immediately release the pipeline result tensor
                    out_img = result.images[0]
                    del result
                    del generator

                    fname    = f"flux_klein_{uuid.uuid4().hex[:8]}_{i}.png"
                    abs_path = output_dir / fname
                    out_img.save(str(abs_path))
                    del out_img
                    paths.append(f"drafts/{fname}")
                    logger.info("[Flux2Klein] Saved → %s", fname)

                    # Flush CUDA cache after each variation so peak VRAM stays low
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()

            finally:
                # Always release reference PIL images and run a full GC pass
                del ref_images
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                    torch.cuda.synchronize()
                logger.info("[Flux2Klein] Post-inference cleanup done.")

            return paths

        loop = asyncio.get_event_loop()
        rel_paths = await loop.run_in_executor(None, _run_sync)

        return ImageResult(
            success=True,
            output_paths=rel_paths,
            metadata={
                "provider": self.provider_id,
                "mode": mode,
                "prompt": prompt,
                "num_references": len(reference_image_paths),
                "resolution": f"{width}x{height}",
            },
        )

    # ── Stub (when model not downloaded) ─────────────────────────────────

    def _generate_stub(
        self,
        prompt: str,
        reference_image_paths: list[str],
        params: dict[str, Any],
    ) -> ImageResult:
        num_variations = max(1, int(params.get("num_variations", 2)))
        mode           = "reference2image" if reference_image_paths else "text2image"
        aspect         = params.get("aspect_ratio", "16:9")
        width, height  = _ASPECT_SIZES.get(aspect, (1280, 720))

        output_dir = settings.outputs_path / "drafts"
        output_dir.mkdir(parents=True, exist_ok=True)

        abs_paths: list[Path] = []
        rel_paths: list[str] = []
        for i in range(num_variations):
            fname = f"flux_klein_{uuid.uuid4().hex[:8]}_{i}.png"
            abs_paths.append(output_dir / fname)
            rel_paths.append(f"drafts/{fname}")

        try:
            from PIL import Image, ImageDraw, ImageFont

            ref_img: Optional[Image.Image] = None
            if reference_image_paths:
                try:
                    ref_img = Image.open(reference_image_paths[0]).convert("RGB")
                    ref_img = ref_img.resize((width, height), Image.LANCZOS)
                except Exception:
                    ref_img = None

            for i, abs_path in enumerate(abs_paths):
                canvas = ref_img.copy() if ref_img else Image.new("RGB", (width, height), (18, 18, 28))
                draw   = ImageDraw.Draw(canvas)
                bh     = max(48, height // 10)
                draw.rectangle([(0, height - bh), (width, height)], fill=(0, 0, 0))
                label   = f"FLUX.2-Klein [STUB] | {mode} | {i + 1}/{num_variations}"
                preview = (prompt[:80] + "...") if len(prompt) > 80 else prompt
                try:
                    font  = ImageFont.truetype("arial.ttf", max(14, height // 40))
                    small = ImageFont.truetype("arial.ttf", max(11, height // 55))
                except OSError:
                    font = small = ImageFont.load_default()
                draw.text((12, height - bh + 6),  label,   fill=(100, 180, 255), font=font)
                draw.text((12, height - bh + 28), preview, fill=(180, 180, 180), font=small)
                canvas.save(str(abs_path), format="PNG")

        except ImportError:
            _MIN_PNG = (
                b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
                b"\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00"
                b"\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18"
                b"\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
            )
            for p in abs_paths:
                p.write_bytes(_MIN_PNG)

        return ImageResult(
            success=True,
            output_paths=rel_paths,
            metadata={"provider": self.provider_id, "mode": mode, "note": "STUB — model not downloaded."},
        )
