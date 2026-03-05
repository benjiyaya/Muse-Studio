'use client';

import { Feather, ImagePlus, Video, Sparkles, ChevronRight } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { VisuallyHidden } from '@radix-ui/react-visually-hidden';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { Scene } from '@/lib/types';

interface SceneDetailSheetProps {
  scene: Scene | null;
  isOpen: boolean;
  onClose: () => void;
  onAskMuse?: () => void;
}

const STATUS_LABELS: Record<Scene['status'], string> = {
  SCRIPT: 'Script',
  KEYFRAME: 'Keyframe Creation',
  DRAFT_QUEUE: 'Draft Queue',
  GENERATING: 'Generating',
  PENDING_APPROVAL: 'Awaiting Approval',
  FINAL: 'Final',
};

export function SceneDetailSheet({ scene, isOpen, onClose, onAskMuse }: SceneDetailSheetProps) {
  if (!scene) return null;

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="right"
        className="w-full max-w-md border-white/8 bg-[oklch(0.11_0.01_264)] p-0 flex flex-col"
      >
        <SheetHeader className="border-b border-white/8 px-5 py-4">
          <VisuallyHidden><SheetTitle>Scene Detail</SheetTitle></VisuallyHidden>
          <VisuallyHidden><SheetDescription>Scene script, keyframes, and actions</SheetDescription></VisuallyHidden>
          <div className="min-w-0 pr-8">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex h-5 w-8 items-center justify-center rounded-md bg-white/8 font-mono text-[10px] font-semibold text-muted-foreground">
                #{String(scene.sceneNumber).padStart(2, '0')}
              </span>
              <span className="rounded-full bg-white/6 border border-white/8 px-2 py-0.5 text-[10px] text-muted-foreground">
                {STATUS_LABELS[scene.status]}
              </span>
            </div>
            <h2 className="font-semibold text-base leading-tight">{scene.title}</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{scene.heading}</p>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
          {/* Action buttons */}
          <div className="flex gap-2 px-5 py-3 border-b border-white/6">
            <Button
              onClick={onAskMuse}
              size="sm"
              className="flex-1 h-8 bg-violet-600 hover:bg-violet-500 text-xs gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Ask Muse
            </Button>
            {(scene.status === 'SCRIPT' || scene.status === 'KEYFRAME') && (
              <Button variant="outline" size="sm" className="flex-1 h-8 border-white/10 bg-white/5 text-xs gap-1.5 hover:bg-white/8">
                <ImagePlus className="h-3.5 w-3.5" />
                Add Keyframe
              </Button>
            )}
            {scene.status === 'KEYFRAME' && (
              <Button variant="outline" size="sm" className="flex-1 h-8 border-white/10 bg-white/5 text-xs gap-1.5 hover:bg-white/8">
                <Video className="h-3.5 w-3.5" />
                Generate Video
              </Button>
            )}
          </div>

          {/* Script content */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <Feather className="h-3.5 w-3.5 text-violet-400" />
              <span className="text-xs font-semibold text-violet-400 uppercase tracking-wide">
                Scene Script
              </span>
            </div>

            <div className="rounded-xl border border-white/8 bg-white/3 p-4 space-y-3">
              <div>
                <p className="font-mono text-xs font-semibold text-muted-foreground mb-1.5 uppercase">
                  {scene.heading}
                </p>
                <p className="text-sm leading-relaxed text-foreground/80">{scene.description}</p>
              </div>

              {scene.dialogue && (
                <>
                  <Separator className="bg-white/6" />
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Dialogue
                    </p>
                    <pre className="font-mono text-xs leading-relaxed text-foreground/70 whitespace-pre-wrap">
                      {scene.dialogue}
                    </pre>
                  </div>
                </>
              )}

              {scene.technicalNotes && (
                <>
                  <Separator className="bg-white/6" />
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                      Technical Notes
                    </p>
                    <p className="text-xs text-muted-foreground">{scene.technicalNotes}</p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Keyframes */}
          {scene.keyframes.length > 0 && (
            <div className="px-5 pb-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
                  Keyframes ({scene.keyframes.length})
                </span>
                <Button variant="ghost" size="sm" className="h-6 text-[10px] text-muted-foreground gap-1 hover:text-foreground px-2">
                  View all <ChevronRight className="h-3 w-3" />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {scene.keyframes.map((kf) => (
                  <div
                    key={kf.keyframeId}
                    className="relative aspect-video rounded-lg border border-white/8 bg-gradient-to-br from-violet-900/30 to-slate-900 flex items-center justify-center overflow-hidden"
                  >
                    <ImagePlus className="h-4 w-4 text-muted-foreground/30" />
                    <div className="absolute bottom-1 left-1 right-1 flex items-center justify-between">
                      <span className="text-[8px] text-muted-foreground/60 font-mono">
                        #{kf.sequenceOrder}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-1 py-0.5 text-[8px] font-medium',
                          kf.status === 'APPROVED'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : kf.status === 'REFINING'
                            ? 'bg-amber-500/20 text-amber-400'
                            : 'bg-white/10 text-muted-foreground',
                        )}
                      >
                        {kf.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
