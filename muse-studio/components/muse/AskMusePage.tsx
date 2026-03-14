'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles, Send, Feather, Palette, Film, FolderOpen, MessageCircle } from 'lucide-react';
import { AppHeader } from '@/components/layout/AppHeader';
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

export interface AskMusePageProps {
  initialContext?: {
    sceneId?: string;
    sceneTitle?: string;
    stage?: string;
  };
  projectId?: string;
  projects: Array<{ id: string; title: string }>;
}

export function AskMusePage({ initialContext, projectId, projects }: AskMusePageProps) {
  const router = useRouter();
  const [activeMuse, setActiveMuse] = useState<MuseAgent>('STORY_MUSE');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const projectIds = new Set(projects.map((p) => p.id));
  const initialSelected =
    projectId && projectIds.has(projectId) ? projectId : null;
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialSelected);
  // Sync selection when URL projectId changes (e.g. navigation to /ask-muse?projectId=x)
  useEffect(() => {
    if (projectId && projects.some((p) => p.id === projectId) && selectedProjectId !== projectId) {
      setSelectedProjectId(projectId);
    }
  }, [projectId, projects, selectedProjectId]);

  const storyMuse = useStoryMuse();
  const llmSettings = useLLMSettings();

  const config = MUSE_CONFIG[activeMuse];
  const Icon = MUSE_ICONS[activeMuse];
  const selectedProject = selectedProjectId
    ? projects.find((p) => p.id === selectedProjectId)
    : null;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, storyMuse.text]);

  // Load chat history when project or muse changes
  useEffect(() => {
    let cancelled = false;

    async function loadHistory() {
      setIsLoadingHistory(true);
      setHistoryError(null);
      try {
        const history = await getMuseChatHistory({
          projectId: selectedProjectId ?? null,
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
  }, [selectedProjectId, activeMuse]);

  function handleSelectProject(id: string | null) {
    setSelectedProjectId(id);
    setPanelOpen(false);
    const params = new URLSearchParams();
    if (id) params.set('projectId', id);
    const query = params.toString();
    router.replace(query ? `/ask-muse?${query}` : '/ask-muse');
  }

  function handleMuseSwitch(muse: MuseAgent) {
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

    // Persist user message (fire-and-forget; errors logged in action)
    appendMuseChatMessage({
      projectId: selectedProjectId ?? null,
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
      projectId: selectedProjectId ?? undefined,
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

    // Persist assistant message
    appendMuseChatMessage({
      projectId: selectedProjectId ?? null,
      muse: activeMuse,
      role: 'assistant',
      content: assistantContent,
    }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('Failed to persist Ask Muse assistant message', err);
    });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AppHeader />

      <div className="flex flex-1 min-h-0">
        {/* Left panel: project list */}
        <aside
          className={cn(
            'flex flex-col border-r border-white/8 bg-white/[0.02] shrink-0',
            'w-[260px] hidden md:flex',
          )}
        >
          <div className="p-3 border-b border-white/8">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2">
              Project context
            </h2>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
            <button
              type="button"
              onClick={() => handleSelectProject(null)}
              className={cn(
                'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                !selectedProjectId
                  ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30'
                  : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent',
              )}
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              <span className="truncate">General chat</span>
            </button>
            {projects.map((p) => {
              const selected = selectedProjectId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectProject(p.id)}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors border',
                    selected
                      ? 'bg-violet-500/20 text-violet-300 border-violet-500/30'
                      : 'border-transparent text-muted-foreground hover:bg-white/5 hover:text-foreground',
                  )}
                >
                  <FolderOpen className="h-4 w-4 shrink-0" />
                  <span className="truncate">{p.title || p.id}</span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Mobile: Projects toggle + drawer */}
        <div className="md:hidden fixed top-14 left-0 right-0 z-10 flex border-b border-white/8 bg-background/95 backdrop-blur px-2 py-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPanelOpen((o) => !o)}
            className="border-white/8"
          >
            <FolderOpen className="h-4 w-4 mr-1.5" />
            {selectedProject ? selectedProject.title : 'General chat'}
          </Button>
        </div>
        {panelOpen && (
          <div
            className="md:hidden fixed inset-0 z-20 bg-black/50 top-14"
            onClick={() => setPanelOpen(false)}
            aria-hidden
          />
        )}
        {panelOpen && (
          <div className="md:hidden fixed left-0 top-14 bottom-0 z-30 w-[260px] border-r border-white/8 bg-background overflow-y-auto p-2 space-y-0.5">
            <button
              type="button"
              onClick={() => handleSelectProject(null)}
              className={cn(
                'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                !selectedProjectId ? 'bg-violet-500/20 text-violet-300' : 'text-muted-foreground',
              )}
            >
              <MessageCircle className="h-4 w-4 shrink-0" />
              General chat
            </button>
            {projects.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectProject(p.id)}
                className={cn(
                  'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm',
                  selectedProjectId === p.id ? 'bg-violet-500/20 text-violet-300' : 'text-muted-foreground',
                )}
              >
                <FolderOpen className="h-4 w-4 shrink-0" />
                <span className="truncate">{p.title || p.id}</span>
              </button>
            ))}
          </div>
        )}

      <main className={cn(
        'flex flex-1 flex-col min-h-0 max-w-4xl w-full mx-auto px-4 py-6',
        'md:pt-6 pt-20',
      )}>
        {/* Page title */}
        <div className="flex items-center gap-2 mb-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20">
            <Sparkles className="h-4 w-4 text-violet-400" />
          </div>
          <h1 className="font-semibold text-lg">Ask Muse</h1>
          <span className="text-xs text-muted-foreground hidden sm:inline">⌘M</span>
        </div>

        {/* Muse selector */}
        <div className="flex gap-2 mb-3">
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

        {/* Reminder */}
        <p className="text-xs text-muted-foreground mb-3">
          Story, Visual, and Motion Muse use your configured LLM (Settings → LLM) for narrative
          and creative suggestions.
        </p>

        {/* Context pill */}
        {(selectedProject || initialContext?.sceneTitle) && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {selectedProject && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/8 px-2.5 py-1 text-xs text-muted-foreground">
                Project: <span className="text-foreground font-medium">{selectedProject.title}</span>
              </span>
            )}
            {initialContext?.sceneTitle && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/5 border border-white/8 px-2.5 py-1 text-xs text-muted-foreground">
                Scene: <span className="text-foreground font-medium">{initialContext.sceneTitle}</span>
              </span>
            )}
          </div>
        )}

        {/* Back to project */}
        {(selectedProjectId ?? projectId) && (
          <div className="mb-3">
            <Link
              href={`/projects/${selectedProjectId ?? projectId}`}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Back to project
            </Link>
          </div>
        )}

        {/* Message list */}
        <div className="flex-1 min-h-0 overflow-y-auto rounded-xl border border-white/8 bg-white/5 p-4 space-y-4">
          {historyError && (
            <p className="text-xs text-destructive text-center">
              {historyError}
            </p>
          )}
          {isLoadingHistory && messages.length === 0 && !storyMuse.isGenerating && !historyError && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Loading previous messages...
            </p>
          )}
          {messages.length === 0 && !storyMuse.isGenerating && !isLoadingHistory && !historyError && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Ask {config.name} anything. Your conversation appears here.
            </p>
          )}
          {messages.map((msg) => {
            const MsgIcon = msg.role === 'assistant' && msg.muse ? MUSE_ICONS[msg.muse] : null;
            return (
            <div
              key={msg.id}
              className={cn(
                'flex gap-2 rounded-lg p-3 text-sm',
                msg.role === 'user'
                  ? 'bg-white/5 border border-white/8 ml-4'
                  : msg.muse
                    ? `${MUSE_CONFIG[msg.muse].bgClass} ${MUSE_CONFIG[msg.muse].borderClass} border mr-4`
                    : 'bg-white/5 border border-white/8 mr-4',
              )}
            >
              {MsgIcon && (
                <MsgIcon className={cn('h-4 w-4 mt-0.5 shrink-0', msg.muse ? MUSE_CONFIG[msg.muse].textClass : '')} />
              )}
              <p className="leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
                {msg.content}
              </p>
            </div>
            );
          })}
          {storyMuse.isGenerating && (
            <div
              className={cn(
                'flex gap-2 rounded-lg p-3 text-sm border',
                config.bgClass,
                config.borderClass,
                config.textClass,
              )}
            >
              <Icon className="h-4 w-4 mt-0.5 shrink-0" />
              <p className="leading-relaxed whitespace-pre-wrap flex-1 min-w-0">
                {storyMuse.text}
                <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-current align-middle" />
              </p>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="mt-4 shrink-0">
          <div className="relative">
            <Textarea
              placeholder={`Ask ${config.name} anything...`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              rows={3}
              className="resize-none pr-12 bg-white/5 border-white/10 focus:border-violet-500/50 placeholder:text-muted-foreground/50"
            />
            <Button
              size="icon"
              onClick={() => handleSubmit()}
              disabled={!prompt.trim() || storyMuse.isGenerating}
              className={cn(
                'absolute bottom-2.5 right-2.5 h-8 w-8',
                'bg-violet-600 hover:bg-violet-500 disabled:opacity-40',
              )}
            >
              {storyMuse.isGenerating ? (
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
      </main>
      </div>
    </div>
  );
}
