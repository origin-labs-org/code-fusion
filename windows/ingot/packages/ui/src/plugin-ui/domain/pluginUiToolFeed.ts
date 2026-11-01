import type { McpAppsToolResultPayload } from "@origin-ai/cf-shared/mcp-apps";
import { MCP_APPS_TRUNCATED_META_KEY } from "@origin-ai/cf-shared/mcp-apps";
import type { ConversationRow, ToolCallRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { PluginUiPresentation } from "../contract.js";
import { parseJsonText, readPluginUiPresentation } from "./readPluginUiPresentation.js";

export interface PluginUiLegacyToolCall {
  status: string;
  input: unknown;
  output?: unknown;
}

export function readPluginUiToolInput(
  toolCall: PluginUiLegacyToolCall | null,
): Record<string, unknown> | undefined {
  return toolCall &&
    typeof toolCall.input === "object" &&
    toolCall.input !== null &&
    !Array.isArray(toolCall.input)
    ? (toolCall.input as Record<string, unknown>)
    : undefined;
}

export function isPluginUiToolCancelled(toolCall: PluginUiLegacyToolCall | null): boolean {
  return toolCall?.status === "stopped";
}

export function buildPluginUiToolResult(
  toolCall: PluginUiLegacyToolCall | null,
  presentation: PluginUiPresentation | null,
): McpAppsToolResultPayload | undefined {
  if (!toolCall || !presentation) return undefined;
  if (toolCall.status === "pending" || toolCall.status === "in_progress") return undefined;
  if (isPluginUiToolCancelled(toolCall)) return undefined;
  const structured = parseJsonText(presentation.structuredContent);
  const meta = parseJsonText(presentation.widgetMeta);
  const rawContent = parseJsonText(presentation.content);
  const content = Array.isArray(rawContent)
    ? (rawContent.filter(
        (block): block is Record<string, unknown> => typeof block === "object" && block !== null,
      ) as Array<Record<string, unknown>>)
    : typeof toolCall.output === "string"
      ? [{ type: "text", text: toolCall.output }]
      : [];
  const baseMeta =
    typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>) : {};
  const mergedMeta = presentation.truncated
    ? { ...baseMeta, [MCP_APPS_TRUNCATED_META_KEY]: { bytes: presentation.truncatedBytes ?? 0 } }
    : baseMeta;
  return {
    content,
    ...(structured !== undefined ? { structuredContent: structured } : {}),
    ...(toolCall.status === "failed" || presentation.isError ? { isError: true } : {}),
    ...(Object.keys(mergedMeta).length > 0 ? { _meta: mergedMeta } : {}),
  };
}

export function findToolRowById(
  rows: readonly ConversationRow[],
  toolCallId: string,
): ToolCallRow | null {
  const row = rows.find(
    (candidate) => candidate.kind === "toolCall" && candidate.toolCallId === toolCallId,
  );
  return row && row.kind === "toolCall" ? row : null;
}

export interface PluginUiSurfaceFeedEntry {
  rowId: number;
  toolCallId: string;
  status: ToolCallRow["status"];
  presentation: PluginUiPresentation;
  input: Record<string, unknown> | undefined;
}

export interface PluginUiSurfaceFeed {
  latest: PluginUiSurfaceFeedEntry | null;
  result: (PluginUiSurfaceFeedEntry & { toolResult: McpAppsToolResultPayload }) | null;
}

export const EMPTY_PLUGIN_UI_SURFACE_FEED: PluginUiSurfaceFeed = { latest: null, result: null };

const LEGACY_STATUS: Record<ToolCallRow["status"], string> = {
  inputStreaming: "pending",
  pendingApproval: "pending",
  running: "in_progress",
  success: "completed",
  error: "failed",
  cancelled: "stopped",
};

function readSurfacePresentation(
  row: ToolCallRow,
  surfaceId: string,
  pluginId: string,
): PluginUiPresentation | null {
  const display = row.display;
  if (
    display?.kind !== "mcp_tool" ||
    display.ui?.surface !== surfaceId ||
    display.ui.pluginId !== pluginId
  )
    return null;
  return readPluginUiPresentation({ display });
}

function toSurfaceFeedEntry(
  row: ToolCallRow,
  presentation: PluginUiPresentation,
): PluginUiSurfaceFeedEntry {
  return {
    rowId: row.rowId,
    toolCallId: row.toolCallId,
    status: row.status,
    presentation,
    input: readPluginUiToolInput({ status: row.status, input: row.input }),
  };
}

export function reducePluginUiSurfaceFeed(
  previous: PluginUiSurfaceFeed,
  rows: readonly ConversationRow[],
  surfaceId: string,
  pluginId: string,
  binding?: { serverName?: string; resourceUri: string },
): PluginUiSurfaceFeed {
  let latest = previous.latest;
  let result = previous.result;
  for (const row of rows) {
    if (row.kind !== "toolCall") continue;
    const presentation = readSurfacePresentation(row, surfaceId, pluginId);
    if (
      !presentation ||
      (binding &&
        (presentation.serverName !== binding.serverName ||
          presentation.resourceUri !== binding.resourceUri))
    )
      continue;
    if (
      !latest ||
      row.rowId > latest.rowId ||
      (row.rowId === latest.rowId && row.status !== latest.status)
    ) {
      latest = toSurfaceFeedEntry(row, presentation);
    }
    if (
      row.status === "success" &&
      !presentation.isError &&
      (!result || row.rowId > result.rowId)
    ) {
      const toolResult = buildPluginUiToolResult(
        { status: LEGACY_STATUS[row.status], input: row.input, output: row.output?.text },
        presentation,
      );
      if (toolResult) result = { ...toSurfaceFeedEntry(row, presentation), toolResult };
    }
  }
  return latest === previous.latest && result === previous.result ? previous : { latest, result };
}

export function mergePluginUiSurfaceFeed(
  current: PluginUiSurfaceFeed,
  candidate: PluginUiSurfaceFeed,
): PluginUiSurfaceFeed {
  const latest =
    candidate.latest &&
    (!current.latest ||
      candidate.latest.rowId > current.latest.rowId ||
      (candidate.latest.rowId === current.latest.rowId &&
        candidate.latest.status !== current.latest.status))
      ? candidate.latest
      : current.latest;
  const result =
    candidate.result && (!current.result || candidate.result.rowId > current.result.rowId)
      ? candidate.result
      : current.result;
  return latest === current.latest && result === current.result ? current : { latest, result };
}
