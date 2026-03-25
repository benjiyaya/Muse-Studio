'use client';

import { useState } from 'react';
import { Sparkles, Send, Feather, Palette, Film } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { MUSE_CONFIG } from '@/lib/constants';
import type { MuseAgent } from '@/lib/types';
import { useStoryMuse } from '@/hooks/useStoryMuse';
import { useLLMSettings } from '@/hooks/useSettings';

interface AskMuseModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMuse?: MuseAgent;
  context?: {
    sceneId?: string;
    sceneTitle?: string;
    stage?: string;
  };
}

const MUSE_ICONS: Record<MuseAgent, React.ElementType> = {
  STORY_MUSE: Feather,
  VISUAL_MUSE: Palette,
  MOTION_MUSE: Film,
};

const QUICK_PROMPTS: Record<MuseAgent, string[]> = {
  STORY_MUSE: [
    'Generate a scene script from this description',
    'Improve the dialogue in this scene',
    'Add more tension to this sequence',
    'Create a storyline for my new project',
  ],
  VISUAL_MUSE: [
    'Generate a keyframe for this scene',
    'Suggest a visual style for my film',
    'Describe a composition for this shot',
    'Create reference image prompts',
  ],
  MOTION_MUSE: [
    'Estimate video duration for this scene',
    'Suggest camera movement for this shot',
    'Review pacing across all scenes',
    'Generate video parameters',
  ],
};

export function AskMuseModal({ isOpen, onClose, defaultMuse = 'STORY_MUSE', context }: AskMuseModalProps) {
  const [activeMuse, setActiveMuse] = useState<MuseAgent>(defaultMuse);
  const [prompt, setPrompt] = useState('');

  const storyMuse = useStoryMuse();
  const llmSettings = useLLMSettings();

  const config = MUSE_CONFIG[activeMuse];
  const Icon = MUSE_ICONS[activeMuse];

  const taskByMuse = {
    STORY_MUSE: 'general_query' as const,
    VISUAL_MUSE: 'visual_query' as const,
    MOTION_MUSE: 'motion_query' as const,
  };

  const isLoading = storyMuse.isGenerating;
  const isLoadingModel = storyMuse.isLoadingModel;
  const thinkingText = storyMuse.thinkingText ?? '';
  const response =
    storyMuse.text || storyMuse.error
      ? (storyMuse.error ?? storyMuse.text)
      : null;

  const showLoadingState = isLoading && !response;
  const showThinking = showLoadingState && thinkingText.length > 0;
  const showStarting = showLoadingState && !thinkingText && !storyMuse.text;

  function handleMuseSwitch(muse: MuseAgent) {
    setActiveMuse(muse);
    storyMuse.cancel();
    setPrompt('');
  }

  async function handleSubmit() {
    if (!prompt.trim()) return;

    const task = taskByMuse[activeMuse];
    await storyMuse.generate({
      task,
      prompt,
      providerId: llmSettings.llmProvider,
      ollamaBaseUrl: llmSettings.ollamaBaseUrl,
      ollamaModel: llmSettings.ollamaModel,
      openaiModel: llmSettings.openaiModel,
      claudeModel: llmSettings.claudeModel,
      lmstudioBaseUrl: llmSettings.lmstudioBaseUrl,
      lmstudioModel: llmSettings.lmstudioModel,
      openrouterModel: llmSettings.openrouterModel,
      openrouterBaseUrl: llmSettings.openrouterBaseUrl,
      context: context
        ? {
            sceneId: context.sceneId,
            sceneTitle: context.sceneTitle,
            stage: context.stage,
          }
        : undefined,
    });
  }

  function handleClose() {
    storyMuse.cancel();
    setPrompt('');
    onClose();
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden border-white/10 bg-[oklch(0.13_0.012_264)]">
        <VisuallyHidden><DialogTitle>Ask Muse</DialogTitle></VisuallyHidden>
        {/* Header */}
        <div className="flex items-center px-5 py-4 border-b border-white/8">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/20">
              <Sparkles className="h-4 w-4 text-violet-400" />
            </div>
            <span className="font-semibold text-sm">Ask Muse</span>
            <span className="text-xs text-muted-foreground ml-1 hidden sm:block">⌘M</span>
          </div>
        </div>

        {/* Muse Selector */}
        <div className="flex gap-2 px-5 pt-4">
          {(Object.keys(MUSE_CONFIG) as MuseAgent[]).map((muse) => {
            const cfg = MUSE_CONFIG[muse];
            const MuseIcon = MUSE_ICONS[muse];
            const active = activeMuse === muse;
            return (
              <button
                key={muse}
                onClick={() => handleMuseSwitch(muse)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all',
                  active
                    ? `${cfg.bgClass} ${cfg.textClass} ${cfg.borderClass}`
                    : 'border-white/8 text-muted-foreground hover:border-white/15 hover:text-foreground',
                )}
              >
                <MuseIcon className="h-3.5 w-3.5" />
                {cfg.name}
              </button>
            );
          })}
        </div>

        {/* Context pill */}
        {context?.sceneTitle && (
          <div className="px-5 pt-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/8 px-2.5 py-1 text-xs text-muted-foreground">
              Scene context: <span className="text-foreground font-medium">{context.sceneTitle}</span>
            </span>
          </div>
        )}

        {/* Quick prompts */}
        {!response && (
          <div className="px-5 pt-3">
            <p className="text-xs text-muted-foreground mb-2">Quick prompts</p>
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS[activeMuse].map((qp) => (
                <button
                  key={qp}
                  onClick={() => setPrompt(qp)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs transition-colors hover:bg-white/5',
                    'border-white/8 text-muted-foreground hover:text-foreground',
                  )}
                >
                  {qp}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Response area */}
        {(response || isLoading) && (
          <div className="mx-5 mt-3 space-y-2">
            {/* Status / what’s happening — so it’s not a black box */}
            {showLoadingState && (
              <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-muted-foreground">
                <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-violet-500/50 border-t-transparent" aria-hidden />
                {showStarting && (
                  <span>Muse is connecting and preparing your response…</span>
                )}
                {showThinking && (
                  <span>Muse is thinking through your request…</span>
                )}
                {!showStarting && !showThinking && storyMuse.text && (
                  <span>Muse is writing…</span>
                )}
              </div>
            )}

            {/* Thinking stream (when supported, e.g. Ollama extended thinking) */}
            {showThinking && thinkingText.length > 0 && (
              <div
                className={cn(
                  'rounded-xl border p-4 text-sm max-h-40 overflow-y-auto',
                  'border-amber-500/20 bg-amber-500/5 text-amber-200/90',
                )}
                role="status"
                aria-live="polite"
              >
                <p className="text-[11px] font-medium uppercase tracking-wider text-amber-400/80 mb-1.5">
                  Thinking
                </p>
                <p className="leading-relaxed whitespace-pre-wrap font-mono text-xs">
                  {thinkingText}
                  <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-amber-400 align-middle" />
                </p>
              </div>
            )}

            {/* Main response (streamed content or error) — show when there is content or error */}
            {(response != null && response !== '') || (isLoading && storyMuse.text) ? (
              <div
                className={cn(
                  'rounded-xl border p-4 text-sm max-h-64 overflow-y-auto',
                  storyMuse.error ? 'border-red-500/30 bg-red-500/8 text-red-300' : config.bgClass,
                  !storyMuse.error && config.borderClass,
                  !storyMuse.error && config.textClass,
                )}
              >
                <div className="flex items-start gap-2">
                  <Icon className="h-4 w-4 mt-0.5 shrink-0" />
                  <p className="leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
                    {response ?? storyMuse.text}
                    {isLoading && storyMuse.text && (
                      <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current align-middle" />
                    )}
                  </p>
                </div>
              </div>
            ) : null}

            {showLoadingState && (
              <p className="text-[11px] text-muted-foreground/60 px-0.5">
                Response streams here as Muse thinks and writes. You can keep the dialog open or cancel.
              </p>
            )}
          </div>
        )}

        {/* Input */}
        <div className="px-5 pt-3 pb-4">
          <div className="relative">
            <Textarea
              placeholder={`Ask ${config.name} anything...`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSubmit();
              }}
              rows={3}
              className="resize-none pr-12 bg-white/5 border-white/10 focus:border-violet-500/50 placeholder:text-muted-foreground/50"
            />
            <Button
              size="icon"
              onClick={handleSubmit}
              disabled={!prompt.trim() || isLoading}
              className={cn(
                'absolute bottom-2.5 right-2.5 h-8 w-8',
                'bg-violet-600 hover:bg-violet-500 disabled:opacity-40',
              )}
            >
              {isLoading ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground/60">⌘↵ to send</p>
          {(activeMuse === 'VISUAL_MUSE' || activeMuse === 'MOTION_MUSE') && (
            <p className="mt-1 text-[11px] text-muted-foreground/50">
              Keyframe and video generation run from the scene cards on the Kanban board.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
