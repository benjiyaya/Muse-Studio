'use client';

import { useDroppable } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SceneCard } from './SceneCard';
import { MuseBadge } from '@/components/muse/MuseBadge';
import { Button } from '@/components/ui/button';
import type { KanbanColumnConfig } from '@/lib/constants';
import type { Scene } from '@/lib/types';

interface KanbanColumnProps {
  column: KanbanColumnConfig;
  scenes: Scene[];
  onAskMuse?: (scene: Scene) => void;
  onAddScene?: () => void;
  onOpenKeyframe?: (scene: Scene) => void;
  onOpenVideoGenerate?: (scene: Scene) => void;
  onOpenVideoReview?: (scene: Scene) => void;
  onOpenFinalScene?: (scene: Scene) => void;
}

export function KanbanColumn({
  column,
  scenes,
  onAskMuse,
  onAddScene,
  onOpenKeyframe,
  onOpenVideoGenerate,
  onOpenVideoReview,
  onOpenFinalScene,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const isScript = column.id === 'SCRIPT';
  const isKeyframe = column.id === 'KEYFRAME';
  const isDraftQueue = column.id === 'DRAFT_QUEUE';
  const isPendingApproval = column.id === 'PENDING_APPROVAL';
  const isFinal = column.id === 'FINAL';

  return (
    <div className="flex w-[288px] shrink-0 flex-col rounded-2xl border border-white/8 bg-[oklch(0.11_0.01_264)] overflow-hidden">
      {/* Column header with color accent */}
      <div className={cn('border-t-2', column.borderTopClass)}>
        <div className="flex items-center justify-between px-3.5 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className={cn('h-2 w-2 shrink-0 rounded-full', column.dotClass)} />
            <span className="text-xs font-semibold leading-tight truncate">{column.label}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {column.muse && <MuseBadge muse={column.muse} size="sm" showName={false} />}
            <span
              className={cn(
                'flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
                column.badgeBg,
                column.badgeText,
              )}
            >
              {scenes.length}
            </span>
            {/* Add Scene button — top of header, SCRIPT column only */}
            {isScript && (
              <button
                onClick={onAddScene}
                title="Add Scene"
                className="flex h-6 w-6 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-muted-foreground transition-colors hover:border-violet-500/40 hover:bg-violet-500/10 hover:text-violet-300"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Droppable area */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex flex-1 flex-col gap-2.5 overflow-y-auto p-3 min-h-[200px] transition-colors',
          isOver && 'bg-violet-500/5 ring-1 ring-inset ring-violet-500/20',
        )}
      >
        {scenes.length === 0 ? (
          <div
            className={cn(
              'flex flex-1 items-center justify-center rounded-xl border-2 border-dashed py-8 transition-colors',
              isOver ? 'border-violet-500/40 bg-violet-500/5' : 'border-white/6',
            )}
          >
            <p className="text-xs text-muted-foreground/50 text-center px-4">
              {isOver ? 'Drop scene here' : 'No scenes yet'}
            </p>
          </div>
        ) : (
          scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              onAskMuse={
                isPendingApproval || isFinal
                  ? undefined
                  : isKeyframe
                  ? () => onOpenKeyframe?.(scene)
                  : isDraftQueue
                  ? () => onOpenVideoGenerate?.(scene)
                  : () => onAskMuse?.(scene)
              }
              onClick={
                isPendingApproval
                  ? () => onOpenVideoReview?.(scene)
                  : isKeyframe
                  ? () => onOpenKeyframe?.(scene)
                  : isDraftQueue
                  ? () => onOpenVideoGenerate?.(scene)
                  : isFinal
                  ? () => onOpenFinalScene?.(scene)
                  : undefined
              }
              ctaLabel={
                isKeyframe ? 'Create Image frame' : isDraftQueue ? 'Create Video' : 'Ask Muse'
              }
            />
          ))
        )}
      </div>

      {/* Add scene button — bottom of SCRIPT column */}
      {isScript && (
        <div className="border-t border-white/6 p-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onAddScene}
            className="w-full h-8 rounded-xl text-xs text-muted-foreground hover:text-foreground hover:bg-white/8 gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Scene
          </Button>
        </div>
      )}
    </div>
  );
}
