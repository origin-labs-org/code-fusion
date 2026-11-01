import { MCP_APPS_STRUCTURED_CONTENT_MAX_BYTES } from "@origin-ai/cf-shared/mcp-apps";

export const PLUGIN_UI_FOLLOW_UP_STRUCTURED_MAX_BYTES = MCP_APPS_STRUCTURED_CONTENT_MAX_BYTES;

export type PluginUiFollowUpPromptResult =
  | { ok: true; prompt: string }
  | { ok: false; reason: "empty_prompt" | "structured_too_large"; bytes?: number };

export function buildPluginUiFollowUpPrompt(
  prompt: string,
  structuredContent: unknown,
): PluginUiFollowUpPromptResult {
  const text = prompt.trim();
  if (!text) return { ok: false, reason: "empty_prompt" };
  if (structuredContent === undefined) return { ok: true, prompt: text };
  let json: string;
  try {
    json = JSON.stringify(structuredContent, null, 2);
  } catch {
    return { ok: true, prompt: text };
  }
  if (json === undefined) return { ok: true, prompt: text };
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > PLUGIN_UI_FOLLOW_UP_STRUCTURED_MAX_BYTES) {
    return { ok: false, reason: "structured_too_large", bytes };
  }
  return { ok: true, prompt: `${text}\n\n\`\`\`json\n${json}\n\`\`\`` };
}
