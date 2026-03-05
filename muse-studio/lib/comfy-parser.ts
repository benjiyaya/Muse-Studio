/**
 * Deterministic parser for ComfyUI workflow JSON files.
 *
 * Convention:
 *   - Nodes with "(Input)" in their _meta.title are user-visible inputs.
 *   - Nodes with "(Output)" in their _meta.title are expected outputs.
 *
 * Supported input kinds (derived from class_type):
 *   text       → CLIPTextEncode, Note, etc.
 *   textarea   → (same as text but mapped to a textarea for longer content)
 *   number     → INT, FLOAT, KSampler seed fields, etc.
 *   image      → LoadImage
 *   image_url  → URL-based image loader nodes (e.g. "Load Image From Url (mtb)")
 *   audio      → LoadAudio
 *
 * Supported output kinds:
 *   image    → SaveImage, PreviewImage, etc.
 *   video    → VHS_VideoCombine, etc.
 *   other    → anything else with (Output)
 */

export type ComfyInputKind = 'text' | 'textarea' | 'number' | 'image' | 'image_url' | 'audio';
export type ComfyOutputKind = 'image' | 'video' | 'other';

export interface ComfyDynamicInput {
  nodeId: string;
  label: string;
  kind: ComfyInputKind;
  defaultValue?: string | number;
  required: boolean;
}

export interface ComfyDynamicOutput {
  nodeId: string;
  label: string;
  kind: ComfyOutputKind;
}

export interface WorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

const TEXT_AREA_CLASSES = new Set(['CLIPTextEncode', 'Note', 'ShowText', 'ImpactWildcardProcessor']);
const NUMBER_CLASSES = new Set(['INT', 'FLOAT', 'KSampler', 'KSamplerAdvanced']);
const IMAGE_CLASSES = new Set(['LoadImage', 'ImageLoader', 'ETN_LoadImageBase64']);
const IMAGE_URL_CLASSES = new Set(['Load Image From Url (mtb)']);
const AUDIO_CLASSES = new Set(['LoadAudio', 'VHS_LoadAudio']);
const VIDEO_OUTPUT_CLASSES = new Set([
  'VHS_VideoCombine', 'SaveVideo', 'VideoOutput', 'AnimateDiffCombine',
]);
const IMAGE_OUTPUT_CLASSES = new Set([
  'SaveImage', 'PreviewImage', 'SaveImageWebsocket', 'ETN_SendImageWebSocket',
]);

function classToInputKind(classType: string): ComfyInputKind {
  if (IMAGE_CLASSES.has(classType)) return 'image';
  if (IMAGE_URL_CLASSES.has(classType)) return 'image_url';
  if (AUDIO_CLASSES.has(classType)) return 'audio';
  if (NUMBER_CLASSES.has(classType)) return 'number';
  if (TEXT_AREA_CLASSES.has(classType)) return 'textarea';
  // Fallback: check common suffixes
  const lower = classType.toLowerCase();
  if (lower.includes('image') || lower.includes('load')) return 'image';
  if (lower.includes('audio')) return 'audio';
  if (lower.includes('int') || lower.includes('float') || lower.includes('seed')) return 'number';
  if (lower.includes('text') || lower.includes('clip') || lower.includes('prompt')) return 'textarea';
  return 'text';
}

function extractDefaultValue(node: WorkflowNode): string | number | undefined {
  const { inputs, class_type } = node;

  if (IMAGE_CLASSES.has(class_type) || AUDIO_CLASSES.has(class_type)) return undefined;

  // CLIPTextEncode / Note — text field is "text"
  if (typeof inputs.text === 'string') return inputs.text;

  // Primitive wrappers
  if (typeof inputs.value === 'string' || typeof inputs.value === 'number') return inputs.value;
  if (typeof inputs.int === 'number') return inputs.int;
  if (typeof inputs.float === 'number') return inputs.float;

  return undefined;
}

export function parseDynamicInputs(workflowJson: Record<string, WorkflowNode>): ComfyDynamicInput[] {
  const results: ComfyDynamicInput[] = [];

  for (const [nodeId, node] of Object.entries(workflowJson)) {
    const title = node._meta?.title ?? '';
    if (!title.includes('(Input)')) continue;

    const label = title.replace('(Input)', '').trim() || node.class_type;
    const kind = classToInputKind(node.class_type);
    const defaultValue = extractDefaultValue(node);

    results.push({
      nodeId,
      label,
      kind,
      defaultValue,
      // All input kinds are required by default.
      required: true,
    });
  }

  return results;
}

export function parseDynamicOutputs(workflowJson: Record<string, WorkflowNode>): ComfyDynamicOutput[] {
  const results: ComfyDynamicOutput[] = [];

  for (const [nodeId, node] of Object.entries(workflowJson)) {
    const title = node._meta?.title ?? '';
    if (!title.includes('(Output)')) continue;

    const label = title.replace('(Output)', '').trim() || node.class_type;

    let kind: ComfyOutputKind = 'other';
    if (VIDEO_OUTPUT_CLASSES.has(node.class_type) || node.class_type.toLowerCase().includes('video')) {
      kind = 'video';
    } else if (IMAGE_OUTPUT_CLASSES.has(node.class_type) || node.class_type.toLowerCase().includes('image')) {
      kind = 'image';
    }

    results.push({ nodeId, label, kind });
  }

  return results;
}
