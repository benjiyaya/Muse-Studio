'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Feather, Palette, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { MUSE_CONFIG } from '@/lib/constants';
import type { MuseAgent } from '@/lib/types';
import { useStoryMuse } from '@/hooks/useStoryMuse';
import { useLLMSettings } from '@/hooks/useSettings';
import { appendMuseChatMessage, getMuseChatHistory } from '@/lib/actions/museChat';

const MUSE_ICONS: Record<MuseAgent, React.ElementType> = {
  STORY_MUSE: Feather,
  VISUAL_MUSE: Palette,
  MOTION_MUSE: Film,
};

const TASK_BY_MUSE: Record<MuseAgent, 'general_query' | 'visual_query' | 'motion_query'> = {
  STORY_MUSE: 'general_query',
  VISUAL_MUSE: 'visual_query',
  MOTION_MUSE: 'motion_query',
};

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  muse?: MuseAgent;
}

export interface MuseChatPanelProps {
  projectId: string | null;
  allowedMuses: MuseAgent[];
  initialContext?: {
    sceneId?: string;
    sceneTitle?: string;
    stage?: string;
  };
  /** Tighter layout for narrow columns (e.g. playground sidebar). */
  compact?: boolean;
  className?: string;
  /** Show LLM reminder under muse tabs (full Ask Muse page). */
  showLlmReminder?: boolean;
  /** Show note that keyframe/video runs from Kanban. */
  showKanbanHint?: boolean;
}

function museListKey(muses: MuseAgent[]): string {
  return [...muses].sort().join(',');
}

export function MuseChatPanel({
  projectId,
  allowedMuses,
  initialContext,
  compact = false,
  className,
  showLlmReminder = true,
  showKanbanHint = true,
}: MuseChatPanelProps) {
  const allowedKey = useMemo(() => museListKey(allowedMuses), [allowedMuses]);
  const firstAllowed = allowedMuses[0] ?? 'STORY_MUSE';

  const [activeMuse, setActiveMuse] = useState<MuseAgent>(() => firstAllowed);
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const storyMuse = useStoryMuse();
  const llmSettings = useLLMSettings();

  const config = MUSE_CONFIG[activeMuse];
  const Icon = MUSE_ICONS[activeMuse];

  useEffect(() => {
    if (!allowedMuses.includes(activeMuse)) {
      setActiveMuse(firstAllowed);
      storyMuse.cancel();
      setPrompt('');
    }
  }, [allowedKey, activeMuse, allowedMuses, firstAllowed, storyMuse]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, storyMuse.text]);

  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setIsLoadingHistory(true);
      setHistoryError(null);
      try {
        const history = await getMuseChatHistory({
          projectId: projectId ?? null,
          muse: activeMuse,
          limit: 100,
        });
        if (cancelled) return;
        setMessages(
          history.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            muse: m.muse,
          })),
        );
      } catch (err) {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.error('Failed to load Ask Muse history', err);
        setHistoryError('Unable to load previous messages.');
        setMessages([]);
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    }

    loadHistory();

    return () => {
      cancelled = true;
    };
  }, [projectId, activeMuse]);

  function handleMuseSwitch(muse: MuseAgent) {
    if (!allowedMuses.includes(muse)) return;
    setActiveMuse(muse);
    storyMuse.cancel();
    setPrompt('');
  }

  async function handleSubmit() {
    if (!prompt.trim()) return;

    const task = TASK_BY_MUSE[activeMuse];
    const userContent = prompt.trim();
    setPrompt('');

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userContent,
      muse: activeMuse,
    };
    setMessages((prev) => [...prev, userMsg]);

    appendMuseChatMessage({
      projectId: projectId ?? null,
      muse: activeMuse,
      role: 'user',
      content: userContent,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to persist Ask Muse user message', err);
    });

    const { text: responseText, error: responseError } = await storyMuse.generate({
      task,
      prompt: userContent,
      providerId: llmSettings.llmProvider,
      ollamaBaseUrl: llmSettings.ollamaBaseUrl,
      ollamaModel: llmSettings.ollamaModel,
      openaiModel: llmSettings.openaiModel,
      claudeModel: llmSettings.claudeModel,
      lmstudioBaseUrl: llmSettings.lmstudioBaseUrl,
      lmstudioModel: llmSettings.lmstudioModel,
      openrouterModel: llmSettings.openrouterModel,
      openrouterBaseUrl: llmSettings.openrouterBaseUrl,
      projectId: projectId ?? undefined,
      context: initialContext
        ? {
            sceneId: initialContext.sceneId,
            sceneTitle: initialContext.sceneTitle,
            stage: initialContext.stage,
          }
        : undefined,
    });
    const assistantContent = responseError ? `Error: ${responseError}` : (responseText ?? '');
    const assistantMsg: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: assistantContent,
      muse: activeMuse,
    };
    setMessages((prev) => [...prev, assistantMsg]);

    appendMuseChatMessage({
      projectId: projectId ?? null,
      muse: activeMuse,
      role: 'assistant',
      content: assistantContent,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to persist Ask Muse assistant message', err);
    });
  }

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {/* Muse selector */}
      <div className={cn('flex flex-wrap gap-1.5', compact ? 'mb-2' : 'mb-3')}>
        {allowedMuses.map((muse) => {
          const cfg = MUSE_CONFIG[muse];
          const MuseIcon = MUSE_ICONS[muse];
          const active = activeMuse === muse;
          return (
            <button
              key={muse}
              type="button"
              onClick={() => handleMuseSwitch(muse)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border font-medium transition-all',
                compact ? 'px-2 py-1.5 text-[10px]' : 'gap-2 px-3 py-2 text-xs',
                active
                  ? `${cfg.bgClass} ${cfg.textClass} ${cfg.borderClass}`
                  : 'border-white/8 text-muted-foreground hover:border-white/15 hover:text-foreground',
              )}
            >
              <MuseIcon className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
              {cfg.name}
            </button>
          );
        })}
      </div>

      {showLlmReminder && (
        <p className={cn('text-muted-foreground', compact ? 'mb-2 text-[10px] leading-snug' : 'mb-3 text-xs')}>
          {compact
            ? 'Uses your LLM (Settings → LLM).'
            : 'Story, Visual, and Motion Muse use your configured LLM (Settings → LLM) for narrative and creative suggestions.'}
        </p>
      )}

      {/* Message list */}
      <div
        className={cn(
          'min-h-0 w-full flex-1 overflow-y-auto rounded-xl border border-white/8 bg-white/5',
          compact ? 'space-y-2 p-2' : 'space-y-4 p-4',
        )}
      >
        {historyError && (
          <p className="text-center text-xs text-destructive">{historyError}</p>
        )}
        {isLoadingHistory && messages.length === 0 && !storyMuse.isGenerating && !historyError && (
          <p
            className={cn(
              'py-6 text-center text-muted-foreground',
              compact ? 'text-xs' : 'text-sm',
            )}
          >
            Loading previous messages...
          </p>
        )}
        {messages.length === 0 && !storyMuse.isGenerating && !isLoadingHistory && !historyError && (
          <p
            className={cn(
              'py-6 text-center text-muted-foreground',
              compact ? 'text-xs' : 'text-sm',
            )}
          >
            Ask {config.name} anything. Your conversation appears here.
          </p>
        )}
        {messages.map((msg) => {
          const MsgIcon = msg.role === 'assistant' && msg.muse ? MUSE_ICONS[msg.muse] : null;
          return (
            <div
              key={msg.id}
              className={cn(
                'flex gap-2 rounded-lg',
                compact ? 'p-2 text-xs' : 'p-3 text-sm',
                msg.role === 'user'
                  ? 'ml-1 border border-white/8 bg-white/5'
                  : msg.muse
                    ? `${MUSE_CONFIG[msg.muse].bgClass} ${MUSE_CONFIG[msg.muse].borderClass} mr-1 border`
                    : 'mr-1 border border-white/8 bg-white/5',
              )}
            >
              {MsgIcon && (
                <MsgIcon
                  className={cn(
                    'mt-0.5 shrink-0',
                    compact ? 'h-3 w-3' : 'h-4 w-4',
                    msg.muse ? MUSE_CONFIG[msg.muse].textClass : '',
                  )}
                />
              )}
              <p className="min-w-0 flex-1 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          );
        })}
        {storyMuse.isGenerating && (
          <div
            className={cn(
              'flex gap-2 rounded-lg border',
              compact ? 'p-2 text-xs' : 'p-3 text-sm',
              config.bgClass,
              config.borderClass,
              config.textClass,
            )}
          >
            <Icon className={cn('mt-0.5 shrink-0', compact ? 'h-3 w-3' : 'h-4 w-4')} />
            <p className="min-w-0 flex-1 whitespace-pre-wrap leading-relaxed">
              {storyMuse.text}
              <span className="ml-0.5 inline-block h-3 w-0.5 animate-pulse bg-current align-middle" />
            </p>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className={cn('shrink-0', compact ? 'mt-2' : 'mt-4')}>
        <div className="relative">
          <Textarea
            placeholder={`Ask ${config.name}…`}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            rows={compact ? 2 : 3}
            className={cn(
              'resize-none border-white/10 bg-white/5 pr-12 placeholder:text-muted-foreground/50 focus:border-violet-500/50',
              compact ? 'min-h-[60px] text-xs' : '',
            )}
          />
          <Button
            size="icon"
            type="button"
            onClick={() => handleSubmit()}
            disabled={!prompt.trim() || storyMuse.isGenerating}
            className={cn(
              'absolute bg-violet-600 hover:bg-violet-500 disabled:opacity-40',
              compact ? 'bottom-2 right-2 h-7 w-7' : 'bottom-2.5 right-2.5 h-8 w-8',
            )}
          >
            {storyMuse.isGenerating ? (
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Send className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
            )}
          </Button>
        </div>
        {!compact && <p className="mt-2 text-xs text-muted-foreground/60">⌘↵ to send</p>}
        {showKanbanHint && (activeMuse === 'VISUAL_MUSE' || activeMuse === 'MOTION_MUSE') && (
          <p
            className={cn(
              'text-muted-foreground/50',
              compact ? 'mt-1 text-[9px] leading-tight' : 'mt-1 text-[11px]',
            )}
          >
            Keyframe and video generation run from the scene cards on the Kanban board.
          </p>
        )}
      </div>
    </div>
  );
}
