"""Quick import and sanity check — run before starting server."""
import sys

print(f"Python {sys.version}")
print("-" * 50)

# Config
from app.config import settings
print(f"[OK] config  models_path={settings.models_path}")
print(f"     models_path_exists={settings.models_path.exists()}")
print(f"     image_draft_provider={settings.providers.image_draft}")
print(f"     video_default={settings.providers.video_default}")

# Schemas
from app.schemas import (
    ImageDraftRequest, ImageRefineRequest,
    VideoGenerateRequest, StoryGenerateRequest,
    HealthResponse, ProvidersResponse,
)
print("[OK] schemas")

# Registry
from app.registry import get_all_provider_info, get_available_video_providers
info = get_all_provider_info()
print("[OK] registry")
for category, providers in info.items():
    for p in providers:
        status = "available" if p["is_available"] else f"unavailable: {(p['unavailable_reason'] or '')[:60]}"
        print(f"     [{category}] {p['provider_id']} ({p['provider_type']}) — {status}")

print()
print(f"Available video providers: {get_available_video_providers()}")

# Routes
from app.api.routes import generate, providers, jobs
print("[OK] routes")

# Main app
from app.main import app
print("[OK] main app")
print()
print("All imports OK — ready to start server.")
print("Run: python run.py")
