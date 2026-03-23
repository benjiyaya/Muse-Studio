# Muse Studio — AI Story & Video Workspace

Muse Studio is a local-first workspace for planning, visualizing, and iterating on stories and video concepts. 

About Basic Usage Of Muse Studio : https://youtu.be/N9FTtNYHzIU

This is create as my hobby, if company want to customize for your workflow, feel free to reach out. 



It combines:
- A **frontend** (`muse-studio`) with kanban-style scenes, characters, and “Muse” suggestions
- A **Python FastAPI backend** (`muse_backend`) that orchestrates LLMs and video/image providers
- Tight integration with **ComfyUI** for image and video generation via your own workflows

This README covers **installation, configuration, and day‑to‑day usage** of the frontend and backend on your machine.

---

## Table of Contents

1. [What's New](#1-whats-new)
2. [Prerequisites](#2-prerequisites)
3. [Clone / Open the Project](#3-clone--open-the-project)
4. [Frontend Setup — muse-studio (Next.js)](#4-frontend-setup--muse-studio-nextjs)
5. [Backend Setup — muse_backend (Python / FastAPI)](#5-backend-setup--muse_backend-python--fastapi)
6. [ComfyUI — Image & Video Generation](#6-comfyui--image--video-generation)
7. [Running the Stack](#7-running-the-stack)
8. [Using Muse Agent (UI Overview)](#8-using-muse-agent-ui-overview)
9. [Verify Everything Works](#9-verify-everything-works)
10. [Quick Command Reference](#10-quick-command-reference)
11. [Upgrading PyTorch](#11-upgrading-pytorch)
12. [Troubleshooting](#12-troubleshooting)
13. [Polished export (Remotion)](#13-polished-export-remotion)
14. [Publishing on GitHub](#14-publishing-on-github)
15. [Credits & acknowledgments](#15-credits--acknowledgments)

---

## 1. What's New

### Exporting your film with the Video Editor Agent (2026-03-13)

When all your scene videos are ready, Muse can help you turn them into a full film using the **Video Editor Agent**. You can let the agent assemble a master cut instead of downloading every clip and editing by hand.

- **Simple Stitch** — Use when you’re happy with each scene as it is. The agent takes all scenes marked as **Final**, arranges them in story order, and joins them into one continuous video. Fast and predictable.
- **Smart Edit** — The agent looks at each final scene, listens to audio, and samples key frames; it prepares an edited version of each scene (today mostly full content, designed to get smarter over time), then assembles them into the final film. Good foundation for future pacing and trimming.

In the UI, choose **Simple Stitch** or **Smart Edit** before clicking **Export Full Film By Agent**. Muse shows progress and then gives you a link to open or download the final film.

### Local LLMs — LM Studio support

Muse Studio supports **LM Studio** as a local LLM provider alongside OpenAI, Ollama, and Claude.

- Run the **LM Studio** app and enable its **OpenAI-compatible local server**.
- In `muse_backend/.env` (optional):
  - `LMSTUDIO_BASE_URL` (default `http://127.0.0.1:1234`)
  - `LMSTUDIO_MODEL` (model id from LM Studio’s `/v1/models`)
  - `LMSTUDIO_API_KEY` (if you enabled API auth in LM Studio)
- In `muse-studio/.env.local`: `NEXT_PUBLIC_LMSTUDIO_BASE_URL=http://127.0.0.1:1234`
- In Muse’s provider settings, choose **LM Studio (Local)** and pick a model. Story Muse (Ask Muse, storyline, scene dialogs) will use LM Studio instead of cloud or Ollama.

**Disabling “thinking” output for Qwen models in LM Studio**  
Some models stream internal reasoning (“thinking”) plus the final answer. To hide that in Muse:

1. In **LM Studio → My Models**, select your Qwen model.
2. Open the **Inference** tab and find **Prompt Template (Jinja)**.
3. Add at the **very beginning** of the template: `{%- set enable_thinking = false %}`
4. Save and restart inference for that model. Muse will then only show the final answer.

---

## 2. Prerequisites

Install these tools before starting.

### Node.js (frontend)

| Platform | Install |
|---|---|
| Windows | Download from https://nodejs.org (LTS, v18+) |
| Linux | `sudo apt install nodejs npm` or use [nvm](https://github.com/nvm-sh/nvm) |

Verify:
```
node --version
npm --version
```

### Python (backend)

Python **3.11 or 3.12** recommended (3.13 is also supported).

| Platform | Install |
|---|---|
| Windows | Download from https://python.org — check **"Add to PATH"** during install |
| Linux | `sudo apt install python3 python3-venv python3-pip` |

Verify:
```
python --version
```

### NVIDIA GPU + CUDA Toolkit (recommended)

Recommended for GPU‑accelerated features. Most flows will still run on CPU but more slowly.

| Platform | Install |
|---|---|
| Windows | Download CUDA Toolkit from https://developer.nvidia.com/cuda-downloads |
| Linux | `sudo apt install nvidia-cuda-toolkit` or use the NVIDIA runfile installer |

Verify:
```
nvidia-smi
```

### Git

| Platform | Install |
|---|---|
| Windows | https://git-scm.com |
| Linux | `sudo apt install git` |

---

## 3. Clone / Open the Project

```bash
git clone https://github.com/benjiyaya/Muse-Studio.git
cd Muse-Studio
```

Project layout:
```
/                              ← repo / project root
├── muse-studio/               ← Next.js frontend
├── muse_backend/              ← Python FastAPI backend
├── packages/
│   └── remotion-film/         ← Remotion “FilmMaster” composition (polished export)
└── README.md                  ← This file
```

Image and video generation run through **ComfyUI**; no local model folder is required in this repo.

---

### 3.1 Quick Start (TL;DR)

1. **Clone & install**
   - Backend:
     ```bash
     cd muse_backend
     python -m venv .venv
     # Activate venv (see OS-specific commands below)
     pip install -r requirements.txt
     cp .env.example .env  # or use Copy-Item on Windows
     ```
   - Frontend:
   ```bash
   cd ../muse-studio
   npm install
   # If .env.local.example exists:
   #   cp .env.local.example .env.local
   # Else create .env.local and set at minimum:
   #   MUSE_BACKEND_URL=http://localhost:8000
   #   NEXT_PUBLIC_OLLAMA_BASE_URL=http://127.0.0.1:11434   # if you use Ollama
   #   NEXT_PUBLIC_LMSTUDIO_BASE_URL=http://127.0.0.1:1234  # if you use LM Studio
   ```
   - Polished Remotion export (optional — needed for `SMART_EDIT_REMOTION` / FilmMaster renders):
     ```bash
     cd ../packages/remotion-film
     npm install
     ```

2. **Configure keys**
   - Edit `muse_backend/.env`:
     - `OPENAI_API_KEY` (Story Muse)
     - `HF_TOKEN` (for gated HuggingFace models, if you use them)
     - Optional video APIs: `KLING_API_KEY`, `SEEDDANCE_API_KEY`, `RUNWAY_API_KEY`.

3. **Start services**
   - Backend:
     ```bash
     cd muse_backend
     # activate .venv
     python run.py
     ```
     Backend: `http://localhost:8000`
   - Frontend:
     ```bash
     cd muse-studio
     npm run dev
     ```
     Frontend: `http://localhost:3000`

4. **Run ComfyUI**
   - Start your ComfyUI server (local or remote).
   - In the app UI (`/settings` → **ComfyUI**), set the **ComfyUI base URL** and register one or more workflows.

5. **Create a project**
   - Open `http://localhost:3000`, create a new project, pick a **Muse Control Level** (Observer / Assistant / Collaborator), then add scenes and generate images / video via your ComfyUI workflows.

---

## 4. Frontend Setup — muse-studio (Next.js)

### Windows (CMD or PowerShell)

```cmd
cd muse-studio
npm install
```

Create the local environment file:

```cmd
copy .env.local.example .env.local
```

> If `.env.local.example` does not exist, create `.env.local` manually with:
> ```
> MUSE_BACKEND_URL=http://localhost:8000
> # Optional local LLM servers (frontend URLs)
> NEXT_PUBLIC_OLLAMA_BASE_URL=http://127.0.0.1:11434
> NEXT_PUBLIC_LMSTUDIO_BASE_URL=http://127.0.0.1:1234
> ```

Start the dev server:

```cmd
npm run dev
```

Frontend runs at **http://localhost:3000**

---

### Linux / macOS

```bash
cd muse-studio
npm install
cp .env.local.example .env.local   # or create manually — see above
npm run dev
```

---

## 5. Backend Setup — muse_backend (Python / FastAPI)

All commands below are run from inside the `muse_backend/` directory unless stated otherwise.

### 5.1 Create the virtual environment

The `.venv` isolates AI model dependencies (especially CUDA PyTorch) from your
system Python. **Never skip this step.**

#### Windows (CMD)

```cmd
cd muse_backend
python -m venv .venv
```

#### Windows (PowerShell)

```powershell
cd muse_backend
python -m venv .venv
```

#### Linux / macOS

```bash
cd muse_backend
python3 -m venv .venv
```

---

### 5.2 Activate the virtual environment

You must activate the venv **every time you open a new terminal**.
Your prompt will show `(.venv)` when active.

#### Windows (CMD)

```cmd
.venv\Scripts\activate.bat
```

#### Windows (PowerShell)

```powershell
.\.venv\Scripts\Activate.ps1
```

> If you see an execution policy error, run once:
> `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

#### Linux / macOS

```bash
source .venv/bin/activate
```

Deactivate when done:

```
deactivate
```

---

### 5.3 Install PyTorch with CUDA

> **Critical:** Do NOT install torch from `requirements.txt` or plain `pip install torch`.
> Both give a CPU-only build with no GPU support. Always use the `--index-url` flag.

First, check your CUDA version:

```
nvidia-smi
```

Look for the **CUDA Version** in the top-right of the output, then pick the matching install command below.

#### CUDA 12.8 (RTX 50xx Blackwell — e.g. RTX PRO 6000)

```
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

#### CUDA 12.4

```
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124
```

#### CUDA 12.1 (RTX 30xx / 40xx Ada)

```
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

#### CUDA 11.8 (older GPUs)

```
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
```

Verify GPU is detected after install:

```
python -c "import torch; print('Torch:', torch.__version__); print('CUDA:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0))"
```

Expected output example:
```
Torch: 2.10.0+cu128
CUDA: True
GPU: NVIDIA RTX PRO 6000 Blackwell Workstation Edition
```

---

### 5.4 Install remaining dependencies

```
pip install -r requirements.txt
```

This installs FastAPI, Uvicorn, OpenAI SDK, and other non-GPU packages.

---

### 5.5 Configure environment variables

#### Windows (CMD)

```cmd
copy .env.example .env
```

#### Windows (PowerShell)

```powershell
Copy-Item .env.example .env
```

#### Linux / macOS

```bash
cp .env.example .env
```

Then open `.env` and fill in your API keys:

```
# OpenAI (Story Muse, cloud)
OPENAI_API_KEY=sk-...

# HuggingFace (required for gated models like FLUX.2-klein safetensors)
HF_TOKEN=hf_...

# Local LLMs (optional)
# Ollama — local LLM server
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.2

# LM Studio — local LLM server (OpenAI-compatible API)
# LMSTUDIO_BASE_URL=http://localhost:1234
# LMSTUDIO_MODEL=gpt-4o-mini
# LMSTUDIO_API_KEY=your_token_if_enabled

# Cloud video APIs (optional — set whichever you use)
KLING_API_KEY=
SEEDDANCE_API_KEY=
RUNWAY_API_KEY=
```

---

## 6. ComfyUI — Image & Video Generation

Image and video generation are handled by **ComfyUI**. Run ComfyUI separately and integrate its workflows into Muse Studio:

- In ComfyUI, rename your input and output nodes so their titles end with (Input) or (Output) — Muse uses these suffixes to detect dynamic inputs and output.
- In **ComfyUI**, open your workflow and **export it as API JSON** (or copy the JSON from the workflow editor).
- In **Muse Studio**, go to **Settings → ComfyUI → Add workflow** and paste the ComfyUI JSON.
  - Give the workflow a clear name, choose its **kind** (image or video), and save it.
- Your saved workflows now appear in the **Muse workflow library** and can be:
  - Assigned per scene on the kanban board (image / video workflow fields).
  - Used from “Generate with ComfyUI” dialogs for scenes and character sheets.

You do **not** need a `models/` folder in this repo — model weights and pipelines live entirely in your ComfyUI installation.

---

## 7. Running the Stack

Both services must be running simultaneously. Use two separate terminal windows.

### Terminal 1 — Python backend

#### Windows (CMD)

```cmd
cd muse_backend
.venv\Scripts\activate.bat
python run.py
```

#### Windows (PowerShell) for Agent Debug and In Browser

```powershell
cd muse_backend
.\.venv\Scripts\Activate.ps1
python run.py
```

#### Linux / macOS

```bash
cd muse_backend
source .venv/bin/activate
python run.py
```

Backend starts at:
- API: **http://localhost:8000**
- Docs: **http://localhost:8000/docs**
- Health: **http://localhost:8000/health**

---

### Terminal 2 — Next.js frontend

#### Windows (CMD or PowerShell) for Agent Debug and In Browser

```cmd
cd muse-studio
npm run dev
```

#### Linux / macOS

```bash
cd muse-studio
npm run dev
```

Frontend starts at **http://localhost:3000**

---

## 8. Using Muse Agent (UI Overview)

Once both backend and frontend are running and ComfyUI is configured:

- **Create a project**
  - Go to `http://localhost:3000`.
  - Click **New Project** and enter:
    - **Title** and optional **Description**.
    - **Muse Control Level**:
      - **Observer** – light, occasional suggestions.
      - **Assistant** – balanced help (default).
      - **Collaborator** – very proactive suggestions.

- **Storyline and scenes**
  - Define your **storyline** for the project.
  - Add **scenes** on the kanban board; Muse can suggest improvements based on your control level.

- **Characters**
  - Use the **Characters** panel to define key characters.
  - Optionally generate character sheet images via ComfyUI workflows when available.

- **ComfyUI workflows (image & video)**
  - In **Settings → ComfyUI**, register one or more workflows from your ComfyUI instance.
  - On the kanban board, assign:
    - An **image workflow** per scene for stills.
    - A **video workflow** per scene for motion.
  - For **video workflows**, ensure the workflow's **(Output)** node uses the native `SaveVideo` node from comfy-core, so the backend downloads an actual playable `.mp4` (not a PNG thumbnail).
  - Use the **Generate with ComfyUI** dialogs on scenes or character sheets to run those workflows, then review results.

- **Muse suggestions**
  - As you confirm storylines, edit scenes, and complete video jobs, Muse surfaces suggestions in the UI.
  - You can adjust the project’s Muse Control Level later from the project header if you want more or fewer suggestions.

---

## 9. Verify Everything Works

### Check backend health

Open in browser or run:

#### Windows (CMD / PowerShell)

```cmd
curl http://localhost:8000/health
```

#### Linux / macOS

```bash
curl http://localhost:8000/health
```

Expected response (example):
```json
{
  "status": "ok",
  "version": "0.1.0",
  "available_providers": { ... }
}
```

### Verify GPU in Python

```
python -c "import torch; print(torch.__version__, '| CUDA:', torch.cuda.is_available(), '| GPU:', torch.cuda.get_device_name(0))"
```

### Verify diffusers

```
python -c "from diffusers import LTXImageToVideoPipeline; print('diffusers OK')"
```

### Verify ltx-core upsampler

```
python -c "from ltx_core.model.upsampler import upsample_video; print('ltx_core OK')"
```

---

## 10. Quick Command Reference

| Task | Windows CMD | Windows PowerShell | Linux / macOS |
|---|---|---|---|
| Activate venv | `.venv\Scripts\activate.bat` | `.\.venv\Scripts\Activate.ps1` | `source .venv/bin/activate` |
| Deactivate venv | `deactivate` | `deactivate` | `deactivate` |
| Start backend | `python run.py` | `python run.py` | `python run.py` |
| Start frontend | `npm run dev` | `npm run dev` | `npm run dev` |
| Check GPU | `nvidia-smi` | `nvidia-smi` | `nvidia-smi` |
| Check CUDA in Python | `python -c "import torch; print(torch.cuda.is_available())"` | same | same |
| Install a new package | `pip install <pkg>` | `pip install <pkg>` | `pip install <pkg>` |
| Freeze dependencies | `pip freeze > requirements.txt` | same | same |

---

## 11. Upgrading PyTorch

When a new PyTorch version is released, upgrade with the same CUDA index URL.
Do **not** use plain `pip install torch --upgrade` — that installs a CPU build.

#### All platforms (replace cu128 with your CUDA version)

```
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128 --upgrade
```

After upgrading, verify CUDA is still available:

```
python -c "import torch; print(torch.__version__, torch.cuda.is_available())"
```

---

## 12. Troubleshooting

### `CUDA available: False` after install

PyTorch was installed without the `--index-url` flag. Fix:

```
pip uninstall torch torchvision torchaudio -y
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

---

### PowerShell execution policy error

```
.venv\Scripts\Activate.ps1 cannot be loaded because running scripts is disabled
```

Fix (run once as your user):

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

### `ltx-core` installs a CPU torch

After installing `ltx-core`, always verify and reinstall if needed:

```
python -c "import torch; print(torch.__version__)"
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

---

### `nmake not found` / `CMAKE_C_COMPILER not set` when installing llama-cpp-python

Visual Studio C++ Build Tools are missing. Install them first (one-time):

```cmd
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
```

After it finishes, **close and reopen your terminal**, then retry the llama-cpp-python install step in **Section 5** (Backend Setup).

---

### `llama-cpp-python` has no GPU support (CPU-only build)

It was installed without `CMAKE_ARGS`. Uninstall and rebuild:

#### Windows (CMD) — open a fresh terminal after installing Build Tools

```cmd
pip uninstall llama-cpp-python -y
set CMAKE_ARGS=-DGGML_CUDA=on
set FORCE_CMAKE=1
pip install llama-cpp-python --no-cache-dir
```

#### Linux / macOS

```bash
pip uninstall llama-cpp-python -y
CMAKE_ARGS="-DGGML_CUDA=on" FORCE_CMAKE=1 pip install llama-cpp-python --no-cache-dir
```

---

### `ModuleNotFoundError` when starting the backend

You are not inside the `.venv`. Activate it first, then retry:

```
# Windows CMD
.venv\Scripts\activate.bat && python run.py

# Linux / macOS
source .venv/bin/activate && python run.py
```

---

### Frontend cannot reach the backend (`503 Backend unreachable`)

1. Make sure the Python backend is running in a separate terminal
2. Check `muse-studio/.env.local` contains `MUSE_BACKEND_URL=http://localhost:8000`
3. Confirm the backend is healthy: `curl http://localhost:8000/health`

---

### Port already in use

#### Windows (CMD / PowerShell) — kill process on port 8000

```cmd
netstat -ano | findstr :8000
taskkill /PID <PID> /F
```

#### Linux / macOS

```bash
lsof -ti:8000 | xargs kill -9
```

---

## 13. Polished export (Remotion)

The **`packages/remotion-film`** package is a [Remotion](https://www.remotion.dev/) composition used for Muse **FilmMaster** exports (polished timeline render). The Python backend can shell out to `npx remotion render` from this directory when you use the Remotion-based export path. For backend environment variables (`MUSE_VIDEO_HTTP_BASE`, `MUSE_REMOTION_PACKAGE_PATH`), see **`muse_backend/README.md`** → *Polished export (Remotion) — optional*.

### Prerequisites

- **Node.js** 18+ (LTS recommended) and **npm** on your `PATH`.
- **`npx`** (ships with npm) — the backend invokes `npx remotion render` from this package directory.

### Installation

From the **repository root**:

```bash
cd packages/remotion-film
npm install
```

Run `npm install` again after dependency changes or a fresh clone.

### Paths and HTTP video sources

- By default the backend expects this project at **`<repo>/packages/remotion-film`**.
- If it lives elsewhere, set **`MUSE_REMOTION_PACKAGE_PATH`** on the backend to the **absolute** path of the folder that contains `package.json`.

Remotion loads scene clips over **HTTP(S)** during render. The backend rewrites timeline URLs using **`MUSE_VIDEO_HTTP_BASE`** (see `muse_backend/README.md`).

- Default: `http://127.0.0.1:3000` (typical `muse-studio` dev server).
- Set **`MUSE_VIDEO_HTTP_BASE`** on the **Python backend** to match wherever Muse Studio is reachable from the machine running the render (often the same idea as `MUSE_FRONTEND_BASE_URL` in `muse-studio/.env.local`, but Next.js does not load that file into Python — set the backend env explicitly or via `muse_backend/.env` if your launcher loads it).

**Muse Studio must be running** and able to serve `/api/outputs/...` at that origin while an export runs.

### Dev — Remotion Studio

Preview the composition locally:

```bash
cd packages/remotion-film
npm run studio
```

### Render (CLI)

Requires a props JSON file (same shape as the backend **FilmTimeline**):

```bash
cd packages/remotion-film
npx remotion render src/index.ts FilmMaster out/video.mp4 --props=timeline.fixtures.json
```

Fixture render (writes props then renders):

```bash
npm run render:fixture
```

### Transitions

Timeline JSON may include `transitionOut` on each sequence **except the last** (Muse strips it on the final clip). `type: "fade"` with `durationSec` produces a crossfade via `@remotion/transitions` (`TransitionSeries` + `fade()`). `cut` or missing values are hard cuts. Durations are clamped to the shorter of the two adjacent clips and to a small minimum fade length in the Remotion layer.

Smart Edit / Remotion export: the editor LLM supplies `transitionOut` per scene; the backend normalizes it (fade duration clamped to 0.05–2.0 s, unknown types become `cut`).

**ffmpeg-only** Smart Edit master concat does not apply these transitions; polished Remotion export and the Muse Studio player preview do.

### Environment summary

| Variable | Where | Purpose |
|----------|--------|---------|
| `MUSE_REMOTION_PACKAGE_PATH` | Python backend | Optional absolute path to this package if not under `<repo>/packages/remotion-film`. |
| `MUSE_VIDEO_HTTP_BASE` | Python backend | Origin where Muse Studio serves video URLs Remotion will fetch (default `http://127.0.0.1:3000`). |

---

## 14. Publishing on GitHub

This repository is hosted at **[github.com/benjiyaya/Muse-Studio](https://github.com/benjiyaya/Muse-Studio)**.

- **Do not commit** API keys or secrets: use `muse_backend/.env` and `muse-studio/.env.local` (see `.gitignore` and `.env.example` files).
- **Generated media** under `muse-studio/outputs/` (draft images, videos, timelines, final cuts) is ignored so clones stay small; recreate outputs locally after install.
- **`muse-studio`**, **`muse_backend`**, and **`packages/`** (including `packages/remotion-film`) are all part of the same repo — clone once at the root and follow the setup sections above.

---

This project is licensed under the MIT License — see [LICENSE](LICENSE).

---

## 15. Credits & acknowledgments

**Remotion** — Muse Studio’s polished film export and timeline preview build on **[Remotion](https://www.remotion.dev/)**, the React-based framework for programmatic video. Thank you to the Remotion team and community for the tools and documentation that make headless, code-driven rendering practical in this stack.
