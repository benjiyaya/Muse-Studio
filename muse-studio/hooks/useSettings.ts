'use client';

import { useState, useEffect } from 'react';
import type { LLMSettings } from '@/lib/actions/settings';

const DEFAULT_LLM: LLMSettings = {
  llmProvider: 'ollama',
  ollamaBaseUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2',
  openaiModel: 'gpt-4o',
  claudeModel: 'claude-sonnet-4-6',
  lmstudioBaseUrl: 'http://localhost:1234',
  lmstudioModel: '',
};

export function useLLMSettings(): LLMSettings {
  const [settings, setSettings] = useState<LLMSettings>(DEFAULT_LLM);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data) => {
        if (data.llm) setSettings(data.llm);
      })
      .catch(() => {/* use defaults */});
  }, []);

  return settings;
}
