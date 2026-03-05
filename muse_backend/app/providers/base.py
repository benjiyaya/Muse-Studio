"""
Abstract base classes for all Muse provider adapters.

Design principle: Next.js only calls capability endpoints (/generate/draft, etc.).
These base classes define the stable contract. Swapping a model = adding a new subclass.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncGenerator, AsyncIterator, Literal, Optional
from pathlib import Path


# ── Model format enum ─────────────────────────────────────────────────────────

class ModelFormat(str, Enum):
    """
    Quantization format for locally-hosted AI models.

    BF16  — BFloat16. Full-weight, best quality. Requires most VRAM.
             Recommended for: RTX 30xx / 40xx with 8 GB+ VRAM.
             Loaded via: transformers / diffusers with torch_dtype=torch.bfloat16

    FP8   — Float8 (e4m3fn). ~50% VRAM vs bf16, near-lossless quality.
             Requires: RTX 40xx Ada Lovelace architecture or newer.
             Loaded via: transformers with load_in_8bit=True or quanto/bitsandbytes fp8

    GGUF  — GPT-Generated Unified Format. Flexible quantization levels (Q4_K_M, Q5_K_M, Q8_0, etc.)
             Runs on lower VRAM GPUs; tradeoff between size and quality.
             Loaded via: llama-cpp-python (compiled with CUDA support)
    """
    BF16 = "bf16"
    FP16 = "fp16"
    FP8 = "fp8"
    FP4 = "fp4"
    GGUF = "gguf"


# ── Result types ──────────────────────────────────────────────────────────────

@dataclass
class ImageResult:
    success: bool
    output_paths: list[str] = field(default_factory=list)
    error: Optional[str] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class VideoResult:
    success: bool
    output_path: Optional[str] = None
    error: Optional[str] = None
    duration_seconds: Optional[float] = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class LLMChunk:
    text: str
    is_final: bool = False
    metadata: dict[str, Any] = field(default_factory=dict)


# ── Format-aware model loader ─────────────────────────────────────────────────

class LocalModelLoader:
    """
    Utility mixin for local providers.

    Understands the ComfyUI split-files folder structure:
        models/{model_name}/
            diffusion_models/   ← main model weights (.safetensors or .gguf)
            text_encoders/      ← separate text encoder weights
            vae/                ← separate VAE weights

    Supports bf16, fp16, fp8, fp4, and gguf formats.
    Format is configured per-model in muse_config.json → model_formats.
    """

    model_folder_name: str  # defined by the concrete provider class

    def _model_path(self) -> Path:
        from app.config import settings
        return settings.get_model_path(self.model_folder_name)

    # ── Sub-folder accessors ──────────────────────────────────────────────────

    def diffusion_models_path(self) -> Path:
        return self._model_path() / "diffusion_models"

    def text_encoders_path(self) -> Path:
        return self._model_path() / "text_encoders"

    def vae_path(self) -> Path:
        return self._model_path() / "vae"

    def find_diffusion_model(self) -> Optional[Path]:
        """
        Returns the diffusion model file (safetensors or gguf) in diffusion_models/.
        Prefers the format configured in muse_config.json.
        """
        dm_dir = self.diffusion_models_path()
        if not dm_dir.exists():
            return None

        fmt = self.detect_format()

        if fmt == ModelFormat.GGUF:
            return self.get_gguf_file()

        # For safetensors formats, prefer configured format keywords
        priority = ["fp8", "fp16", "bf16"] if fmt in (ModelFormat.FP8, ModelFormat.FP16) else ["bf16", "fp16", "fp8"]
        all_st = sorted(dm_dir.glob("*.safetensors"))
        if not all_st:
            return None

        for keyword in priority:
            match = next((f for f in all_st if keyword in f.name.lower()), None)
            if match:
                return match

        return all_st[0]

    def find_text_encoder(self, prefer_fp8: bool = False) -> Optional[Path]:
        """Returns the best available text encoder file in text_encoders/."""
        te_dir = self.text_encoders_path()
        if not te_dir.exists():
            return None

        files = sorted(te_dir.glob("*.safetensors"))
        if not files:
            return None

        if prefer_fp8:
            fp8_match = next((f for f in files if "fp8" in f.name.lower()), None)
            if fp8_match:
                return fp8_match

        return files[0]

    def find_vae(self) -> Optional[Path]:
        """Returns the VAE safetensors file."""
        vae_dir = self.vae_path()
        if not vae_dir.exists():
            return None
        files = sorted(vae_dir.glob("*.safetensors"))
        return files[0] if files else None

    # ── Format detection ──────────────────────────────────────────────────────

    def detect_format(self) -> ModelFormat:
        """
        Returns the format from muse_config.json.
        Falls back to auto-detection based on files present in diffusion_models/.
        """
        from app.config import settings
        configured = settings.get_model_format(self.model_folder_name)
        if configured:
            try:
                return ModelFormat(configured)
            except ValueError:
                pass
        return self._auto_detect_format()

    def _auto_detect_format(self) -> ModelFormat:
        """Infer format from files present in diffusion_models/."""
        dm_dir = self.diffusion_models_path()
        if not dm_dir.exists():
            return ModelFormat.BF16

        all_files: list[Path] = []
        for p in dm_dir.rglob("*"):
            if p.is_file():
                all_files.append(p)

        names = [f.name.lower() for f in all_files]

        if any(n.endswith(".gguf") for n in names):
            return ModelFormat.GGUF
        if any("fp8" in n for n in names):
            return ModelFormat.FP8
        if any("fp16" in n for n in names):
            return ModelFormat.FP16
        return ModelFormat.BF16

    def get_gguf_file(self) -> Optional[Path]:
        """
        Returns the path to the first .gguf file found in diffusion_models/.
        Searches recursively to handle sub-folders like HighNoise/ and LowNoise/
        (used by Wan 2.2 GGUF structure).
        """
        dm_dir = self.diffusion_models_path()
        if not dm_dir.exists():
            return None
        gguf_files = sorted(dm_dir.rglob("*.gguf"))
        return gguf_files[0] if gguf_files else None

    # ── PyTorch dtype helpers ─────────────────────────────────────────────────

    def get_torch_dtype(self):
        """Returns the correct torch dtype for the configured format."""
        import torch
        fmt = self.detect_format()
        if fmt in (ModelFormat.BF16,):
            return torch.bfloat16
        elif fmt in (ModelFormat.FP16,):
            return torch.float16
        elif fmt == ModelFormat.FP8:
            return torch.float8_e4m3fn
        else:
            return torch.bfloat16

    def get_load_kwargs(self) -> dict[str, Any]:
        """
        Returns kwargs for from_pretrained() matching the configured format.

        bf16  → {"torch_dtype": torch.bfloat16, "device_map": "auto"}
        fp16  → {"torch_dtype": torch.float16, "device_map": "auto"}
        fp8   → {"load_in_8bit": True, "device_map": "auto"}
        gguf  → {} — use load_gguf() instead
        """
        import torch
        fmt = self.detect_format()

        if fmt == ModelFormat.BF16:
            return {"torch_dtype": torch.bfloat16, "device_map": "auto"}
        elif fmt == ModelFormat.FP16:
            return {"torch_dtype": torch.float16, "device_map": "auto"}
        elif fmt == ModelFormat.FP8:
            return {"load_in_8bit": True, "device_map": "auto"}
        elif fmt == ModelFormat.GGUF:
            return {}

        return {"torch_dtype": torch.bfloat16, "device_map": "auto"}

    # ── GGUF loader ───────────────────────────────────────────────────────────

    def load_gguf(self, n_gpu_layers: int = -1, n_ctx: int = 2048) -> Any:
        """
        Loads a GGUF model using llama-cpp-python with full GPU offload.
        Finds the .gguf file automatically from diffusion_models/.

        Requires: CMAKE_ARGS="-DGGML_CUDA=on" pip install llama-cpp-python
        """
        try:
            from llama_cpp import Llama
        except ImportError:
            raise RuntimeError(
                "llama-cpp-python not installed or missing CUDA support.\n"
                "Run: CMAKE_ARGS='-DGGML_CUDA=on' pip install llama-cpp-python --no-cache-dir"
            )

        gguf_file = self.get_gguf_file()
        if not gguf_file:
            raise FileNotFoundError(
                f"No .gguf file found in {self.diffusion_models_path()}. "
                "See models/README.md for download instructions."
            )

        return Llama(
            model_path=str(gguf_file),
            n_gpu_layers=n_gpu_layers,
            n_ctx=n_ctx,
            verbose=False,
        )

    def format_summary(self) -> str:
        """Human-readable format + filename for logging/health endpoint."""
        fmt = self.detect_format()
        model_file = self.find_diffusion_model()
        detail = f" ({model_file.name})" if model_file else " (not found)"
        return f"{fmt.value.upper()}{detail}"


# ── Base provider ─────────────────────────────────────────────────────────────

class BaseProvider(ABC):
    """Common interface for all Muse inference providers."""

    provider_id: str
    display_name: str
    provider_type: Literal["local", "api"]

    @abstractmethod
    def is_available(self) -> bool:
        """
        Return True if this provider can accept requests right now.

        For local providers: checks if model files exist at the expected path.
        For API providers: checks if the API key environment variable is set.
        """

    def unavailable_reason(self) -> Optional[str]:
        """Human-readable explanation if is_available() is False. Override as needed."""
        return None

    def capabilities(self) -> dict[str, Any]:
        """Optional metadata about this provider's capabilities."""
        return {}


# ── Image providers ───────────────────────────────────────────────────────────

class ImageDraftProvider(BaseProvider):
    """
    Step 1 of the Visual Muse pipeline.
    Generates initial composition from reference images + text prompt.
    Default implementation: Qwen Image Edit.
    """

    @abstractmethod
    async def generate(
        self,
        prompt: str,
        reference_image_paths: list[str],
        params: dict[str, Any],
    ) -> ImageResult:
        """
        Args:
            prompt: Scene description from script content.
            reference_image_paths: Up to 5 images establishing style/mood.
            params: e.g. {"aspect_ratio": "16:9", "style_strength": 0.75, "num_variations": 2}

        Returns:
            ImageResult with output_paths pointing to generated draft image(s).
        """


class ImageRefineProvider(BaseProvider):
    """
    Step 2 of the Visual Muse pipeline.
    img2img refinement of the Step 1 draft at low denoise strength.
    Default implementation: Z-Image Turbo.
    """

    @abstractmethod
    async def refine(
        self,
        draft_image_path: str,
        prompt: Optional[str],
        params: dict[str, Any],
    ) -> ImageResult:
        """
        Args:
            draft_image_path: Output from ImageDraftProvider.generate().
            prompt: Optional additional guidance for refinement.
            params: e.g. {"denoise_strength": 0.35}

        Returns:
            ImageResult with output_path pointing to the final high-quality image.
        """


# ── Video providers ───────────────────────────────────────────────────────────

class VideoProvider(BaseProvider):
    """
    Motion Muse video generation.
    Supports both local models (./models/) and cloud APIs.
    """

    @abstractmethod
    async def generate(
        self,
        script: str,
        keyframe_paths: list[str],
        params: dict[str, Any],
        on_progress: Optional[Any] = None,
    ) -> VideoResult:
        """
        Args:
            script: Full scene script text.
            keyframe_paths: Approved keyframe images to guide generation.
            params: e.g. {"duration_seconds": 5, "fps": 24, "motion_strength": 0.7}
            on_progress: Optional async callback(percent: int, message: str) for progress updates.

        Returns:
            VideoResult with output_path to the generated video file.
        """


class LocalVideoProvider(VideoProvider, LocalModelLoader):
    """
    Base class for locally-hosted video models (e.g. Wan 2.2, LTX2).
    Model files live under settings.models_path / model_folder_name.
    Uses LocalModelLoader for split-files folder access and format detection.
    Concrete providers MUST override is_available() and unavailable_reason().
    """

    provider_type: str = "local"
    model_folder_name: str  # e.g. "wan2.2" → loaded from ../models/wan2.2/


class APIVideoProvider(VideoProvider):
    """
    Base class for cloud API video providers (e.g. Kling, SeedDance, Runway).
    Requires an API key in the environment.
    """

    provider_type: Literal["local", "api"] = "api"
    api_key_env_var: str  # e.g. "KLING_API_KEY"

    def _get_api_key(self) -> Optional[str]:
        import os
        return os.getenv(self.api_key_env_var)

    def is_available(self) -> bool:
        return bool(self._get_api_key())

    def unavailable_reason(self) -> Optional[str]:
        if not self.is_available():
            return f"API key not set. Add {self.api_key_env_var} to your .env file."
        return None


# ── LLM providers ─────────────────────────────────────────────────────────────

class LLMProvider(BaseProvider):
    """
    Story Muse language model provider.
    Supports streaming responses via async generator.
    """

    @abstractmethod
    async def generate_stream(
        self,
        task: str,
        prompt: str,
        context: Optional[dict[str, Any]],
        params: dict[str, Any],
    ) -> AsyncGenerator[LLMChunk, None]:
        """
        Yields LLMChunk objects as text is generated.
        Set chunk.is_final = True on the last chunk.

        Args:
            task: e.g. "generate_storyline", "write_scene_script", "refine_dialogue"
            prompt: User's request/description.
            context: Optional dict with scene info, characters, existing content.
            params: e.g. {"max_tokens": 2048, "temperature": 0.8}
        """
