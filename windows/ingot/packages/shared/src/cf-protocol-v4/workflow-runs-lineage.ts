
import { WORKFLOW_RUN_STOP_REASONS } from "./workflow-observation-display.js";
import type { WorkflowRunState } from "./workflow-runs.js";

export function readRunIdField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readWorkflowRunStopReason(value: unknown): WorkflowRunState["stopReason"] {
  return typeof value === "string" &&
    (WORKFLOW_RUN_STOP_REASONS as readonly string[]).includes(value)
    ? (value as WorkflowRunState["stopReason"])
    : undefined;
}
