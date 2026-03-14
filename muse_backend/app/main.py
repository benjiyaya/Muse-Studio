"""
Muse Backend — FastAPI Application Entry Point

Run with:
    uvicorn app.main:app --reload --port 8000

Or use the start script:
    python run.py
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.api.routes import agent, generate, providers, jobs, llm, inference_settings, projects, editor
from app.schemas import HealthResponse
from app.registry import get_all_provider_info

# ── App instance ──────────────────────────────────────────────────────────────

app = FastAPI(
    title="Muse Agent Backend",
    description=(
        "AI inference backend for Muse Studio. "
        "Provides Story Muse (LLM), Visual Muse (image generation), "
        "and Motion Muse (video generation) capabilities."
    ),
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS — allow Next.js frontend to call this API ────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",   # Next.js dev server
        "http://127.0.0.1:3000",
        # Add production domain here when deploying
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(agent.router)
app.include_router(generate.router)
app.include_router(projects.router)
app.include_router(providers.router)
app.include_router(jobs.router)
app.include_router(llm.router)
app.include_router(inference_settings.router)
app.include_router(editor.router)

# ── Health check ──────────────────────────────────────────────────────────────

@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """
    Returns server health status, models path, and a summary of available providers.
    The Next.js BFF calls this on startup to verify the Python backend is reachable.
    """
    models_path = settings.models_path
    provider_info = get_all_provider_info()

    available = {
        category: [p["provider_id"] for p in providers if p["is_available"]]
        for category, providers in provider_info.items()
    }

    return HealthResponse(
        status="ok",
        models_path=str(models_path),
        models_path_exists=models_path.exists(),
        available_providers=available,
    )


@app.get("/", tags=["System"])
async def root():
    return {
        "service": "Muse Agent Backend",
        "version": "0.1.0",
        "docs": "/docs",
        "health": "/health",
    }
