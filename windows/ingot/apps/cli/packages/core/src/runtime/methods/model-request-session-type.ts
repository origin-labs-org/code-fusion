import { ModelRequestSessionType, ModelRetryBudget, type SessionTaskType } from "@origin-ai/cf-contracts";

export function resolveModelRequestSessionTypeFromTaskType(
  taskType: SessionTaskType | undefined,
): ModelRequestSessionType {
  if (taskType === "subagent_child") return ModelRequestSessionType.Subagent;
  if (taskType === "selection_side_chat") return ModelRequestSessionType.SideChat;
  if (taskType === "workflow_child" || taskType === "nested_workflow_child") {
    return ModelRequestSessionType.Other;
  }
  return ModelRequestSessionType.Main;
}

export function resolveModelRetryBudgetFromTaskType(
  taskType: SessionTaskType | undefined,
): ModelRetryBudget {
  if (taskType === "workflow_child" || taskType === "nested_workflow_child") {
    return ModelRetryBudget.Unbounded;
  }
  return ModelRetryBudget.Default;
}
