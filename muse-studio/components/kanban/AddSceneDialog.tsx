'use client';

import { useState, useTransition } from 'react';
import { Clapperboard, Plus, X, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { createScene } from '@/lib/actions/scenes';
import { cn } from '@/lib/utils';
import type { Scene } from '@/lib/types';

interface AddSceneDialogProps {
  isOpen: boolean;
  projectId: string;
  nextSceneNumber: number;
  onClose: () => void;
  onCreated: (scene: Scene) => void;
}

const HEADING_PRESETS = [
  'INT. ',
  'EXT. ',
  'INT./EXT. ',
];

export function AddSceneDialog({
  isOpen,
  projectId,
  nextSceneNumber,
  onClose,
  onCreated,
}: AddSceneDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState('');
  const [heading, setHeading] = useState('');
  const [description, setDescription] = useState('');
  const [dialogue, setDialogue] = useState('');
  const [technicalNotes, setTechnicalNotes] = useState('');

  function reset() {
    setTitle('');
    setHeading('');
    setDescription('');
    setDialogue('');
    setTechnicalNotes('');
    setError(null);
  }

  function handleClose() {
    if (isPending) return;
    reset();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !heading.trim() || !description.trim()) return;

    setError(null);

    startTransition(async () => {
      try {
        const sceneId = await createScene({
          projectId,
          title: title.trim(),
          heading: heading.trim(),
          description: description.trim(),
          dialogue: dialogue.trim() || undefined,
          technicalNotes: technicalNotes.trim() || undefined,
        });

        const newScene: Scene = {
          id: sceneId,
          sceneNumber: nextSceneNumber,
          title: title.trim(),
          heading: heading.trim(),
          description: description.trim(),
          dialogue: dialogue.trim() || undefined,
          technicalNotes: technicalNotes.trim() || undefined,
          status: 'SCRIPT',
          keyframes: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        onCreated(newScene);
        reset();
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create scene. Please try again.');
      }
    });
  }

  if (!isOpen) return null;

  const canSubmit = title.trim() && heading.trim() && description.trim();

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      {/* Dark overlay */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Dialog panel */}
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-white/12 bg-[oklch(0.13_0.012_264)] shadow-2xl shadow-black/60 flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/20">
              <Clapperboard className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Add Scene</h2>
              <p className="text-xs text-muted-foreground/60">
                Scene #{String(nextSceneNumber).padStart(2, '0')} · Script of Scenes
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isPending}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/8 text-muted-foreground transition-colors hover:border-white/15 hover:text-foreground disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

            {/* Title */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Scene Title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. The First Confession"
                disabled={isPending}
                className={cn(
                  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm',
                  'placeholder:text-muted-foreground/40 focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/20',
                  'disabled:opacity-50 transition-colors',
                )}
              />
            </div>

            {/* Heading */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Scene Heading <span className="text-red-400">*</span>
              </label>
              {/* Quick prefix buttons */}
              <div className="mb-2 flex gap-1.5">
                {HEADING_PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setHeading(p)}
                    className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-mono text-muted-foreground/70 hover:border-violet-500/30 hover:text-violet-300 transition-colors"
                  >
                    {p.trim()}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={heading}
                onChange={(e) => setHeading(e.target.value)}
                placeholder="e.g. INT. ELISE'S OFFICE — DAY"
                disabled={isPending}
                className={cn(
                  'w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-mono',
                  'placeholder:text-muted-foreground/40 placeholder:font-sans focus:border-violet-500/50 focus:outline-none focus:ring-1 focus:ring-violet-500/20',
                  'disabled:opacity-50 transition-colors',
                )}
              />
              <p className="mt-1 text-[10px] text-muted-foreground/40">
                Standard format: INT./EXT. LOCATION — TIME OF DAY
              </p>
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Scene Description <span className="text-red-400">*</span>
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what happens in this scene — visual action, atmosphere, character beats…"
                rows={4}
                disabled={isPending}
                className="resize-none bg-white/5 border-white/10 focus:border-violet-500/50 placeholder:text-muted-foreground/40 text-sm disabled:opacity-50"
              />
            </div>

            {/* Dialogue — optional */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                Dialogue
                <span className="text-[10px] font-normal text-muted-foreground/40">(optional)</span>
              </label>
              <Textarea
                value={dialogue}
                onChange={(e) => setDialogue(e.target.value)}
                placeholder={"CHARACTER: (action) Line of dialogue.\nOTHER: Response."}
                rows={3}
                disabled={isPending}
                className="resize-none bg-white/5 border-white/10 focus:border-violet-500/50 placeholder:text-muted-foreground/40 text-sm font-mono disabled:opacity-50"
              />
            </div>

            {/* Technical Notes — optional */}
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                Technical Notes
                <span className="text-[10px] font-normal text-muted-foreground/40">(optional)</span>
              </label>
              <Textarea
                value={technicalNotes}
                onChange={(e) => setTechnicalNotes(e.target.value)}
                placeholder="Camera angles, lighting, VFX notes…"
                rows={2}
                disabled={isPending}
                className="resize-none bg-white/5 border-white/10 focus:border-violet-500/50 placeholder:text-muted-foreground/40 text-sm disabled:opacity-50"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5">
                <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300">{error}</p>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t border-white/8 px-5 py-3 shrink-0">
            <p className="text-xs text-muted-foreground/40">
              <span className="text-red-400">*</span> Required fields
            </p>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClose}
                disabled={isPending}
                className="h-8 text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!canSubmit || isPending}
                className="h-8 bg-blue-600 hover:bg-blue-500 text-xs font-medium gap-1.5 disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Creating…
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5" />
                    Create Scene
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
