"""
Visual Muse — Step 1: Qwen Image Edit Provider
Generates draft keyframes from reference images + text prompt (img2img editing).

━━━ Source Weights ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Diffusion model (Edit weights):
    Comfy-Org/Qwen-Image-Edit_ComfyUI
      split_files/diffusion_models/qwen_image_edit_2511_bf16.safetensors     (38 GB)
      split_files/diffusion_models/qwen_image_edit_2511_fp8mixed.safetensors (19 GB)
      split_files/diffusion_models/qwen_image_edit_2509_fp8_e4m3fn.safetensors (19 GB)
    GGUF: unsloth/Qwen-Image-Edit-2511-GGUF
      qwen-image-edit-2511-Q4_K_M.gguf   (13 GB, recommended)
      qwen-image-edit-2511-Q8_0.gguf      (22 GB, near-lossless)

  Text encoder (shared with Qwen-Image base model):
    Comfy-Org/Qwen-Image_ComfyUI
      split_files/text_encoders/qwen_2.5_vl_7b.safetensors           (bf16, 15.4 GB)
      split_files/text_encoders/qwen_2.5_vl_7b_fp8_scaled.safetensors (fp8, 8.7 GB)

  VAE (shared with Qwen-Image base model):
    Comfy-Org/Qwen-Image_ComfyUI
      split_files/vae/qwen_image_vae.safetensors                      (242 MB)

━━━ Local Folder Structure ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  models/qwen-image-edit/
    diffusion_models/
      qwen_image_edit_2511_bf16.safetensors     ← bf16 option
      OR qwen_image_edit_2511_fp8mixed.safetensors ← fp8 option
      OR qwen-image-edit-2511-Q4_K_M.gguf          ← gguf option
    text_encoders/
      qwen_2.5_vl_7b.safetensors               ← bf16 option
      OR qwen_2.5_vl_7b_fp8_scaled.safetensors  ← fp8 option (saves ~7 GB VRAM)
    vae/
      qwen_image_vae.safetensors               ← always bf16 (242 MB)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TODO: Replace stub inference with actual pipeline once model files are downloaded.
"""

from __future__ import annotations
import uuid
from pathlib import Path
from typing import Any, Optional

from app.providers.base import ImageDraftProvider, ImageResult, LocalModelLoader, ModelFormat
from app.config import settings


class QwenImageEditProvider(ImageDraftProvider, LocalModelLoader):
    provider_id = "qwen"
    display_name = "Qwen Image Edit 2511"
    provider_type = "local"
    model_folder_name = "qwen-image-edit"

    def is_available(self) -> bool:
        dm_path = self.diffusion_models_path()
        if not dm_path.exists():
            return False
        has_diffusion = bool(list(dm_path.rglob("*.safetensors")) or list(dm_path.rglob("*.gguf")))
        return (
            has_diffusion
            and self.find_text_encoder() is not None
            and self.find_vae() is not None
        )

    def unavailable_reason(self) -> Optional[str]:
        if not self.is_available():
            base = self._model_path()
            missing = []
            dm_path = self.diffusion_models_path()
            if not dm_path.exists() or not (list(dm_path.rglob("*.safetensors")) or list(dm_path.rglob("*.gguf"))):
                missing.append(
                    "diffusion_models/ — download from Comfy-Org/Qwen-Image-Edit_ComfyUI\n"
                    "      (qwen_image_edit_2511_bf16.safetensors or fp8mixed or GGUF Q4_K_M)"
                )
            if self.find_text_encoder() is None:
                missing.append(
                    "text_encoders/ — download from Comfy-Org/Qwen-Image_ComfyUI\n"
                    "      (qwen_2.5_vl_7b.safetensors or qwen_2.5_vl_7b_fp8_scaled.safetensors)"
                )
            if self.find_vae() is None:
                missing.append(
                    "vae/ — download from Comfy-Org/Qwen-Image_ComfyUI\n"
                    "      (qwen_image_vae.safetensors)"
                )
            return (
                f"Missing files in {base}:\n" +
                "\n".join(f"  - {m}" for m in missing) +
                "\nSee models/README.md for full download commands."
            )
        return None

    def capabilities(self) -> dict[str, Any]:
        return {
            "mode": "image_edit",
            "max_reference_images": 5,
            "supported_aspect_ratios": ["16:9", "9:16", "1:1", "4:3"],
            "max_variations": 4,
            "supported_formats": ["bf16", "fp8", "gguf"],
            "active_format": self.format_summary() if self.is_available() else "N/A",
            "requires": ["diffusion_models", "text_encoders (Qwen 2.5 VL 7B)", "vae"],
            "hf_diffusion_edit": "Comfy-Org/Qwen-Image-Edit_ComfyUI",
            "hf_text_encoder_vae": "Comfy-Org/Qwen-Image_ComfyUI",
            "hf_gguf": "unsloth/Qwen-Image-Edit-2511-GGUF",
        }

    async def generate(
        self,
        prompt: str,
        reference_image_paths: list[str],
        params: dict[str, Any],
    ) -> ImageResult:
        """
        Generates draft keyframe(s) using Qwen Image Edit pipeline.

        Three components required (auto-resolved by LocalModelLoader):
          - diffusion model : self.find_diffusion_model()  → edit-specific weights
          - text encoder    : self.find_text_encoder()     → qwen_2.5_vl_7b (bf16 or fp8)
          - VAE             : self.find_vae()              → qwen_image_vae.safetensors

        TODO: Replace stub with actual inference.

        --- Safetensors (bf16 / fp8) path ---
            from diffusers import QwenImageEditPipeline   # adapt to actual package API
            import torch

            diff_model  = self.find_diffusion_model()
            text_enc    = self.find_text_encoder(prefer_fp8=True)
            vae_file    = self.find_vae()
            load_kwargs = self.get_load_kwargs()
            # bf16 → {"torch_dtype": torch.bfloat16, "device_map": "auto"}
            # fp8  → {"load_in_8bit": True, "device_map": "auto"}

            pipe = QwenImageEditPipeline.from_single_file(
                str(diff_model),
                text_encoder=load_component(str(text_enc), **load_kwargs),
                vae=load_component(str(vae_file)),
                **load_kwargs,
            ).to("cuda")

            ref_images = [Image.open(p).convert("RGB") for p in reference_image_paths]
            results = pipe(
                prompt=prompt,
                image=ref_images[0] if ref_images else None,
                num_images_per_prompt=params.get("num_variations", 2),
            ).images

        --- GGUF path ---
            model = self.load_gguf(n_gpu_layers=-1)
            # text encoder and VAE still loaded via safetensors for GGUF path
        """

        # ── STUB ──
        num_variations = params.get("num_variations", 2)
        output_dir = Path("outputs") / "drafts"
        output_dir.mkdir(parents=True, exist_ok=True)

        output_paths = [
            str(output_dir / f"draft_{uuid.uuid4().hex[:8]}_{i}.png")
            for i in range(num_variations)
        ]

        return ImageResult(
            success=True,
            output_paths=output_paths,
            metadata={
                "provider": self.provider_id,
                "prompt": prompt,
                "num_references": len(reference_image_paths),
                "format": self.format_summary(),
                "diffusion_model": str(self.find_diffusion_model()) if self.is_available() else "not downloaded",
                "text_encoder": str(self.find_text_encoder()) if self.find_text_encoder() else "not downloaded",
                "vae": str(self.find_vae()) if self.find_vae() else "not downloaded",
                "note": "STUB — model not yet loaded",
            },
        )
