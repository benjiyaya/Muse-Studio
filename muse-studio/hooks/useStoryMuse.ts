'use client';

import { useState, useCallback, useRef } from 'react';

export type StoryMuseTask =
  | 'generate_storyline'
  | 'write_scene_script'
  | 'refine_dialogue'
  | 'general_query'
  | 'visual_query'
  | 'motion_query'
  | 'visual_keyframe_prompt';

export interface StoryMuseOptions {
  task: StoryMuseTask;
  prompt: string;
  context?: Record<string, unknown>;
  projectId?: string;
  providerId?: string;
  ollamaBaseUrl?: string;
  ollamaModel?: string;
  openaiModel?: string;
  claudeModel?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface StoryMuseState {
  isGenerating: boolean;
  isLoadingModel: boolean;  // true while waiting for first token (model loading from disk)
  text: string;
  error: string | null;
}

/**
 * Streams Story Muse responses from the Python backend via SSE.
 *
 * Usage:
 *   const { isGenerating, text, error, generate, cancel } = useStoryMuse();
 *   await generate({ task: 'generate_storyline', prompt: '...' });
 *   // Use returned { text, error } for the final result; state updates for streaming UI.
 */
export function useStoryMuse() {
  const [state, setState] = useState<StoryMuseState>({
    isGenerating: false,
    isLoadingModel: false,
    text: '',
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setState((prev) => ({ ...prev, isGenerating: false }));
  }, []);

  const generate = useCallback(
    async (opts: StoryMuseOptions): Promise<{ text: string; error: string | null }> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState({ isGenerating: true, isLoadingModel: true, text: '', error: null });

      let accumulated = '';

      try {
        const res = await fetch('/api/generate/story', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            task: opts.task,
            prompt: opts.prompt,
            context: opts.context,
            project_id: opts.projectId,
            provider_id: opts.providerId,
            max_tokens: opts.maxTokens,
            temperature: opts.temperature,
            ollama_base_url: opts.ollamaBaseUrl,
            ollama_model: opts.ollamaModel,
            openai_model: opts.openaiModel,
            claude_model: opts.claudeModel,
          }),
        });

        if (!res.body) throw new Error('No response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            // SSE comment (keep-alive ping while model loads) — ignore
            if (line.startsWith(':')) continue;
            if (!line.startsWith('data:')) continue;
            const json = line.slice(5).trim();
            if (!json) continue;

            try {
              const chunk = JSON.parse(json) as {
                text?: string;
                error?: string;
                is_final?: boolean;
              };

              if (chunk.error) {
                setState({ isGenerating: false, isLoadingModel: false, text: accumulated, error: chunk.error });
                return { text: accumulated, error: chunk.error };
              }

              if (chunk.text) {
                accumulated += chunk.text;
                setState({ isGenerating: !chunk.is_final, isLoadingModel: false, text: accumulated, error: null });
              }
            } catch {
              // malformed chunk — skip
            }
          }
        }

        setState({ isGenerating: false, isLoadingModel: false, text: accumulated, error: null });
        return { text: accumulated, error: null };
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setState((prev) => ({ ...prev, isGenerating: false, isLoadingModel: false }));
          return { text: accumulated, error: null };
        }
        const message = err instanceof Error ? err.message : 'Story Muse generation failed';
        setState({ isGenerating: false, isLoadingModel: false, text: accumulated, error: message });
        return { text: accumulated, error: message };
      }
    },
    [],
  );

  return { ...state, generate, cancel };
}
