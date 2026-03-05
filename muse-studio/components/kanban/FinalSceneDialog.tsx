'use client';

import { X, Video, ImageIcon, FileText } from 'lucide-react';
import { useRef } from 'react';
import type { Scene } from '@/lib/types';
import { cn } from '@/lib/utils';

interface FinalSceneDialogProps {
  isOpen: boolean;
  scene: Scene | null;
  onClose: () => void;
}

export function FinalSceneDialog({ isOpen, scene, onClose }: FinalSceneDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  if (!isOpen || !scene) return null;

  const approved = scene.keyframes.find((k) => k.status === 'APPROVED' && (k.finalImage || k.draftImage));
  const fallbackKf = scene.keyframes.find((k) => k.finalImage || k.draftImage);
  const keyframeImage = (approved ?? fallbackKf)?.finalImage ?? (approved ?? fallbackKf)?.draftImage;
  const prompt =
    (approved ?? fallbackKf)?.generationParams.prompt ??
    scene.description;

  const videoUrl = scene.videoUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div className="relative z-10 flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[oklch(0.13_0.01_264)] shadow-2xl shadow-black/60">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 border border-emerald-500/25">
              <Video className="h-4 w-4 text-emerald-400" />
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
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/8 text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Main content: split layout for video + details */}
        <div className="flex flex-1 flex-col md:flex-row border-b border-white/6">
          {/* Video area */}
          <div className="md:w-2/3 border-b md:border-b-0 md:border-r border-white/6 bg-black/40 flex items-center justify-center">
            {videoUrl ? (
              // eslint-disable-next-line jsx-a11y/media-has-caption
              <video
                ref={videoRef}
                src={videoUrl}
                className="h-full w-full object-contain"
                controls
                loop
                playsInline
              />
            ) : (
              <div className="flex flex-col items-center gap-3 text-muted-foreground/40 py-12">
                <Video className="h-10 w-10" />
                <span className="text-xs">No final video available</span>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="md:w-1/3 flex flex-col overflow-y-auto">
            {/* Keyframe image */}
            <div className="border-b border-white/6 p-4">
              <div className="flex items-center gap-2 mb-2">
                <ImageIcon className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span className="text-xs font-semibold text-muted-foreground/80">Keyframe image</span>
              </div>
              <div className="rounded-lg border border-white/8 bg-black/40 flex items-center justify-center overflow-hidden min-h-[120px]">
                {keyframeImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={keyframeImage.url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[11px] text-muted-foreground/50 px-3 text-center">
                    No keyframe image available for this scene.
                  </span>
                )}
              </div>
            </div>

            {/* Text prompt */}
            <div className="border-b border-white/6 p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span className="text-xs font-semibold text-muted-foreground/80">Image / video prompt</span>
              </div>
              <p className="text-[11px] text-muted-foreground/80 whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed">
                {prompt ?? 'No prompt recorded for this scene.'}
              </p>
            </div>

            {/* Scene description */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <FileText className="h-3.5 w-3.5 text-muted-foreground/70" />
                <span className="text-xs font-semibold text-muted-foreground/80">Scene description</span>
              </div>
              <p className="text-[11px] text-muted-foreground/80 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                {scene.description}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

