'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { VideoGenerateResponse, JobResult } from '@/lib/backend-client';

export interface VideoOptions {
  sceneId: string;
  script: string;
  keyframePaths?: string[];
  durationSeconds?: number;
  fps?: number;
  motionStrength?: number;
  providerId?: string;
}

export type MotionMusePhase = 'idle' | 'queued' | 'running' | 'completed' | 'failed';

export interface MotionMuseState {
  phase: MotionMusePhase;
  jobId: string | null;
  providerId: string | null;
  progressPercent: number;
  message: string | null;
  outputPath: string | null;
  error: string | null;
}

// Motion Muse (generic video) polling — align with Kanban video polling.
// 3 minutes to reduce backend load for long-running video jobs.
const POLL_INTERVAL_MS = 3 * 60 * 1000;

/**
 * Manages Motion Muse async video generation:
 *   1. submitJob() → POST /api/generate/video — gets a job_id immediately
 *   2. Polls GET /api/jobs/[id] every 3 s until completed or failed
 */
export function useMotionMuse() {
  const [state, setState] = useState<MotionMuseState>({
    phase: 'idle',
    jobId: null,
    providerId: null,
    progressPercent: 0,
    message: null,
    outputPath: null,
    error: null,
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Clean up interval on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const startPolling = useCallback(
    (jobId: string) => {
      stopPolling();
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/jobs/${jobId}`);
          if (!res.ok) return;
          const job = (await res.json()) as JobResult;

          if (job.status === 'completed') {
            stopPolling();
            setState((prev) => ({
              ...prev,
              phase: 'completed',
              progressPercent: 100,
              message: job.message ?? 'Generation complete',
              outputPath: job.output_path ?? null,
            }));
          } else if (job.status === 'failed') {
            stopPolling();
            setState((prev) => ({
              ...prev,
              phase: 'failed',
              error: job.error ?? 'Video generation failed',
            }));
          } else {
            setState((prev) => ({
              ...prev,
              phase: job.status === 'running' ? 'running' : 'queued',
              progressPercent: job.progress_percent ?? prev.progressPercent,
              message: job.message ?? prev.message,
            }));
          }
        } catch {
          // transient poll error — keep trying
        }
      }, POLL_INTERVAL_MS);
    },
    [stopPolling],
  );

  const submitJob = useCallback(
    async (opts: VideoOptions) => {
      stopPolling();
      setState({
        phase: 'queued',
        jobId: null,
        providerId: null,
        progressPercent: 0,
        message: 'Submitting job…',
        outputPath: null,
        error: null,
      });

      try {
        const res = await fetch('/api/generate/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scene_id: opts.sceneId,
            script: opts.script,
            keyframe_paths: opts.keyframePaths ?? [],
            duration_seconds: opts.durationSeconds,
            fps: opts.fps,
            motion_strength: opts.motionStrength ?? 0.7,
            provider_id: opts.providerId,
          }),
        });

        if (!res.ok) {
          const body = await res.json();
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }

        const data = (await res.json()) as VideoGenerateResponse;
        setState((prev) => ({
          ...prev,
          jobId: data.job_id,
          providerId: data.provider_id,
          message: data.message,
        }));
        startPolling(data.job_id);
        return data.job_id;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Video job submission failed';
        setState((prev) => ({ ...prev, phase: 'failed', error: message }));
        return null;
      }
    },
    [stopPolling, startPolling],
  );

  const reset = useCallback(() => {
    stopPolling();
    setState({
      phase: 'idle',
      jobId: null,
      providerId: null,
      progressPercent: 0,
      message: null,
      outputPath: null,
      error: null,
    });
  }, [stopPolling]);

  return { ...state, submitJob, reset };
}
