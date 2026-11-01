import type { CfTaskMeta } from "@origin-ai/cf-shared";
import type { TaskNavEntry } from "@/lib/taskNavigationHistory.js";
import type { TaskEntityKey } from "@/lib/taskQueryCache.js";
import { buildTaskEntityKey } from "@/lib/taskQueryCache.js";

export function taskNavigationTargetExists(params: {
  entry: TaskNavEntry;
  visibleTasks: readonly Pick<CfTaskMeta, "taskId">[];
  taskMetaByEntityKey: Record<TaskEntityKey, CfTaskMeta>;
}): boolean {
  if (params.visibleTasks.some((task) => task.taskId === params.entry.taskId)) {
    return true;
  }

  const cachedTask = params.taskMetaByEntityKey[buildTaskEntityKey(params.entry)];
  if (!cachedTask) {
    return false;
  }

  return cachedTask.taskId === params.entry.taskId;
}
