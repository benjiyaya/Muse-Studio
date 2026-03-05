"""
Muse Backend startup script.
Reads host/port from muse_config.json automatically.

Usage:
    python run.py
"""

import os
import sys
import io
import uvicorn
from app.config import settings

# Must be set BEFORE torch initialises CUDA.
# expandable_segments lets the allocator grow/shrink blocks without
# needing one large contiguous chunk, eliminating the "226 MiB OOM
# with 28 GB free" fragmentation failure during Gemma loading.
os.environ["PYTORCH_ALLOC_CONF"] = "expandable_segments:True"

# Force stdout to UTF-8 so emoji/Unicode in print() doesn't crash on Windows cp1252
if sys.stdout is not None and getattr(sys.stdout, 'encoding', None) and sys.stdout.encoding.lower() != 'utf-8':
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    except Exception:
        pass

if __name__ == "__main__":
    print(f"\n[Muse] Muse Backend starting...")
    print(f"   Models path : {settings.models_path}")
    print(f"   Models exist: {settings.models_path.exists()}")
    print(f"   Server      : http://{settings.server.host}:{settings.server.port}")
    print(f"   API docs    : http://localhost:{settings.server.port}/docs\n")

    uvicorn.run(
        "app.main:app",
        host=settings.server.host,
        port=settings.server.port,
        reload=settings.server.reload,
        reload_delay=2.0,          # debounce rapid file-system events (e.g. .pyc writes)
        reload_excludes=[
            "**/__pycache__/**",
            "**/*.pyc",
            "**/*.pyo",
            "backend.log",
            "_debug_*.py",
        ],
        log_level=settings.server.log_level,
    )
