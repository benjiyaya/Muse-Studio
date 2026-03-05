'use client';

import { Toaster } from 'sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      {children}
      <Toaster
        position="top-center"
        toastOptions={{
          classNames: {
            toast: '!rounded-xl !border !border-white/10 !bg-[oklch(0.14_0.01_264)] !text-foreground !shadow-2xl !shadow-black/60',
            title: '!text-sm !font-medium',
            description: '!text-xs !text-muted-foreground',
            success: '!border-emerald-500/25 !bg-[oklch(0.14_0.01_150)]',
            error: '!border-red-500/25 !bg-[oklch(0.14_0.01_20)]',
            icon: '!text-current',
          },
        }}
        richColors
      />
    </TooltipProvider>
  );
}
