import type { LLMSettings } from '@/lib/actions/settings';

/**
 * Model id for the **active** LLM provider only.
 * Avoids showing a stale Ollama model when the user switched to OpenRouter (or another provider).
 */
export function activeLlmModelId(settings?: LLMSettings): string | undefined {
  if (!settings) return undefined;
  switch (settings.llmProvider) {
    case 'ollama':
      return settings.ollamaModel?.trim() || undefined;
    case 'openai':
      return settings.openaiModel?.trim() || undefined;
    case 'claude':
      return settings.claudeModel?.trim() || undefined;
    case 'lmstudio':
      return settings.lmstudioModel?.trim() || undefined;
    case 'openrouter':
      return settings.openrouterModel?.trim() || undefined;
    default:
      return undefined;
  }
}

/** Local runtimes that may spend a long time loading weights into VRAM/RAM. */
export function isLocalLlmProvider(settings?: LLMSettings): boolean {
  const p = settings?.llmProvider;
  return p === 'ollama' || p === 'lmstudio';
}

export function activeLlmProviderLabel(settings?: LLMSettings): string {
  const p = settings?.llmProvider ?? 'ollama';
  const labels: Record<string, string> = {
    ollama: 'Ollama',
    openai: 'OpenAI',
    claude: 'Claude',
    lmstudio: 'LM Studio',
    openrouter: 'OpenRouter',
  };
  return labels[p] ?? p;
}

/** Scene-generation SSE: no bytes for two minutes (used by SceneGenerationOverlay). */
export function streamFirstDataTimeoutMessage(settings?: LLMSettings): string {
  const local = isLocalLlmProvider(settings);
  return (
    'Timed out waiting for the LLM: no data on the stream for 2 minutes. ' +
    (local
      ? 'Check Settings → LLM (local server running, model load). '
      : 'Check Settings → LLM (API keys in .env, network, provider status). ') +
    'Use Try again when ready.'
  );
}
