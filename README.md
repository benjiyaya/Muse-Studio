# Muse Studio 

Complete setup guide for both the **Next.js frontend** (`muse-studio`) and the
**Python AI inference backend** (`muse_backend`).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone / Open the Project](#2-clone--open-the-project)
3. [Frontend Setup — muse-studio (Next.js)](#3-frontend-setup--muse-studio-nextjs)
4. [Backend Setup — muse_backend (Python / FastAPI)](#4-backend-setup--muse_backend-python--fastapi)
   - [4.1 Create the virtual environment](#41-create-the-virtual-environment)
   - [4.2 Activate the virtual environment](#42-activate-the-virtual-environment)
   - [4.3 Install PyTorch with CUDA](#43-install-pytorch-with-cuda)
   - [4.4 Install ML dependencies](#44-install-ml-dependencies)
   - [4.5 Install LTX-Video 2 core](#45-install-ltx-video-2-core)
   - [4.6 Install GGUF support (optional)](#46-install-gguf-support-optional)
   - [4.7 Install remaining dependencies](#47-install-remaining-dependencies)
   - [4.8 Configure environment variables](#48-configure-environment-variables)
5. [ComfyUI — Image & Video Generation](#5-comfyui--image--video-generation)
6. [Running the Stack](#6-running-the-stack)
7. [Verify Everything Works](#7-verify-everything-works)
8. [Quick Command Reference](#8-quick-command-reference)
9. [Upgrading PyTorch](#9-upgrading-pytorch)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

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

## 2. Clone / Open the Project

```bash
git clone https://github.com/benjiyaya/Muse-Studio.git
cd Muse-Studio
```

Project layout:
```
/                         ← repo / project root
├── muse-studio/          ← Next.js frontend
├── muse_backend/         ← Python FastAPI backend
└── README.md             ← This file
```

Image and video generation run through **ComfyUI**; no local model folder is required in this repo.

---

## 2.1 Quick Start (TL;DR)

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
     # Else create .env.local and set:
     #   MUSE_BACKEND_URL=http://localhost:8000
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

## 3. Frontend Setup — muse-studio (Next.js)

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

## 4. Backend Setup — muse_backend (Python / FastAPI)

All commands below are run from inside the `muse_backend/` directory unless stated otherwise.

### 4.1 Create the virtual environment

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

### 4.2 Activate the virtual environment

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

### 4.3 Install PyTorch with CUDA

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

### 4.4 Install ML dependencies

```
pip install transformers>=4.45.0 diffusers>=0.33.0 accelerate>=0.33.0 safetensors>=0.4.3 Pillow>=10.4.0
```

---

### 4.5 Install LTX-Video 2 core

Required for the LTX-Video 2 spatial upsampler (two-stage 1080p pipeline).

```
pip install git+https://github.com/Lightricks/LTX-2.git#subdirectory=packages/ltx-core
```

> After this installs, verify PyTorch still has CUDA (ltx-core can sometimes pull
> in a CPU torch as a dependency). Re-run the install from Step 4.3 if needed.

---

### 4.6 Install GGUF support (optional)

Required only if you want to run GGUF-format models (LTX-2 Q4_K_M, FLUX.2-klein GGUF, etc.).
`llama-cpp-python` compiles a C++ extension — a C++ compiler is required.

---

#### Windows — Step A: Install Visual Studio Build Tools (one-time, free)

`llama-cpp-python` needs `nmake` and `cl.exe` from Microsoft's free Build Tools.
You will see the error `nmake not found / CMAKE_C_COMPILER not set` if these are missing.

**Option 1 — Already have Visual Studio (full IDE):**

If Visual Studio 2019/2022 is installed, the compiler is already there.
You just need to launch the right terminal — skip to **Step B** and use the
**Developer Command Prompt** instead of regular CMD.

**Option 2 — Install Visual Studio Build Tools only (free, ~3 GB):**

Open **CMD or PowerShell as Administrator**, then run:

```cmd
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
```

Or download manually from: https://visualstudio.microsoft.com/visual-cpp-build-tools/
and select **"Desktop development with C++"** during install.

---

#### Windows — Step B: Install llama-cpp-python with CUDA

The compiler must be on your PATH. The easiest way is the **Developer Command Prompt**,
which is pre-configured with all VS compiler tools.

1. Open the **Start menu** and search for:
   `Developer Command Prompt for VS 2022`
   (or VS 2019 if that's your version) — click it.

2. In that window, navigate to your project and install:

```cmd
cd path\to\v3_src\muse_backend
.venv\Scripts\activate.bat
set CMAKE_ARGS=-DGGML_CUDA=on
set FORCE_CMAKE=1
pip install llama-cpp-python --no-cache-dir
```

> The build takes 5–15 minutes — CMake output scrolling is normal.

If you prefer PowerShell, search for **"Developer PowerShell for VS 2022"** in the Start menu instead, then:

```powershell
cd path\to\v3_src\muse_backend
.\.venv\Scripts\Activate.ps1
$env:CMAKE_ARGS = "-DGGML_CUDA=on"
$env:FORCE_CMAKE = "1"
pip install llama-cpp-python --no-cache-dir
```

---

#### Linux / macOS

Install the compiler first if not present:

```bash
# Ubuntu / Debian
sudo apt install cmake g++ build-essential

# macOS
xcode-select --install
```

Then build with CUDA:

```bash
source .venv/bin/activate
CMAKE_ARGS="-DGGML_CUDA=on" FORCE_CMAKE=1 pip install llama-cpp-python --no-cache-dir
```

---

### 4.7 Install remaining dependencies

```
pip install -r requirements.txt
```

This installs FastAPI, Uvicorn, OpenAI SDK, and other non-GPU packages.

---

### 4.8 Configure environment variables

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
# OpenAI (Story Muse)
OPENAI_API_KEY=sk-...

# HuggingFace (required for gated models like FLUX.2-klein safetensors)
HF_TOKEN=hf_...

# Cloud video APIs (optional — set whichever you use)
KLING_API_KEY=
SEEDDANCE_API_KEY=
RUNWAY_API_KEY=
```

---

## 5. ComfyUI — Image & Video Generation

Image and video generation are handled by **ComfyUI**. Run ComfyUI separately and configure the app to use it:

- In **muse-studio**, register ComfyUI workflows in **Settings → ComfyUI** (workflow URL and any auth).
- Scenes use ComfyUI workflows for scene images and video; assign workflows per scene from the kanban board.

You do **not** need a `models/` folder in this repo — model weights and pipelines live in your ComfyUI installation.

---

## 6. Running the Stack

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

## 7. Using Muse Agent (UI Overview)

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
  - Use the **Generate with ComfyUI** dialogs on scenes or character sheets to run those workflows, then review results.

- **Muse suggestions**
  - As you confirm storylines, edit scenes, and complete video jobs, Muse surfaces suggestions in the UI.
  - You can adjust the project’s Muse Control Level later from the project header if you want more or fewer suggestions.

---

## 8. Verify Everything Works

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

## 9. Quick Command Reference

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

## 10. Upgrading PyTorch

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

## 11. Troubleshooting

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

After it finishes, **close and reopen your terminal**, then retry from Step B in section 4.6.

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

## 12. Publishing on GitHub

To publish this app on GitHub:

1. **Create a new repository** on GitHub (do not initialize with a README if you already have one locally).

2. **Ensure nothing sensitive is committed:**
   - No `.env` or `.env.local` (they are in `.gitignore`)
   - No API keys or tokens in code

3. **Initial commit and push** (from `v3_src`):

   ```bash
   git add .
   git status   # review what will be committed
   git commit -m "Initial commit: Muse Agent (muse-studio + muse_backend)"
   git branch -M main
   git remote add origin https://github.com/benjiyaya/Muse-Studio-Agent.git
   git push -u origin main
   ```

4. **Optional:** Add a repository description, topics (e.g. `nextjs`, `fastapi`, `comfyui`, `ai`), and a link to this README in the repo “About” section.

This project is licensed under the MIT License — see [LICENSE](LICENSE).
#
