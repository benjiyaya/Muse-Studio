'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FileImage,
  FileText,
  Film,
  FolderOpen,
  Library,
  Loader2,
  Maximize2,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Send,
  Star,
  Trash2,
  Upload,
  Wrench,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { McpChatResponse, McpToolCallLogEntry } from '@/lib/mcp-extensions/orchestrateMcpChat';
import type { McpAttachmentPayload, McpPendingApproval } from '@/lib/mcp-extensions/mcpChatTypes';
import type { McpExtensionsInitialLine } from '@/lib/actions/mcpExtensionsChat';
import {
  createMcpExtensionsChatSession,
  deleteMcpExtensionsChatSession,
  getMcpExtensionsChatSessionLines,
  listMcpExtensionsChatSessions,
  renameMcpExtensionsChatSession,
  setMcpExtensionsChatSessionContext,
  setMcpExtensionsChatSessionPinned,
  type McpExtensionsChatSession,
} from '@/lib/actions/mcpExtensionsChat';
import type { McpConsolePluginGroup, McpExtensionToolDescriptor } from '@/lib/actions/plugins';
import { McpExtensionsToolsPanel } from '@/components/mcp-extensions/McpExtensionsToolsPanel';
import { getProjectById } from '@/lib/actions/projects';
import { listCharacters } from '@/lib/actions/characters';
import {
  promotePlaygroundAssetToKeyframe,
  promotePlaygroundAssetToCharacterImage,
  promotePlaygroundVideoToScene,
} from '@/lib/actions/projectMediaLibrary';
import type { CharacterImageKind } from '@/lib/types';
import type { ProjectStage } from '@/lib/types';
import { mediaKindFromRelPath, previewUrlToOutputsRelPath } from '@/lib/mcp-extensions/previewPaths';
import {
  listPlaygroundGlobalLibrary,
  listPlaygroundGlobalTextLibrary,
  listProjectMediaLibrary,
  listProjectTextLibrary,
  type MediaLibraryItem,
  type TextLibraryItem,
} from '@/lib/actions/projectMediaLibrary';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface McpExtensionsProjectSummary {
  id: string;
  title: string;
  currentStage: ProjectStage;
  logline?: string;
}

type ChatLine =
  | { id?: string; role: 'user'; content: string }
  | {
      id?: string;
      role: 'assistant';
      content: string;
      toolCalls?: McpToolCallLogEntry[];
    };

const CHARACTER_KIND_OPTIONS: CharacterImageKind[] = [
  'FACE',
  'FULL_BODY',
  'EXPRESSION',
  'OUTFIT',
  'TURNAROUND',
  'ACTION',
  'OTHER',
];

interface McpExtensionsConsoleClientProps {
  initialLines: McpExtensionsInitialLine[];
  initialSessions: McpExtensionsChatSession[];
  initialSessionId: string;
  initialContextFromQuery?: {
    projectId?: string;
    sceneId?: string;
    sceneTitle?: string;
    stage?: string;
  };
  projects: McpExtensionsProjectSummary[];
  initialPluginGroups: McpConsolePluginGroup[];
  toolCatalog: McpExtensionToolDescriptor[];
}

/** Run after Radix closes the menu so `<input type="file">` `.click()` stays user-gesture-safe. */
function openFilePickerAfterMenu(ref: RefObject<HTMLInputElement | null>) {
  queueMicrotask(() => ref.current?.click());
}

/** `crypto.randomUUID` is missing in non-secure contexts (e.g. http:// LAN IP). */
function newClientId(): string {
  const c = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

function linesToApiPayload(
  chatLines: ChatLine[],
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return chatLines.map((l) =>
    l.role === 'user'
      ? { role: 'user' as const, content: l.content }
      : { role: 'assistant' as const, content: l.content },
  );
}

type ComposerAttachmentKind = 'image' | 'video' | 'text';
type ComposerUploadTarget = 'session' | 'project';

type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: ComposerAttachmentKind;
  relPath: string;
  previewUrl?: string;
  target: ComposerUploadTarget;
  projectId?: string;
  source?: 'upload' | 'library';
};

function fileNameFromRelPath(relPath: string): string {
  const parts = relPath.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || relPath;
}

/** Avoids Next dev overlay from failed /api/outputs loads (404/CORS) breaking img/video. */
function ComposerAttachmentThumb({ attachment: a }: { attachment: ComposerAttachment }) {
  const [mediaFailed, setMediaFailed] = useState(false);
  const preview = a.previewUrl ?? (a.relPath ? `/api/outputs/${a.relPath}` : undefined);

  return (
    <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/40">
      {!mediaFailed && a.kind === 'image' && preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => setMediaFailed(true)}
        />
      ) : !mediaFailed && a.kind === 'video' && preview ? (
        <video
          src={preview}
          className="h-full w-full object-cover"
          muted
          playsInline
          preload="metadata"
          onError={() => setMediaFailed(true)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          {a.kind === 'text' ? (
            <FileText className="h-6 w-6" />
          ) : a.kind === 'image' ? (
            <FileImage className="h-6 w-6" />
          ) : (
            <Film className="h-6 w-6" />
          )}
        </div>
      )}
      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/70 px-1 text-[8px] font-medium uppercase text-white/90">
        {a.kind}
      </span>
    </div>
  );
}

function composerToPayload(a: ComposerAttachment): McpAttachmentPayload {
  return {
    relPath: a.relPath,
    kind: a.kind,
    name: a.name,
    mimeType: a.mimeType,
    size: a.size,
    previewUrl: a.previewUrl,
    target: a.target,
    projectId: a.projectId,
    source: a.source ?? 'upload',
  };
}

function attachmentScopeLine(a: ComposerAttachment): string {
  if (a.target === 'project') return `project:${a.projectId ?? 'unknown'}`;
  if (a.source === 'library' && a.relPath.includes('/playground/')) return 'playground';
  return 'session';
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

function buildAttachmentBlock(attachments: ComposerAttachment[]): string {
  if (attachments.length === 0) return '';
  const lines = attachments.map((a) => {
    const scope = attachmentScopeLine(a);
    return `- ${a.kind}: ${a.relPath} (${scope})`;
  });
  return ['Attachments:', ...lines].join('\n');
}

export function McpExtensionsConsoleClient({
  initialLines,
  initialSessions,
  initialSessionId,
  initialContextFromQuery,
  projects,
  initialPluginGroups,
  toolCatalog,
}: McpExtensionsConsoleClientProps) {
  const router = useRouter();
  const [lines, setLines] = useState<ChatLine[]>(() =>
    initialLines.map((l) =>
      l.role === 'user'
        ? { id: l.id, role: 'user' as const, content: l.content }
        : {
            id: l.id,
            role: 'assistant' as const,
            content: l.content,
            toolCalls: l.toolCalls,
          },
    ),
  );
  const [input, setInput] = useState('');
  const [sessions, setSessions] = useState<McpExtensionsChatSession[]>(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState(initialSessionId);
  const [sessionSearch, setSessionSearch] = useState('');
  const [emptySessionProjectId, setEmptySessionProjectId] = useState<string>(projects[0]?.id ?? '');
  const [switchingSession, setSwitchingSession] = useState(false);
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;

  const [lightbox, setLightbox] = useState<{ url: string; kind: 'image' | 'video' } | null>(null);

  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteMode, setPromoteMode] = useState<'keyframe' | 'character' | 'video' | null>(null);
  const [promoteScenes, setPromoteScenes] = useState<
    Array<{ id: string; title: string; sceneNumber: number }>
  >([]);
  const [promoteCharacters, setPromoteCharacters] = useState<Array<{ id: string; name: string }>>([]);
  const [promoteSceneId, setPromoteSceneId] = useState('');
  const [promoteCharacterId, setPromoteCharacterId] = useState('');
  const [promoteCharKind, setPromoteCharKind] = useState<CharacterImageKind>('FACE');
  const [promoteLoadingData, setPromoteLoadingData] = useState(false);
  const [promoteSubmitting, setPromoteSubmitting] = useState(false);
  const [promoteError, setPromoteError] = useState<string | null>(null);
  const [promotePickedProjectId, setPromotePickedProjectId] = useState('');
  const [promoteResultPath, setPromoteResultPath] = useState<string | null>(null);

  const [pendingApproval, setPendingApproval] = useState<McpPendingApproval | null>(null);
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [uploadingKind, setUploadingKind] = useState<ComposerAttachmentKind | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [showAllToolTags, setShowAllToolTags] = useState(false);
  const imageUploadRef = useRef<HTMLInputElement>(null);
  const videoUploadRef = useRef<HTMLInputElement>(null);
  const textUploadRef = useRef<HTMLInputElement>(null);
  const pendingTurnRef = useRef<{
    latestUserMessage: string;
    attachments: McpAttachmentPayload[];
  } | null>(null);

  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);
  const [mediaLibraryKind, setMediaLibraryKind] = useState<ComposerAttachmentKind>('image');
  const [mediaLibraryScope, setMediaLibraryScope] = useState<'playground' | 'project'>('playground');
  const [mediaLibraryProjectId, setMediaLibraryProjectId] = useState<string>(projects[0]?.id ?? '');
  const [mediaLibraryLoading, setMediaLibraryLoading] = useState(false);
  const [mediaLibraryItems, setMediaLibraryItems] = useState<
    Array<MediaLibraryItem | (TextLibraryItem & { kind: 'text' })>
  >([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [lines, loading]);

  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, sessionSearch]);
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;
  const activeProject = activeSession?.projectId
    ? projects.find((p) => p.id === activeSession.projectId) ?? null
    : null;

  const refreshSessions = useCallback(async () => {
    const next = await listMcpExtensionsChatSessions();
    setSessions(next);
    if (next.length > 0 && !next.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(next[0]!.id);
    }
  }, [activeSessionId]);

  const loadSession = useCallback(async (sessionId: string) => {
    setSwitchingSession(true);
    try {
      const sessionLines = await getMcpExtensionsChatSessionLines(sessionId);
      const found = sessions.find((s) => s.id === sessionId);
      setActiveSessionId(sessionId);
      if (found?.projectId) setEmptySessionProjectId(found.projectId);
      setLines(
        sessionLines.map((l) =>
          l.role === 'user'
            ? { id: l.id, role: 'user' as const, content: l.content }
            : { id: l.id, role: 'assistant' as const, content: l.content, toolCalls: l.toolCalls },
        ),
      );
      setPendingApproval(null);
      pendingTurnRef.current = null;
      setComposerAttachments([]);
      setComposerError(null);
      setInput('');
    } finally {
      setSwitchingSession(false);
    }
  }, [sessions]);

  const createSession = useCallback(async () => {
    const created = await createMcpExtensionsChatSession();
    await refreshSessions();
    await loadSession(created.id);
  }, [loadSession, refreshSessions]);

  const renameSession = useCallback(
    async (sessionId: string, currentTitle: string) => {
      const next = window.prompt('Rename chat', currentTitle)?.trim();
      if (!next || next === currentTitle) return;
      await renameMcpExtensionsChatSession(sessionId, next);
      await refreshSessions();
    },
    [refreshSessions],
  );

  const togglePinSession = useCallback(
    async (sessionId: string, pinned: boolean) => {
      await setMcpExtensionsChatSessionPinned(sessionId, !pinned);
      await refreshSessions();
    },
    [refreshSessions],
  );

  const deleteSession = useCallback(
    async (sessionId: string) => {
      if (!window.confirm('Delete this chat session and its messages?')) return;
      const nextActiveId = await deleteMcpExtensionsChatSession(sessionId);
      await refreshSessions();
      await loadSession(nextActiveId);
    },
    [loadSession, refreshSessions],
  );

  useEffect(() => {
    if (!initialContextFromQuery?.projectId) return;
    if (lines.length > 0) return;
    if (!activeSessionId) return;
    if (activeSession?.projectId) return;
    const projectExists = projects.some((p) => p.id === initialContextFromQuery.projectId);
    if (!projectExists) return;
    setEmptySessionProjectId(initialContextFromQuery.projectId);
    void setMcpExtensionsChatSessionContext(activeSessionId, {
      projectId: initialContextFromQuery.projectId,
      sceneId: initialContextFromQuery.sceneId,
    }).then(() => refreshSessions());
  }, [
    initialContextFromQuery,
    lines.length,
    activeSessionId,
    activeSession?.projectId,
    projects,
    refreshSessions,
  ]);

  const startSessionWithProject = useCallback(async () => {
    if (!activeSessionId || !emptySessionProjectId) return;
    await setMcpExtensionsChatSessionContext(activeSessionId, {
      projectId: emptySessionProjectId,
      sceneId: undefined,
    });
    await refreshSessions();
  }, [activeSessionId, emptySessionProjectId, refreshSessions]);

  const continueWithoutProject = useCallback(async () => {
    if (!activeSessionId) return;
    await setMcpExtensionsChatSessionContext(activeSessionId, {
      projectId: null,
      sceneId: null,
    });
    await refreshSessions();
  }, [activeSessionId, refreshSessions]);

  const loadMediaLibraryItems = useCallback(async () => {
    setMediaLibraryLoading(true);
    setComposerError(null);
    try {
      if (mediaLibraryKind === 'text') {
        if (mediaLibraryScope === 'playground') {
          const items = await listPlaygroundGlobalTextLibrary();
          setMediaLibraryItems(items.map((i) => ({ ...i, kind: 'text' as const })));
          return;
        }
        if (!mediaLibraryProjectId) {
          setMediaLibraryItems([]);
          return;
        }
        const items = await listProjectTextLibrary(mediaLibraryProjectId);
        setMediaLibraryItems(items.map((i) => ({ ...i, kind: 'text' as const })));
        return;
      }
      if (mediaLibraryScope === 'playground') {
        const all = await listPlaygroundGlobalLibrary();
        setMediaLibraryItems(all.filter((i) => i.kind === mediaLibraryKind));
      } else {
        if (!mediaLibraryProjectId) {
          setMediaLibraryItems([]);
          return;
        }
        const all = await listProjectMediaLibrary(mediaLibraryProjectId);
        setMediaLibraryItems(all.filter((i) => i.kind === mediaLibraryKind));
      }
    } catch (e) {
      setComposerError(e instanceof Error ? e.message : String(e));
      setMediaLibraryItems([]);
    } finally {
      setMediaLibraryLoading(false);
    }
  }, [mediaLibraryKind, mediaLibraryScope, mediaLibraryProjectId]);

  useEffect(() => {
    if (!mediaLibraryOpen) return;
    void loadMediaLibraryItems();
  }, [mediaLibraryOpen, loadMediaLibraryItems]);

  async function loadPromoteContext(projectId: string, mode: 'keyframe' | 'character' | 'video') {
    setPromoteLoadingData(true);
    try {
      if (mode === 'character') {
        const chars = await listCharacters(projectId);
        setPromoteCharacters(chars.map((c) => ({ id: c.id, name: c.name })));
        setPromoteCharacterId(chars[0]?.id ?? '');
        setPromoteCharKind('FACE');
      } else {
        const p = await getProjectById(projectId);
        const sc = (p?.scenes ?? []).map((s) => ({
          id: s.id,
          title: s.title,
          sceneNumber: s.sceneNumber,
        }));
        setPromoteScenes(sc);
        setPromoteSceneId(sc[0]?.id ?? '');
      }
    } finally {
      setPromoteLoadingData(false);
    }
  }

  async function openAssignDialog(mode: 'keyframe' | 'character' | 'video', sourceRelPath: string) {
    if (projects.length === 0) {
      setPromoteError('Create a project first under Projects.');
      setPromoteMode(mode);
      setPromoteResultPath(sourceRelPath);
      setPromoteOpen(true);
      return;
    }
    const firstId = projects[0]!.id;
    setPromotePickedProjectId(firstId);
    setPromoteResultPath(sourceRelPath);
    setPromoteError(null);
    setPromoteMode(mode);
    setPromoteOpen(true);
    await loadPromoteContext(firstId, mode);
  }

  async function handlePromoteConfirm() {
    const projectId = promotePickedProjectId;
    const resultPath = promoteResultPath;
    if (!projectId || !resultPath || !promoteMode) return;
    setPromoteSubmitting(true);
    setPromoteError(null);
    try {
      if (promoteMode === 'keyframe') {
        if (!promoteSceneId) throw new Error('Pick a scene');
        await promotePlaygroundAssetToKeyframe({
          projectId,
          sceneId: promoteSceneId,
          sourceRelPath: resultPath,
        });
      } else if (promoteMode === 'character') {
        if (!promoteCharacterId) throw new Error('Pick a character');
        await promotePlaygroundAssetToCharacterImage({
          projectId,
          characterId: promoteCharacterId,
          sourceRelPath: resultPath,
          kind: promoteCharKind,
        });
      } else if (promoteMode === 'video') {
        if (!promoteSceneId) throw new Error('Pick a scene');
        await promotePlaygroundVideoToScene({
          projectId,
          sceneId: promoteSceneId,
          sourceRelPath: resultPath,
        });
      }
      setPromoteOpen(false);
      setPromoteMode(null);
      setPromoteResultPath(null);
      router.refresh();
    } catch (e) {
      setPromoteError(e instanceof Error ? e.message : 'Assignment failed');
    } finally {
      setPromoteSubmitting(false);
    }
  }

  const policyMap = new Map<string, 'ask' | 'auto'>();
  for (const g of initialPluginGroups) {
    if (!g.enabled) continue;
    for (const h of g.hooks) {
      if (!h.enabled) continue;
      policyMap.set(`${g.pluginId}:${h.capability}`, h.mcpPolicy);
    }
  }
  const enabledToolTags = toolCatalog.map((t) => ({
    key: `${t.pluginId}:${t.capability}`,
    pluginName: t.pluginName,
    capability: t.capability,
    mcpPolicy: policyMap.get(`${t.pluginId}:${t.capability}`) ?? 'auto',
  }));

  const shownToolTags = showAllToolTags ? enabledToolTags : enabledToolTags.slice(0, 8);
  const hiddenToolCount = Math.max(0, enabledToolTags.length - shownToolTags.length);

  async function uploadAttachment(file: File, kind: ComposerAttachmentKind) {
    setUploadingKind(kind);
    setComposerError(null);
    try {
      const form = new FormData();
      form.set('file', file);
      form.set('kind', kind);
      const target = activeSession?.projectId ? 'project' : 'session';
      form.set('target', target);
      if (target === 'project' && activeSession?.projectId) {
        form.set('projectId', activeSession.projectId);
      }
      const res = await fetch('/api/mcp-extensions/upload', {
        method: 'POST',
        body: form,
      });
      const rawText = await res.text();
      let data: { error?: string; item?: Omit<ComposerAttachment, 'id' | 'source'> & { source?: string } };
      try {
        data = rawText ? (JSON.parse(rawText) as typeof data) : {};
      } catch {
        throw new Error(rawText?.slice(0, 280) || `Upload failed (${res.status})`);
      }
      if (!res.ok || !data.item) {
        throw new Error(data.error ?? `Upload failed (${res.status})`);
      }
      setComposerAttachments((prev) => [
        ...prev,
        { ...data.item!, id: newClientId(), source: 'upload' },
      ]);
    } catch (e) {
      setComposerError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploadingKind(null);
    }
  }

  function openMediaLibrary(kind: ComposerAttachmentKind) {
    setMediaLibraryKind(kind);
    setMediaLibraryProjectId((id) => id || projects[0]?.id || '');
    setMediaLibraryOpen(true);
  }

  function addLibraryItemToComposer(item: MediaLibraryItem | (TextLibraryItem & { kind: 'text' })) {
    const isText = 'kind' in item && item.kind === 'text';
    const relPath = item.path;
    const kind: ComposerAttachmentKind = isText ? 'text' : item.kind;
    const name = fileNameFromRelPath(relPath);
    const previewUrl = `/api/outputs/${relPath}`;
    const target: ComposerUploadTarget = mediaLibraryScope === 'project' ? 'project' : 'session';
    const projectId = mediaLibraryScope === 'project' ? mediaLibraryProjectId : undefined;
    const size = item.sizeBytes ?? 0;
    const mimeType =
      kind === 'image' ? 'image/*' : kind === 'video' ? 'video/*' : 'text/plain';

    setComposerAttachments((prev) => [
      ...prev,
      {
        id: newClientId(),
        name,
        mimeType,
        size,
        kind,
        relPath,
        previewUrl,
        target,
        projectId,
        source: 'library',
      },
    ]);
    setMediaLibraryOpen(false);
  }

  const send = useCallback(async () => {
    const text = input.trim();
    if ((!text && composerAttachments.length === 0) || loading || switchingSession) return;

    const attachmentText = buildAttachmentBlock(composerAttachments);
    const finalMessage = [text, attachmentText].filter(Boolean).join('\n\n');
    const attachmentPayload = composerAttachments.map(composerToPayload);
    const userLine: ChatLine = { role: 'user', content: finalMessage };
    const nextLines: ChatLine[] = [...lines, userLine];
    setLines(nextLines);
    setInput('');
    setComposerAttachments([]);
    setPendingApproval(null);
    pendingTurnRef.current = null;
    setComposerError(null);
    setLoading(true);

    try {
      const payload = linesToApiPayload(nextLines);

      const res = await fetch('/api/mcp-extensions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSessionId,
          sessionContext: {
            projectId: activeSession?.projectId,
            sceneId: activeSession?.sceneId,
            sceneTitle: initialContextFromQuery?.sceneTitle,
            stage: initialContextFromQuery?.stage,
          },
          messages: payload,
          attachments: attachmentPayload,
        }),
      });

      const data = (await res.json()) as McpChatResponse & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }

      setLines((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.assistantText ?? '',
          toolCalls: data.toolCalls ?? [],
        },
      ]);
      const pend = data.pendingApproval ?? null;
      setPendingApproval(pend);
      if (pend) {
        pendingTurnRef.current = {
          latestUserMessage: finalMessage,
          attachments: attachmentPayload,
        };
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLines((prev) => [...prev, { role: 'assistant', content: `**Error:** ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, composerAttachments, lines, loading, activeSessionId, switchingSession, activeSession, initialContextFromQuery]);

  const confirmPendingTool = useCallback(async () => {
    if (!pendingApproval || loading || switchingSession) return;
    const toRun = pendingApproval;
    const ctx = pendingTurnRef.current;
    const approveLine: ChatLine = {
      role: 'user',
      content: `✓ Approve running ${toRun.capability} (${toRun.pluginName})`,
    };
    const nextLines = [...linesRef.current, approveLine];
    setLines(nextLines);
    setPendingApproval(null);
    pendingTurnRef.current = null;
    setLoading(true);
    try {
      const res = await fetch('/api/mcp-extensions/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSessionId,
          sessionContext: {
            projectId: activeSession?.projectId,
            sceneId: activeSession?.sceneId,
            sceneTitle: initialContextFromQuery?.sceneTitle,
            stage: initialContextFromQuery?.stage,
          },
          messages: linesToApiPayload(nextLines),
          approvePending: {
            capability: toRun.capability,
            pluginId: toRun.pluginId,
            input: toRun.input,
            latestUserMessage: ctx?.latestUserMessage,
            attachments: ctx?.attachments,
          },
        }),
      });
      const data = (await res.json()) as McpChatResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setLines((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.assistantText ?? '',
          toolCalls: data.toolCalls ?? [],
        },
      ]);
      // Avoid router.refresh() here: full RSC refetch remounts/flashes the page and is unnecessary
      // because chat state is already updated above. Use the MCP tools panel "Refresh" if needed.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLines((prev) => [...prev, { role: 'assistant', content: `**Error:** ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }, [pendingApproval, loading, activeSessionId, switchingSession, activeSession, initialContextFromQuery]);

  function renderMediaPreview(p: { kind: string; url?: string; label?: string }, key: number) {
    const rel = p.url ? previewUrlToOutputsRelPath(p.url) : null;
    const fileKind = rel ? mediaKindFromRelPath(rel) : null;

    const openLightbox = () => {
      if (!p.url) return;
      if (p.kind === 'image' || fileKind === 'image') setLightbox({ url: p.url, kind: 'image' });
      else if (p.kind === 'video' || fileKind === 'video') setLightbox({ url: p.url, kind: 'video' });
    };

    const assignButtons =
      rel && fileKind === 'image' ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 text-[10px] transition-all hover:-translate-y-0.5 hover:bg-violet-500/25 hover:text-violet-100 hover:shadow-[0_0_0_1px_rgba(167,139,250,0.35)] focus-visible:ring-violet-400/70"
            onClick={() => void openAssignDialog('keyframe', rel)}
          >
            Assign to keyframe…
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[10px] transition-all hover:-translate-y-0.5 hover:border-violet-400/45 hover:bg-violet-500/15 hover:text-violet-100 hover:shadow-[0_0_0_1px_rgba(167,139,250,0.25)] focus-visible:ring-violet-400/70"
            onClick={() => void openAssignDialog('character', rel)}
          >
            Assign to character…
          </Button>
        </div>
      ) : rel && fileKind === 'video' ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 text-[10px] transition-all hover:-translate-y-0.5 hover:bg-violet-500/25 hover:text-violet-100 hover:shadow-[0_0_0_1px_rgba(167,139,250,0.35)] focus-visible:ring-violet-400/70"
            onClick={() => void openAssignDialog('video', rel)}
          >
            Assign video to scene…
          </Button>
        </div>
      ) : null;

    if (p.kind === 'image' && p.url) {
      return (
        <div key={key} className="space-y-1">
          <button
            type="button"
            onClick={openLightbox}
            className="group relative block max-w-full rounded-md border border-white/10 bg-black/40 text-left outline-none ring-offset-2 ring-offset-black/40 focus-visible:ring-2 focus-visible:ring-violet-500"
            title="View full size"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url}
              alt={p.label ?? ''}
              className="max-h-48 w-auto rounded-md object-contain transition group-hover:opacity-95"
            />
            <span className="pointer-events-none absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md bg-black/55 text-white/90 opacity-0 shadow group-hover:opacity-100">
              <Maximize2 className="h-3.5 w-3.5" />
            </span>
          </button>
          {assignButtons}
        </div>
      );
    }
    if (p.kind === 'video' && p.url) {
      return (
        <div key={key} className="space-y-1">
          <div className="relative inline-block max-w-full rounded-md border border-white/10 bg-black/40">
            <video src={p.url} controls className="max-h-56 max-w-full rounded-md object-contain" />
            <button
              type="button"
              onClick={openLightbox}
              className="absolute bottom-2 right-2 flex h-8 w-8 items-center justify-center rounded-md bg-black/70 text-white/95 shadow-md ring-1 ring-white/15 transition hover:bg-black/85"
              title="View full size"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
          </div>
          {assignButtons}
        </div>
      );
    }
    return (
      <pre
        key={key}
        className="text-[11px] text-muted-foreground whitespace-pre-wrap max-h-40 overflow-y-auto"
      >
        {p.label ?? p.url ?? ''}
      </pre>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-white/8 px-4 py-3">
        <h1 className="text-sm font-semibold text-foreground">Extensions</h1>
        <div className="mt-2 flex items-center gap-2 lg:hidden">
          <select
            value={activeSessionId}
            onChange={(e) => void loadSession(e.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border border-white/12 bg-black/40 px-2 text-[11px]"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.pinned ? '★ ' : ''}
                {s.title}
              </option>
            ))}
          </select>
          <Button type="button" size="sm" variant="outline" className="h-8 px-2" onClick={() => void createSession()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)_minmax(280px,360px)]">
        <aside className="hidden min-h-0 border-r border-white/8 lg:flex lg:flex-col">
          <div className="flex items-center gap-2 border-b border-white/8 px-3 py-2.5">
            <MessageSquare className="h-4 w-4 text-violet-300" />
            <span className="text-xs font-medium text-foreground">Sessions</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2 text-[11px]"
              onClick={() => void createSession()}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              New
            </Button>
          </div>
          <div className="border-b border-white/8 px-3 py-2">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder="Search chats"
                className="h-8 w-full rounded-md border border-white/10 bg-black/25 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground"
              />
            </label>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
            {filteredSessions.length === 0 ? (
              <p className="px-2 py-4 text-center text-[11px] text-muted-foreground">No sessions found.</p>
            ) : (
              filteredSessions.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    'group rounded-lg border px-2 py-2',
                    s.id === activeSessionId
                      ? 'border-violet-500/35 bg-violet-500/10'
                      : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.04]',
                  )}
                >
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => void loadSession(s.id)}
                    disabled={switchingSession || loading}
                  >
                    <div className="flex items-center gap-1.5">
                      {s.pinned ? <Star className="h-3.5 w-3.5 text-amber-300" /> : null}
                      <span className="truncate text-xs font-medium text-foreground">{s.title}</span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{s.messageCount} messages</p>
                  </button>
                  <div className="mt-1.5 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5"
                      title={s.pinned ? 'Unpin' : 'Pin'}
                      onClick={() => void togglePinSession(s.id, s.pinned)}
                    >
                      <Star className={cn('h-3.5 w-3.5', s.pinned ? 'text-amber-300' : 'text-muted-foreground')} />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5"
                      title="Rename"
                      onClick={() => void renameSession(s.id, s.title)}
                    >
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-1.5"
                      title="Delete"
                      onClick={() => void deleteSession(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <div className="min-h-0 overflow-y-auto px-4 py-4 space-y-4">
          {activeProject ? (
            <div className="inline-flex items-center gap-1 rounded-full border border-violet-500/25 bg-violet-500/10 px-2.5 py-1 text-[11px] text-violet-200/95">
              Project: <span className="font-medium text-foreground">{activeProject.title}</span>
            </div>
          ) : null}
          {lines.length === 0 && !loading && (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-8 text-sm">
              <p className="text-center text-muted-foreground">
                Ask to generate an image, run a capability, or describe what you want an extension to do.
              </p>
              {!activeSession?.projectId ? (
                <div className="mx-auto mt-4 max-w-md space-y-2 rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Session context</p>
                  <select
                    value={emptySessionProjectId}
                    onChange={(e) => setEmptySessionProjectId(e.target.value)}
                    className="h-9 w-full rounded-md border border-white/12 bg-black/40 px-2 text-xs"
                  >
                    {projects.length === 0 ? <option value="">No projects</option> : null}
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                  </select>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 bg-violet-600 hover:bg-violet-500"
                      onClick={() => void startSessionWithProject()}
                      disabled={!emptySessionProjectId || projects.length === 0}
                    >
                      Start with project
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => void continueWithoutProject()}
                    >
                      Continue without project
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {lines.map((line, i) => (
            <div
              key={line.id ?? `line-${i}`}
              className={cn('flex', line.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[min(100%,720px)] rounded-2xl px-4 py-3 text-sm leading-relaxed',
                  line.role === 'user'
                    ? 'bg-violet-600/25 border border-violet-500/25 text-foreground'
                    : 'bg-white/5 border border-white/10 text-foreground/95',
                )}
              >
                {line.role === 'assistant' && line.toolCalls && line.toolCalls.length > 0 ? (
                  <div className="space-y-3">
                    {line.toolCalls.map((tc, j) => (
                      <div
                        key={j}
                        className="rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs font-mono"
                      >
                        <div className="flex items-center gap-2 text-muted-foreground mb-1">
                          <Wrench className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            {tc.pluginName ?? tc.pluginId ?? 'extension'} · {tc.capability} ·{' '}
                            <span
                              className={tc.status === 'ok' ? 'text-emerald-400' : 'text-red-400'}
                            >
                              {tc.status}
                            </span>
                          </span>
                        </div>
                        {tc.error ? (
                          <p className="text-red-300 whitespace-pre-wrap">{tc.error}</p>
                        ) : null}
                        {tc.previews.length > 0 ? (
                          <div className="flex flex-col gap-2 mt-2">
                            {tc.previews.map((p, k) => renderMediaPreview(p, k))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {line.content ? <div className="whitespace-pre-wrap">{line.content}</div> : null}
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap">{line.content}</div>
                )}
              </div>
            </div>
          ))}

          {(loading || switchingSession) && (
            <div className="flex justify-start">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-violet-400" />
                {switchingSession ? 'Loading chat…' : 'Thinking…'}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <aside className="hidden min-h-0 lg:flex lg:flex-col">
          <McpExtensionsToolsPanel initialGroups={initialPluginGroups} />
        </aside>
      </div>

      <div className="border-t border-white/8 p-4 space-y-3">
        {pendingApproval ? (
          <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100/95">
            <span className="min-w-0 flex-1">
              Pending tool: <span className="font-mono">{pendingApproval.capability}</span> —{' '}
              {pendingApproval.pluginName}
            </span>
            <Button
              type="button"
              size="sm"
              className="h-8 bg-violet-600 hover:bg-violet-500"
              disabled={loading}
              onClick={() => void confirmPendingTool()}
            >
              Run tool
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 text-muted-foreground"
              disabled={loading}
              onClick={() => {
                setPendingApproval(null);
                pendingTurnRef.current = null;
              }}
            >
              Dismiss
            </Button>
          </div>
        ) : null}
        <div className="max-w-4xl mx-auto w-full space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              <Wrench className="h-3 w-3" />
              Enabled tools
            </span>
            {shownToolTags.length === 0 ? (
              <span className="text-[11px] text-muted-foreground">No tools enabled. Use the right panel.</span>
            ) : null}
            {shownToolTags.map((t) => (
              <span
                key={t.key}
                className={cn(
                  'inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-mono',
                  t.mcpPolicy === 'ask'
                    ? 'border-amber-500/25 bg-amber-500/10 text-amber-200/95'
                    : 'border-violet-500/25 bg-violet-500/10 text-violet-200/95',
                )}
                title={`${t.pluginName} · ${t.capability} (${t.mcpPolicy.toUpperCase()})`}
              >
                {t.pluginName} · {t.capability}
              </span>
            ))}
            {hiddenToolCount > 0 ? (
              <button
                type="button"
                className="rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowAllToolTags((v) => !v)}
              >
                {showAllToolTags ? 'Show less' : `+${hiddenToolCount} more`}
              </button>
            ) : null}
          </div>

          <div className="rounded-xl border border-white/10 bg-black/35 p-2 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 border-white/12 bg-white/5 text-xs"
                    disabled={loading || uploadingKind !== null}
                  >
                    {uploadingKind === 'image' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileImage className="h-3.5 w-3.5" />
                    )}
                    Image
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem
                    onSelect={() => openFilePickerAfterMenu(imageUploadRef)}
                    className="gap-2 text-xs"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload new file…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => openMediaLibrary('image')}
                    className="gap-2 text-xs"
                  >
                    <Library className="h-3.5 w-3.5" />
                    Media library…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 border-white/12 bg-white/5 text-xs"
                    disabled={loading || uploadingKind !== null}
                  >
                    {uploadingKind === 'video' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Film className="h-3.5 w-3.5" />
                    )}
                    Video
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem
                    onSelect={() => openFilePickerAfterMenu(videoUploadRef)}
                    className="gap-2 text-xs"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload new file…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => openMediaLibrary('video')}
                    className="gap-2 text-xs"
                  >
                    <Library className="h-3.5 w-3.5" />
                    Media library…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 border-white/12 bg-white/5 text-xs"
                    disabled={loading || uploadingKind !== null}
                  >
                    {uploadingKind === 'text' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <FileText className="h-3.5 w-3.5" />
                    )}
                    Text file
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem
                    onSelect={() => openFilePickerAfterMenu(textUploadRef)}
                    className="gap-2 text-xs"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload new file…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => openMediaLibrary('text')}
                    className="gap-2 text-xs"
                  >
                    <Library className="h-3.5 w-3.5" />
                    Media library…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <Paperclip className="h-3 w-3" />
                {activeSession?.projectId ? 'Uploads route to active project' : 'Uploads route to session'}
              </span>
              <input
                ref={imageUploadRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadAttachment(file, 'image');
                  e.currentTarget.value = '';
                }}
              />
              <input
                ref={videoUploadRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadAttachment(file, 'video');
                  e.currentTarget.value = '';
                }}
              />
              <input
                ref={textUploadRef}
                type="file"
                accept=".txt,.md,.json,.csv,.tsv,.srt,.vtt,.yaml,.yml,text/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void uploadAttachment(file, 'text');
                  e.currentTarget.value = '';
                }}
              />
            </div>

            <div className="flex flex-wrap items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Describe what you want (e.g. generate an image of a sunset over mountains)…"
                rows={2}
                disabled={loading}
                className="min-w-0 flex-1 resize-none border-white/10 bg-black/30 text-sm min-h-[72px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <Button
                className="shrink-0 self-end bg-violet-600 hover:bg-violet-500 h-10 px-4"
                disabled={loading || (!input.trim() && composerAttachments.length === 0)}
                onClick={() => void send()}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>

            {composerError ? <p className="text-xs text-red-400">{composerError}</p> : null}

            {composerAttachments.length > 0 ? (
              <div className="space-y-2 border-t border-white/8 pt-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Attached for next message
                </p>
                <div className="flex flex-wrap gap-2">
                  {composerAttachments.map((a) => {
                    return (
                      <div
                        key={a.id}
                        className="flex max-w-[min(100%,20rem)] min-w-0 items-stretch gap-2 rounded-lg border border-white/12 bg-black/25 py-1.5 pl-1.5 pr-1 text-left"
                        title={a.relPath}
                      >
                        <ComposerAttachmentThumb attachment={a} />
                        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 py-0.5">
                          <span className="truncate text-xs font-medium text-foreground" title={a.name}>
                            {a.name}
                          </span>
                          <span className="truncate font-mono text-[10px] text-muted-foreground" title={a.relPath}>
                            {a.relPath}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {a.size > 0
                              ? formatBytes(a.size)
                              : a.source === 'library'
                                ? 'Media library'
                                : '—'}{' '}
                            · {a.source === 'library' ? 'library' : 'upload'}
                            {a.target === 'project' && a.projectId ? ` · project` : ''}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 self-start rounded-md p-1 text-muted-foreground transition hover:bg-white/10 hover:text-foreground"
                          onClick={() =>
                            setComposerAttachments((prev) => prev.filter((x) => x.id !== a.id))
                          }
                          aria-label={`Remove ${a.name}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Dialog open={mediaLibraryOpen} onOpenChange={setMediaLibraryOpen}>
        <DialogContent className="flex max-h-[90vh] w-[min(96vw,1200px)] max-w-[min(96vw,1200px)] flex-col gap-0 overflow-hidden border-white/10 bg-[oklch(0.13_0.012_264)] p-0 sm:max-w-[min(96vw,1200px)]">
          <DialogHeader className="border-b border-white/10 px-6 py-4">
            <DialogTitle className="text-lg flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-violet-400" />
              {mediaLibraryKind === 'image'
                ? 'Pick image'
                : mediaLibraryKind === 'video'
                  ? 'Pick video'
                  : 'Pick text file'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 px-6 py-4 text-sm min-h-0 flex-1 flex flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-muted-foreground self-center">Source</span>
              <select
                value={mediaLibraryScope}
                onChange={(e) =>
                  setMediaLibraryScope(e.target.value === 'project' ? 'project' : 'playground')
                }
                className="h-8 rounded-md border border-white/12 bg-black/40 px-2 text-[11px]"
              >
                <option value="playground">Playground (global)</option>
                <option value="project">Project library</option>
              </select>
              {mediaLibraryScope === 'project' ? (
                <select
                  value={mediaLibraryProjectId}
                  onChange={(e) => setMediaLibraryProjectId(e.target.value)}
                  className="h-8 min-w-[10rem] max-w-[min(24rem,50vw)] rounded-md border border-white/12 bg-black/40 px-2 text-[11px]"
                  disabled={projects.length === 0}
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              ) : null}
            </div>
            {mediaLibraryLoading ? (
              <div className="flex items-center gap-2 py-16 justify-center text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading…
              </div>
            ) : mediaLibraryItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-12 text-center px-4">
                No matching files. Generate media in Playground, add files to the project library, or create scene
                keyframes / videos — those appear here too.
              </p>
            ) : (
              <div className="grid max-h-[min(70vh,720px)] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3 lg:grid-cols-4">
                {mediaLibraryItems.map((item, idx) => {
                  const url = `/api/outputs/${item.path}`;
                  const label = fileNameFromRelPath(item.path);
                  return (
                    <button
                      key={`${item.path}-${idx}`}
                      type="button"
                      onClick={() => addLibraryItemToComposer(item)}
                      className="group flex min-w-0 flex-col rounded-xl border border-white/10 bg-black/30 p-2 text-left transition hover:border-violet-500/35 hover:bg-white/5"
                    >
                      {'kind' in item && item.kind === 'text' ? (
                        <div className="flex h-44 items-center justify-center rounded-lg bg-white/5">
                          <FileText className="h-12 w-12 text-muted-foreground" />
                        </div>
                      ) : item.kind === 'image' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt=""
                          className="h-44 w-full rounded-lg object-cover"
                        />
                      ) : (
                        <div className="relative h-44 w-full overflow-hidden rounded-lg bg-black/50">
                          <video src={url} className="h-full w-full object-cover opacity-90" muted />
                          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/90">
                            video
                          </span>
                        </div>
                      )}
                      <span className="mt-2 truncate text-[11px] text-muted-foreground" title={item.path}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter className="border-t border-white/10 px-6 py-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => setMediaLibraryOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lightbox !== null} onOpenChange={(o) => !o && setLightbox(null)}>
        <DialogContent className="max-h-[96vh] w-[96vw] max-w-[96vw] border-white/10 bg-black/95 p-2 sm:max-w-[96vw]">
          <div className="flex max-h-[90vh] items-center justify-center overflow-auto">
            {lightbox?.kind === 'image' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={lightbox.url}
                alt=""
                className="max-h-[85vh] max-w-full object-contain"
              />
            ) : lightbox?.kind === 'video' ? (
              <video src={lightbox.url} controls className="max-h-[85vh] max-w-full" autoPlay />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={promoteOpen}
        onOpenChange={(open) => {
          setPromoteOpen(open);
          if (!open) {
            setPromoteMode(null);
            setPromoteError(null);
            setPromoteResultPath(null);
          }
        }}
      >
        <DialogContent className="border-white/10 bg-[oklch(0.13_0.012_264)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">
              {promoteMode === 'keyframe' && 'Assign image as keyframe'}
              {promoteMode === 'character' && 'Add image to character'}
              {promoteMode === 'video' && 'Assign video to scene'}
            </DialogTitle>
          </DialogHeader>
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Create a project under{' '}
              <Link href="/projects" className="text-violet-400 hover:underline">
                Projects
              </Link>{' '}
              to attach outputs.
            </p>
          ) : promoteLoadingData ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Project</label>
                <select
                  value={promotePickedProjectId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPromotePickedProjectId(id);
                    if (promoteMode) void loadPromoteContext(id, promoteMode);
                  }}
                  className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-xs"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
              {(promoteMode === 'keyframe' || promoteMode === 'video') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Scene</label>
                  {promoteScenes.length === 0 ? (
                    <p className="text-xs text-amber-400/90">No scenes in this project yet.</p>
                  ) : (
                    <select
                      value={promoteSceneId}
                      onChange={(e) => setPromoteSceneId(e.target.value)}
                      className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-xs"
                    >
                      {promoteScenes.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.sceneNumber}. {s.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              {promoteMode === 'character' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Character</label>
                    {promoteCharacters.length === 0 ? (
                      <p className="text-xs text-amber-400/90">No characters in this project yet.</p>
                    ) : (
                      <select
                        value={promoteCharacterId}
                        onChange={(e) => setPromoteCharacterId(e.target.value)}
                        className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-xs"
                      >
                        {promoteCharacters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Image kind</label>
                    <select
                      value={promoteCharKind}
                      onChange={(e) => setPromoteCharKind(e.target.value as CharacterImageKind)}
                      className="w-full rounded-lg border border-white/12 bg-black/40 px-3 py-2 text-xs"
                    >
                      {CHARACTER_KIND_OPTIONS.map((k) => (
                        <option key={k} value={k}>
                          {k.replace(/_/g, ' ')}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <p className="text-[11px] text-muted-foreground/70">
                The file is copied into your project library or character refs; the extension output file
                stays in place.
              </p>
              {promoteError && <p className="text-xs text-red-400">{promoteError}</p>}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPromoteOpen(false)}
              disabled={promoteSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="bg-violet-600 hover:bg-violet-500"
              disabled={
                promoteSubmitting ||
                promoteLoadingData ||
                projects.length === 0 ||
                !promotePickedProjectId ||
                (promoteMode === 'character' && promoteCharacters.length === 0) ||
                ((promoteMode === 'keyframe' || promoteMode === 'video') && promoteScenes.length === 0)
              }
              onClick={() => void handlePromoteConfirm()}
            >
              {promoteSubmitting ? 'Saving…' : 'Confirm'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
