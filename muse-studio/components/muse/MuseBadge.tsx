import { cn } from '@/lib/utils';
import { MUSE_CONFIG } from '@/lib/constants';
import type { MuseAgent } from '@/lib/types';

interface MuseBadgeProps {
  muse: MuseAgent;
  size?: 'sm' | 'md';
  showName?: boolean;
  className?: string;
}

export function MuseBadge({ muse, size = 'sm', showName = true, className }: MuseBadgeProps) {
  const config = MUSE_CONFIG[muse];

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border font-medium',
        config.bgClass,
        config.textClass,
        config.borderClass,
        size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm',
        className,
      )}
    >
      <span className={cn('rounded-full', config.dotClass, size === 'sm' ? 'h-1.5 w-1.5' : 'h-2 w-2')} />
      {showName && config.shortName}
    </span>
  );
}
