'use client';

import { useState } from 'react';
import { Sparkles, Plus, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { createProject } from '@/lib/actions/projects';
import { CONTROL_LEVEL_CONFIG } from '@/lib/constants';
import type { MuseControlLevel } from '@/lib/types';

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the new project ID after successful creation. */
  onCreated?: (id: string) => void;
}

export function NewProjectDialog({ open, onClose, onCreated }: NewProjectDialogProps) {
  const [title, setTitle]             = useState('');
  const [description, setDescription] = useState('');
  const [controlLevel, setControlLevel] = useState<MuseControlLevel>('ASSISTANT');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  async function handleCreate() {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const project = await createProject({
        title: title.trim(),
        description: description.trim() || undefined,
        // Default to Muse-generated storyline; user can still choose manual
        // inside the full Storyline stage after project creation.
        storylineSource: 'MUSE_GENERATED',
        museControlLevel: controlLevel,
      });
      handleReset();
      onCreated?.(project.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setTitle('');
    setDescription('');
    setControlLevel('ASSISTANT');
    setError(null);
  }

  function handleClose() {
    handleReset();
    onClose();
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[1024px] max-w-[1200px] h-[60vh] max-h-[700px] border-white/10 bg-[oklch(0.13_0.012_264)] p-0 overflow-hidden">
        <DialogHeader className="border-b border-white/8 px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/20">
              <Plus className="h-4 w-4 text-violet-400" />
            </span>
            New Project
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">Project details</p>
        </DialogHeader>

        <div className="p-6">
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Project Title <span className="text-violet-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && title.trim() && handleCreate()}
                placeholder="e.g. Neon Requiem"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm placeholder:text-muted-foreground/50 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-colors"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Brief Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this film about? (optional)"
                rows={3}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm placeholder:text-muted-foreground/50 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-colors"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Muse Control Level
              </label>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Controls how proactively Muse suggests changes for this project.
              </p>
              <div className="grid grid-cols-3 gap-2 sm:max-w-xs mb-2">
                {(Object.keys(CONTROL_LEVEL_CONFIG) as MuseControlLevel[]).map((level) => {
                  const active = level === controlLevel;
                  const { label } = CONTROL_LEVEL_CONFIG[level];
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setControlLevel(level)}
                      className={cn(
                        'rounded-xl border px-2 py-1.5 text-xs font-medium transition-all',
                        active
                          ? 'border-violet-500/60 bg-violet-500/15 text-violet-200'
                          : 'border-white/10 bg-white/5 text-muted-foreground hover:border-white/20 hover:bg-white/8',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <ul className="ml-4 mt-1 list-disc space-y-0.5 text-[11px] text-muted-foreground">
                <li>
                  <span className="font-medium text-foreground/80">Observer</span> — monitors only, helps you
                  keep logs of your project.
                </li>
                <li>
                  <span className="font-medium text-foreground/80">Assistant</span> — suggests on request,
                  semi-autonomous.
                </li>
                <li>
                  <span className="font-medium text-foreground/80">Collaborator</span> — auto-generates, most
                  hands-off option for fully autonomous projects.
                </li>
              </ul>
            </div>
            {error && (
              <p className="text-xs text-red-400 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
                {error}
              </p>
            )}
            <Button
              className="w-full bg-violet-600 hover:bg-violet-500 font-medium gap-2"
              disabled={!title.trim() || saving}
              onClick={handleCreate}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Create Project
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
