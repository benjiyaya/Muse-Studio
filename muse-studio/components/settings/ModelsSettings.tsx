'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Cpu,
  Zap,
  Save,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  MemoryStick,
  Video,
  CheckCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { saveInferenceSettings } from '@/lib/actions/settings';
import type { InferenceSettings, FluxOffloadMode } from '@/lib/actions/settings';
import type { ProviderInfo } from '@/lib/backend-client';

interface ModelsSettingsProps {
  initialSettings: InferenceSettings;
}

// ── Offload mode options ───────────────────────────────────────────────────────

interface OffloadOption {
  id: FluxOffloadMode;
  label: string;
  description: string;
  vram: string;
  speed: string;
  badge: string;
  badgeColor: string;
  speedDots: number; // 1–3
}

const OFFLOAD_OPTIONS: OffloadOption[] = [
  {
    id: 'none',
    label: 'Full GPU',
    description: 'All components (Transformer, Text Encoder, VAE) stay resident on the GPU throughout inference. Fastest possible generation speed.',
    vram: '~32 GB',
    speed: 'Fastest',
    badge: 'Recommended for 40 GB+ GPU',
    badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    speedDots: 3,
  },
  {
    id: 'model',
    label: 'Model CPU Offload',
    description: 'Each sub-model moves to CPU after its turn, then back to GPU when needed. Reduces peak VRAM significantly with moderate speed loss.',
    vram: '~17 GB peak',
    speed: 'Medium',
    badge: 'Good for 24 GB GPU',
    badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    speedDots: 2,
  },
  {
    id: 'sequential',
    label: 'Sequential CPU Offload',
    description: 'Layer-by-layer offloading — each individual layer moves to GPU only when executing, then returns to CPU. Minimum VRAM but much slower.',
    vram: '~8 GB peak',
    speed: 'Slowest',
    badge: 'For 12–16 GB GPU',
    badgeColor: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    speedDots: 1,
  },
];

// ── Speed indicator dots ───────────────────────────────────────────────────────

function SpeedDots({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            i <= count ? 'bg-emerald-400' : 'bg-white/15',
          )}
        />
      ))}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ModelsSettings({ initialSettings }: ModelsSettingsProps) {
  const router = useRouter();

  const [offload, setOffload] = useState<FluxOffloadMode>(initialSettings.fluxKleinOffload);
  const [videoDefault, setVideoDefault] = useState<string>(initialSettings.videoDefault);
  const [videoProviders, setVideoProviders] = useState<ProviderInfo[]>([]);
  const [videoProvidersLoading, setVideoProvidersLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<'idle' | 'unloading' | 'unloaded'>('idle');

  const isDirty =
    offload !== initialSettings.fluxKleinOffload ||
    videoDefault !== initialSettings.videoDefault;

  // Fetch available video providers from backend on mount
  useEffect(() => {
    setVideoProvidersLoading(true);
    Promise.all([
      fetch('/api/providers', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      fetch('/api/inference-settings', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
    ]).then(([provData, settingsData]) => {
      if (provData?.video) setVideoProviders(provData.video as ProviderInfo[]);
      // Sync video_default from backend config (authoritative source)
      if (settingsData?.video_default) setVideoDefault(settingsData.video_default);
    }).finally(() => setVideoProvidersLoading(false));
  }, []);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setPipelineStatus('idle');
    try {
      // 1. Persist to SQLite (frontend DB cache)
      await saveInferenceSettings({ fluxKleinOffload: offload, videoDefault });

      // 2. Call backend to update muse_config.json + unload cached pipeline
      setPipelineStatus('unloading');
      const res = await fetch('/api/inference-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flux_klein_offload: offload,
          video_default: videoDefault,
          unload_pipeline: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        // Backend unreachable is non-fatal — the config file is already updated,
        // the pipeline will pick it up on restart.
        if (res.status === 503) {
          setSaveError('Backend offline — setting saved. Pipeline will use new mode on next restart.');
        } else {
          setSaveError(data?.detail ?? 'Failed to apply setting to backend.');
        }
        setPipelineStatus('idle');
      } else {
        setPipelineStatus('unloaded');
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      router.refresh();
    } catch {
      setSaveError('Unexpected error — check that the backend is running.');
      setPipelineStatus('idle');
    } finally {
      setSaving(false);
    }
  }

  const selected = OFFLOAD_OPTIONS.find((o) => o.id === offload)!;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/20 border border-violet-500/30">
              <Cpu className="h-4 w-4 text-violet-400" />
            </div>
            <h1 className="text-lg font-semibold">Models</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Local AI model inference settings.
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

      {/* Save feedback */}
      {saveError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>{saveError}</p>
        </div>
      )}
      {pipelineStatus === 'unloaded' && (
        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <p>Pipeline unloaded. The new offload mode will be applied on the next image generation.</p>
        </div>
      )}
      {pipelineStatus === 'unloading' && (
        <div className="flex items-center gap-2.5 rounded-xl border border-blue-500/20 bg-blue-500/5 px-4 py-3 text-sm text-blue-300">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" />
          <p>Applying setting and unloading pipeline…</p>
        </div>
      )}

      {/* ── FLUX.2-Klein Inference ──────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <MemoryStick className="h-4 w-4 text-violet-400" />
          <h2 className="text-sm font-medium">FLUX.2-Klein — GPU / CPU Offload Strategy</h2>
        </div>
        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          Controls how the three pipeline components (Transformer 17 GB, Text Encoder 15 GB, VAE 321 MB)
          are distributed between GPU and CPU memory during inference.
          Changes take effect on the next generation after saving.
        </p>

        {/* Option cards */}
        <div className="space-y-2">
          {OFFLOAD_OPTIONS.map((opt) => {
            const active = offload === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setOffload(opt.id)}
                className={cn(
                  'w-full rounded-xl border p-4 text-left transition-all',
                  active
                    ? 'border-violet-500/50 bg-violet-500/10'
                    : 'border-white/8 bg-white/3 hover:border-white/15 hover:bg-white/5',
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 min-w-0">
                    {/* Radio */}
                    <div
                      className={cn(
                        'mt-0.5 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors',
                        active ? 'border-violet-400 bg-violet-400' : 'border-white/20',
                      )}
                    >
                      {active && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                    </div>

                    {/* Label + description */}
                    <div className="min-w-0">
                      <div className={cn('text-sm font-medium', active && 'text-violet-300')}>
                        {opt.label}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground/70 leading-relaxed">
                        {opt.description}
                      </div>
                    </div>
                  </div>

                  {/* Stats + badge */}
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    <span
                      className={cn(
                        'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                        opt.badgeColor,
                      )}
                    >
                      {opt.badge}
                    </span>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground/60">
                      <span className="flex items-center gap-1">
                        <Cpu className="h-3 w-3" />
                        {opt.vram}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <Zap className="h-3 w-3" />
                        <SpeedDots count={opt.speedDots} />
                      </span>
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Summary of current selection */}
        <div className="rounded-xl border border-white/6 bg-white/2 px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Current selection</p>
          <p className="text-xs text-muted-foreground/70">
            <span className="text-foreground/80 font-medium">{selected.label}</span>
            {' · '}VRAM: <span className="text-foreground/70">{selected.vram}</span>
            {' · '}Speed: <span className="text-foreground/70">{selected.speed}</span>
          </p>
          <p className="text-xs text-muted-foreground/50 mt-0.5">
            Stored in <code className="font-mono bg-white/5 px-1 rounded">muse_config.json</code> under{' '}
            <code className="font-mono bg-white/5 px-1 rounded">inference.flux_klein_offload</code>.
          </p>
        </div>
      </section>

      {/* ── Video Generation Model ───────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Video className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-medium">Video Generation — Default Provider</h2>
        </div>
        <p className="text-xs text-muted-foreground/70 leading-relaxed">
          Selects which video model is used when generating video from a scene card.
          Stored as <code className="font-mono bg-white/5 px-1 rounded">providers.video_default</code>{' '}
          in <code className="font-mono bg-white/5 px-1 rounded">muse_config.json</code>.
        </p>

        {videoProvidersLoading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60 py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Loading providers from backend…
          </div>
        ) : videoProviders.length === 0 ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-white/10 bg-white/2 px-4 py-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400/70" />
            <p className="text-xs text-muted-foreground/60">
              Backend offline — cannot load provider list. Start the backend and refresh to configure.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {videoProviders.map((p) => {
              const isSelected = videoDefault === p.provider_id;
              return (
                <button
                  key={p.provider_id}
                  onClick={() => p.is_available && setVideoDefault(p.provider_id)}
                  disabled={!p.is_available}
                  className={cn(
                    'w-full rounded-xl border p-3.5 text-left transition-all',
                    'disabled:pointer-events-none disabled:opacity-40',
                    isSelected
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : p.is_available
                      ? 'border-white/8 bg-white/3 hover:border-white/15 hover:bg-white/5'
                      : 'border-white/5 bg-white/2',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Radio */}
                      <div
                        className={cn(
                          'h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors',
                          isSelected ? 'border-amber-400 bg-amber-400' : 'border-white/20',
                        )}
                      >
                        {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </div>

                      {/* Name + availability */}
                      <div className="min-w-0">
                        <div className={cn('text-sm font-medium', isSelected && 'text-amber-300')}>
                          {p.display_name}
                        </div>
                        {!p.is_available && p.unavailable_reason && (
                          <div className="mt-0.5 text-[11px] text-red-400/70 line-clamp-1">
                            {p.unavailable_reason}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide',
                          p.provider_type === 'local'
                            ? 'bg-blue-500/15 text-blue-400'
                            : 'bg-violet-500/15 text-violet-400',
                        )}
                      >
                        {p.provider_type}
                      </span>
                      {p.is_available ? (
                        <span className="flex items-center gap-1 text-[10px] text-emerald-400">
                          <CheckCircle className="h-3 w-3" />
                          Available
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/40">Not available</span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Current value summary */}
        <div className="rounded-xl border border-white/6 bg-white/2 px-4 py-3 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Current selection</p>
          <p className="text-xs text-muted-foreground/70">
            <code className="font-mono text-foreground/80">{videoDefault}</code>
            {' '}will be used for all video generation jobs.
          </p>
        </div>
      </section>

      {/* ── More model settings coming soon ─────────────────────────────────── */}
      <section className="rounded-2xl border border-white/6 bg-white/2 p-5 space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground/70">More coming soon</p>
        <p className="text-xs text-muted-foreground/50">
          Model format selector (bf16 / fp8 / gguf), VRAM budget planner, and per-model path
          overrides will appear here in a future update. For now, edit{' '}
          <code className="font-mono bg-white/5 px-1 rounded">muse_backend/muse_config.json</code>{' '}
          directly for other model settings.
        </p>
      </section>
    </div>
  );
}
