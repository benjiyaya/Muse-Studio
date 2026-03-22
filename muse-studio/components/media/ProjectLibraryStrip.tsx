'use client';

import { useEffect, useState } from 'react';
import {
  listProjectMediaLibrary,
  type MediaLibraryItem,
} from '@/lib/actions/projectMediaLibrary';

interface ProjectLibraryStripProps {
  projectId: string;
  filter: 'image' | 'video' | 'all';
  onPick: (item: MediaLibraryItem) => void;
  className?: string;
}

export function ProjectLibraryStrip({
  projectId,
  filter,
  onPick,
  className,
}: ProjectLibraryStripProps) {
  const [items, setItems] = useState<MediaLibraryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const all = await listProjectMediaLibrary(projectId);
        if (cancelled) return;
        const f =
          filter === 'all' ? all : all.filter((i) => i.kind === filter);
        setItems(f.slice(0, 32));
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, filter]);

  if (loading) {
    return (
      <p className="text-[10px] text-muted-foreground/70">Loading project library…</p>
    );
  }
  if (items.length === 0) {
    return (
      <p className="text-[10px] text-muted-foreground/50">
        No images or videos in this project library yet. Generate in the playground with this project
        selected, or promote assets here.
      </p>
    );
  }

  return (
    <div className={className}>
      <p className="mb-1 text-[10px] text-muted-foreground/50">From project library:</p>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
        {items.map((item) => (
          <button
            key={item.path}
            type="button"
            onClick={() => onPick(item)}
            title={item.path}
            className="h-10 w-10 shrink-0 overflow-hidden rounded-md border border-white/10 transition-colors hover:border-violet-500/40"
          >
            {item.kind === 'image' ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={`/api/outputs/${item.path}`}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-black/40 text-[8px] text-muted-foreground">
                VID
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
