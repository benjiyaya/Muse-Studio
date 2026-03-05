/**
 * Server-side HTTP client for the Muse Python backend.
 * Used exclusively from Next.js API route handlers (never called from the browser directly).
 *
 * The Python backend URL is read from the MUSE_BACKEND_URL environment variable,
 * defaulting to http://localhost:8000 for local development.
 */

const BACKEND_URL = process.env.MUSE_BACKEND_URL ?? 'http://localhost:8000';

// ── Request / Response types (mirror Python schemas.py) ──────────────────────

export interface HealthResponse {
  status: string;
  version: string;
  models_path: string;
  models_path_exists: boolean;
  available_providers: Record<string, string[]>;
}

export interface ProviderInfo {
  provider_id: string;
  display_name: string;
  provider_type: 'local' | 'api';
  category: 'image_draft' | 'image_refine' | 'video' | 'llm';
  is_available: boolean;
  unavailable_reason?: string;
  capabilities: Record<string, unknown>;
}

export interface ProvidersResponse {
  image_draft: ProviderInfo[];
  image_refine: ProviderInfo[];
  video: ProviderInfo[];
  llm: ProviderInfo[];
}

export interface ImageAsset {
  path: string;
  width: number;
  height: number;
  file_size_bytes?: number;
}

export interface ImageDraftRequest {
  scene_id: string;
  prompt: string;
  reference_image_paths?: string[];
  aspect_ratio?: string;
  style_strength?: number;
  provider_id?: string;
  num_variations?: number;
}

export interface ImageDraftResponse {
  scene_id: string;
  provider_id: string;
  variations: ImageAsset[];
  generation_params: Record<string, unknown>;
}

export interface ImageRefineRequest {
  scene_id: string;
  draft_image_path: string;
  prompt?: string;
  denoise_strength?: number;
  provider_id?: string;
}

export interface ImageRefineResponse {
  scene_id: string;
  provider_id: string;
  final_image: ImageAsset;
  generation_params: Record<string, unknown>;
}

export interface VideoGenerateRequest {
  scene_id: string;
  script: string;
  keyframe_paths?: string[];
  duration_seconds?: number;
  fps?: number;
  motion_strength?: number;
  provider_id?: string;
  /** For LTX2 only: '16:9' (1280×720) or '9:16' (720×1280). */
  aspect_ratio?: string;
}

export interface VideoGenerateResponse {
  job_id: string;
  scene_id: string;
  provider_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  message: string;
}

export interface StoryGenerateRequest {
  task: string;
  prompt: string;
  context?: Record<string, unknown>;
  provider_id?: string;
  max_tokens?: number;
  temperature?: number;
  // Ollama-specific (forwarded to backend when provider_id = "ollama")
  ollama_base_url?: string;
  ollama_model?: string;
  // OpenAI-specific
  openai_model?: string;
  // Claude-specific
  claude_model?: string;
}

export interface JobResult {
  job_id: string;
  scene_id: string;
  provider_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress_percent?: number;
  message?: string;
  output_path?: string;
  error?: string;
  created_at: string;
  updated_at: string;
  comfy_prompt_id?: string;
}

// ── Internal fetch wrapper ────────────────────────────────────────────────────

async function backendFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const url = `${BACKEND_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail?.error ?? body?.detail ?? detail;
    } catch {
      // ignore parse failures
    }
    throw new BackendError(detail, res.status);
  }

  return res.json() as Promise<T>;
}

export class BackendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'BackendError';
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export const backendClient = {
  /**
   * Returns backend health + available providers summary.
   * Used by the frontend to show a connection indicator.
   */
  async health(): Promise<HealthResponse> {
    return backendFetch<HealthResponse>('/health');
  },

  /**
   * Lists all registered providers with availability status.
   */
  async providers(): Promise<ProvidersResponse> {
    return backendFetch<ProvidersResponse>('/providers');
  },

  /**
   * Visual Muse Step 1: Generate draft keyframe(s).
   */
  async generateDraft(body: ImageDraftRequest): Promise<ImageDraftResponse> {
    return backendFetch<ImageDraftResponse>('/generate/draft', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * Visual Muse Step 2: Refine a draft keyframe (img2img).
   */
  async refineImage(body: ImageRefineRequest): Promise<ImageRefineResponse> {
    return backendFetch<ImageRefineResponse>('/generate/refine', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * Motion Muse: Submit async video generation job.
   * Returns immediately with a job_id; poll getJob() for progress.
   */
  async generateVideo(body: VideoGenerateRequest): Promise<VideoGenerateResponse> {
    return backendFetch<VideoGenerateResponse>('/generate/video', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * Poll a video generation job for status + output path.
   */
  async getJob(jobId: string): Promise<JobResult> {
    return backendFetch<JobResult>(`/jobs/${jobId}`);
  },

  /**
   * Story Muse: Returns a raw fetch Response with a text/event-stream body.
   * The caller is responsible for streaming the response through to the browser.
   *
   * This does NOT use backendFetch because we need access to the raw Response
   * body stream (not the parsed JSON).
   */
  async generateStoryStream(body: StoryGenerateRequest): Promise<Response> {
    const url = `${BACKEND_URL}/generate/story`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const b = await res.json();
        detail = b?.detail?.error ?? b?.detail ?? detail;
      } catch {
        // ignore
      }
      throw new BackendError(detail, res.status);
    }

    return res;
  },
};
