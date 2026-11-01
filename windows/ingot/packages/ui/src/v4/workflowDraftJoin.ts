import type { ConversationRow, ToolCallRow } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { WorkflowDraftPosition } from "@/ToolCallBlocks/shared.js";
import {
  isPlainRecord,
  readWorkflowAmendTarget,
} from "@/ToolCallBlocks/renderers/createWorkflowInput.js";
import { isAmendWorkflowToolCall, isCreateWorkflowToolCall } from "@/lib/workflowToolNames.js";

export function buildWorkflowDraftByToolCallId(
  rows: readonly ConversationRow[] | undefined,
): ReadonlyMap<string, WorkflowDraftPosition> {
  const byToolCallId = new Map<string, WorkflowDraftPosition>();
  const latestByLineage = new Map<string, string>();
  const failuresByLineageTurn = new Map<string, number>();

  for (const row of rows ?? []) {
    if (row.kind !== "toolCall") continue;
    const lineage = workflowDraftLineage(row);
    if (lineage === undefined) continue;

    const previous = latestByLineage.get(lineage);
    if (previous !== undefined) {
      const position = byToolCallId.get(previous);
      if (position !== undefined) byToolCallId.set(previous, { ...position, superseded: true });
    }
    latestByLineage.set(lineage, row.toolCallId);

    const turnKey = `${lineage}\u0000${row.turnId}`;
    const failures = failuresByLineageTurn.get(turnKey) ?? 0;
    byToolCallId.set(row.toolCallId, { ordinal: failures + 1, superseded: false });

    const compiled = readCompiled(row);
    if (compiled === false) failuresByLineageTurn.set(turnKey, failures + 1);
    if (compiled === true) failuresByLineageTurn.set(turnKey, 0);
  }
  return byToolCallId;
}

function workflowDraftLineage(row: ToolCallRow): string | undefined {
  if (isAmendWorkflowToolCall(row)) {
    return `amend\u0000${readWorkflowAmendTarget(row.input) ?? ""}`;
  }
  return isCreateWorkflowToolCall(row) ? "create" : undefined;
}

function readCompiled(row: ToolCallRow): boolean | undefined {
  const display: unknown = row.output?.display ?? row.display;
  if (!isPlainRecord(display) || display.kind !== "create_workflow") return undefined;
  return typeof display.ok === "boolean" ? display.ok : undefined;
}
