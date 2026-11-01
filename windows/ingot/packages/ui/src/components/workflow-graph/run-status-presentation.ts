import type { WorkflowRunState } from "@origin-ai/cf-shared/cf-protocol-v4";
import type { StepRunStatus } from "@/components/workflow-graph/types.js";

export const STATUS_DOT: Record<StepRunStatus, string> = {
  done: "bg-success",
  failed: "bg-destructive ring-2 ring-destructive/30",
  pending: "border-[1.5px] border-foreground-subtlest bg-transparent",
  running: "animate-pulse bg-warning motion-reduce:animate-none",
};

export const DRAFT_FEEDBACK_DOT = {
  open: "border-[1.5px] border-warning bg-transparent",
  settled: STATUS_DOT.pending,
} as const;

export const RUN_STATUS_DOT: Record<WorkflowRunState["status"], string> = {
  pending: STATUS_DOT.pending,
  running: STATUS_DOT.running,
  completed: STATUS_DOT.done,
  errored: STATUS_DOT.failed,
  stopped: STATUS_DOT.pending,
};

export const RUN_STATUS_TEXT: Record<WorkflowRunState["status"], string> = {
  pending: "text-foreground-subtle",
  running: "text-warning",
  completed: "text-success",
  errored: "text-destructive",
  stopped: "text-foreground-subtle",
};

export const WORKFLOW_RUN_STOP_REASONS = [
  "user",
  "model",
  "provider",
  "interrupted",
  "superseded",
] as const;
export type WorkflowRunStopReason = (typeof WORKFLOW_RUN_STOP_REASONS)[number];

export function readWorkflowRunStopReason(run: {
  status?: string;
  stopReason?: unknown;
}): WorkflowRunStopReason | undefined {
  if (run.status !== "stopped") return undefined;
  const reason = run.stopReason;
  return typeof reason === "string" &&
    (WORKFLOW_RUN_STOP_REASONS as readonly string[]).includes(reason)
    ? (reason as WorkflowRunStopReason)
    : undefined;
}

export function workflowRunStopReasonMessageId(reason: WorkflowRunStopReason): string {
  return `chat.toolCall.workflow.run.stopReason.${reason}`;
}

export function isWorkflowRunSuperseded(run: { status?: string; stopReason?: unknown }): boolean {
  return readWorkflowRunStopReason(run) === "superseded";
}
