import type { ConversationRow, ToolCallRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import { resolvePluginUiLogicalScope } from "./pluginUiLogicalScope.js";

export const PLUGIN_UI_AUTO_EXPAND_TURNS = 3;

export interface PluginUiLogicalInstance {
  key: string;
  
  activeToolCallId: string;
  
  supersededToolCallIds: string[];
}

export interface PluginUiRowDisposition {
  key: string;
  superseded: boolean;
  
  autoExpand: boolean;
  
  forcedInline: boolean;
}

export interface PluginUiInstanceDerivation {
  instances: PluginUiLogicalInstance[];
  byToolCallId: Readonly<Record<string, PluginUiRowDisposition>>;
}

export const EMPTY_PLUGIN_UI_INSTANCE_DERIVATION: PluginUiInstanceDerivation = {
  instances: [],
  byToolCallId: {},
};

function isPluginUiToolRow(row: ConversationRow): row is ToolCallRow {
  return (
    row.kind === "toolCall" && row.display?.kind === "mcp_tool" && row.display.ui !== undefined
  );
}

function isSuccessfulUiRow(row: ToolCallRow): boolean {
  return (
    row.status === "success" &&
    !(row.display?.kind === "mcp_tool" && row.display.ui?.isError === true)
  );
}

export function deriveLogicalUiInstances(
  rows: readonly ConversationRow[],
  options: { autoExpandTurns?: number } = {},
): PluginUiInstanceDerivation {
  const turnOrder: string[] = [];
  for (const row of rows) {
    if (!turnOrder.includes(row.turnId)) turnOrder.push(row.turnId);
  }
  const recentTurns = turnOrder.slice(-(options.autoExpandTurns ?? PLUGIN_UI_AUTO_EXPAND_TURNS));
  const groupKeys: string[] = [];
  const groups: Record<string, ToolCallRow[]> = {};
  for (const row of rows) {
    if (!isPluginUiToolRow(row)) continue;
    const display = row.display;
    if (display?.kind !== "mcp_tool" || !display.ui) continue;
    const logical = resolvePluginUiLogicalScope(display.ui, {
      kind: "toolCall",
      toolCallId: row.toolCallId,
    });
    const key = JSON.stringify([
      display.ui.pluginId,
      display.serverName,
      display.ui.resourceUri,
      logical,
    ]);
    const group = groups[key];
    if (group) group.push(row);
    else {
      groups[key] = [row];
      groupKeys.push(key);
    }
  }
  const instances: PluginUiLogicalInstance[] = [];
  const byToolCallId: Record<string, PluginUiRowDisposition> = {};
  for (const key of groupKeys) {
    const group = groups[key]!;
    const successes = group.filter(isSuccessfulUiRow);
    const active = successes.at(-1) ?? group.at(-1)!;
    const superseded = successes.filter((row) => row !== active).map((row) => row.toolCallId);
    instances.push({ key, activeToolCallId: active.toolCallId, supersededToolCallIds: superseded });
    for (const row of group) {
      byToolCallId[row.toolCallId] = {
        key,
        superseded: superseded.includes(row.toolCallId),
        autoExpand: recentTurns.includes(row.turnId),
        forcedInline: row.display?.kind === "mcp_tool" && row.display.ui?.showInline === true,
      };
    }
  }
  return { instances, byToolCallId };
}
