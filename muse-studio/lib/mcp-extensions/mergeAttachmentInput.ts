import type { McpAttachmentPayload } from '@/lib/mcp-extensions/mcpChatTypes';

function apiOutputsUrl(relPath: string): string {
  const trimmed = relPath.replace(/^\/+/, '');
  return `/api/outputs/${trimmed}`;
}

/**
 * Enrich extension HTTP tool input with structured attachment metadata.
 *
 * MCP tools are **not** merged here: many servers validate arguments with strict Pydantic
 * models and reject extra keys (`museAttachments`, `image_url`, etc.). For method "MCP",
 * only the orchestrator JSON `input` is sent — the model must copy URLs/paths from
 * STRUCTURED ATTACHMENTS into schema-defined fields.
 */
export function mergeAttachmentsIntoToolInput(
  input: unknown,
  attachments: McpAttachmentPayload[] | undefined,
  opts: { method: 'MCP' | 'HTTP' | string },
): Record<string, unknown> {
  const base =
    input && typeof input === 'object' && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  if (!attachments?.length) return base;

  if (opts.method === 'MCP') {
    return base;
  }

  const museAttachments = attachments.map((a) => ({
    kind: a.kind,
    relPath: a.relPath,
    apiUrl: apiOutputsUrl(a.relPath),
    name: a.name,
    source: a.source ?? 'upload',
    target: a.target,
    projectId: a.projectId,
  }));
  base.museAttachments = museAttachments;

  return base;
}
