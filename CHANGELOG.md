# Changelog

All notable changes to Muse Studio are documented here. Release titles match Git tags (e.g. `v1.5.0`).

---

## [1.5.5] - 2026-09-04

### Highlights

- Consolidate Ask Muse into Extensions flow and redirect `/ask-muse` to `/mcp-extensions` with query compatibility.
- Add built-in Muse orchestration tool execution (`muse.story`, `muse.visual`, `muse.motion`) in the unified executor.
- Improve session UX (create/switch/rename/delete/pin/search), persist `project_id`/`scene_id` context, and add better empty-session onboarding.
- Remove manual upload target selector and infer upload destination from chat session context (project or session).
- Improve reliability with DB/session schema guards, `crypto.randomUUID` fallback path, and strict MCP argument-shape compatibility fixes.

## [1.5.0] - 2026-03-28

### User-facing features

- Unified product version shown in Settings -> About, backend `GET /health`, and package metadata.
- OpenRouter as a first-class LLM provider (OpenAI-compatible API with env-based keys).
- LM Studio support for Story Muse and related routes.
- Plugin extensions flow in settings and generation dialogs.
- MCP bridge via `mcp-muse-studio`.
- Video Editor Agent export paths (Simple Stitch, Smart Edit, Remotion polished render).
- Security checks with `scripts/security_dependency_guard.py` and `SECURITY.md`.

### Codebase and architecture

- Story and batch scene generation logic consolidated in `muse-studio/lib/generation/`.
- Shared job polling helpers and server utility modules.
- Shared Story Muse prompts in `muse_backend/app/providers/llm/shared_prompts.py`.
- Plugin extension contracts/actions plus SDK/host package integration.
- Backend API version surfaced via `APP_VERSION` in `muse_backend/app/main.py`.

### Documentation

- README updates for setup, providers, release notes, and security checks.
- Plugin development docs aligned with current extension patterns.

---

## Earlier releases

Prior work before `v1.5.0` is summarized in README section "What's New" and in git history.
