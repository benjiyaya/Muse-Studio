'use client';

import { useState, useEffect, useCallback } from 'react';
import type { MuseAgent } from '@/lib/types';

interface AskMuseState {
  isOpen: boolean;
  defaultMuse?: MuseAgent;
  context?: {
    sceneId?: string;
    sceneTitle?: string;
    stage?: string;
  };
}

let globalSetState: ((state: AskMuseState) => void) | null = null;

export function useAskMuse() {
  const [state, setState] = useState<AskMuseState>({ isOpen: false });

  useEffect(() => {
    globalSetState = setState;
    return () => {
      globalSetState = null;
    };
  }, []);

  const open = useCallback((opts?: Omit<AskMuseState, 'isOpen'>) => {
    setState({ isOpen: true, ...opts });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'm') {
        e.preventDefault();
        setState((prev) => ({ ...prev, isOpen: !prev.isOpen }));
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { ...state, open, close };
}

export function openAskMuse(opts?: Omit<AskMuseState, 'isOpen'>) {
  globalSetState?.({ isOpen: true, ...opts });
}
