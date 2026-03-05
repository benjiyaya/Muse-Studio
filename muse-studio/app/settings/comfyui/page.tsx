'use client';

import { useState, useTransition } from 'react';
import { Workflow, Plus, Trash2, Pencil, Check, X, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  listComfyWorkflows,
  registerComfyWorkflow,
  updateComfyWorkflow,
  deleteComfyWorkflow,
  type ComfyWorkflowSummary,
} from '@/lib/actions/comfyui';
import { parseDynamicInputs, parseDynamicOutputs, type WorkflowNode } from '@/lib/comfy-parser';

// ── Component ────────────────────────────────────────────────────────────────

export default function ComfyUISettingsPage() {
  const [workflows, setWorkflows] = useState<ComfyWorkflowSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Load on first render
  if (!loaded) {
    setLoaded(true);
    listComfyWorkflows().then(setWorkflows).catch(console.error);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-semibold">ComfyUI Workflows</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Register ComfyUI API workflow JSONs. Label nodes with{' '}
          <code className="rounded bg-white/8 px-1 py-0.5 text-xs">(Input)</code> and{' '}
          <code className="rounded bg-white/8 px-1 py-0.5 text-xs">(Output)</code> in their titles
          so the UI can generate dynamic controls.
        </p>
      </div>

      <RegisterWorkflowForm
        onSaved={(wf) => setWorkflows((p) => [wf, ...p])}
      />

      <WorkflowLibrary
        workflows={workflows}
        onDeleted={(id) => setWorkflows((p) => p.filter((w) => w.id !== id))}
        onUpdated={(updated) =>
          setWorkflows((p) => p.map((w) => (w.id === updated.id ? updated : w)))
        }
      />
    </div>
  );
}

// ── Register form ─────────────────────────────────────────────────────────────

function RegisterWorkflowForm({ onSaved }: { onSaved: (wf: ComfyWorkflowSummary) => void }) {
  const [json, setJson] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'image' | 'video'>('image');
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<{ inputs: ReturnType<typeof parseDynamicInputs>; outputs: ReturnType<typeof parseDynamicOutputs> } | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleAnalyze() {
    setParseError(null);
    setParsed(null);
    try {
      const obj = JSON.parse(json) as Record<string, WorkflowNode>;
      const inputs = parseDynamicInputs(obj);
      const outputs = parseDynamicOutputs(obj);
      setParsed({ inputs, outputs });
    } catch {
      setParseError('Invalid JSON — please paste a valid ComfyUI API workflow.');
    }
  }

  function handleSave() {
    if (!name.trim() || !json.trim()) return;
    startTransition(async () => {
      const id = await registerComfyWorkflow({ name, description, kind, json });
      onSaved({ id, name, description: description || null, kind, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      setJson('');
      setName('');
      setDescription('');
      setParsed(null);
    });
  }

  return (
    <section className="rounded-2xl border border-white/8 bg-white/3 p-5 space-y-4">
      <h2 className="text-sm font-semibold">Analyze &amp; Register Workflow</h2>

      {/* JSON textarea */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Workflow JSON</label>
        <Textarea
          value={json}
          onChange={(e) => { setJson(e.target.value); setParsed(null); setParseError(null); }}
          rows={6}
          placeholder='Paste your ComfyUI API workflow JSON here…'
          className="font-mono text-xs resize-none bg-black/20 border-white/10"
        />
      </div>

      <Button variant="outline" size="sm" onClick={handleAnalyze} disabled={!json.trim()}>
        Analyze Workflow
      </Button>

      {parseError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/8 px-3 py-2 text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {parseError}
        </div>
      )}

      {/* Detected I/O */}
      {parsed && (
        <div className="rounded-xl border border-white/8 bg-black/20 p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground/70">Detected Inputs &amp; Outputs</p>
          <div className="space-y-1">
            {parsed.inputs.length === 0 && parsed.outputs.length === 0 ? (
              <p className="text-xs text-muted-foreground/50">
                No (Input) or (Output) markers found. Add them to node titles in ComfyUI.
              </p>
            ) : null}
            {parsed.inputs.map((inp) => (
              <div key={inp.nodeId} className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-violet-400">INPUT</span>
                <span className="text-foreground/80">{inp.label}</span>
                <span className="text-muted-foreground/50">({inp.kind})</span>
                {inp.required && <span className="text-red-400/70">required</span>}
              </div>
            ))}
            {parsed.outputs.map((out) => (
              <div key={out.nodeId} className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-400">OUTPUT</span>
                <span className="text-foreground/80">{out.label}</span>
                <span className="text-muted-foreground/50">({out.kind})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Name / description / kind / save — shown after analysis */}
      {parsed && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Workflow Name *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Image Workflow"
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Kind</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as 'image' | 'video')}
                className="w-full rounded-lg border border-white/10 bg-[oklch(0.13_0.01_264)] px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/30"
              >
                <option value="image">Image (Keyframe)</option>
                <option value="video">Video</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description of this workflow…"
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>
          <Button
            size="sm"
            disabled={!name.trim() || isPending}
            onClick={handleSave}
            className="bg-violet-600 hover:bg-violet-500 text-white"
          >
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            Save to Library
          </Button>
        </div>
      )}
    </section>
  );
}

// ── Library ───────────────────────────────────────────────────────────────────

function WorkflowLibrary({
  workflows,
  onDeleted,
  onUpdated,
}: {
  workflows: ComfyWorkflowSummary[];
  onDeleted: (id: string) => void;
  onUpdated: (wf: ComfyWorkflowSummary) => void;
}) {
  if (workflows.length === 0) {
    return (
      <section>
        <h2 className="text-sm font-semibold mb-3">Saved Workflows</h2>
        <div className="flex items-center justify-center rounded-2xl border-2 border-dashed border-white/6 py-12">
          <div className="text-center">
            <Workflow className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground/50">No workflows registered yet</p>
            <p className="text-xs text-muted-foreground/30 mt-1">Analyze and save a workflow above</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2 className="text-sm font-semibold mb-3">Saved Workflows ({workflows.length})</h2>
      <div className="space-y-2">
        {workflows.map((wf) => (
          <WorkflowCard key={wf.id} workflow={wf} onDeleted={onDeleted} onUpdated={onUpdated} />
        ))}
      </div>
    </section>
  );
}

function WorkflowCard({
  workflow,
  onDeleted,
  onUpdated,
}: {
  workflow: ComfyWorkflowSummary;
  onDeleted: (id: string) => void;
  onUpdated: (wf: ComfyWorkflowSummary) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description ?? '');
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      await updateComfyWorkflow(workflow.id, { name, description });
      onUpdated({ ...workflow, name, description: description || null });
      setEditing(false);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteComfyWorkflow(workflow.id);
      onDeleted(workflow.id);
    });
  }

  return (
    <div className="rounded-xl border border-white/8 bg-white/3 px-4 py-3">
      {editing ? (
        <div className="space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/30"
          />
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-muted-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
          />
          <p className="text-[10px] text-muted-foreground/40">
            Workflow JSON is not editable after registration.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={isPending} onClick={handleSave} className="h-7 text-xs">
              <Check className="h-3 w-3 mr-1" /> Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setName(workflow.name); setDescription(workflow.description ?? ''); }} className="h-7 text-xs">
              <X className="h-3 w-3 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-400 mt-0.5">
            <Workflow className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-medium">{workflow.name}</p>
              <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                workflow.kind === 'video'
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'bg-violet-500/10 text-violet-400'
              }`}>
                {workflow.kind}
              </span>
            </div>
            {workflow.description && (
              <p className="text-xs text-muted-foreground/60 mt-0.5 truncate">{workflow.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => setEditing(true)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              disabled={isPending}
              onClick={handleDelete}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
