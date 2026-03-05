'use client';

import { useState } from 'react';
import { Workflow, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ComfyWorkflowSummary } from '@/lib/actions/comfyui';
import type { Scene } from '@/lib/types';

interface ComfyWorkflowSelectDialogProps {
  open: boolean;
  kind: 'image' | 'video';
  scene: Scene | null;
  workflows: ComfyWorkflowSummary[];
  onClose: () => void;
  onSelected: (workflow: ComfyWorkflowSummary) => Promise<void>;
}

export function ComfyWorkflowSelectDialog({
  open,
  kind,
  scene,
  workflows,
  onClose,
  onSelected,
}: ComfyWorkflowSelectDialogProps) {
  const [selecting, setSelecting] = useState<string | null>(null);

  if (!open || !scene) return null;

  const kindLabel = kind === 'image' ? 'Keyframe Image' : 'Video Generation';

  async function handleSelect(workflow: ComfyWorkflowSummary) {
    setSelecting(workflow.id);
    try {
      await onSelected(workflow);
    } finally {
      setSelecting(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-[480px] max-h-[80vh] flex flex-col rounded-2xl border border-white/10 bg-[oklch(0.13_0.01_264)] shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
              <Workflow className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">Select Workflow</p>
              <p className="text-xs text-muted-foreground">{kindLabel} · {scene.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Workflow list */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {workflows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Workflow className="h-8 w-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">No {kind} workflows registered</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Go to Settings → ComfyUI to register workflows.
              </p>
            </div>
          ) : (
            workflows.map((wf) => (
              <button
                key={wf.id}
                disabled={!!selecting}
                onClick={() => handleSelect(wf)}
                className="w-full flex items-center gap-3 rounded-xl border border-white/6 bg-white/4 px-4 py-3 text-left transition-all hover:border-violet-500/30 hover:bg-violet-500/8 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400">
                  <Workflow className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{wf.name}</p>
                  {wf.description && (
                    <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{wf.description}</p>
                  )}
                </div>
                {selecting === wf.id ? (
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-transparent shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-white/8 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} className="w-full">
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}
