import type { ConversationRow, ToolCallRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { OfficialMcpToolErrorCode } from "@origin-ai/cf-shared";

export interface McpUnavailableNotice {
  code: OfficialMcpToolErrorCode;
  serverName: string;
  toolName: string;
  
  rowId: number;
}

function readMcpToolCallRow(row: ConversationRow): ToolCallRow | null {
  return row.kind === "toolCall" ? row : null;
}

export function resolveMcpUnavailableNotice(
  rows: readonly ConversationRow[] | undefined,
): McpUnavailableNotice | null {
  if (!rows || rows.length === 0) return null;
  const seenTools = new Set<string>();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) continue;
    const toolCallRow = readMcpToolCallRow(row);
    if (!toolCallRow) continue;
    const display = toolCallRow.display;
    if (display?.kind !== "mcp_tool") continue;
    const toolKey = `${display.serverName}\u0000${display.toolName}`;
    if (seenTools.has(toolKey)) continue;
    seenTools.add(toolKey);
    if (!display.unavailable) continue;
    return {
      code: display.unavailable.code,
      rowId: toolCallRow.rowId,
      serverName: display.serverName,
      toolName: display.toolName,
    };
  }
  return null;
}
