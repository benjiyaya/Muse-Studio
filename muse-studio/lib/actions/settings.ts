'use server';

import { db } from '@/db';

interface SettingRow {
  key: string;
  value: string;
  updated_at: string;
}

// ─── Read ──────────────────────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
  const row = db
    .prepare<[string], SettingRow>('SELECT * FROM settings WHERE key = ?')
    .get(key);
  return row?.value ?? null;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = db.prepare<[], SettingRow>('SELECT * FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ─── Write ─────────────────────────────────────────────────────────────────────

export async function setSetting(key: string, value: string): Promise<void> {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now);
}

export async function setSettings(entries: Record<string, string>): Promise<void> {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const txn = db.transaction(() => {
    for (const [key, value] of Object.entries(entries)) {
      stmt.run(key, value, now);
    }
  });
  txn();
}

// ─── LLM settings convenience helpers ────────────────────────────────────────

export interface LLMSettings {
  llmProvider: string;    // "ollama" | "openai" | "claude" | "lmstudio"
  ollamaBaseUrl: string;
  ollamaModel: string;
  openaiModel: string;
  claudeModel: string;
  lmstudioBaseUrl: string;
  lmstudioModel: string;
}

export async function getLLMSettings(): Promise<LLMSettings> {
  const all = await getAllSettings();
  return {
    llmProvider: all['llm_provider'] ?? 'ollama',
    ollamaBaseUrl: all['ollama_base_url'] ?? 'http://localhost:11434',
    ollamaModel: all['ollama_model'] ?? 'qwen3-vl:latest',
    openaiModel: all['openai_model'] ?? 'gpt-4o',
    claudeModel: all['claude_model'] ?? 'claude-sonnet-4-6',
    lmstudioBaseUrl: all['lmstudio_base_url'] ?? 'http://localhost:1234',
    lmstudioModel: all['lmstudio_model'] ?? '',
  };
}

export async function saveLLMSettings(data: LLMSettings): Promise<void> {
  await setSettings({
    llm_provider: data.llmProvider,
    ollama_base_url: data.ollamaBaseUrl,
    ollama_model: data.ollamaModel,
    openai_model: data.openaiModel,
    claude_model: data.claudeModel,
    lmstudio_base_url: data.lmstudioBaseUrl,
    lmstudio_model: data.lmstudioModel,
  });
}

// ─── Inference / Model settings ───────────────────────────────────────────────

export type FluxOffloadMode = 'none' | 'model' | 'sequential';

export interface InferenceSettings {
  fluxKleinOffload: FluxOffloadMode;
  videoDefault: string;  // maps to providers.video_default in muse_config.json
}

export async function getInferenceSettings(): Promise<InferenceSettings> {
  const all = await getAllSettings();
  return {
    fluxKleinOffload: (all['flux_klein_offload'] as FluxOffloadMode) ?? 'none',
    videoDefault: all['video_default'] ?? 'ltx2',
  };
}

export async function saveInferenceSettings(data: InferenceSettings): Promise<void> {
  await setSettings({
    flux_klein_offload: data.fluxKleinOffload,
    video_default: data.videoDefault,
  });
}
