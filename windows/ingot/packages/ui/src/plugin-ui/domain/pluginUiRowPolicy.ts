import type { ConversationRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { PluginUiRowDisposition } from "./pluginUiInstancePolicy.js";

export interface PluginUiRowPinContext {
  disposition?: PluginUiRowDisposition;
  
  manualPinned?: boolean;
}

export type PluginUiRowPinResolver = (toolCallId: string) => PluginUiRowPinContext | undefined;

export function isPluginUiPinnedToolRow(
  row: ConversationRow,
  resolve?: PluginUiRowPinResolver,
): boolean {
  if (row.kind !== "toolCall") return false;
  if (row.status === "error" || row.status === "cancelled") return false;
  const display = row.display;
  if (display?.kind !== "mcp_tool" || display.ui === undefined) return false;
  if (display.ui.isError === true) return false;
  if (!resolve) return true;
  const context = resolve(row.toolCallId);
  if (!context) return true;
  if (context.disposition?.superseded) return false;
  if (context.manualPinned !== undefined) return context.manualPinned;
  if (!context.disposition) return true;
  return context.disposition.forcedInline || context.disposition.autoExpand;
}
