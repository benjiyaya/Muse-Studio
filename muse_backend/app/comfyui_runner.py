from __future__ import annotations

"""
Thin async client for talking to a running ComfyUI instance.

This module is intentionally self-contained so that /generate/comfyui in
`api.routes.generate` can submit a workflow, monitor completion, and download
the final outputs into Muse Studio's shared `outputs/` folder.
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional

import asyncio
import json
import mimetypes
import time
import urllib.parse as _urlparse

import httpx

from app.config import settings


OnProgress = Callable[[int, str], Awaitable[None]]


def _agent_log(message: str, data: dict[str, Any], location: str, hypothesis_id: str) -> None:
    """Append a single NDJSON log line for the debug agent."""
    payload = {
        "sessionId": "ccff78",
        "runId": "comfyui",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data,
        "timestamp": int(time.time() * 1000),
    }
    log_path = Path(__file__).resolve().parents[2] / "debug-ccff78.log"
    try:
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(payload) + "\n")
    except Exception:
        # Logging must never break generation
        return


def _http_to_ws(url: str) -> str:
    """Convert http(s)://host → ws(s)://host for ComfyUI websocket."""
    parsed = _urlparse.urlparse(url)
    scheme = "wss" if parsed.scheme == "https" else "ws"
    return _urlparse.urlunparse((scheme, parsed.netloc, "/ws", "", "", ""))


@dataclass
class ComfyUIRunner:
    base_url: str

    async def run(
        self,
        workflow: dict[str, Any],
        kind: str,
        output_dir: Path,
        on_progress: Optional[OnProgress] = None,
    ) -> tuple[bool, Optional[Path], Optional[str], Optional[str]]:
        """
        Submit a patched workflow to ComfyUI and wait for completion.

        Returns (success, output_path, error_message, comfy_prompt_id).
        """
        client_id = f"muse-{id(self)}-{asyncio.get_running_loop().time():.0f}"

        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=5.0)) as client:
            # 0) Ensure any local media files referenced in the workflow are uploaded
            #     to ComfyUI's input folder, and replace their paths with the uploaded
            #     filenames. This mirrors the /upload/image (and audio) pattern from
            #     ComfyUI integration examples.
            await self._prepare_media_inputs(client, workflow)

            # 1) Submit prompt
            submit_resp = await client.post(
                f"{self.base_url}/prompt",
                json={"client_id": client_id, "prompt": workflow},
            )
            submit_resp.raise_for_status()
            payload = submit_resp.json()
            prompt_id = payload.get("prompt_id")
            if not prompt_id:
                return False, None, "ComfyUI did not return a prompt_id.", None

            # region agent log
            _agent_log(
                "comfyui_prompt_submitted",
                {"prompt_id": prompt_id, "base_url": self.base_url, "kind": kind},
                "comfyui_runner.py:run",
                "H1",
            )
            # endregion

            # 2) Wait for execution to finish (websocket if available, else HTTP poll)
            try:
                await self._wait_for_completion(prompt_id, client_id, on_progress, kind)
            except Exception as exc:  # noqa: BLE001
                # region agent log
                _agent_log(
                    "comfyui_execution_error",
                    {"prompt_id": prompt_id, "error": str(exc)},
                    "comfyui_runner.py:run",
                    "H1",
                )
                # endregion
                return False, None, f"ComfyUI execution error: {exc}", prompt_id

            # 3) Fetch history and download the first output file
            try:
                if kind == "video":
                    # ComfyUI can expose /history/<prompt_id> before all outputs are fully written.
                    # If we download too early we might grab only a thumbnail PNG.
                    last_exc: Optional[Exception] = None
                    output_path: Optional[Path] = None
                    for attempt in range(1, 6):
                        try:
                            output_path = await self._download_first_output(
                                client, prompt_id, kind, output_dir
                            )
                            break
                        except RuntimeError as exc:
                            last_exc = exc
                            if "No playable video output found" not in str(exc):
                                raise
                            if on_progress:
                                await on_progress(
                                    95,
                                    f"Waiting for video output (attempt {attempt}/5)...",
                                )
                            await asyncio.sleep(1.5 * attempt)

                    if output_path is None:
                        raise last_exc or RuntimeError("Failed to download video output after retries.")
                else:
                    output_path = await self._download_first_output(client, prompt_id, kind, output_dir)
            except Exception as exc:  # noqa: BLE001
                # region agent log
                _agent_log(
                    "comfyui_download_error",
                    {"prompt_id": prompt_id, "error": str(exc)},
                    "comfyui_runner.py:run",
                    "H1",
                )
                # endregion
                return False, None, f"Failed to download ComfyUI output: {exc}", prompt_id

            # region agent log
            _agent_log(
                "comfyui_run_success",
                {"prompt_id": prompt_id, "output_path": str(output_dir)},
                "comfyui_runner.py:run",
                "H1",
            )
            # endregion

        return True, output_path, None, prompt_id

    async def _wait_for_completion(
        self,
        prompt_id: str,
        client_id: str,
        on_progress: Optional[OnProgress],
        kind: str,
    ) -> None:
        """
        Wait until ComfyUI has written history for this prompt_id.

        NOTE: We intentionally avoid using the websocket stream here because
        custom nodes can emit execution_error events even when a usable video
        file is ultimately written. Instead, we rely solely on the HTTP
        /history/{prompt_id} endpoint and then inspect the recorded outputs.
        """
        await self._poll_until_done(prompt_id, on_progress, kind)

    async def _poll_until_done(
        self,
        prompt_id: str,
        on_progress: Optional[OnProgress],
        kind: str,
    ) -> None:
        """Simple HTTP polling fallback when websockets is unavailable."""
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            # Avoid returning too early: for some ComfyUI graphs, history appears
            # before the final video payload (e.g. a PNG thumbnail) is written.
            VIDEO_EXTS = (".mp4", ".mov", ".webm", ".mkv")
            start_ts = time.time()
            last_wait_log_ts = 0.0
            while True:
                resp = await client.get(f"{self.base_url}/history/{prompt_id}")
                if resp.status_code == 404:
                    # History not ready yet
                    await asyncio.sleep(1.5)
                    continue

                resp.raise_for_status()
                history = resp.json() or {}
                if not history:
                    await asyncio.sleep(1.5)
                    continue

                if kind == "video":
                    top = next(iter(history.values()), {}) or {}
                    outputs = top.get("outputs") or {}

                    def _is_video_record(rec: Any) -> bool:
                        if not isinstance(rec, dict):
                            return False
                        filename = rec.get("filename")
                        fmt = rec.get("format")
                        if isinstance(fmt, str) and fmt.startswith("video/"):
                            return True
                        if isinstance(filename, str) and filename.lower().endswith(VIDEO_EXTS):
                            return True
                        return False

                    found_video = False
                    if isinstance(outputs, dict):
                        for node_data in outputs.values():
                            if not isinstance(node_data, dict):
                                continue
                            if any(_is_video_record(r) for r in (node_data.get("videos") or []) if r is not None):
                                found_video = True
                                break
                            if any(_is_video_record(r) for r in (node_data.get("images") or []) if r is not None):
                                found_video = True
                                break

                    if not found_video:
                        if time.time() - start_ts > 120:
                            # Give up after a reasonable time; download stage will fail with details.
                            if on_progress:
                                await on_progress(98, "ComfyUI history written but no video detected (timeout).")
                            return
                        if on_progress:
                            await on_progress(95, "Waiting for ComfyUI video output...")
                        # Limited debug logging so we can inspect what history contains
                        # while waiting (e.g. thumbnail PNGs vs real mp4).
                        now_ts = time.time()
                        if now_ts - last_wait_log_ts > 10:
                            last_wait_log_ts = now_ts
                            try:
                                candidates: list[str] = []
                                if isinstance(outputs, dict):
                                    for node_data in outputs.values():
                                        if not isinstance(node_data, dict):
                                            continue
                                        for rec in (node_data.get("videos") or []):
                                            if isinstance(rec, dict):
                                                fn = rec.get("filename")
                                                fmt = rec.get("format")
                                                if isinstance(fn, str):
                                                    candidates.append(
                                                        f"{fn}({fmt or 'no-format'})"
                                                    )
                                        for rec in (node_data.get("images") or []):
                                            if isinstance(rec, dict):
                                                fn = rec.get("filename")
                                                fmt = rec.get("format")
                                                if isinstance(fn, str):
                                                    candidates.append(
                                                        f"{fn}({fmt or 'no-format'})"
                                                    )
                                        if len(candidates) >= 12:
                                            break
                                        if len(candidates) >= 12:
                                            break
                                _agent_log(
                                    "comfyui_waiting_for_video_output",
                                    {
                                        "prompt_id": prompt_id,
                                        "elapsed_sec": round(now_ts - start_ts, 1),
                                        "candidates": candidates[:12],
                                    },
                                    "comfyui_runner.py:_poll_until_done",
                                    "H1",
                                )
                            except Exception:
                                # Logging must never break generation.
                                pass
                        await asyncio.sleep(2.0)
                        continue

                # Presence of history implies completion (or we detected video-like output).
                if on_progress:
                    await on_progress(100, "ComfyUI history ready.")
                return

    async def _download_first_output(
        self,
        client: httpx.AsyncClient,
        prompt_id: str,
        kind: str,
        output_dir: Path,
    ) -> Path:
        """
        Inspect ComfyUI history for prompt_id and download the first image/video.
        """
        resp = await client.get(f"{self.base_url}/history/{prompt_id}")
        resp.raise_for_status()
        hist = resp.json()

        if not isinstance(hist, dict) or not hist:
            raise RuntimeError("ComfyUI history is empty.")

        # History structure: { prompt_id: { 'outputs': { node_id: { 'images': [...], 'videos': [...] } } } }
        item = next(iter(hist.values()))
        outputs = item.get("outputs") or {}

        file_records: list[dict[str, Any]] = []
        for node_data in outputs.values():
            if not isinstance(node_data, dict):
                continue

            # ComfyUI's history may record video outputs either under "videos" or, for some
            # nodes, under "images" with an .mp4 filename. To be robust, we collect both.
            videos_list = node_data.get("videos") or []
            images_list = node_data.get("images") or []

            if isinstance(videos_list, list):
                for r in videos_list:
                    if isinstance(r, dict):
                        file_records.append({**r, "__muse_source": "videos"})
            if isinstance(images_list, list):
                for r in images_list:
                    if isinstance(r, dict):
                        file_records.append({**r, "__muse_source": "images"})

        if not file_records:
            raise RuntimeError("No outputs found in ComfyUI history.")

        # Prefer true video files when kind == "video".
        # Some ComfyUI nodes also emit a PNG "thumbnail" next to the real video;
        # downloading that PNG into outputs/videos breaks the HTML5 <video> player.
        if kind == "video":
            VIDEO_EXTS = (".mp4", ".mov", ".webm", ".mkv")
            video_recs = [
                r for r in file_records
                if isinstance(r.get("filename"), str) and r["filename"].lower().endswith(VIDEO_EXTS)
            ]
            if video_recs:
                # Prefer explicit "video/*" formats (some nodes may emit thumbnails)
                # and only then fall back to extension-based selection.
                by_format = [
                    r
                    for r in video_recs
                    if isinstance(r.get("format"), str) and str(r["format"]).startswith("video/")
                ]
                rec = by_format[0] if by_format else video_recs[0]
            else:
                # Fallback: probe /view outputs and choose the one that actually returns video/*.
                # This handles cases where ComfyUI's history record filename isn't reliably
                # suffixed with a video extension.
                preferred = sorted(
                    file_records,
                    key=lambda r: 0 if r.get("__muse_source") == "videos" else 1,
                )
                last_found: list[str] = []
                for r in preferred:
                    if not isinstance(r, dict) or not isinstance(r.get("filename"), str):
                        continue
                    params = {
                        "filename": r["filename"],
                        "subfolder": r.get("subfolder", ""),
                        "type": r.get("type", "output"),
                    }
                    download_resp = await client.get(f"{self.base_url}/view", params=params)
                    content_type = (download_resp.headers.get("content-type") or "").lower()
                    last_found.append(f"{r['filename']}({content_type or 'no-content-type'})")

                    if content_type.startswith("video/"):
                        output_dir.mkdir(parents=True, exist_ok=True)
                        out_path = output_dir / r["filename"]
                        out_path.write_bytes(download_resp.content)
                        try:
                            _agent_log(
                                "comfyui_output_selected_by_content_type",
                                {
                                    "prompt_id": prompt_id,
                                    "kind": kind,
                                    "filename": r.get("filename"),
                                    "subfolder": r.get("subfolder", ""),
                                    "source": r.get("__muse_source"),
                                    "content_type": content_type,
                                },
                                "comfyui_runner.py:_download_first_output",
                                "H1",
                            )
                        except Exception:
                            pass
                        return out_path

                found = last_found[:10]
                raise RuntimeError(
                    "No playable video output found in ComfyUI history; refuses to download non-video outputs. "
                    f"Probed: {', '.join(found)}"
                )
        elif kind == "image":
            # For images, prefer common raster formats but still fall back safely.
            IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp", ".gif")
            image_recs = [
                r for r in file_records
                if isinstance(r.get("filename"), str) and r["filename"].lower().endswith(IMAGE_EXTS)
            ]
            rec = image_recs[0] if image_recs else file_records[0]
        else:
            # Unknown kind; keep prior behavior.
            rec = file_records[0]

        # Debug log: which record we selected to download.
        try:
            _agent_log(
                "comfyui_output_selected",
                {
                    "prompt_id": prompt_id,
                    "kind": kind,
                    "filename": rec.get("filename"),
                    "subfolder": rec.get("subfolder", ""),
                    "source": rec.get("__muse_source"),
                },
                "comfyui_runner.py:_download_first_output",
                "H1",
            )
        except Exception:
            # Logging must never break generation.
            pass
        filename = rec.get("filename")
        subfolder = rec.get("subfolder", "")
        file_type = rec.get("type", "output")
        if not filename:
            raise RuntimeError("Output record missing filename.")

        params = {
            "filename": filename,
            "subfolder": subfolder,
            "type": file_type,
        }
        download_resp = await client.get(f"{self.base_url}/view", params=params)
        download_resp.raise_for_status()

        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / filename
        out_path.write_bytes(download_resp.content)
        return out_path

    async def _prepare_media_inputs(self, client: httpx.AsyncClient, workflow: dict[str, Any]) -> None:
        """
        Scan the workflow for LoadImage / LoadAudio nodes that reference local files
        (e.g. refs/sceneId/uuid.png) and upload those files to ComfyUI via
        /upload/image or /upload/audio. After upload, rewrite the node inputs to
        use just the uploaded filename, which is what ComfyUI expects.
        """
        media_nodes: list[tuple[str, str, str]] = []
        for node_id, node in workflow.items():
            if not isinstance(node, dict):
                continue
            class_type = node.get("class_type")
            inputs = node.get("inputs") or {}
            if not isinstance(inputs, dict):
                continue

            if class_type == "LoadImage" and isinstance(inputs.get("image"), str):
                media_nodes.append((str(node_id), "image", str(inputs.get("image"))))
            elif class_type == "LoadAudio" and isinstance(inputs.get("audio"), str):
                media_nodes.append((str(node_id), "audio", str(inputs.get("audio"))))

        for node_id, field, value in media_nodes:
            path_str = value
            # If it's already a bare filename (no path separators), assume ComfyUI can see it.
            if "/" not in path_str and "\\" not in path_str:
                continue

            local_path = Path(path_str)
            if not local_path.is_absolute():
                local_path = settings.outputs_path / path_str

            if not local_path.exists():
                _agent_log(
                    "comfyui_media_missing",
                    {"node_id": node_id, "field": field, "path": str(local_path)},
                    "comfyui_runner.py:_prepare_media_inputs",
                    "H1",
                )
                continue

            ext = local_path.suffix.lower()
            is_image = ext in {".png", ".jpg", ".jpeg", ".webp", ".gif"}
            is_audio = ext in {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac"}

            if field == "image" and not is_image:
                continue
            if field == "audio" and not is_audio:
                continue

            try:
                mime_type, _ = mimetypes.guess_type(local_path.name)
                if mime_type is None:
                    mime_type = "application/octet-stream"

                files = {field: (local_path.name, local_path.open("rb"), mime_type)}
                data = {"type": "input", "overwrite": "false"}

                endpoint = "/upload/image" if field == "image" else "/upload/audio"
                resp = await client.post(f"{self.base_url}{endpoint}", files=files, data=data)
                resp.raise_for_status()

                # After upload, ComfyUI expects just the filename in the workflow.
                workflow[node_id]["inputs"][field] = local_path.name

                _agent_log(
                    "comfyui_media_uploaded",
                    {
                        "node_id": node_id,
                        "field": field,
                        "local_path": str(local_path),
                        "uploaded_name": local_path.name,
                    },
                    "comfyui_runner.py:_prepare_media_inputs",
                    "H1",
                )
            except Exception as exc:  # noqa: BLE001
                _agent_log(
                    "comfyui_media_upload_error",
                    {"node_id": node_id, "field": field, "path": str(local_path), "error": str(exc)},
                    "comfyui_runner.py:_prepare_media_inputs",
                    "H1",
                )

