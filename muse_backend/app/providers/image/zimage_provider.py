"""
Visual Muse — Step 2: Z-Image Turbo Provider
img2img quality refinement of the Step 1 draft image.

Source weights:
  bf16       : Comfy-Org/z_image_turbo
               split_files/diffusion_models/z_image_turbo_bf16.safetensors  (11.5 GB)
  fp4/nvfp4  : Comfy-Org/z_image_turbo
               split_files/diffusion_models/z_image_turbo_nvfp4.safetensors (4.2 GB, RTX 40xx+)
  gguf       : unsloth/Z-Image-Turbo-GGUF

  text encoder (always required):
               split_files/text_encoders/qwen_3_4b.safetensors           (bf16, 7.5 GB)
               split_files/text_encoders/qwen_3_4b_fp8_mixed.safetensors  (fp8, 5.2 GB)
               split_files/text_encoders/qwen_3_4b_fp4_mixed.safetensors  (fp4, 3.2 GB)

  vae (always required):
               split_files/vae/ae.safetensors  (320 MB)

Local folder structure:
  models/zimage-turbo/
    diffusion_models/
      z_image_turbo_bf16.safetensors           ← bf16 option
      OR z_image_turbo_nvfp4.safetensors        ← fp4 option
    text_encoders/
      qwen_3_4b.safetensors                    ← bf16 option
      OR qwen_3_4b_fp8_mixed.safetensors        ← fp8 option
    vae/
      ae.safetensors                           ← always bf16

TODO: Replace stub with actual diffusers pipeline once model files are downloaded.
"""

from __future__ import annotations
import uuid
from pathlib import Path
from typing import Any, Optional

from app.providers.base import ImageRefineProvider, ImageResult, LocalModelLoader, ModelFormat
from app.config import settings


class ZImageTurboProvider(ImageRefineProvider, LocalModelLoader):
    provider_id = "zimage_turbo"
    display_name = "Z-Image Turbo"
    provider_type = "local"
    model_folder_name = "zimage-turbo"

    def is_available(self) -> bool:
        """
        Local Z-Image Turbo has been disabled in this ComfyUI-based version.

        Refinement is handled via ComfyUI workflows instead of local diffusers
        weights under a /models directory, so we deliberately avoid any models/
        folder existence checks here.
        """
        return False

    def unavailable_reason(self) -> Optional[str]:
        if not self.is_available():
            return "Local Z-Image Turbo is disabled; use ComfyUI image workflows instead."
        return None

    def capabilities(self) -> dict[str, Any]:
        return {
            "mode": "img2img",
            "recommended_denoise_range": [0.3, 0.4],
            "max_denoise": 0.6,
            "supported_formats": ["bf16", "fp4", "gguf"],
            "active_format": "disabled",
            "requires": [],
            "hf_repo_bf16_fp4": "Comfy-Org/z_image_turbo",
            "hf_repo_gguf": "unsloth/Z-Image-Turbo-GGUF",
        }

    async def refine(
        self,
        draft_image_path: str,
        prompt: Optional[str],
        params: dict[str, Any],
    ) -> ImageResult:
        """
        Refines a draft keyframe via img2img at low denoise strength.

        TODO: Replace stub with actual diffusers pipeline.

        Z-Image Turbo uses three separate components loaded from split_files:
          1. Diffusion model  → self.find_diffusion_model()
          2. Text encoder     → self.find_text_encoder()
          3. VAE              → self.find_vae()

        Example (adapt to actual Z-Image Turbo / diffusers API):

            from diffusers import AutoPipelineForImage2Image
            from safetensors.torch import load_file
            from PIL import Image
            import torch

            load_kwargs = self.get_load_kwargs()
            # bf16 → {"torch_dtype": torch.bfloat16, "device_map": "auto"}
            # fp4/fp8 → {"load_in_8bit": True, "device_map": "auto"}

            diff_model = self.find_diffusion_model()
            text_enc   = self.find_text_encoder(prefer_fp8=True)
            vae_file   = self.find_vae()

            pipe = AutoPipelineForImage2Image.from_single_file(
                str(diff_model),
                text_encoder=load_text_encoder(str(text_enc), **load_kwargs),
                vae=load_vae(str(vae_file)),
                **load_kwargs,
            ).to("cuda")

            draft_image = Image.open(draft_image_path).convert("RGB")
            result = pipe(
                prompt=prompt or "high quality cinematic keyframe, film grain, sharp",
                image=draft_image,
                strength=params.get("denoise_strength", 0.35),
                num_inference_steps=4,
                guidance_scale=0.0,
            ).images[0]

            output_path = Path("outputs/final") / f"final_{uuid.uuid4().hex[:8]}.png"
            output_path.parent.mkdir(parents=True, exist_ok=True)
            result.save(str(output_path))
        """

        # ── STUB ──
        output_dir = Path("outputs") / "final"
        output_dir.mkdir(parents=True, exist_ok=True)
        stub_path = output_dir / f"final_{uuid.uuid4().hex[:8]}.png"

        return ImageResult(
            success=True,
            output_paths=[str(stub_path)],
            metadata={
                "provider": self.provider_id,
                "draft_source": draft_image_path,
                "denoise_strength": params.get("denoise_strength", 0.35),
                "format": "disabled",
                "diffusion_model": "not used in this version",
                "text_encoder": "not used in this version",
                "vae": "not used in this version",
                "note": "STUB — local Z-Image Turbo is disabled; ComfyUI handles refinement.",
            },
        )
