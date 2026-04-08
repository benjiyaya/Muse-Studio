export type McpChatMessage = { role: 'user' | 'assistant'; content: string };

/** Structured attachments from the Extensions composer (upload or media library). */
export type McpAttachmentPayload = {
  relPath: string;
  kind: 'image' | 'video' | 'text';
  name?: string;
  mimeType?: string;
  size?: number;
  previewUrl?: string;
  target?: 'session' | 'project';
  projectId?: string;
  /** upload = copied under drafts/mcp-extensions/…; library = existing outputs path */
  source?: 'upload' | 'library';
};

export type McpToolCallPreview = {
  kind: 'image' | 'video' | 'json';
  url?: string;
  label?: string;
};

export type McpToolCallLogEntry = {
  capability: string;
  pluginId?: string;
  pluginName?: string;
  status: 'ok' | 'error';
  error?: string;
  previews: McpToolCallPreview[];
};

export type McpPendingApproval = {
  capability: string;
  pluginId: string;
  pluginName: string;
  input: unknown;
};

export type McpChatResponse = {
  assistantText: string;
  toolCalls: McpToolCallLogEntry[];
  /** When hook policy is "ask", the model planned a tool but execution waits for confirmation. */
  pendingApproval?: McpPendingApproval | null;
};
