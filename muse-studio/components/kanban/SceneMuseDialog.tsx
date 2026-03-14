'use client';

import { useState, useTransition } from 'react';
import {
  Sparkles,
  X,
  Feather,
  Palette,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertCircle,
  Send,
  Square,
  BookImage,
  Save,
  RefreshCw,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useStoryMuse } from '@/hooks/useStoryMuse';
import { useLLMSettings } from '@/hooks/useSettings';
import { createKeyframe, updateScene, updateSceneStatus } from '@/lib/actions/scenes';
import type { Scene, KanbanStatus } from '@/lib/types';

type SceneMuseMode = 'rewrite' | 'image_prompt';

const MODE_CONFIG = {
  rewrite: {
    id: 'rewrite' as const,
    label: 'Rewrite Current Scene',
    Icon: Feather,
    bgClass: 'bg-violet-500/10',
    textClass: 'text-violet-300',
    borderClass: 'border-violet-500/25',
    activeTabBg: 'bg-violet-500/15',
    activeTabBorder: 'border-violet-500/40',
    activeTabText: 'text-violet-300',
    placeholder:
      'What changes would you like?\ne.g. Make it more tense, add a confrontation, rewrite in first person, sharpen the dialogue…',
    taskId: 'rewrite_scene',
    btnLabel: 'Rewrite Scene',
    hint: 'Story Muse will rewrite the full scene script based on your instructions.',
  },
  image_prompt: {
    id: 'image_prompt' as const,
    label: 'Image Prompt for Keyframe',
    Icon: Palette,
    bgClass: 'bg-blue-500/10',
    textClass: 'text-blue-300',
    borderClass: 'border-blue-500/25',
    activeTabBg: 'bg-blue-500/15',
    activeTabBorder: 'border-blue-500/40',
    activeTabText: 'text-blue-300',
    placeholder:
      'Style / mood notes (optional)\ne.g. cinematic noir, golden hour, handheld 35mm, wide angle, high contrast…',
    taskId: 'visual_keyframe_prompt',
    btnLabel: 'Generate Image Prompt',
    hint: 'Visual Muse will craft a detailed text-to-image prompt from this scene.',
  },
} as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract scene heading and screenplay body from raw LLM output. */
function parseRewrittenScene(
  text: string,
  originalHeading: string,
): { heading: string; description: string } {
  const trimmed = text.trim();
  const lines = trimmed.split('\n');

  // Find first line that looks like a scene heading (INT. / EXT. / INT./EXT.)
  const headingIdx = lines.findIndex((l) =>
    /^(INT\.|EXT\.|INT\.\/EXT\.)/i.test(l.trim()),
  );

  if (headingIdx >= 0) {
    const heading = lines[headingIdx].trim().toUpperCase();
    const body = lines
      .slice(headingIdx + 1)
      .join('\n')
      .trim();
    return { heading, description: body };
  }

  // No heading found — keep original, use full text as body
  return { heading: originalHeading, description: trimmed };
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface SceneMuseDialogProps {
  isOpen: boolean;
  scene: Scene | null;
  onClose: () => void;
  /** Called after a rewrite is saved — update the card in the board. */
  onSceneRewritten?: (sceneId: string, updates: { heading: string; description: string }) => void;
  /** Called after a keyframe is saved — move the card to KEYFRAME column. */
  onKeyframeSaved?: (sceneId: string, keyframeId: string, prompt: string) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SceneMuseDialog({
  isOpen,
  scene,
  onClose,
  onSceneRewritten,
  onKeyframeSaved,
}: SceneMuseDialogProps) {
  const router = useRouter();
  const [mode, setMode] = useState<SceneMuseMode>('rewrite');
  const [input, setInput] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);

  // Rewrite-save state
  const [rewriteSaved, setRewriteSaved] = useState(false);
  const [rewriteError, setRewriteError] = useState<string | null>(null);
  const [isSavingRewrite, startRewriteTransition] = useTransition();

  // Keyframe-save state
  const [keyframeSaved, setKeyframeSaved] = useState(false);
  const [keyframeError, setKeyframeError] = useState<string | null>(null);
  const [isSavingKeyframe, startKeyframeTransition] = useTransition();

  const storyMuse = useStoryMuse();
  const llmSettings = useLLMSettings();

  const cfg = MODE_CONFIG[mode];
  const { Icon } = cfg;
  const { isGenerating, isLoadingModel, text: response, error } = storyMuse;

  function resetSaveState() {
    setRewriteSaved(false);
    setRewriteError(null);
    setKeyframeSaved(false);
    setKeyframeError(null);
  }

  function handleModeSwitch(next: SceneMuseMode) {
    if (next === mode) return;
    storyMuse.cancel();
    setMode(next);
    setInput('');
    resetSaveState();
  }

  function handleClose() {
    storyMuse.cancel();
    setInput('');
    setMode('rewrite');
    setShowPreview(false);
    setCopied(false);
    resetSaveState();
    onClose();
  }

  function buildUserMessage(): string {
    if (!scene) return input;

    if (mode === 'rewrite') {
      const parts = [
        `Scene #${String(scene.sceneNumber).padStart(2, '0')}: ${scene.title}`,
        scene.heading,
        '',
        scene.description,
        scene.dialogue ? `\n${scene.dialogue}` : null,
        scene.technicalNotes ? `\nTechnical notes: ${scene.technicalNotes}` : null,
      ]
        .filter((p) => p !== null)
        .join('\n');

      return input.trim()
        ? `Instruction: "${input.trim()}"\n\n---\n\n${parts}`
        : `Please rewrite and improve the following scene:\n\n---\n\n${parts}`;
    }

    const sceneText = `Scene: ${scene.title}\nHeading: ${scene.heading}\nDescription: ${scene.description}`;
    const styleNote = input.trim() ? `\n\nStyle/Mood: ${input.trim()}` : '';
    return `${sceneText}${styleNote}`;
  }

  async function handleGenerate() {
    if (!scene || isGenerating) return;
    resetSaveState();

    await storyMuse.generate({
      task: cfg.taskId as Parameters<typeof storyMuse.generate>[0]['task'],
      prompt: buildUserMessage(),
      providerId: llmSettings.llmProvider,
      ollamaBaseUrl: llmSettings.ollamaBaseUrl,
      ollamaModel: llmSettings.ollamaModel,
      openaiModel: llmSettings.openaiModel,
      claudeModel: llmSettings.claudeModel,
      lmstudioBaseUrl: llmSettings.lmstudioBaseUrl,
      lmstudioModel: llmSettings.lmstudioModel,
      maxTokens: mode === 'image_prompt' ? 512 : 2048,
      temperature: mode === 'image_prompt' ? 0.85 : 0.75,
    });
  }

  function handleCopy() {
    if (!response) return;
    navigator.clipboard.writeText(response).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Save rewrite → update scene record ───────────────────────────────────

  function handleSaveRewrite() {
    if (!scene || !response || isSavingRewrite || rewriteSaved) return;
    setRewriteError(null);

    const parsed = parseRewrittenScene(response, scene.heading);

    startRewriteTransition(async () => {
      try {
        await updateScene(scene.id, {
          heading: parsed.heading,
          description: parsed.description,
        });
        setRewriteSaved(true);
        onSceneRewritten?.(scene.id, parsed);
        router.refresh();
      } catch (err) {
        setRewriteError(err instanceof Error ? err.message : 'Failed to save scene.');
      }
    });
  }

  // ── Save keyframe prompt → move scene to Keyframe Creation ───────────────

  function handleSaveAsKeyframe() {
    if (!scene || !response || isSavingKeyframe || keyframeSaved) return;
    setKeyframeError(null);

    startKeyframeTransition(async () => {
      try {
        const trimmedPrompt = response.trim();
        // 1. Create the keyframe record with the generated prompt
        const kfId = await createKeyframe({
          sceneId: scene.id,
          source: 'VISUAL_MUSE',
          prompt: trimmedPrompt,
        });
        // 2. Move the scene card to "Keyframe Creation" column
        await updateSceneStatus(scene.id, 'KEYFRAME' as KanbanStatus);
        setKeyframeSaved(true);
        onKeyframeSaved?.(scene.id, kfId, trimmedPrompt);
        router.refresh();
      } catch (err) {
        setKeyframeError(err instanceof Error ? err.message : 'Failed to save keyframe.');
      }
    });
  }

  if (!isOpen || !scene) return null;

  const hasResponse = Boolean(response);
  const showResponseArea = hasResponse || (isGenerating && !isLoadingModel);
  const isImageMode = mode === 'image_prompt';
  const isRewriteMode = mode === 'rewrite';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Dialog panel */}
      <div className="relative z-10 w-full max-w-[520px] rounded-2xl border border-white/12 bg-[oklch(0.13_0.012_264)] shadow-2xl shadow-black/60 flex flex-col max-h-[88vh]">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/20">
              <Sparkles className="h-4 w-4 text-violet-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">Ask Muse</span>
                <kbd className="text-[10px] text-muted-foreground/50 rounded border border-white/10 bg-white/5 px-1 py-0.5">⌘M</kbd>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="font-mono text-[10px] rounded-md border border-white/8 bg-white/5 px-1.5 py-0.5 text-muted-foreground/70">
                  #{String(scene.sceneNumber).padStart(2, '0')}
                </span>
                <span className="text-xs font-medium text-muted-foreground truncate max-w-[200px]">
                  {scene.title}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 text-muted-foreground transition-colors hover:border-white/15 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Mode Tabs ──────────────────────────────────────────────── */}
        <div className="flex gap-2 px-5 pt-4 shrink-0">
          {(Object.values(MODE_CONFIG) as typeof MODE_CONFIG[SceneMuseMode][]).map((m) => {
            const ModeIcon = m.Icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleModeSwitch(m.id)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all',
                  active
                    ? `${m.activeTabBg} ${m.activeTabText} ${m.activeTabBorder}`
                    : 'border-white/8 text-muted-foreground hover:border-white/15 hover:text-foreground',
                )}
              >
                <ModeIcon className="h-3.5 w-3.5 shrink-0" />
                {m.label}
              </button>
            );
          })}
        </div>

        {/* ── Scrollable body ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3 min-h-0">

          <p className="text-xs text-muted-foreground/50">{cfg.hint}</p>

          {/* Scene preview toggle */}
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="w-full flex items-start justify-between gap-3 rounded-lg border border-white/8 bg-white/3 px-3 py-2.5 text-left transition-colors hover:border-white/12 hover:bg-white/4"
          >
            <div className="min-w-0">
              <p className="font-mono text-[10px] text-muted-foreground/60 mb-0.5">{scene.heading}</p>
              {!showPreview && (
                <p className="text-xs text-muted-foreground/50 italic leading-relaxed line-clamp-2">
                  {scene.description}
                </p>
              )}
            </div>
            {showPreview ? (
              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0 mt-0.5" />
            )}
          </button>

          {showPreview && (
            <div className="rounded-lg border border-white/8 bg-white/3 px-3 py-3 space-y-2 text-xs">
              <p className="leading-relaxed text-muted-foreground/80">{scene.description}</p>
              {scene.dialogue && (
                <pre className="font-mono text-[10px] whitespace-pre-wrap text-muted-foreground/60 border-t border-white/6 pt-2 mt-2">
                  {scene.dialogue}
                </pre>
              )}
              {scene.technicalNotes && (
                <p className="text-[10px] italic text-muted-foreground/50 border-t border-white/6 pt-2 mt-2">
                  {scene.technicalNotes}
                </p>
              )}
            </div>
          )}

          {/* Instruction / style input */}
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleGenerate();
            }}
            placeholder={cfg.placeholder}
            rows={mode === 'rewrite' ? 3 : 2}
            disabled={isGenerating}
            className="resize-none bg-white/5 border-white/10 focus:border-violet-500/40 placeholder:text-muted-foreground/35 text-sm disabled:opacity-50"
          />

          {/* Model loading */}
          {isLoadingModel && (
            <div className="flex items-center gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
              <Loader2 className="h-4 w-4 text-amber-400 animate-spin shrink-0" />
              <div>
                <p className="text-xs text-amber-300 font-medium">Loading model into memory…</p>
                <p className="text-[10px] text-amber-400/60">This may take a moment for large models.</p>
              </div>
            </div>
          )}

          {/* Generation error */}
          {error && !isGenerating && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{error}</p>
            </div>
          )}

          {/* Response area */}
          {showResponseArea && (
            <div className={cn('rounded-xl border px-4 py-3.5', cfg.bgClass, cfg.borderClass)}>
              <div className="flex items-start gap-2.5">
                <Icon className={cn('h-4 w-4 mt-0.5 shrink-0', cfg.textClass)} />
                <p className={cn('text-sm leading-relaxed whitespace-pre-wrap flex-1', cfg.textClass)}>
                  {response}
                  {isGenerating && !isLoadingModel && (
                    <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current align-middle" />
                  )}
                </p>
              </div>
            </div>
          )}

          {/* Rewrite saved confirmation */}
          {rewriteSaved && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
              <Check className="h-4 w-4 text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs text-emerald-300 font-medium">Scene updated</p>
                <p className="text-[10px] text-emerald-400/60">
                  The scene script has been saved to the database.
                </p>
              </div>
            </div>
          )}
          {rewriteError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{rewriteError}</p>
            </div>
          )}

          {/* Keyframe saved confirmation */}
          {keyframeSaved && (
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
              <Check className="h-4 w-4 text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs text-emerald-300 font-medium">Moved to Keyframe Creation</p>
                <p className="text-[10px] text-emerald-400/60">
                  The prompt is saved and the scene has moved to the Keyframe Creation column.
                </p>
              </div>
            </div>
          )}
          {keyframeError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-300">{keyframeError}</p>
            </div>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3 shrink-0">
          <p className="text-[10px] text-muted-foreground/40">⌘↵ to generate</p>

          <div className="flex items-center gap-2">

            {/* Copy — tertiary ghost */}
            {hasResponse && !isGenerating && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCopy}
                className="h-8 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
              >
                {copied ? (
                  <><Check className="h-3.5 w-3.5 text-emerald-400" />Copied!</>
                ) : (
                  <><Copy className="h-3.5 w-3.5" />Copy</>
                )}
              </Button>
            )}

            {/* Stop while generating */}
            {isGenerating && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => storyMuse.cancel()}
                className="h-8 text-xs gap-1.5 text-red-400 hover:text-red-300 border border-red-500/20 hover:border-red-500/40"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </Button>
            )}

            {/* ── PRIMARY SAVE ACTION (emerald) ── */}

            {/* Rewrite mode: Save Changes */}
            {isRewriteMode && hasResponse && !isGenerating && (
              <Button
                size="sm"
                onClick={handleSaveRewrite}
                disabled={isSavingRewrite || rewriteSaved}
                className={cn(
                  'h-8 text-xs gap-1.5 font-medium',
                  rewriteSaved
                    ? 'bg-emerald-700/40 text-emerald-300 border border-emerald-500/30 cursor-default'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white',
                )}
              >
                {isSavingRewrite ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
                ) : rewriteSaved ? (
                  <><Check className="h-3.5 w-3.5" />Saved</>
                ) : (
                  <><Save className="h-3.5 w-3.5" />Save Changes</>
                )}
              </Button>
            )}

            {/* Image mode: Save as Keyframe */}
            {isImageMode && hasResponse && !isGenerating && (
              <Button
                size="sm"
                onClick={handleSaveAsKeyframe}
                disabled={isSavingKeyframe || keyframeSaved}
                className={cn(
                  'h-8 text-xs gap-1.5 font-medium',
                  keyframeSaved
                    ? 'bg-emerald-700/40 text-emerald-300 border border-emerald-500/30 cursor-default'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white',
                )}
              >
                {isSavingKeyframe ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</>
                ) : keyframeSaved ? (
                  <><Check className="h-3.5 w-3.5" />Saved</>
                ) : (
                  <><BookImage className="h-3.5 w-3.5" />Save as Keyframe</>
                )}
              </Button>
            )}

            {/* ── REGENERATE (ghost with border — clearly secondary) ── */}
            {!isGenerating && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleGenerate}
                className="h-8 text-xs gap-1.5 border border-white/12 text-muted-foreground hover:text-foreground hover:border-white/20 hover:bg-white/5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {hasResponse ? 'Regenerate' : cfg.btnLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
