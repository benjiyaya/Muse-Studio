'use client';

import Link from 'next/link';
import { Users } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ProjectCharactersButtonProps {
  projectId: string;
  projectTitle: string;
}

export function ProjectCharactersButton({
  projectId,
  projectTitle,
}: ProjectCharactersButtonProps) {
  return (
    <Button
      variant="outline"
      size="sm"
      asChild
      className="ml-3 h-8 border-white/15 bg-white/5 text-xs text-muted-foreground hover:bg-violet-500/10 hover:text-violet-200 hover:border-violet-500/40"
    >
      <Link href={`/projects/${projectId}/characters`}>
        <Users className="mr-1.5 h-3.5 w-3.5" />
        Characters
      </Link>
    </Button>
  );
}

