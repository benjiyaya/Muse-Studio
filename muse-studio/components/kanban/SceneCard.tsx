'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Sparkles, GripVertical, ImageIcon, Video, CheckCircle2, Loader2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Scene } from '@/lib/types';

interface SceneCardProps {
  scene: Scene;
  onAskMuse?: () => void;
  onClick?: () => void;
  ctaLabel?: string;
}

function StatusIndicator({ status }: { status: Scene['status'] }) {
  if (status === 'GENERATING') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-orange-400">
        <Loader2 className="h-3 w-3 animate-spin" />
        Generating…
      </span>
    );
  }
  if (status === 'PENDING_APPROVAL') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-yellow-400">
        <Clock className="h-3 w-3" />
        Awaiting approval
      </span>
    );
  }
  if (status === 'FINAL') {
    return (
      <span className="flex items-center gap-1 text-[10px] text-emerald-400">
        <CheckCircle2 className="h-3 w-3" />
        Final
      </span>
    );
  }
  return null;
}

export function SceneCard({ scene, onAskMuse, onClick, ctaLabel }: SceneCardProps) {
  const isGenerating = scene.status === 'GENERATING';
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: scene.id,
    data: { status: scene.status },
    disabled: isGenerating,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  const approvedKeyframes = scene.keyframes.filter((k) => k.status === 'APPROVED').length;
  const totalKeyframes = scene.keyframes.length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onClick}
      className={cn(
        'group relative rounded-xl border border-white/8 bg-[oklch(0.17_0.01_264)] p-3.5 transition-all',
        'hover:border-white/15 hover:bg-[oklch(0.19_0.01_264)] hover:shadow-lg hover:shadow-black/30',
        isDragging && 'shadow-2xl shadow-violet-500/20 border-violet-500/30',
        onClick && !isGenerating && 'cursor-pointer',
      )}
    >
      {/* Drag handle */}
      <div
        {...(!isGenerating ? listeners : {})}
        {...(!isGenerating ? attributes : {})}
        suppressHydrationWarning
        className={cn(
          'absolute left-0 top-0 flex h-full w-6 items-center justify-center rounded-l-xl opacity-0 transition-opacity group-hover:opacity-100',
          isGenerating ? 'cursor-not-allowed opacity-40 group-hover:opacity-40' : 'cursor-grab active:cursor-grabbing',
        )}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/50" />
      </div>

      <div className="pl-1">
        {/* Scene number + title */}
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="shrink-0 flex h-5 w-8 items-center justify-center rounded-md bg-white/8 font-mono text-[10px] font-semibold text-muted-foreground">
              #{String(scene.sceneNumber).padStart(2, '0')}
            </span>
            <span className="text-sm font-medium leading-tight line-clamp-1">{scene.title}</span>
          </div>
        </div>

        {/* Heading */}
        <p className="mb-2 font-mono text-[10px] text-muted-foreground/70 line-clamp-1">
          {scene.heading}
        </p>

        {/* Description preview */}
        <p className="mb-3 text-xs text-muted-foreground/80 leading-relaxed line-clamp-2">
          {scene.description}
        </p>

        {/* Keyframe thumbnails */}
        {totalKeyframes > 0 && (
          <div className="mb-3 flex gap-1.5 items-center">
            {scene.keyframes.slice(0, 3).map((kf) => (
              <div
                key={kf.keyframeId}
                className="relative h-10 w-14 rounded-md bg-gradient-to-br from-violet-900/40 to-slate-900 border border-white/8 flex items-center justify-center overflow-hidden"
              >
                {kf.draftImage || kf.finalImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(kf.finalImage ?? kf.draftImage)!.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/40" />
                )}
                {kf.status === 'APPROVED' && (
                  <div className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 flex items-center justify-center">
                    <div className="h-1 w-1 rounded-full bg-white" />
                  </div>
                )}
                {kf.draftImage && kf.status !== 'APPROVED' && (
                  <div className="absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full bg-blue-400" />
                )}
              </div>
            ))}
            {totalKeyframes > 3 && (
              <span className="text-[10px] text-muted-foreground">+{totalKeyframes - 3}</span>
            )}
          </div>
        )}

        {/* Video indicator */}
        {(scene.status === 'GENERATING' || scene.status === 'PENDING_APPROVAL' || scene.status === 'FINAL') && (
          <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-white/4 border border-white/6 px-2.5 py-1.5">
            <Video className="h-3 w-3 text-muted-foreground/60" />
            {scene.videoDurationSeconds ? (
              <span className="text-[10px] text-muted-foreground">
                {scene.videoDurationSeconds}s · {scene.videoUrl ? 'Ready' : 'Processing'}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">Video draft</span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2">
          <StatusIndicator status={scene.status} />
          {totalKeyframes > 0 && scene.status !== 'FINAL' && (
            <span className="text-[10px] text-muted-foreground ml-auto">
              {approvedKeyframes}/{totalKeyframes} frames
            </span>
          )}
          {onAskMuse && scene.status !== 'GENERATING' && scene.status !== 'PENDING_APPROVAL' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                onAskMuse();
              }}
              className="h-6 shrink-0 rounded-full border border-white/8 bg-white/5 px-2 text-[10px] text-muted-foreground opacity-40 transition-opacity group-hover:opacity-100 hover:text-violet-300 hover:border-violet-500/30 hover:bg-violet-500/10"
            >
              <Sparkles className="mr-1 h-3 w-3" />
              {ctaLabel ?? 'Ask Muse'}
            </Button>
          )}
          {scene.status === 'PENDING_APPROVAL' && (
            <span className="ml-auto text-[10px] text-yellow-400/60 opacity-0 group-hover:opacity-100 transition-opacity">
              Click to review →
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
