# LTX2 provider: merged checkpoint and video output

## Model layout (after removing standalone connector)

- **Required**
  - `models/ltx2/diffusion_models/ltx-2-19b-dev.safetensors` (or GGUF) — **merged** checkpoint containing transformer + video/audio VAE + **embeddings connector** (no separate connector file).
  - `models/ltx2/text_encoders/gemma_3_12B_it_fp8_scaled.safetensors` — Gemma 3 12B text encoder only.
  - `models/ltx2/vae/LTX2_video_vae_bf16.safetensors` — if not already inside the merged checkpoint.
- **Optional**
  - `models/ltx2/vae/LTX2_audio_vae_bf16.safetensors`, `ltx-2-spatial-upscaler-x2-1.0.safetensors`.

## Video output and DB

- Videos are written to **muse-studio/outputs/videos** (via `settings.outputs_path / "videos"`).
- The backend returns **relative** path (e.g. `videos/ltx2_xxxx.mp4`) in `VideoResult.output_path`.
- The job API returns this to the frontend; the frontend builds `videoUrl = /api/outputs/videos/ltx2_xxxx.mp4` and calls `updateScene(sceneId, { videoUrl })`, which persists to **muse-studio/db/muse.db** (scenes.video_url).

## Code changes in ltx_provider.py

1. **Availability**: Do not require a standalone connector file; require only diffusion model + video VAE + Gemma.
2. **Connector loading**: If a standalone connector file exists, use it; otherwise (merged checkpoint) extract connector keys from the diffusion checkpoint when loading the transformer (BF16 safetensors path).
3. **Output path**: Already using `settings.outputs_path / "videos"` and returning relative path; keep as is. Remove debug instrumentation.
4. **Docstring and capabilities**: Update to describe merged checkpoint and that connector is included in it.
