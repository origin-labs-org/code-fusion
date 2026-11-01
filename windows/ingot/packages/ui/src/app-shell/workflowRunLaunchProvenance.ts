import type { ConversationRow, WorkflowLaunchMeta } from "@origin-ai/cf-shared/cf-protocol-v4";

interface WorkflowLaunchProvenance {
  meta: WorkflowLaunchMeta;
  startedAt?: number;
}

export function resolveWorkflowLaunchProvenance(
  rows: readonly ConversationRow[] | undefined,
  toolCallId: string,
): WorkflowLaunchProvenance | undefined {
  let fallback: WorkflowLaunchProvenance | undefined;
  for (const row of rows ?? []) {
    if (row.kind === "turnHeader" && row.workflowLaunch?.toolCallId === toolCallId) {
      return { meta: row.workflowLaunch, startedAt: row.startedAt };
    }
    if (
      fallback === undefined &&
      row.kind === "userInput" &&
      row.workflowLaunch?.toolCallId === toolCallId
    ) {
      fallback = { meta: row.workflowLaunch, startedAt: row.createdAt };
    }
  }
  return fallback;
}
