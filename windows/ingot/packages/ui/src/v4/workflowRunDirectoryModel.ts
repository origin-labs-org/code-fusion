import type {
  V4ConversationWorkflowRunSummary,
  WorkflowRunState,
} from "@origin-ai/cf-shared/cf-protocol-v4";

export const WORKFLOW_RUN_DIRECTORY_LIMIT = 64;

export type WorkflowRunDirectoryRow = V4ConversationWorkflowRunSummary & { toolCallId: string };

interface WorkflowRunDirectory {
  
  running: WorkflowRunDirectoryRow[];
  
  ended: WorkflowRunDirectoryRow[];
  
  truncated: boolean;
}

function hasDetailAnchor(
  summary: V4ConversationWorkflowRunSummary,
): summary is WorkflowRunDirectoryRow {
  return summary.toolCallId !== undefined;
}

function isEnded(summary: V4ConversationWorkflowRunSummary): boolean {
  return summary.status !== "pending" && summary.status !== "running";
}

export function buildWorkflowRunDirectory(
  summaries: readonly V4ConversationWorkflowRunSummary[] | null | undefined,
): WorkflowRunDirectory {
  const rows = (summaries ?? []).filter(hasDetailAnchor);
  return {
    running: rows.filter((row) => !isEnded(row)),
    ended: rows.filter(isEnded),
    truncated: (summaries?.length ?? 0) >= WORKFLOW_RUN_DIRECTORY_LIMIT,
  };
}

export function countEndedWorkflowRuns(
  summaries: readonly V4ConversationWorkflowRunSummary[] | null | undefined,
): number {
  return buildWorkflowRunDirectory(summaries).ended.length;
}

export function workflowRunDirectoryRefreshKey(
  runs: readonly WorkflowRunState[] | null | undefined,
): string {
  const all = runs ?? [];
  const settled = all.filter((run) => run.status !== "pending" && run.status !== "running").length;
  return `${all.length}:${settled}`;
}
