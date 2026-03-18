'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  X,
  CheckCircle2,
  RefreshCw,
  ImageIcon,
  Play,
  Pause,
  Video,
  RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Scene, KanbanStatus } from '@/lib/types';
import {
  approveSceneVideo,
  clearSceneVideo,
  clearSceneVideoAndKeyframes,
} from '@/lib/actions/scenes';

interface VideoReviewDialogProps {
  isOpen: boolean;
  scene: Scene | null;
  onClose: () => void;
  onSceneUpdated: (sceneId: string, status: KanbanStatus, clearVideo?: boolean, clearKeyframes?: boolean) => void;
}

type ActionPhase = 'idle' | 'approving' | 'redoing' | 'recreating';

export function VideoReviewDialog({
  isOpen,
  scene,
  onClose,
  onSceneUpdated,
}: VideoReviewDialogProps) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<ActionPhase>('idle');
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoLoadError, setVideoLoadError] = useState(false);

  const videoUrl = scene?.videoUrl ?? null;
  const busy = phase !== 'idle';

  useEffect(() => {
    setVideoLoadError(false);
    setIsPlaying(false);
  }, [videoUrl]);

  if (!isOpen || !scene) return null;

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  }

  async function handleApprove() {
    if (!scene || busy) return;
    setPhase('approving');
    try {
      await approveSceneVideo(scene.id);
      onSceneUpdated(scene.id, 'FINAL');
      router.refresh();
      toast.success('Scene approved', {
        description: `Scene #${String(scene.sceneNumber).padStart(2, '0')} — ${scene.title} is now Final.`,
      });
      onClose();
    } catch {
      toast.error('Failed to approve scene');
    } finally {
      setPhase('idle');
    }
  }

  async function handleRedoVideo() {
    if (!scene || busy) return;
    setPhase('redoing');
    try {
      await clearSceneVideo(scene.id);
      onSceneUpdated(scene.id, 'DRAFT_QUEUE', true, false);
      router.refresh();
      toast('Video cleared', {
        description: 'Scene moved back to Video Draft Queue. Generate a new video.',
        duration: 5000,
      });
      onClose();
    } catch {
      toast.error('Failed to reset video');
    } finally {
      setPhase('idle');
    }
  }

  async function handleRecreateKeyframe() {
    if (!scene || busy) return;
    setPhase('recreating');
    try {
      await clearSceneVideoAndKeyframes(scene.id);
      onSceneUpdated(scene.id, 'KEYFRAME', true, true);
      router.refresh();
      toast('Keyframes cleared', {
        description: 'Scene moved back to Keyframe Creation. Recreate your reference images.',
        duration: 5000,
      });
      onClose();
    } catch {
      toast.error('Failed to reset keyframes');
    } finally {
      setPhase('idle');
    }
  }

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-white/10 bg-[oklch(0.13_0.01_264)] shadow-2xl shadow-black/60 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-yellow-500/15 border border-yellow-500/20">
              <Video className="h-4 w-4 text-yellow-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="shrink-0 flex h-5 w-8 items-center justify-center rounded-md bg-white/8 font-mono text-[10px] font-semibold text-muted-foreground">
                  #{String(scene.sceneNumber).padStart(2, '0')}
                </span>
                <h2 className="text-sm font-semibold truncate">{scene.title}</h2>
              </div>
              <p className="font-mono text-[10px] text-muted-foreground/60 truncate mt-0.5">
                {scene.heading}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/8 text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground disabled:opacity-40"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Video preview area */}
        <div className="relative bg-black/40 flex items-center justify-center" style={{ aspectRatio: '16/9' }}>
          {videoUrl ? (
            <>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                ref={videoRef}
                src={videoUrl}
                className="h-full w-full object-contain"
                loop
                playsInline
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
                onError={() => {
                  if (videoLoadError) return;
                  setVideoLoadError(true);
                  toast.error('Video failed to load', {
                    description: 'The output file may be missing or corrupted. Try "Redo Video".',
                  });
                }}
              />
              {/* Play/pause overlay */}
              <button
                onClick={togglePlay}
                className={cn(
                  'absolute inset-0 flex items-center justify-center transition-opacity',
                  isPlaying ? 'opacity-0 hover:opacity-100' : 'opacity-100',
                )}
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/60 border border-white/20 backdrop-blur-sm transition-transform hover:scale-110">
                  {isPlaying ? (
                    <Pause className="h-6 w-6 text-white" />
                  ) : (
                    <Play className="ml-1 h-6 w-6 text-white" />
                  )}
                </div>
              </button>
              {videoLoadError ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 p-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Video couldn&apos;t be decoded. Try generating again.
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex flex-col items-center gap-3 text-muted-foreground/40">
              <Video className="h-10 w-10" />
              <span className="text-xs">No video available</span>
            </div>
          )}
        </div>

        {/* Scene description */}
        <div className="px-5 py-3 border-b border-white/6">
          <p className="text-xs text-muted-foreground/70 leading-relaxed line-clamp-2">
            {scene.description}
          </p>
        </div>

        {/* Action buttons */}
        <div className="px-5 py-4 flex flex-col gap-3">
          {/* Approve */}
          <Button
            onClick={handleApprove}
            disabled={busy || !videoUrl}
            className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white border-0 font-medium text-sm gap-2 disabled:opacity-40"
          >
            {phase === 'approving' ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Approve
          </Button>

          <div className="grid grid-cols-2 gap-3">
            {/* Redo Video */}
            <Button
              onClick={handleRedoVideo}
              disabled={busy}
              variant="outline"
              className="h-10 rounded-xl border-orange-500/30 bg-orange-500/8 text-orange-300 hover:bg-orange-500/15 hover:border-orange-500/50 hover:text-orange-200 font-medium text-sm gap-2 disabled:opacity-40"
            >
              {phase === 'redoing' ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCcw className="h-4 w-4" />
              )}
              Redo Video
            </Button>

            {/* Recreate Keyframe */}
            <Button
              onClick={handleRecreateKeyframe}
              disabled={busy}
              variant="outline"
              className="h-10 rounded-xl border-red-500/30 bg-red-500/8 text-red-300 hover:bg-red-500/15 hover:border-red-500/50 hover:text-red-200 font-medium text-sm gap-2 disabled:opacity-40"
            >
              {phase === 'recreating' ? (
                <RefreshCw className="h-4 w-4 animate-spin" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
              Recreate Keyframe
            </Button>
          </div>

          {/* Hint text */}
          <p className="text-center text-[10px] text-muted-foreground/40 leading-relaxed">
            <span className="text-orange-400/70">Redo</span> keeps keyframes, regenerates video with a new seed.{' '}
            <span className="text-red-400/70">Recreate Keyframe</span> deletes video and all reference images.
          </p>
        </div>
      </div>
    </div>
  );
}
