'use client';

import { useState, useTransition } from 'react';
import { X, User, Sparkles, Loader2, FileImage, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { Character, StorylineContent } from '@/lib/types';
import type { LLMSettings } from '@/lib/actions/settings';
import type { ComfyWorkflowSummary } from '@/lib/actions/comfyui';
import { cn } from '@/lib/utils';
import { useStoryMuse } from '@/hooks/useStoryMuse';
import { createCharacter, updateCharacter } from '@/lib/actions/characters';
import { CharacterComfyGenerateDialog } from '@/components/characters/CharacterComfyGenerateDialog';

interface CharacterSheetDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectTitle: string;
  storyline?: StorylineContent;
  llmSettings: LLMSettings;
  comfyImageWorkflows: ComfyWorkflowSummary[];
  characters: Character[];
  onCharactersChange: (next: Character[]) => void;
}

export function CharacterSheetDialog({
  open,
  onClose,
  projectId,
  projectTitle,
  storyline,
  llmSettings,
  comfyImageWorkflows,
  characters,
  onCharactersChange,
}: CharacterSheetDialogProps) {
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

  if (!open) return null;

  function resetForm() {
    setName('');
    setPrimaryRole('');
    setShortBio('');
    setDesignNotes('');
    setError(null);
  }

  function handleDialogClose() {
    if (isPending || storyMuse.isGenerating) return;
    resetForm();
    onClose();
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
        onCharactersChange([...characters, created]);
        resetForm();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create character.');
      }
    });
  }

  async function handleGeneratePrompt(char: Character) {
    if (promptPendingId) return;
    setPromptPendingId(char.id);

    const pieces: string[] = [];
    pieces.push(`Create a single rich visual description for this film character that can be used as an AI image prompt.`);
    pieces.push('');
    pieces.push(`Character name: ${char.name}`);
    if (char.primaryRole) pieces.push(`Role: ${char.primaryRole}`);
    if (char.shortBio) pieces.push(`Short bio: ${char.shortBio}`);
    if (char.designNotes) pieces.push(`Design notes: ${char.designNotes}`);
    if (storyline?.logline) pieces.push(`Story logline: ${storyline.logline}`);
    if (storyline?.genre) pieces.push(`Genre: ${storyline.genre}`);
    if (storyline?.themes?.length) pieces.push(`Themes: ${storyline.themes.join(', ')}`);

    const prompt = pieces.join('\n');

    const { text, error } = await storyMuse.generate({
      task: 'visual_keyframe_prompt',
      prompt,
      projectId,
      providerId: llmSettings.llmProvider,
      ollamaBaseUrl: llmSettings.ollamaBaseUrl,
      ollamaModel: llmSettings.ollamaModel,
      openaiModel: llmSettings.openaiModel,
      claudeModel: llmSettings.claudeModel,
      maxTokens: 512,
      temperature: 0.8,
    });

    if (error) {
      setError(error);
      setPromptPendingId(null);
      return;
    }

    const nextCharacters = characters.map((c) =>
      c.id === char.id ? { ...c, promptPositive: text.trim() } : c,
    );
    onCharactersChange(nextCharacters);

    // Persist promptPositive on the server
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDialogClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div className="relative z-10 flex h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[oklch(0.13_0.012_264)] shadow-2xl shadow-black/70">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20">
              <User className="h-4 w-4 text-violet-300" />
            </div>
            <div>
              <p className="text-sm font-semibold">
                Characters · <span className="text-violet-300">{projectTitle}</span>
              </p>
              <p className="text-xs text-muted-foreground/70">
                Define main characters, generate visual prompts, and prepare reference images.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDialogClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 text-muted-foreground transition-colors hover:border-white/20 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 min-h-0 divide-x divide-white/10">
          {/* Left: create new character */}
          <div className="w-80 shrink-0 border-r border-white/8 bg-white/2 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
              New Character
            </p>
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
                className="mt-1 h-8 w-full gap-1.5 bg-violet-600 text-xs hover:bg-violet-500"
              >
                {isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                Add Character
              </Button>
            </form>
          </div>

          {/* Right: character list */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {characters.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center text-xs text-muted-foreground/70">
                <FileImage className="mb-2 h-6 w-6 text-muted-foreground/40" />
                <p className="font-medium text-foreground/80">No characters yet</p>
                <p className="mt-1 max-w-xs">
                  Create 2–5 main characters for this project, then generate visual prompts and reference images for consistent casting.
                </p>
              </div>
            ) : (
              characters.map((char) => {
                const pendingPrompt = promptPendingId === char.id || storyMuse.isGenerating;
                return (
                  <div
                    key={char.id}
                    className="rounded-xl border border-white/10 bg-white/3 px-4 py-3 flex flex-col gap-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">
                          {char.name}
                          {char.primaryRole && (
                            <span className="ml-1.5 text-[11px] font-normal text-muted-foreground/70">
                              · {char.primaryRole}
                            </span>
                          )}
                        </p>
                        {char.shortBio && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground/80 line-clamp-2">
                            {char.shortBio}
                          </p>
                        )}
                      </div>

                      {comfyImageWorkflows.length > 0 && (
                        <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-1">
                          <Workflow className="h-3 w-3 text-violet-300" />
                          <span className="text-[10px] text-muted-foreground/70">
                            Image workflows ready
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="mt-1 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-muted-foreground/80">
                          Visual prompt (for Flux 2 Klein / Qwen Edit)
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="xs"
                          disabled={pendingPrompt}
                          onClick={() => handleGeneratePrompt(char)}
                          className="h-7 gap-1 rounded-full border-violet-500/40 bg-violet-500/10 text-[11px] text-violet-100 hover:bg-violet-500/20"
                        >
                          {pendingPrompt ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Sparkles className="h-3 w-3" />
                          )}
                          Muse prompt
                        </Button>
                      </div>

                      <Textarea
                        value={char.promptPositive ?? ''}
                        onChange={(e) => {
                          const next = characters.map((c) =>
                            c.id === char.id ? { ...c, promptPositive: e.target.value } : c,
                          );
                          onCharactersChange(next);
                        }}
                        rows={4}
                        placeholder="Use Story Muse to draft a rich visual description, then tweak as needed."
                        className="resize-none bg-black/20 border-white/10 text-xs placeholder:text-muted-foreground/40"
                      />
                    </div>

                    {/* Character reference images */}
                    {char.images && char.images.length > 0 && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[11px] font-medium text-muted-foreground/75">
                          Reference images
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {char.images.map((img) => (
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
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground/70">
                          Generate character sheet image with ComfyUI.
                        </p>
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          className="h-7 rounded-full border-violet-500/40 bg-violet-500/10 text-[11px] text-violet-100 hover:bg-violet-500/20"
                          disabled={!char.promptPositive?.trim()}
                          onClick={() => {
                            setImageTargetId(char.id);
                            setImageDialogOpen(true);
                          }}
                        >
                          <FileImage className="mr-1 h-3 w-3" />
                          Generate image
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <CharacterComfyGenerateDialog
        open={imageDialogOpen}
        onClose={() => setImageDialogOpen(false)}
        character={characters.find((c) => c.id === imageTargetId) ?? null}
        comfyImageWorkflows={comfyImageWorkflows}
        onImageAttached={(image) => {
          const charId = image.characterId;
          const next = characters.map((c) =>
            c.id === charId ? { ...c, images: [...(c.images ?? []), image] } : c,
          );
          onCharactersChange(next);
        }}
      />
    </div>
  );
}

