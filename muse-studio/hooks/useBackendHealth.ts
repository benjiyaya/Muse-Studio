'use client';

import { useState, useEffect, useCallback } from 'react';

export type BackendStatus = 'checking' | 'online' | 'offline';

export interface BackendHealth {
  status: BackendStatus;
  version?: string;
  modelsPathExists?: boolean;
  availableProviders?: Record<string, string[]>;
  error?: string;
}

/**
 * Polls GET /api/health on mount to determine whether the Python backend is reachable.
 * Re-check is triggered by calling `recheck()`.
 */
export function useBackendHealth(): BackendHealth & { recheck: () => void } {
  const [health, setHealth] = useState<BackendHealth>({ status: 'checking' });

  const check = useCallback(async () => {
    setHealth({ status: 'checking' });
    try {
      const res = await fetch('/api/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setHealth({
        status: 'online',
        version: data.version,
        modelsPathExists: data.models_path_exists,
        availableProviders: data.available_providers,
      });
    } catch (err) {
      setHealth({
        status: 'offline',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { ...health, recheck: check };
}
