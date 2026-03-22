# Muse Backend — Python Inference Server

FastAPI server providing Story Muse (LLM), Visual Muse (image), and Motion Muse (video) capabilities.

---

## Development Environment Setup

### Step 1 — Create the virtual environment

All Python work **must** run inside `.venv`. This isolates CUDA-specific PyTorch builds
from any system Python and prevents version conflicts between AI model dependencies.

```powershell
# From muse_backend/ directory
python -m venv .venv
```

### Step 2 — Activate `.venv`

```powershell
# Windows (PowerShell)
.\.venv\Scripts\Activate.ps1

# Windows (CMD)
.\.venv\Scripts\activate.bat

# macOS / Linux
source .venv/bin/activate
```

You should see `(.venv)` in your prompt. **Always activate before running any Python commands.**

### Step 3 — Install PyTorch with CUDA support

> **Important:** Do NOT install PyTorch from `requirements.txt` directly — that installs the
> CPU-only version. CUDA builds must be installed manually from the PyTorch index.

```powershell
# CUDA 12.1 (recommended for RTX 30xx/40xx)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121

# CUDA 11.8 (for older GPUs)
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Verify CUDA is available
python -c "import torch; print('CUDA:', torch.cuda.is_available(), '| Device:', torch.cuda.get_device_name(0))"
```

### Step 4 — Install GGUF support (llama-cpp-python with CUDA)

`llama-cpp-python` requires a CUDA-aware build. Install it before `requirements.txt`:

```powershell
# Set build flags for CUDA, then install
$env:CMAKE_ARGS="-DGGML_CUDA=on"
$env:FORCE_CMAKE=1
pip install llama-cpp-python --no-cache-dir
```

### Step 5 — Install remaining dependencies

```powershell
pip install -r requirements.txt
```

### Step 6 — Configure environment variables

```powershell
Copy-Item .env.example .env
# Edit .env and add your API keys
```

### Step 7 — Start the server

```powershell
python run.py
# Server starts at http://localhost:8000
# API docs at http://localhost:8000/docs
```

---

## Local ASR model for Video Editor Agent (onnx-asr + ONNX Whisper)

The Video Editor Agent's transcription helper (`transcribe_video` in
`app/video_editor_tools.py`) uses a **local ONNX ASR model** via the `onnx-asr`
library. This keeps all audio processing on your machine and avoids cloud calls.

Before running the full Muse system with the Video Editor Agent enabled, you
should:

1. **Install `onnx-asr` inside the virtual environment**

   ```powershell
   # From muse_backend/, with .venv activated
   pip install onnx-asr
   ```

2. **Download an ONNX Whisper model into your models folder**

   We recommend the small Portuguese Whisper model from OpenVoiceOS as a starting point:

   - Model card: https://huggingface.co/OpenVoiceOS/whisper-small-pt-onnx

   Create a directory under `muse_backend/models/onnx-asr` (or whatever
   `MODEL_BASE_PATH` points to), for example:

   ```text
   muse_backend/
     models/
       onnx-asr/
         whisper-small-pt/
           # ONNX model files go here
   ```

   Download or export the ONNX model into that folder following the instructions
   in the model card (or your preferred ONNX Whisper variant).

3. **Point the backend at the local ASR model**

   Set the `MUSE_ASR_MODEL_ID` environment variable to the local model path. In
   `muse_backend/.env` this might look like:

   ```env
   MUSE_ASR_MODEL_ID=e:/MuseAgent_KanbunPM/v3_src/muse_backend/models/onnx-asr/whisper-small-pt
   ```

   On Windows PowerShell you can also set it temporarily for the current shell:

   ```powershell
   $env:MUSE_ASR_MODEL_ID = "e:\MuseAgent_KanbunPM\v3_src\muse_backend\models\onnx-asr\whisper-small-pt"
   ```

At runtime, `app.video_editor_tools._get_asr_model()` will load this model once
via `onnx_asr.load_model(MUSE_ASR_MODEL_ID)` and reuse it for subsequent
transcription calls.

---

## Polished export (Remotion) — optional

When the Video Editor Agent runs with mode `SMART_EDIT_REMOTION`, the backend shells out to `npx remotion render` in `packages/remotion-film` (or override with `MUSE_REMOTION_PACKAGE_PATH`).

- **`MUSE_VIDEO_HTTP_BASE`** — Base URL where Muse Studio serves `/api/outputs/...` (default `http://127.0.0.1:3000`). Remotion’s headless renderer loads scene MP4s over **http(s)** only; the Studio app must be reachable at this URL during render.
- **`MUSE_REMOTION_PACKAGE_PATH`** — Absolute path to the Remotion project if not at `<repo>/packages/remotion-film`.

Requires **Node.js** and **npx** on the same machine as the backend.

Scene-to-scene **fade** transitions from the editor LLM (`transitionOut`) are applied in this Remotion render and in the Studio preview; the ffmpeg-only Smart Edit concat path does not use them yet.

---

## CUDA Environment Quick Reference

| Command | Purpose |
|---|---|
| `.\.venv\Scripts\Activate.ps1` | Activate environment |
| `deactivate` | Deactivate environment |
| `python -c "import torch; print(torch.cuda.is_available())"` | Verify CUDA |
| `nvidia-smi` | Check GPU usage during inference |
| `python -c "import torch; print(torch.version.cuda)"` | Check CUDA version torch was built with |

---

## Supported Model Formats

Local image and video models support **three quantization formats**.
Choose based on your VRAM and quality requirements:

| Format | VRAM Usage | Quality | Notes |
|---|---|---|---|
| **bf16** (BFloat16) | Full | Best | Recommended for RTX 40xx (8GB+) |
| **FP8** (Float8) | ~50% of bf16 | Near-lossless | Requires RTX 40xx (Ada Lovelace+) |
| **GGUF** | 20–60% of bf16 | Good–Excellent | Most flexible, runs on lower VRAM GPUs |

Configure the preferred format per model in `muse_config.json`:
```json
{
  "model_formats": {
    "qwen-image-edit": "bf16",
    "zimage-turbo": "bf16",
    "wan2.2": "fp16",
    "ltx2": "gguf"
  }
}
```

Available formats: `bf16`, `fp16`, `fp8`, `fp4`, `gguf`

---

## Project Structure

```
muse_backend/
├── app/
│   ├── main.py              ← FastAPI app
│   ├── config.py            ← muse_config.json loader
│   ├── schemas.py           ← Pydantic API contracts
│   ├── registry.py          ← Provider registration
│   ├── api/routes/
│   │   ├── generate.py      ← POST /generate/*
│   │   ├── providers.py     ← GET /providers
│   │   └── jobs.py          ← GET /jobs/{id}
│   └── providers/
│       ├── base.py          ← Abstract base classes + ModelFormat
│       ├── image/           ← Qwen Image Edit, Z-Image Turbo
│       ├── video/
│       │   ├── local/       ← Wan 2.2, LTX-Video 2
│       │   └── api/         ← Kling, SeedDance, Runway
│       └── llm/             ← OpenAI GPT-4o
├── run.py                   ← Start server
├── requirements.txt
├── muse_config.json         ← User configuration
├── .env.example             ← API key template
└── .venv/                   ← NEVER commit this
```

---

## Adding a New Provider

1. Create `app/providers/{category}/my_provider.py`, subclass the appropriate base class
2. Register it in `app/registry.py` — add one entry to the relevant dict
3. Add the `provider_id` option to `muse_config.json` → `providers`

No other files need to change.
