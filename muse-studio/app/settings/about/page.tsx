import { Film, Github } from 'lucide-react';

export default function AboutSettingsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-500/20 border border-violet-500/30">
          <Film className="h-4 w-4 text-violet-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">About Muse Studio</h1>
          <p className="text-sm text-muted-foreground">Version and credits.</p>
        </div>
      </div>
      <div className="rounded-2xl border border-white/8 bg-[oklch(0.13_0.012_264)] p-6 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Version</span>
          <span className="font-mono">0.1.0</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Frontend</span>
          <span>Next.js 16 · React 19 · TailwindCSS 4</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Backend</span>
          <span>FastAPI · Python 3.11+</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Database</span>
          <span>SQLite (better-sqlite3)</span>
        </div>
      </div>
    </div>
  );
}
