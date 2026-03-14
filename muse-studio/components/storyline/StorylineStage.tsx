'use client';

import { useState } from 'react';
import {
  Sparkles,
  PenLine,
  CheckCircle2,
  ChevronRight,
  Feather,
  Users,
  BookOpen,
  Tag,
  AlignLeft,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { Project, StorylineContent } from '@/lib/types';
import type { LLMSettings } from '@/lib/actions/settings';
import { useStoryMuse } from '@/hooks/useStoryMuse';

interface StorylineStageProps {
  project: Project;
  onConfirm?: (storyline: StorylineContent, options?: { targetScenes: number }) => Promise<void> | void;
  llmSettings?: LLMSettings;
}

type InputMethod = 'muse' | 'manual';

const INPUT_METHODS = [
  {
    id: 'muse' as InputMethod,
    icon: Sparkles,
    label: 'Collaborate with Story Muse',
    description: 'Describe your concept and Story Muse generates a complete storyline outline.',
    cta: 'Generate with Story Muse',
  },
  {
    id: 'manual' as InputMethod,
    icon: PenLine,
    label: 'Write manually',
    description: 'Start with a blank canvas and build your storyline from scratch.',
    cta: 'Write Manually',
  },
];

/**
 * Parses the section-based markdown output from the LLM.
 * Handles the ## LOGLINE / ## PLOT OUTLINE / etc. format.
 * Falls back gracefully to using the full text as the plot outline.
 */
function parseStorylineText(raw: string): StorylineContent {
  // Try JSON first (some models may return it)
  try {
    const json = JSON.parse(raw) as StorylineContent;
    if (json.plotOutline) return json;
  } catch {
    // not JSON — parse as sections
  }

  const section = (header: string): string => {
    const re = new RegExp(
      `##\\s*${header}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`,
      'i',
    );
    return raw.match(re)?.[1]?.trim() ?? '';
  };

  const listSection = (header: string): string[] => {
    const text = section(header);
    if (!text) return [];
    return text
      .split('\n')
      .map((l) => l.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean);
  };

  const logline = section('LOGLINE');
  const plotOutline = section('PLOT OUTLINE') || section('PLOT') || raw.trim();
  const characters = listSection('CHARACTERS');
  const themes = listSection('THEMES');
  const genre = section('GENRE');

  return {
    logline: logline || undefined,
    plotOutline,
    characters,
    themes,
    genre: genre || undefined,
  };
}

const DEMO_STORYLINE: StorylineContent = {
  logline:
    'In a coastal town where fog never lifts, a therapist begins to suspect her patients\' shared nightmares are not dreams at all — but memories of something that hasn\'t happened yet.',
  plotOutline:
    'Dr. Elise Maren moves to the remote town of Hallow Bay after a breakdown. Her new patients all describe the same recurring nightmare: standing at the edge of a cliff at dawn, watching someone fall. As Elise digs deeper, the line between her patients\' inner worlds and the town\'s hidden history begins to collapse — and she realizes she has been in the nightmare too.',
  characters: [
    'Dr. Elise Maren — Therapist protagonist, haunted by her own past',
    'Mayor Callum Voss — Charming, deeply unsettling town leader',
    'Nora Heald — Patient, the first to recognize Elise from the dream',
    'The Figure — A recurring presence seen in all the patients\' nightmares',
  ],
  themes: ['Memory vs reality', 'Collective trauma', 'The unreliable mind', 'Isolation'],
  genre: 'Psychological horror / mystery',
};

export function StorylineStage({ project, onConfirm, llmSettings }: StorylineStageProps) {
  const [selectedMethod, setSelectedMethod] = useState<InputMethod | null>(null);
  const [musePrompt, setMusePrompt] = useState('');
  const [storyline, setStoryline] = useState<StorylineContent | null>(
    project.storyline ?? null,
  );
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [targetScenes, setTargetScenes] = useState<number>(8);
  const [targetScenesInput, setTargetScenesInput] = useState<string>('8');

  const storyMuse = useStoryMuse();
  const isGenerating = storyMuse.isGenerating;
  const isLoadingModel = storyMuse.isLoadingModel;

  async function handleGenerate() {
    if (!musePrompt.trim()) return;

    const { text: raw, error } = await storyMuse.generate({
      task: 'generate_storyline',
      prompt: musePrompt,
      context: { projectTitle: project.title },
      providerId: llmSettings?.llmProvider ?? 'ollama',
      ollamaBaseUrl: llmSettings?.ollamaBaseUrl,
      ollamaModel: llmSettings?.ollamaModel,
      openaiModel: llmSettings?.openaiModel,
      claudeModel: llmSettings?.claudeModel,
      lmstudioBaseUrl: llmSettings?.lmstudioBaseUrl,
      lmstudioModel: llmSettings?.lmstudioModel,
    });

    if (error || !raw) return; // Error is displayed inline

    setStoryline(parseStorylineText(raw));
  }

  async function handleConfirm() {
    if (!storyline || isConfirming) return;
    setIsConfirming(true);
    await onConfirm?.(storyline, { targetScenes });
    // page navigates away — no need to reset
  }

  // If no method selected yet — show method picker
  if (!selectedMethod && !storyline) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          {/* Stage header */}
          <div className="mb-8 text-center">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 text-xs font-medium text-violet-400">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
              Stage 1 · Storyline
            </div>
            <h2 className="text-2xl font-bold tracking-tight">
              Build Your{' '}
              <span className="text-violet-400">Storyline</span>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
              Every great film begins with a strong narrative foundation. Establish your storyline
              before creating scene scripts and visuals.
            </p>
          </div>

          {/* Method cards */}
          <div className="space-y-3">
            {INPUT_METHODS.map((method) => {
              const Icon = method.icon;
              return (
                <button
                  key={method.id}
                  onClick={() => setSelectedMethod(method.id)}
                  className="group w-full rounded-2xl border border-white/8 bg-[oklch(0.13_0.012_264)] p-5 text-left transition-all hover:border-violet-500/30 hover:bg-violet-500/5"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-all group-hover:border-violet-500/30 group-hover:bg-violet-500/15">
                      <Icon className="h-5 w-5 text-muted-foreground group-hover:text-violet-400 transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm group-hover:text-violet-300 transition-colors">
                        {method.label}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{method.description}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-violet-400 transition-colors shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Flow hint */}
          <div className="mt-8 flex items-center justify-center gap-3 text-xs text-muted-foreground/50">
            <span className="flex items-center gap-1">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-violet-500/20 text-violet-400 text-[10px] font-bold">1</span>
              Storyline
            </span>
            <div className="h-px w-8 bg-white/10" />
            <span className="flex items-center gap-1">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/8 text-muted-foreground text-[10px] font-bold">2</span>
              Scene Scripts
            </span>
            <div className="h-px w-8 bg-white/10" />
            <span className="flex items-center gap-1">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/8 text-muted-foreground text-[10px] font-bold">3</span>
              Production
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ── Full-screen generating view ──────────────────────────────────────────────
  if (selectedMethod === 'muse' && !storyline && isGenerating) {
    const wordCount = storyMuse.text ? storyMuse.text.trim().split(/\s+/).length : 0;
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top status bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/8 bg-[oklch(0.12_0.01_264)] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-500/20 animate-pulse">
              <Feather className="h-3.5 w-3.5 text-violet-400" />
            </div>
            <span className="text-sm font-medium text-violet-300">Story Muse</span>
            <span className="text-xs text-muted-foreground/60">
              {isLoadingModel && !storyMuse.text ? 'loading model…' : 'writing your storyline…'}
            </span>
          </div>
          {wordCount > 0 && (
            <span className="text-xs text-muted-foreground/40 tabular-nums">
              {wordCount} words
            </span>
          )}
        </div>

        {/* Main area */}
        <div className="flex flex-1 flex-col overflow-hidden">

          {/* Model loading state — before first token */}
          {isLoadingModel && !storyMuse.text && (
            <div className="flex flex-1 flex-col items-center justify-center gap-6 px-8">
              {/* Animated ring */}
              <div className="relative flex h-20 w-20 items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-violet-500/20" />
                <div className="absolute inset-0 rounded-full border-2 border-t-violet-400 border-r-transparent border-b-transparent border-l-transparent animate-spin" />
                <Feather className="h-7 w-7 text-violet-400/70" />
              </div>
              <div className="text-center max-w-sm">
                <p className="text-base font-medium text-foreground/80">Loading model into memory</p>
                <p className="mt-1.5 text-sm text-muted-foreground/60">
                  {llmSettings?.ollamaModel
                    ? `${llmSettings.ollamaModel} — large models take a minute on first use.`
                    : 'Large models take a minute on first use.'}
                </p>
                <div className="mt-4 flex justify-center gap-1.5">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="h-1.5 w-1.5 rounded-full bg-violet-400/60 animate-bounce"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Live streaming text — scrolls as content grows */}
          {storyMuse.text && (
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl px-6 py-8">
                {/* Subtle "writing" pulse bar at top */}
                <div className="mb-6 h-0.5 w-full rounded-full overflow-hidden bg-white/5">
                  <div className="h-full bg-gradient-to-r from-violet-500 to-violet-300 animate-pulse w-full" />
                </div>
                <pre className="text-sm leading-7 text-foreground/85 whitespace-pre-wrap font-mono tracking-wide">
                  {storyMuse.text}
                  <span className="inline-block h-[1.1em] w-0.5 bg-violet-400 animate-[blink_1s_step-end_infinite] ml-px align-text-bottom" />
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Story Muse input form (before generating) ─────────────────────────────
  if (selectedMethod === 'muse' && !storyline) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">

          <button
            onClick={() => setSelectedMethod(null)}
            className="mb-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5 rotate-180" />
            Back
          </button>

          <div className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/20">
                <Feather className="h-4 w-4 text-violet-400" />
              </div>
              <span className="font-semibold text-sm text-violet-400">Story Muse</span>
            </div>
            <h2 className="text-xl font-bold">Describe your film concept</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Share your idea — genre, theme, tone, characters, setting. The more you tell Story Muse,
              the richer your storyline will be.
            </p>
          </div>

          {/* Error display */}
          {storyMuse.error && (
            <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/5 px-4 py-3 flex items-start gap-2.5">
              <XCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-red-300">Generation failed</p>
                <p className="text-xs text-red-300/70 mt-0.5">{storyMuse.error}</p>
                <p className="text-xs text-muted-foreground/60 mt-1.5">
                  Check your LLM settings in{' '}
                  <a href="/settings/llm" className="text-violet-400 hover:underline">Settings → LLM</a>
                  {' '}and make sure the service is running.
                </p>
              </div>
            </div>
          )}

          <div className="relative mb-4">
            <Textarea
              value={musePrompt}
              onChange={(e) => setMusePrompt(e.target.value)}
              placeholder={`e.g. "A psychological horror set in a fog-covered coastal town. A therapist discovers her patients all share the same recurring nightmare — and she's in it too. Themes of memory, collective trauma, and isolation."`}
              rows={6}
              className="resize-none bg-white/5 border-white/10 focus:border-violet-500/50 placeholder:text-muted-foreground/40 text-sm"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleGenerate();
              }}
            />
            <p className="mt-1.5 text-xs text-muted-foreground/40 text-right">
              ⌘↵ to generate
            </p>
          </div>

          <Button
            onClick={handleGenerate}
            disabled={!musePrompt.trim()}
            className="w-full bg-violet-600 hover:bg-violet-500 font-medium gap-2 h-11"
          >
            <Sparkles className="h-4 w-4" />
            {storyMuse.error ? 'Try Again' : 'Generate Storyline with Story Muse'}
          </Button>

          <p className="mt-2.5 text-center text-xs text-muted-foreground/40">
            Using {llmSettings?.llmProvider ?? 'ollama'}
            {llmSettings?.llmProvider === 'ollama' && llmSettings.ollamaModel
              ? ` · ${llmSettings.ollamaModel}`
              : llmSettings?.llmProvider === 'openai' && llmSettings.openaiModel
              ? ` · ${llmSettings.openaiModel}`
              : llmSettings?.llmProvider === 'claude' && llmSettings.claudeModel
              ? ` · ${llmSettings.claudeModel}`
              : ''}
          </p>
        </div>
      </div>
    );
  }

  // Manual entry — show a blank storyline form
  if (selectedMethod === 'manual' && !storyline) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl">
          <button
            onClick={() => setSelectedMethod(null)}
            className="mb-6 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5 rotate-180" />
            Back
          </button>
          <h2 className="text-xl font-bold mb-4">Write your storyline</h2>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Logline</label>
              <Textarea placeholder="One sentence that captures your film's core premise…" rows={2} className="resize-none bg-white/5 border-white/10 focus:border-violet-500/50 text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Plot Outline</label>
              <Textarea placeholder="Describe the story arc — beginning, middle, end…" rows={5} className="resize-none bg-white/5 border-white/10 focus:border-violet-500/50 text-sm" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Characters</label>
              <Textarea placeholder="List your main characters and their roles…" rows={3} className="resize-none bg-white/5 border-white/10 focus:border-violet-500/50 text-sm" />
            </div>
            <Button
              onClick={() => setStoryline(DEMO_STORYLINE)}
              className="w-full bg-violet-600 hover:bg-violet-500 font-medium gap-2 h-11"
            >
              <PenLine className="h-4 w-4" />
              Save & Preview Storyline
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Storyline review & confirm view
  if (storyline) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          {/* Header */}
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-violet-500/20">
                  <Feather className="h-3.5 w-3.5 text-violet-400" />
                </div>
                <span className="text-xs font-semibold text-violet-400 uppercase tracking-wide">
                  Storyline Draft · Ready for Review
                </span>
              </div>
              <h2 className="text-xl font-bold">{project.title}</h2>
              {storyline.genre && (
                <span className="mt-1 inline-block text-xs text-muted-foreground">{storyline.genre}</span>
              )}
            </div>
            <Button
              onClick={handleConfirm}
              disabled={isConfirming}
              className="shrink-0 bg-emerald-600 hover:bg-emerald-500 font-medium gap-2"
            >
              {isConfirming ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Saving…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm &amp; Proceed to Scripts
                </>
              )}
            </Button>
          </div>

          {/* Confirm CTA banner */}
          <div className="mb-6 rounded-xl border border-emerald-500/20 bg-emerald-500/8 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-emerald-300">Review your storyline, then confirm</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Confirming locks this storyline and enables Story Muse to create scene scripts.
                  You can still edit before confirming.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground/80">Scene breakdown preset</span>{' '}
                · Choose how many scenes Story Muse should generate from this storyline. For longer films,
                you can enter a custom scene count.
              </div>
              <div className="mt-1 flex flex-wrap items-center justify-end gap-2">
                <div className="flex gap-1.5">
                  {[5, 8, 12].map((count) => {
                    const active = targetScenes === count;
                    return (
                      <button
                        key={count}
                        type="button"
                        onClick={() => {
                          setTargetScenes(count);
                          setTargetScenesInput(String(count));
                        }}
                        className={cn(
                          'rounded-full px-3 py-1 text-[11px] font-medium border transition-all',
                          active
                            ? 'border-emerald-400/70 bg-emerald-500/20 text-emerald-200'
                            : 'border-white/10 bg-white/5 text-muted-foreground hover:border-white/20 hover:bg-white/10',
                        )}
                      >
                        {count} scenes
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground/70">or</span>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    inputMode="numeric"
                    value={targetScenesInput}
                    onChange={(e) => {
                      const value = e.target.value;
                      setTargetScenesInput(value);
                      const n = Number.parseInt(value, 10);
                      if (!Number.isNaN(n) && n > 0 && n <= 120) {
                        setTargetScenes(n);
                      }
                    }}
                    onBlur={() => {
                      const n = Number.parseInt(targetScenesInput, 10);
                      let next = Number.isNaN(n) ? 8 : n;
                      if (next < 1) next = 1;
                      if (next > 120) next = 120;
                      setTargetScenes(next);
                      setTargetScenesInput(String(next));
                    }}
                    className="h-7 w-20 rounded-full border border-white/15 bg-white/5 px-3 text-[11px] text-foreground/90 placeholder:text-muted-foreground/60 outline-none focus:border-emerald-400/70 focus:ring-1 focus:ring-emerald-500/40"
                    placeholder="e.g. 24"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Storyline sections */}
          <div className="space-y-4">

            {/* Logline */}
            {storyline.logline && (
              <StorylineSection
                icon={AlignLeft}
                label="Logline"
                accent="violet"
                editing={editingSection === 'logline'}
                onEdit={() => setEditingSection(editingSection === 'logline' ? null : 'logline')}
              >
                <p className="text-sm leading-relaxed italic text-foreground/90">
                  "{storyline.logline}"
                </p>
              </StorylineSection>
            )}

            {/* Plot Outline */}
            <StorylineSection
              icon={BookOpen}
              label="Plot Outline"
              accent="violet"
              editing={editingSection === 'plot'}
              onEdit={() => setEditingSection(editingSection === 'plot' ? null : 'plot')}
            >
              {editingSection === 'plot' ? (
                <Textarea
                  defaultValue={storyline.plotOutline}
                  rows={5}
                  className="resize-none bg-white/5 border-white/10 focus:border-violet-500/50 text-sm"
                />
              ) : (
                <p className="text-sm leading-relaxed text-foreground/80">{storyline.plotOutline}</p>
              )}
            </StorylineSection>

            {/* Characters */}
            <StorylineSection
              icon={Users}
              label="Characters"
              accent="blue"
              editing={editingSection === 'characters'}
              onEdit={() => setEditingSection(editingSection === 'characters' ? null : 'characters')}
            >
              <ul className="space-y-1.5">
                {storyline.characters.map((char, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-400" />
                    {char}
                  </li>
                ))}
              </ul>
            </StorylineSection>

            {/* Themes */}
            <StorylineSection
              icon={Tag}
              label="Themes"
              accent="amber"
              editing={editingSection === 'themes'}
              onEdit={() => setEditingSection(editingSection === 'themes' ? null : 'themes')}
            >
              <div className="flex flex-wrap gap-2">
                {storyline.themes.map((theme, i) => (
                  <span
                    key={i}
                    className="rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-400"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            </StorylineSection>
          </div>

          {/* Bottom CTA */}
          <div className="mt-8 flex gap-3">
            <Button
              variant="outline"
              className="border-white/10 bg-white/5 hover:bg-white/8 gap-2"
              onClick={() => { setStoryline(null); setSelectedMethod(null); }}
            >
              Start over
            </Button>
            <Button
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 font-medium gap-2 h-11"
              onClick={handleConfirm}
            >
              <CheckCircle2 className="h-4 w-4" />
              Confirm Storyline &amp; Proceed to Scene Scripts
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── Reusable section card ──────────────────────────────────────────────────────

interface StorySectionProps {
  icon: React.ElementType;
  label: string;
  accent: 'violet' | 'blue' | 'amber';
  editing?: boolean;
  onEdit?: () => void;
  children: React.ReactNode;
}

const ACCENT_MAP = {
  violet: {
    icon: 'text-violet-400',
    label: 'text-violet-400',
    border: 'border-violet-500/20',
    bg: 'bg-violet-500/8',
    iconBg: 'bg-violet-500/15',
  },
  blue: {
    icon: 'text-blue-400',
    label: 'text-blue-400',
    border: 'border-blue-500/20',
    bg: 'bg-blue-500/8',
    iconBg: 'bg-blue-500/15',
  },
  amber: {
    icon: 'text-amber-400',
    label: 'text-amber-400',
    border: 'border-amber-500/20',
    bg: 'bg-amber-500/8',
    iconBg: 'bg-amber-500/15',
  },
};

function StorylineSection({ icon: Icon, label, accent, editing, onEdit, children }: StorySectionProps) {
  const a = ACCENT_MAP[accent];
  return (
    <div className={cn('rounded-xl border p-5', a.border, a.bg)}>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', a.iconBg)}>
            <Icon className={cn('h-3.5 w-3.5', a.icon)} />
          </span>
          <span className={cn('text-xs font-semibold uppercase tracking-wide', a.label)}>
            {label}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="h-6 rounded-full px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {editing ? 'Done' : 'Edit'}
        </Button>
      </div>
      {children}
    </div>
  );
}
