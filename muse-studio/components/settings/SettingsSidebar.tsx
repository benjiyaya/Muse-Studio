'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Brain, Info, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { href: '/settings/llm',     label: 'LLM',     icon: Brain,    description: 'Provider, model & API keys' },
  { href: '/settings/comfyui', label: 'ComfyUI',  icon: Workflow, description: 'Workflow library' },
  { href: '/settings/about',   label: 'About',    icon: Info,     description: 'Version & credits' },
];

export function SettingsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-52 shrink-0 pr-6">
      <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
        Settings
      </h2>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all',
                active
                  ? 'bg-violet-500/10 border border-violet-500/20'
                  : 'hover:bg-white/5 border border-transparent',
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 transition-colors',
                  active ? 'text-violet-400' : 'text-muted-foreground group-hover:text-violet-400',
                )}
              />
              <div>
                <div className={cn('font-medium leading-none', active && 'text-violet-300')}>
                  {item.label}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground/60">{item.description}</div>
              </div>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
