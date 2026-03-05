'use client';

import { useRouter } from 'next/navigation';
import { StorylineStage } from './StorylineStage';
import { confirmStoryline } from '@/lib/actions/projects';
import type { LLMSettings } from '@/lib/actions/settings';
import type { Project, StorylineContent } from '@/lib/types';

interface StorylineStageWrapperProps {
  project: Project;
  llmSettings?: LLMSettings;
}

export function StorylineStageWrapper({ project, llmSettings }: StorylineStageWrapperProps) {
  const router = useRouter();

  async function handleConfirm(storyline: StorylineContent, options?: { targetScenes: number }) {
    // Save storyline to DB and advance project stage to SCRIPT
    await confirmStoryline(project.id, storyline);
    // Navigate to same page with ?generating=scenes — the page-level overlay
    // takes over from here (avoids revalidatePath race condition)
    const params = new URLSearchParams({ generating: 'scenes' });
    const targetScenes = options?.targetScenes;
    if (targetScenes && Number.isFinite(targetScenes)) {
      params.set('targetScenes', String(targetScenes));
    }
    router.push(`/projects/${project.id}?${params.toString()}`);
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <StorylineStage project={project} onConfirm={handleConfirm} llmSettings={llmSettings} />
    </div>
  );
}
