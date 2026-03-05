'use client';

import { useState, useCallback } from 'react';
import type { ImageDraftResponse, ImageRefineResponse } from '@/lib/backend-client';

export interface DraftOptions {
  sceneId: string;
  prompt: string;
  referenceImagePaths?: string[];
  aspectRatio?: string;
  styleStrength?: number;
  numVariations?: number;
  providerId?: string;
}

export interface RefineOptions {
  sceneId: string;
  draftImagePath: string;
  prompt?: string;
  denoiseStrength?: number;
  providerId?: string;
}

export type VisualMusePhase = 'idle' | 'drafting' | 'refining' | 'done' | 'error';

export interface VisualMuseState {
  phase: VisualMusePhase;
  draft: ImageDraftResponse | null;
  refined: ImageRefineResponse | null;
  error: string | null;
}

/**
 * Manages the two-step Visual Muse workflow:
 *   Step 1 — generateDraft()  → calls POST /api/generate/draft  (Qwen / FLUX.2-klein)
 *   Step 2 — refineImage()    → calls POST /api/generate/refine  (Z-Image Turbo)
 */
export function useVisualMuse() {
  const [state, setState] = useState<VisualMuseState>({
    phase: 'idle',
    draft: null,
    refined: null,
    error: null,
  });

  const generateDraft = useCallback(async (opts: DraftOptions) => {
    setState({ phase: 'drafting', draft: null, refined: null, error: null });

    try {
      const res = await fetch('/api/generate/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene_id: opts.sceneId,
          prompt: opts.prompt,
          reference_image_paths: opts.referenceImagePaths ?? [],
          aspect_ratio: opts.aspectRatio ?? '16:9',
          style_strength: opts.styleStrength ?? 0.75,
          num_variations: opts.numVariations ?? 2,
          provider_id: opts.providerId,
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as ImageDraftResponse;
      setState({ phase: 'done', draft: data, refined: null, error: null });
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Draft generation failed';
      setState((prev) => ({ ...prev, phase: 'error', error: message }));
      return null;
    }
  }, []);

  const refineImage = useCallback(async (opts: RefineOptions) => {
    setState((prev) => ({ ...prev, phase: 'refining', error: null }));

    try {
      const res = await fetch('/api/generate/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scene_id: opts.sceneId,
          draft_image_path: opts.draftImagePath,
          prompt: opts.prompt,
          denoise_strength: opts.denoiseStrength ?? 0.35,
          provider_id: opts.providerId,
        }),
      });

      if (!res.ok) {
        const body = await res.json();
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as ImageRefineResponse;
      setState((prev) => ({ ...prev, phase: 'done', refined: data, error: null }));
      return data;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Image refinement failed';
      setState((prev) => ({ ...prev, phase: 'error', error: message }));
      return null;
    }
  }, []);

  const reset = useCallback(() => {
    setState({ phase: 'idle', draft: null, refined: null, error: null });
  }, []);

  return { ...state, generateDraft, refineImage, reset };
}
