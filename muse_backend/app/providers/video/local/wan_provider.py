"""
Motion Muse — Local Video Provider: Wan 2.2 I2V (Image-to-Video, 14B)

Source weights:
  fp16       : Comfy-Org/Wan_2.2_ComfyUI_Repackaged
               split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp16.safetensors  (26.6 GB)
               split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp16.safetensors   (26.6 GB)
  fp8        : split_files/diffusion_models/wan2.2_i2v_high_noise_14B_fp8_scaled.safetensors (13.3 GB)
               split_files/diffusion_models/wan2.2_i2v_low_noise_14B_fp8_scaled.safetensors  (13.3 GB)
  gguf       : QuantStack/Wan2.2-I2V-A14B-GGUF
               HighNoise/Wan2.2-I2V-A14B-HighNoise-Q4_K_M.gguf  (9 GB)
               LowNoise/Wan2.2-I2V-A14B-LowNoise-Q4_K_M.gguf    (9 GB)

  text encoder (shared):
               split_files/text_encoders/umt5_xxl_fp16.safetensors          (10.6 GB)
               split_files/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors (6.3 GB)

  vae (shared):
               split_files/vae/wan2.2_vae.safetensors  (1.3 GB)

Local folder structure:
  models/wan2.2/
    diffusion_models/
      wan2.2_i2v_high_noise_14B_fp16.safetensors  (or fp8_scaled)
      wan2.2_i2v_low_noise_14B_fp16.safetensors   (or fp8_scaled)
      OR HighNoise/Wan2.2-I2V-A14B-HighNoise-Q4_K_M.gguf  (gguf)
         LowNoise/Wan2.2-I2V-A14B-LowNoise-Q4_K_M.gguf    (gguf)
    text_encoders/
      umt5_xxl_fp16.safetensors  (or fp8 variant)
    vae/
      wan2.2_vae.safetensors

Note: Wan 2.2 I2V uses separate high-noise and low-noise diffusion models.
Both are required. The scheduler selects which one to use at inference time.
"""

from __future__ import annotations
import asyncio
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from app.providers.base import LocalVideoProvider, VideoResult, ModelFormat


class WanProvider(LocalVideoProvider):
    provider_id = "wan2.2"
    display_name = "Wan 2.2 I2V (Local)"
    model_folder_name = "wan2.2"

    def is_available(self) -> bool:
        dm_path = self.diffusion_models_path()
        if not dm_path.exists():
            return False
        has_model = bool(
            list(dm_path.rglob("*.safetensors")) or
            list(dm_path.rglob("*.gguf"))
        )
        return has_model and self.find_vae() is not None and self.find_text_encoder() is not None

    def unavailable_reason(self) -> Optional[str]:
        if not self.is_available():
            base = self._model_path()
            missing = []
            dm_path = self.diffusion_models_path()
            if not dm_path.exists() or not (list(dm_path.rglob("*.safetensors")) or list(dm_path.rglob("*.gguf"))):
                missing.append("diffusion_models/ (wan2.2_i2v_high/low_noise_14B_{fp16|fp8}.safetensors or GGUF)")
            if self.find_text_encoder() is None:
                missing.append("text_encoders/ (umt5_xxl_fp16.safetensors or fp8 variant)")
            if self.find_vae() is None:
                missing.append("vae/ (wan2.2_vae.safetensors)")
            return (
                f"Missing files in {base}:\n" + "\n".join(f"  - {m}" for m in missing) +
                "\nSee models/README.md. Source: Comfy-Org/Wan_2.2_ComfyUI_Repackaged"
            )
        return None

    def capabilities(self) -> dict[str, Any]:
        return {
            "max_duration_seconds": 10,
            "supported_fps": [16, 24],
            "image_guided": True,
            "text_guided": True,
            "recommended_vram_gb": 16,
            "supported_formats": ["fp16", "fp8", "gguf"],
            "active_format": self.format_summary() if self.is_available() else "N/A",
            "requires": ["diffusion_models (high + low noise)", "text_encoders", "vae"],
            "hf_repo_fp16_fp8": "Comfy-Org/Wan_2.2_ComfyUI_Repackaged",
            "hf_repo_gguf": "QuantStack/Wan2.2-I2V-A14B-GGUF",
        }

    def _find_high_noise_model(self) -> Optional[Path]:
        """Returns the high-noise diffusion model file."""
        dm_dir = self.diffusion_models_path()
        if not dm_dir.exists():
            return None
        # safetensors first
        candidates = sorted(dm_dir.glob("*high_noise*.safetensors"))
        if candidates:
            return candidates[0]
        # GGUF: HighNoise/ subfolder
        gguf_candidates = sorted((dm_dir / "HighNoise").glob("*.gguf")) if (dm_dir / "HighNoise").exists() else []
        return gguf_candidates[0] if gguf_candidates else None

    def _find_low_noise_model(self) -> Optional[Path]:
        """Returns the low-noise diffusion model file."""
        dm_dir = self.diffusion_models_path()
        if not dm_dir.exists():
            return None
        candidates = sorted(dm_dir.glob("*low_noise*.safetensors"))
        if candidates:
            return candidates[0]
        gguf_candidates = sorted((dm_dir / "LowNoise").glob("*.gguf")) if (dm_dir / "LowNoise").exists() else []
        return gguf_candidates[0] if gguf_candidates else None

    async def generate(
        self,
        script: str,
        keyframe_paths: list[str],
        params: dict[str, Any],
        on_progress: Optional[Callable] = None,
    ) -> VideoResult:
        """
        Generates video from scene script + keyframe images via Wan 2.2 I2V.

        TODO: Replace stub with actual Wan 2.2 pipeline.
        Use Wan2GP (https://github.com/deepbeepmeep/Wan2GP) or the official Wan2.2 package
        which supports loading ComfyUI-repackaged split-files directly.

            from wan2gp import Wan2GPPipeline   # or official Wan2.2 package

            high_noise_model = self._find_high_noise_model()
            low_noise_model  = self._find_low_noise_model()
            text_encoder     = self.find_text_encoder(prefer_fp8=True)
            vae_file         = self.find_vae()
            load_kwargs      = self.get_load_kwargs()
            # fp16 → {"torch_dtype": torch.float16, "device_map": "auto"}
            # fp8  → {"load_in_8bit": True, "device_map": "auto"}
            # gguf → load via llama-cpp-python or gguf-compatible loader

            pipe = Wan2GPPipeline.from_split_files(
                high_noise_model=str(high_noise_model),
                low_noise_model=str(low_noise_model),
                text_encoder=str(text_encoder),
                vae=str(vae_file),
                **load_kwargs,
            ).to("cuda")

            first_frame = Image.open(keyframe_paths[0]) if keyframe_paths else None
            video_frames = pipe.i2v(
                image=first_frame,
                prompt=script,
                num_frames=params.get("duration_seconds", 5) * params.get("fps", 24),
                callback=lambda step, _: on_progress and asyncio.ensure_future(
                    on_progress(int(step / total_steps * 100), f"Step {step}")
                ),
            ).frames[0]

            output_path = Path("outputs/video") / f"{uuid.uuid4().hex[:8]}.mp4"
            output_path.parent.mkdir(parents=True, exist_ok=True)
            from diffusers.utils import export_to_video
            export_to_video(video_frames, str(output_path), fps=params.get("fps", 24))
        """

        # ── STUB ──
        output_dir = Path("outputs") / "video"
        output_dir.mkdir(parents=True, exist_ok=True)

        if on_progress:
            for pct in [10, 30, 60, 90, 100]:
                await asyncio.sleep(0.5)
                await on_progress(pct, f"Wan 2.2 generating... {pct}%")

        stub_path = output_dir / f"wan_{uuid.uuid4().hex[:8]}.mp4"

        return VideoResult(
            success=True,
            output_path=str(stub_path),
            duration_seconds=params.get("duration_seconds", 5),
            metadata={
                "provider": self.provider_id,
                "num_keyframes": len(keyframe_paths),
                "format": self.format_summary(),
                "high_noise_model": str(self._find_high_noise_model()) if self._find_high_noise_model() else "not downloaded",
                "low_noise_model": str(self._find_low_noise_model()) if self._find_low_noise_model() else "not downloaded",
                "note": "STUB — model not yet loaded",
            },
        )
