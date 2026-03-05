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
