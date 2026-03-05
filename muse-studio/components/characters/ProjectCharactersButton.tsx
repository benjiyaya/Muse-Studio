'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { Character, StorylineContent } from '@/lib/types';
import type { LLMSettings } from '@/lib/actions/settings';
import type { ComfyWorkflowSummary } from '@/lib/actions/comfyui';
import { CharacterSheetDialog } from '@/components/characters/CharacterSheetDialog';

interface ProjectCharactersButtonProps {
  projectId: string;
  projectTitle: string;
  storyline?: StorylineContent;
  llmSettings: LLMSettings;
  comfyImageWorkflows: ComfyWorkflowSummary[];
  initialCharacters: Character[];
}

export function ProjectCharactersButton({
  projectId,
  projectTitle,
  storyline,
  llmSettings,
  comfyImageWorkflows,
  initialCharacters,
}: ProjectCharactersButtonProps) {
  const [open, setOpen] = useState(false);
  const [characters, setCharacters] = useState<Character[]>(initialCharacters);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="ml-3 h-8 border-white/15 bg-white/5 text-xs text-muted-foreground hover:bg-violet-500/10 hover:text-violet-200 hover:border-violet-500/40"
        onClick={() => setOpen(true)}
      >
        <Users className="mr-1.5 h-3.5 w-3.5" />
        Characters
      </Button>

      <CharacterSheetDialog
        open={open}
        onClose={() => setOpen(false)}
        projectId={projectId}
        projectTitle={projectTitle}
        storyline={storyline}
        llmSettings={llmSettings}
        comfyImageWorkflows={comfyImageWorkflows}
        characters={characters}
        onCharactersChange={setCharacters}
      />
    </>
  );
}

