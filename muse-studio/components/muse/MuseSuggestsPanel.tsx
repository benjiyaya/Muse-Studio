'use client';

import { useState } from 'react';
import { Bell, ChevronRight, Feather, Palette, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { MUSE_CONFIG, SUGGESTION_TYPE_CONFIG } from '@/lib/constants';
import type { MuseSuggestion, MuseAgent, SuggestionAction } from '@/lib/types';

interface MuseSuggestsPanelProps {
  suggestions: MuseSuggestion[];
  onDismiss?: (id: string) => void;
  onAction?: (id: string, action: SuggestionAction) => void;
  onRefresh?: () => Promise<void>;
}

const MUSE_ICONS: Record<MuseAgent, React.ElementType> = {
  STORY_MUSE: Feather,
  VISUAL_MUSE: Palette,
  MOTION_MUSE: Film,
};

const ACTION_LABELS: Record<SuggestionAction, string> = {
  REVIEW: 'Review',
  FIX: 'Fix',
  PREVIEW: 'Preview',
  ACCEPT: 'Accept',
  EDIT: 'Edit',
  DISMISS: 'Dismiss',
  VIEW_DETAILS: 'View Details',
  ADJUST: 'Adjust',
};

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function MuseSuggestsPanel({
  suggestions,
  onDismiss,
  onAction,
  onRefresh,
}: MuseSuggestsPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const unread = suggestions.filter((s) => !s.isRead).length;

  return (
    <>
      {/* Bell trigger */}
      <div className="relative">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-xl hover:bg-white/8"
          onClick={() => setIsOpen(true)}
        >
          <Bell className="h-4 w-4 text-muted-foreground" />
        </Button>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </div>

      {/* Panel */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="right"
          className="w-[380px] border-white/8 bg-[oklch(0.13_0.012_264)] p-0"
        >
          <SheetHeader className="border-b border-white/8 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <SheetTitle className="flex items-center gap-2 text-sm font-semibold pr-2">
                  <span className="text-violet-400">✦</span> Muse Suggests
                  {unread > 0 && (
                    <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs text-violet-400">
                      {unread} new
                    </span>
                  )}
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">
                  Muse inspires — you decide. Review and act on Muse suggestions.
                </SheetDescription>
              </div>
              {onRefresh && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-full border-white/10 bg-white/5 px-3 text-[11px]"
                  disabled={isRefreshing}
                  onClick={async () => {
                    try {
                      setIsRefreshing(true);
                      await onRefresh();
                    } finally {
                      setIsRefreshing(false);
                    }
                  }}
                >
                  {isRefreshing ? 'Refreshing…' : 'Refresh'}
                </Button>
              )}
            </div>
          </SheetHeader>

          <div className="flex flex-col gap-2 overflow-y-auto p-4">
            {suggestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Bell className="mb-3 h-8 w-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No suggestions right now</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Muse will notify you when it has ideas
                </p>
              </div>
            ) : (
              suggestions.map((suggestion) => {
                const museConfig = MUSE_CONFIG[suggestion.muse];
                const typeConfig = SUGGESTION_TYPE_CONFIG[suggestion.type];
                const MuseIcon = MUSE_ICONS[suggestion.muse];
                return (
                  <div
                    key={suggestion.id}
                    className={cn(
                      'group rounded-xl border p-4 transition-colors',
                      suggestion.isRead
                        ? 'border-white/6 bg-white/3'
                        : 'border-white/10 bg-white/5',
                    )}
                  >
                    {/* Top row */}
                    <div className="mb-2.5 flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            'flex h-6 w-6 items-center justify-center rounded-lg',
                            museConfig.bgClass,
                          )}
                        >
                          <MuseIcon className={cn('h-3.5 w-3.5', museConfig.textClass)} />
                        </span>
                        <span className={cn('text-xs font-medium', museConfig.textClass)}>
                          {museConfig.name}
                        </span>
                        <span
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-medium',
                            typeConfig.bgClass,
                            typeConfig.textClass,
                            typeConfig.borderClass,
                          )}
                        >
                          {typeConfig.label}
                        </span>
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground/60">
                        {timeAgo(suggestion.createdAt)}
                      </span>
                    </div>

                    {/* Message */}
                    <p className="mb-3 text-xs leading-relaxed text-foreground/80">
                      {suggestion.message}
                    </p>

                    {/* Actions */}
                    <div className="flex flex-wrap gap-1.5">
                      {suggestion.actions
                        .filter((a) => a !== 'DISMISS')
                        .map((action) => (
                          <Button
                            key={action}
                            variant="outline"
                            size="sm"
                            onClick={() => onAction?.(suggestion.id, action)}
                            className={cn(
                              'h-6 rounded-full border-white/10 bg-white/5 px-2.5 text-[11px] hover:border-white/20 hover:bg-white/10',
                            )}
                          >
                            {ACTION_LABELS[action]}
                            <ChevronRight className="ml-0.5 h-3 w-3" />
                          </Button>
                        ))}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onDismiss?.(suggestion.id)}
                        className="h-6 rounded-full px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
