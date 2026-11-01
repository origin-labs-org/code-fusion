import type { SessionTaskType } from "@origin-ai/cf-contracts";

export const TASK_LIST_SESSION_TYPES = [
  "interactive",
  "fork",
  "workflow_parent",
] as const satisfies readonly SessionTaskType[];

const TASK_LIST_SESSION_TYPE_SET = new Set<SessionTaskType>(
  TASK_LIST_SESSION_TYPES,
);

export function isTaskListSessionType(
  taskType: SessionTaskType | undefined,
): boolean {
  return TASK_LIST_SESSION_TYPE_SET.has(taskType ?? "interactive");
}
