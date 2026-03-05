'use client';

import { createContext, useContext, useState } from 'react';
import type { MuseAgent } from '@/lib/types';

export { deriveActiveMuse } from '@/lib/derive-active-muse';

// ── Context ────────────────────────────────────────────────────────────────────

interface ProjectStatusContextValue {
  activeMuse: MuseAgent;
  setActiveMuse: (muse: MuseAgent) => void;
}

const ProjectStatusContext = createContext<ProjectStatusContextValue>({
  activeMuse: 'STORY_MUSE',
  setActiveMuse: () => {},
});

export function ProjectStatusProvider({
  initialMuse,
  children,
}: {
  initialMuse: MuseAgent;
  children: React.ReactNode;
}) {
  const [activeMuse, setActiveMuse] = useState<MuseAgent>(initialMuse);
  return (
    <ProjectStatusContext.Provider value={{ activeMuse, setActiveMuse }}>
      {children}
    </ProjectStatusContext.Provider>
  );
}

export function useProjectStatus() {
  return useContext(ProjectStatusContext);
}
