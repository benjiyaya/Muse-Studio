'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Brain,
  Wifi,
  WifiOff,
  Loader2,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Save,
  ChevronDown,
  Sparkles,
  ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { saveLLMSettings } from '@/lib/actions/settings';
import type { LLMSettings as LLMSettingsData } from '@/lib/actions/settings';

interface LLMModel {
  name: string;
  size: string;
  modified_at: string;
}

interface TestResult {
  ok: boolean;
  message: string;
  latency_ms: number;
}

interface LLMSettingsProps {
  initialSettings: LLMSettingsData;
}

const PROVIDER_OPTIONS = [
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    description: 'Run LLMs locally on your machine. Free, private, no API key required.',
    badge: 'Recommended',
    badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    description: 'Cloud API. Requires OPENAI_API_KEY in muse_backend/.env.',
    badge: 'API Key Required',
    badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
  {
    id: 'claude',
    label: 'Anthropic Claude',
    description: 'Cloud API via OpenAI-compatible endpoint. Requires ANTHROPIC_API_KEY in muse_backend/.env.',
    badge: 'API Key Required',
    badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
];

const OPENAI_MODELS = [
  { id: 'gpt-4o',       label: 'GPT-4o',       description: 'High intelligence, multimodal' },
  { id: 'gpt-4o-mini',  label: 'GPT-4o mini',  description: 'Fast & cost-efficient' },
  { id: 'gpt-5.0',      label: 'GPT-5.0',      description: 'Next-gen flagship' },
  { id: 'gpt-5.2',      label: 'GPT-5.2',      description: 'Latest GPT-5 release' },
];

const CLAUDE_MODELS = [
  { id: 'claude-haiku-3-5',   label: 'Claude Haiku 3.5',   description: 'Fast, compact' },
  { id: 'claude-sonnet-4-6',  label: 'Claude Sonnet 4.6',  description: 'Balanced — recommended' },
  { id: 'claude-opus-4-6',    label: 'Claude Opus 4.6',    description: 'Most powerful' },
];

// ── Simple model dropdown shared by OpenAI and Claude sections ───────────────

interface ModelPickerProps {
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string; description: string }[];
}

function ModelPicker({ value, onChange, options }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value) ?? options[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none hover:bg-white/8 transition-colors"
      >
        <span>
          {selected.label}{' '}
          <span className="text-muted-foreground/60 text-xs">— {selected.description}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl border border-white/10 bg-[oklch(0.16_0.012_264)] shadow-2xl overflow-hidden">
          {options.map((opt) => (
            <button
              key={opt.id}
              onClick={() => { onChange(opt.id); setOpen(false); }}
              className={cn(
                'w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-white/8 transition-colors',
                value === opt.id && 'bg-violet-500/10 text-violet-300',
              )}
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-xs text-muted-foreground/60 shrink-0 ml-3">{opt.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LLMSettings({ initialSettings }: LLMSettingsProps) {
  const router = useRouter();

  const [provider, setProvider] = useState(initialSettings.llmProvider);
  const [ollamaUrl, setOllamaUrl] = useState(initialSettings.ollamaBaseUrl);
  const [ollamaModel, setOllamaModel] = useState(initialSettings.ollamaModel);
  const [openaiModel, setOpenaiModel] = useState(initialSettings.openaiModel ?? 'gpt-4o');
  const [claudeModel, setClaudeModel] = useState(initialSettings.claudeModel ?? 'claude-sonnet-4-6');

  const [models, setModels] = useState<LLMModel[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [ollamaDropdownOpen, setOllamaDropdownOpen] = useState(false);

  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const isDirty =
    provider !== initialSettings.llmProvider ||
    ollamaUrl !== initialSettings.ollamaBaseUrl ||
    ollamaModel !== initialSettings.ollamaModel ||
    openaiModel !== (initialSettings.openaiModel ?? 'gpt-4o') ||
    claudeModel !== (initialSettings.claudeModel ?? 'claude-sonnet-4-6');

  // ── Load Ollama models ─────────────────────────────────────────────────────

  const fetchModels = useCallback(async (url: string) => {
    setLoadingModels(true);
    setModelsError(null);
    setModels([]);
    try {
      const params = new URLSearchParams({ base_url: url });
      const res = await fetch(`/api/llm/models?${params}`);
      const data = await res.json();
      if (data.ok) {
        setModels(data.models ?? []);
        if (data.models?.length > 0 && !ollamaModel) {
          setOllamaModel(data.models[0].name);
        }
      } else {
        setModelsError(data.error ?? 'Could not fetch models');
      }
    } catch {
      setModelsError('Could not reach Ollama');
    } finally {
      setLoadingModels(false);
    }
  }, [ollamaModel]);

  useEffect(() => {
    if (provider === 'ollama') {
      fetchModels(ollamaUrl);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Test Ollama connection ─────────────────────────────────────────────────

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_url: ollamaUrl, model: ollamaModel }),
      });
      const data = await res.json();
      setTestResult({ ok: data.ok, message: data.message, latency_ms: data.latency_ms });
      if (data.ok && data.models?.length > 0) {
        setModels(data.models.map((name: string) => ({ name, size: '', modified_at: '' })));
      }
    } catch {
      setTestResult({ ok: false, message: 'Could not reach Ollama', latency_ms: -1 });
    } finally {
      setTesting(false);
    }
  }

  // ── Save settings ──────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      await saveLLMSettings({
        llmProvider: provider,
        ollamaBaseUrl: ollamaUrl,
        ollamaModel,
        openaiModel,
        claudeModel,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      router.refresh();
    } catch {
      // fail silently — rare
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/20 border border-violet-500/30">
              <Brain className="h-4 w-4 text-violet-400" />
            </div>
            <h1 className="text-lg font-semibold">Language Model</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Configure the AI provider that powers Story Muse.
          </p>
        </div>

        <Button
          onClick={handleSave}
          disabled={!isDirty || saving}
          className={cn(
            'gap-2 h-9 px-4 font-medium transition-all',
            isDirty
              ? 'bg-violet-600 hover:bg-violet-500 text-white'
              : 'bg-white/5 text-muted-foreground border border-white/10 cursor-default',
          )}
        >
          {saving ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : saveSuccess ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          {saveSuccess ? 'Saved!' : 'Save Changes'}
        </Button>
      </div>

      {/* Provider selection */}
      <section>
        <h2 className="mb-3 text-sm font-medium">Active Provider</h2>
        <div className="space-y-2">
          {PROVIDER_OPTIONS.map((opt) => {
            const active = provider === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => { setProvider(opt.id); setTestResult(null); }}
                className={cn(
                  'w-full rounded-xl border p-4 text-left transition-all',
                  active
                    ? 'border-violet-500/50 bg-violet-500/10'
                    : 'border-white/8 bg-white/3 hover:border-white/15 hover:bg-white/5',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        'mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors',
                        active ? 'border-violet-400 bg-violet-400' : 'border-white/20',
                      )}
                    >
                      {active && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>
                    <div>
                      <div className={cn('text-sm font-medium', active && 'text-violet-300')}>
                        {opt.label}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{opt.description}</div>
                    </div>
                  </div>
                  <span
                    className={cn(
                      'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                      opt.badgeColor,
                    )}
                  >
                    {opt.badge}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Ollama configuration ───────────────────────────────────────────── */}
      {provider === 'ollama' && (
        <section className="rounded-2xl border border-white/8 bg-[oklch(0.13_0.012_264)] p-5 space-y-5">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Wifi className="h-4 w-4 text-violet-400" />
            Ollama Configuration
          </h2>

          {/* Base URL */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Ollama Server URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://localhost:11434"
                className="flex-1 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-mono placeholder:text-muted-foreground/50 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-colors"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 p-0 border border-white/10 bg-white/5 hover:bg-white/10 shrink-0"
                onClick={() => fetchModels(ollamaUrl)}
                disabled={loadingModels}
                title="Refresh model list"
              >
                <RefreshCw className={cn('h-4 w-4', loadingModels && 'animate-spin')} />
              </Button>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground/60">
              Default: http://localhost:11434. Change if Ollama runs on a different host/port.
            </p>
          </div>

          {/* Model selector */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Model
            </label>
            <div className="relative">
              <button
                onClick={() => setOllamaDropdownOpen((v) => !v)}
                className="w-full flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm outline-none hover:bg-white/8 transition-colors"
              >
                <span className={ollamaModel ? '' : 'text-muted-foreground/50'}>
                  {ollamaModel || (loadingModels ? 'Loading...' : 'Select a model')}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </button>

              {ollamaDropdownOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-xl border border-white/10 bg-[oklch(0.16_0.012_264)] shadow-2xl overflow-hidden max-h-60 overflow-y-auto">
                  {loadingModels ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading models…
                    </div>
                  ) : models.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-muted-foreground/60">
                      {modelsError
                        ? `Error: ${modelsError}`
                        : 'No models found. Run: ollama run qwen3-vl'}
                    </div>
                  ) : (
                    models.map((m) => (
                      <button
                        key={m.name}
                        onClick={() => {
                          setOllamaModel(m.name);
                          setOllamaDropdownOpen(false);
                        }}
                        className={cn(
                          'w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-white/8 transition-colors',
                          ollamaModel === m.name && 'bg-violet-500/10 text-violet-300',
                        )}
                      >
                        <span className="font-medium">{m.name}</span>
                        {m.size && (
                          <span className="text-xs text-muted-foreground/60">{m.size}</span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {modelsError && !models.length && (
              <p className="mt-1.5 text-xs text-red-400/80">{modelsError}</p>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground/60">
              Pull new models with: <code className="font-mono bg-white/5 px-1 rounded">ollama pull &lt;model&gt;</code>
            </p>
          </div>

          {/* Test connection */}
          <div>
            <Button
              onClick={handleTest}
              disabled={testing}
              variant="ghost"
              className="h-9 gap-2 border border-white/10 bg-white/5 hover:bg-white/10 text-sm"
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4" />
              )}
              Test Connection
            </Button>

            {testResult && (
              <div
                className={cn(
                  'mt-3 flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm',
                  testResult.ok
                    ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                    : 'border-red-500/20 bg-red-500/5 text-red-300',
                )}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
                )}
                <div>
                  <p>{testResult.message}</p>
                  {testResult.latency_ms > 0 && (
                    <p className="mt-0.5 text-xs opacity-70">
                      Response time: {testResult.latency_ms}ms
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick setup guide */}
          <div className="rounded-xl border border-white/6 bg-white/2 p-4">
            <p className="text-xs font-medium text-muted-foreground mb-2">Quick Setup</p>
            <ol className="space-y-1.5 text-xs text-muted-foreground/70">
              <li>
                <span className="text-foreground/80">1.</span> Download Ollama:{' '}
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-violet-400 hover:underline"
                >
                  ollama.com/download
                </a>
              </li>
              <li>
                <span className="text-foreground/80">2.</span> Start the server:{' '}
                <code className="font-mono bg-white/5 px-1 rounded">ollama serve</code>
              </li>
              <li>
                <span className="text-foreground/80">3.</span> Pull a vision model:{' '}
                <code className="font-mono bg-white/5 px-1 rounded">ollama run qwen3-vl</code>
              </li>
              <li>
                <span className="text-foreground/80">4.</span> Click{' '}
                <span className="text-foreground/80 font-medium">Test Connection</span> above to verify.
              </li>
            </ol>
          </div>
        </section>
      )}

      {/* ── OpenAI configuration ───────────────────────────────────────────── */}
      {provider === 'openai' && (
        <section className="rounded-2xl border border-white/8 bg-[oklch(0.13_0.012_264)] p-5 space-y-5">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-amber-400" />
            OpenAI Configuration
          </h2>

          {/* Model picker */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Model
            </label>
            <ModelPicker
              value={openaiModel}
              onChange={setOpenaiModel}
              options={OPENAI_MODELS}
            />
            <p className="mt-1.5 text-xs text-muted-foreground/60">
              See{' '}
              <a
                href="https://platform.openai.com/docs/models"
                target="_blank"
                rel="noopener noreferrer"
                className="text-amber-400/80 hover:text-amber-400 inline-flex items-center gap-0.5"
              >
                platform.openai.com/docs/models <ExternalLink className="h-3 w-3" />
              </a>{' '}
              for the full list.
            </p>
          </div>

          {/* API key instructions */}
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <p className="text-sm text-amber-300/80">
              Set your API key in the backend environment file:
            </p>
            <code className="mt-2 block rounded-lg bg-white/5 px-3 py-2 text-xs font-mono text-foreground/80 whitespace-pre">
              {'# muse_backend/.env\nOPENAI_API_KEY=sk-...'}
            </code>
          </div>
          <p className="text-xs text-muted-foreground/60">
            The key is never stored in the database. Restart the backend after updating .env.
          </p>
        </section>
      )}

      {/* ── Claude configuration ───────────────────────────────────────────── */}
      {provider === 'claude' && (
        <section className="rounded-2xl border border-white/8 bg-[oklch(0.13_0.012_264)] p-5 space-y-5">
          <h2 className="text-sm font-medium flex items-center gap-2">
            <Brain className="h-4 w-4 text-violet-300" />
            Anthropic Claude Configuration
          </h2>

          {/* Model picker */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Model
            </label>
            <ModelPicker
              value={claudeModel}
              onChange={setClaudeModel}
              options={CLAUDE_MODELS}
            />
            <p className="mt-1.5 text-xs text-muted-foreground/60">
              See{' '}
              <a
                href="https://docs.anthropic.com/en/docs/about-claude/models/overview"
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-400/80 hover:text-violet-400 inline-flex items-center gap-0.5"
              >
                docs.anthropic.com/models <ExternalLink className="h-3 w-3" />
              </a>{' '}
              for the full list.
            </p>
          </div>

          {/* API key instructions */}
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3">
            <p className="text-sm text-violet-300/80">
              Set your API key in the backend environment file:
            </p>
            <code className="mt-2 block rounded-lg bg-white/5 px-3 py-2 text-xs font-mono text-foreground/80 whitespace-pre">
              {'# muse_backend/.env\nANTHROPIC_API_KEY=sk-ant-...'}
            </code>
          </div>

          {/* OpenAI SDK compat note */}
          <div className="rounded-xl border border-white/6 bg-white/2 px-4 py-3 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">How it works</p>
            <p className="text-xs text-muted-foreground/70">
              Uses Anthropic&apos;s{' '}
              <a
                href="https://platform.claude.com/docs/en/api/openai-sdk"
                target="_blank"
                rel="noopener noreferrer"
                className="text-violet-400/80 hover:text-violet-400 inline-flex items-center gap-0.5"
              >
                OpenAI-compatible API <ExternalLink className="h-3 w-3" />
              </a>
              . The backend sends requests to{' '}
              <code className="font-mono bg-white/5 px-1 rounded">https://api.anthropic.com/v1/</code>{' '}
              using the standard OpenAI SDK, so no extra dependencies are needed.
            </p>
          </div>

          <p className="text-xs text-muted-foreground/60">
            The key is never stored in the database. Restart the backend after updating .env.
          </p>
        </section>
      )}

      {/* Disconnect/unavailable indicator */}
      {provider === 'ollama' && !loadingModels && models.length === 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
          <WifiOff className="h-3.5 w-3.5" />
          Ollama not detected — generation will show an error until it&apos;s running.
        </div>
      )}
    </div>
  );
}
