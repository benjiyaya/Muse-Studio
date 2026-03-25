'use client';

import { useState, useTransition } from 'react';
import {
  User,
  Sparkles,
  Loader2,
  FileImage,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Character, StorylineContent } from '@/lib/types';
import type { LLMSettings } from '@/lib/actions/settings';
import type { ComfyWorkflowSummary } from '@/lib/actions/comfyui';
import { cn } from '@/lib/utils';
import { useStoryMuse } from '@/hooks/useStoryMuse';
import { createCharacter, updateCharacter } from '@/lib/actions/characters';
import { CharacterComfyGenerateDialog } from '@/components/characters/CharacterComfyGenerateDialog';

const NO_ROLE_LABEL = 'No role';

function groupCharactersByRole(characters: Character[]): Record<string, Character[]> {
  const map: Record<string, Character[]> = {};
  for (const c of characters) {
    const role = (c.primaryRole?.trim() || NO_ROLE_LABEL) as string;
    if (!map[role]) map[role] = [];
    map[role].push(c);
  }
  // Sort roles: "No role" last; else alphabetical
  const sortedKeys = Object.keys(map).sort((a, b) => {
    if (a === NO_ROLE_LABEL) return 1;
    if (b === NO_ROLE_LABEL) return -1;
    return a.localeCompare(b);
  });
  const result: Record<string, Character[]> = {};
  for (const k of sortedKeys) result[k] = map[k];
  return result;
}

interface CharactersPageClientProps {
  projectId: string;
  projectTitle: string;
  storyline?: StorylineContent;
  llmSettings: LLMSettings;
  comfyImageWorkflows: ComfyWorkflowSummary[];
  initialCharacters: Character[];
}

export function CharactersPageClient({
  projectId,
  projectTitle,
  storyline,
  llmSettings,
  comfyImageWorkflows,
  initialCharacters,
}: CharactersPageClientProps) {
  const [characters, setCharacters] = useState<Character[]>(initialCharacters);
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (!initialCharacters.length) return null;
    const sorted = [...initialCharacters].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    );
    return sorted[0]?.id ?? null;
  });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [primaryRole, setPrimaryRole] = useState('');
  const [shortBio, setShortBio] = useState('');
  const [designNotes, setDesignNotes] = useState('');

  const storyMuse = useStoryMuse();
  const [promptPendingId, setPromptPendingId] = useState<string | null>(null);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [imageTargetId, setImageTargetId] = useState<string | null>(null);

  const selectedCharacter = selectedId
    ? (characters.find((c) => c.id === selectedId) ?? null)
    : null;
  const grouped = groupCharactersByRole(characters);

  function resetForm() {
    setName('');
    setPrimaryRole('');
    setShortBio('');
    setDesignNotes('');
    setError(null);
  }

  async function handleCreateCharacter(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setError(null);
    startTransition(async () => {
      try {
        const created = await createCharacter({
          projectId,
          name: name.trim(),
          primaryRole: primaryRole.trim() || undefined,
          shortBio: shortBio.trim() || undefined,
          designNotes: designNotes.trim() || undefined,
          sortOrder: characters.length,
        });
        setCharacters((prev) => [...prev, created]);
        resetForm();
        setSelectedId(created.id);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create character.');
      }
    });
  }

  async function handleGeneratePrompt(char: Character) {
    if (promptPendingId) return;
    setPromptPendingId(char.id);

    const pieces: string[] = [];
    pieces.push(
      'Create a single rich visual description for this film character that can be used as an AI image prompt.',
    );
    pieces.push('');
    pieces.push(`Character name: ${char.name}`);
    if (char.primaryRole) pieces.push(`Role: ${char.primaryRole}`);
    if (char.shortBio) pieces.push(`Short bio: ${char.shortBio}`);
    if (char.designNotes) pieces.push(`Design notes: ${char.designNotes}`);
    if (storyline?.logline) pieces.push(`Story logline: ${storyline.logline}`);
    if (storyline?.genre) pieces.push(`Genre: ${storyline.genre}`);
    if (storyline?.themes?.length) pieces.push(`Themes: ${storyline.themes.join(', ')}`);

    const prompt = pieces.join('\n');

    const { text, error: genError } = await storyMuse.generate({
      task: 'visual_keyframe_prompt',
      prompt,
      projectId,
      providerId: llmSettings.llmProvider,
      ollamaBaseUrl: llmSettings.ollamaBaseUrl,
      ollamaModel: llmSettings.ollamaModel,
      openaiModel: llmSettings.openaiModel,
      claudeModel: llmSettings.claudeModel,
      lmstudioBaseUrl: llmSettings.lmstudioBaseUrl,
      lmstudioModel: llmSettings.lmstudioModel,
      openrouterModel: llmSettings.openrouterModel,
      openrouterBaseUrl: llmSettings.openrouterBaseUrl,
      maxTokens: 512,
      temperature: 0.8,
    });

    if (genError) {
      setError(genError);
      setPromptPendingId(null);
      return;
    }

    setCharacters((prev) =>
      prev.map((c) => (c.id === char.id ? { ...c, promptPositive: text.trim() } : c)),
    );

    startTransition(async () => {
      try {
        await updateCharacter(char.id, { promptPositive: text.trim() });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save character prompt.');
      } finally {
        setPromptPendingId(null);
      }
    });
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* Side panel: Role + character list */}
      <aside className="w-64 shrink-0 flex flex-col border-r border-white/8 bg-[oklch(0.12_0.01_264)]">
        <div className="p-3 border-b border-white/8">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            Role · Character list
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/60">
            {projectTitle}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {characters.length === 0 ? (
            <p className="text-xs text-muted-foreground/70 p-2">
              No characters yet. Create one in the main area.
            </p>
          ) : (
            Object.entries(grouped).map(([role, list]) => (
              <div key={role} className="mb-4">
                <p className="text-[10px] font-medium uppercase tracking-wider text-violet-400/90 px-2 mb-1.5">
                  {role}
                </p>
                <ul className="space-y-0.5">
                  {list.map((char) => (
                    <li key={char.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(char.id)}
                        className={cn(
                          'w-full text-left rounded-lg px-2.5 py-2 text-xs transition-colors',
                          selectedId === char.id
                            ? 'bg-violet-500/20 text-violet-200 border border-violet-500/30'
                            : 'text-muted-foreground hover:bg-white/5 hover:text-foreground border border-transparent',
                        )}
                      >
                        <span className="font-medium truncate block">{char.name}</span>
                        {char.primaryRole && char.primaryRole !== role && (
                          <span className="text-[10px] text-muted-foreground/60 truncate block">
                            {char.primaryRole}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* Main area: New character form or selected character detail */}
      <main className="flex-1 min-w-0 overflow-y-auto flex flex-col">
        <div className="p-5 max-w-3xl">
          {!selectedCharacter ? (
            /* New Character form */
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20">
                  <User className="h-4 w-4 text-violet-300" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">New Character</h2>
                  <p className="text-xs text-muted-foreground/70">
                    Add a main character for this project.
                  </p>
                </div>
              </div>

              <form onSubmit={handleCreateCharacter} className="space-y-3">
                <div>
                  <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                    Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Kira Nakamura"
                    disabled={isPending}
                    className={cn(
                      'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs',
                      'placeholder:text-muted-foreground/50 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/25',
                    )}
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                    Role
                  </label>
                  <input
                    type="text"
                    value={primaryRole}
                    onChange={(e) => setPrimaryRole(e.target.value)}
                    placeholder="e.g. Protagonist, Antagonist"
                    disabled={isPending}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs placeholder:text-muted-foreground/50 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/25"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                    Short Bio
                  </label>
                  <Textarea
                    value={shortBio}
                    onChange={(e) => setShortBio(e.target.value)}
                    rows={3}
                    disabled={isPending}
                    placeholder="One or two sentences describing who they are."
                    className="resize-none bg-white/5 border-white/10 text-xs placeholder:text-muted-foreground/50 focus:border-violet-500/50"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                    Design Notes
                  </label>
                  <Textarea
                    value={designNotes}
                    onChange={(e) => setDesignNotes(e.target.value)}
                    rows={3}
                    disabled={isPending}
                    placeholder="Visual anchors: age, build, clothing, props, palette…"
                    className="resize-none bg-white/5 border-white/10 text-xs placeholder:text-muted-foreground/50 focus:border-violet-500/50"
                  />
                </div>

                {error && (
                  <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                    {error}
                  </p>
                )}

                <Button
                  type="submit"
                  size="sm"
                  disabled={!name.trim() || isPending}
                  className="h-8 gap-1.5 bg-violet-600 text-xs hover:bg-violet-500"
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Add Character
                </Button>
              </form>
            </div>
          ) : (
            /* Selected character detail */
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20">
                    <User className="h-4 w-4 text-violet-300" />
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold">{selectedCharacter.name}</h2>
                    {selectedCharacter.primaryRole && (
                      <p className="text-xs text-muted-foreground/70">
                        {selectedCharacter.primaryRole}
                      </p>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => setSelectedId(null)}
                >
                  New character
                </Button>
              </div>

              {selectedCharacter.shortBio && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">Short Bio</p>
                  <p className="text-xs text-foreground/90">{selectedCharacter.shortBio}</p>
                </div>
              )}

              {selectedCharacter.designNotes && (
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">Design Notes</p>
                  <p className="text-xs text-foreground/90 whitespace-pre-wrap">
                    {selectedCharacter.designNotes}
                  </p>
                </div>
              )}

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-medium text-muted-foreground/80">
                    Visual prompt (for Flux 2 Klein / Qwen Edit)
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={promptPendingId === selectedCharacter.id || storyMuse.isGenerating}
                    onClick={() => handleGeneratePrompt(selectedCharacter)}
                    className="h-7 gap-1 rounded-full border-violet-500/40 bg-violet-500/10 text-[11px] text-violet-100 hover:bg-violet-500/20"
                  >
                    {promptPendingId === selectedCharacter.id || storyMuse.isGenerating ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Sparkles className="h-3 w-3" />
                    )}
                    Muse prompt
                  </Button>
                </div>

                <Textarea
                  value={selectedCharacter.promptPositive ?? ''}
                  onChange={(e) => {
                    const next = characters.map((c) =>
                      c.id === selectedCharacter.id ? { ...c, promptPositive: e.target.value } : c,
                    );
                    setCharacters(next);
                  }}
                  onBlur={() => {
                    const current = characters.find((c) => c.id === selectedCharacter.id);
                    if (current?.promptPositive !== undefined) {
                      updateCharacter(selectedCharacter.id, { promptPositive: current.promptPositive }).catch(
                        () => setError('Failed to save prompt.'),
                      );
                    }
                  }}
                  rows={4}
                  placeholder="Use Story Muse to draft a rich visual description, then tweak as needed."
                  className="resize-none bg-black/20 border-white/10 text-xs placeholder:text-muted-foreground/40"
                />
              </div>

              {selectedCharacter.images && selectedCharacter.images.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[11px] font-medium text-muted-foreground/75">
                    Reference images
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedCharacter.images.map((img) => (
                      <button
                        key={img.id}
                        type="button"
                        className="h-12 w-12 overflow-hidden rounded-md border border-white/10 bg-black/40 hover:border-violet-400/70 transition-colors"
                        onClick={() => {
                          if (img.image?.url) {
                            window.open(img.image.url, '_blank', 'noreferrer');
                          }
                        }}
                        title={img.kind.toLowerCase()}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.image?.url}
                          alt={img.kind}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {comfyImageWorkflows.length > 0 && (
                <div className="flex items-center justify-between gap-2 pt-2">
                  <p className="text-[11px] text-muted-foreground/70">
                    Generate character sheet image with ComfyUI.
                  </p>
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    className="h-7 rounded-full border-violet-500/40 bg-violet-500/10 text-[11px] text-violet-100 hover:bg-violet-500/20"
                    disabled={!selectedCharacter.promptPositive?.trim()}
                    onClick={() => {
                      setImageTargetId(selectedCharacter.id);
                      setImageDialogOpen(true);
                    }}
                  >
                    <FileImage className="mr-1 h-3 w-3" />
                    Generate image
                  </Button>
                </div>
              )}

              {error && (
                <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      </main>

      <CharacterComfyGenerateDialog
        open={imageDialogOpen}
        onClose={() => setImageDialogOpen(false)}
        character={characters.find((c) => c.id === imageTargetId) ?? null}
        comfyImageWorkflows={comfyImageWorkflows}
        onImageAttached={(image) => {
          setCharacters((prev) =>
            prev.map((c) =>
              c.id === image.characterId ? { ...c, images: [...(c.images ?? []), image] } : c,
            ),
          );
        }}
      />
    </div>
  );
}
