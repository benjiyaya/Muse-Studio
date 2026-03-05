'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Film, ImageIcon, FileText, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STAGE_CONFIG } from '@/lib/constants';
import type { Project } from '@/lib/types';
import { deriveProjectStage } from '@/lib/derive-project-stage';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { deleteProjectAndAssets } from '@/lib/actions/projects';

interface ProjectCardProps {
  project: Project;
}

const STAGE_ICONS = {
  STORYLINE: FileText,
  SCRIPT: FileText,
  KEYFRAME_VIDEO: Film,
};

const THUMBNAIL_GRADIENTS = [
  'from-violet-900/60 via-slate-900 to-slate-950',
  'from-blue-900/60 via-slate-900 to-slate-950',
  'from-amber-900/60 via-slate-900 to-slate-950',
  'from-rose-900/60 via-slate-900 to-slate-950',
  'from-cyan-900/60 via-slate-900 to-slate-950',
];

function getGradient(id: string): string {
  const index = id.charCodeAt(id.length - 1) % THUMBNAIL_GRADIENTS.length;
  return THUMBNAIL_GRADIENTS[index];
}

// Date objects are serialized to strings when crossing the server→client boundary,
// so we accept both types and normalize before formatting.
function formatDate(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const derivedStage = deriveProjectStage({
    currentStage: project.currentStage,
    storylineConfirmed: project.storylineConfirmed,
    scenes: project.scenes,
  });
  const stageConfig = STAGE_CONFIG[derivedStage];
  const StageIcon = STAGE_ICONS[derivedStage];
  const gradient = getGradient(project.id);
  const finalScenes = project.scenes.filter((s) => s.status === 'FINAL').length;
  const totalScenes = project.scenes.length;

  async function handleConfirmDelete() {
    setIsDeleting(true);
    try {
      await deleteProjectAndAssets(project.id);
      setConfirmOpen(false);
      router.refresh();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('Failed to delete project', err);
      // Keep dialog open so user can try again or cancel
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      <Link href={`/projects/${project.id}`} className="group block" suppressHydrationWarning>
        <div className="relative overflow-hidden rounded-2xl border border-white/8 bg-[oklch(0.13_0.012_264)] transition-all duration-300 hover:border-white/15 hover:shadow-2xl hover:shadow-violet-500/5 hover:-translate-y-0.5">
          {/* Thumbnail */}
          <div className={cn('relative h-40 bg-gradient-to-br', gradient)}>
            <div className="absolute inset-0 flex items-center justify-center opacity-20">
              <Film className="h-16 w-16 text-white" />
            </div>
            {/* Stage badge overlay */}
            <div className="absolute top-3 left-3">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium backdrop-blur-sm',
                  stageConfig.bgClass,
                  stageConfig.textClass,
                  stageConfig.borderClass,
                )}
              >
                <StageIcon className="h-3 w-3" />
                Stage {stageConfig.step} · {stageConfig.label}
              </span>
            </div>
            {/* Delete button */}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setConfirmOpen(true);
              }}
              className="absolute top-3 right-3 inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-500/40 bg-red-500/20 text-red-200 opacity-0 transition-opacity hover:bg-red-500/30 hover:border-red-400 group-hover:opacity-100"
              aria-label="Delete project"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            {/* Arrow on hover */}
            <div className="absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 opacity-0 transition-opacity group-hover:opacity-100 backdrop-blur-sm">
              <ArrowRight className="h-4 w-4 text-white" />
            </div>
          </div>

          {/* Content */}
          <div className="p-4">
            <div className="mb-1">
              <h3 className="font-semibold text-base leading-tight group-hover:text-violet-300 transition-colors line-clamp-1">
                {project.title}
              </h3>
            </div>

            {project.storyline?.logline && (
              <p className="mb-3 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {project.storyline.logline}
              </p>
            )}

            {!project.storyline?.logline && project.description && (
              <p className="mb-3 text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {project.description}
              </p>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-white/6 pt-3">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <ImageIcon className="h-3 w-3" />
                  {totalScenes} scenes
                </span>
                {totalScenes > 0 && (
                  <span className="text-xs text-emerald-400">
                    {finalScenes}/{totalScenes} final
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground/60" suppressHydrationWarning>
                {formatDate(project.updatedAt)}
              </span>
            </div>
          </div>
        </div>
      </Link>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              This will permanently delete the project, its scenes, Muse suggestions, chat history,
              and generated media (images and videos) associated with this project. This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting…' : 'Delete project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
