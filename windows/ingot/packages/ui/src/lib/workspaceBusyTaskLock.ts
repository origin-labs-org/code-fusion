import type { CfProvider, CfTaskRuntimeStatus } from "@origin-ai/cf-shared";

function isBusyTaskRuntimeStatus(status: CfTaskRuntimeStatus): boolean {
  return status === "creating" || status === "restoring" || status === "streaming";
}

function buildTaskProviderByTaskId(
  optimisticTaskMetaByTaskId: Record<string, { provider?: CfProvider }>,
  taskListCache?: Array<{ taskId: string; provider?: CfProvider }> | null,
): Record<string, CfProvider | undefined> {
  const providerByTaskId: Record<string, CfProvider | undefined> = {};

  for (const task of taskListCache ?? []) {
    if (!task.provider) {
      continue;
    }
    providerByTaskId[task.taskId] = task.provider;
  }

  for (const [taskId, meta] of Object.entries(optimisticTaskMetaByTaskId)) {
    if (!meta.provider) {
      continue;
    }
    providerByTaskId[taskId] = meta.provider;
  }

  return providerByTaskId;
}

export function hasBusyTaskInWorkspaceProvider(
  selectedProvider: CfProvider,
  taskRuntimeByTaskId: Record<string, { status: CfTaskRuntimeStatus; provider?: CfProvider }>,
  optimisticTaskMetaByTaskId: Record<string, { provider?: CfProvider }>,
  taskListCache?: Array<{ taskId: string; provider?: CfProvider }> | null,
  activeTaskId?: string | null,
): boolean {
  const providerByTaskId = buildTaskProviderByTaskId(optimisticTaskMetaByTaskId, taskListCache);
  const normalizedActiveTaskId = activeTaskId?.trim() ?? "";

  for (const [taskId, runtimeState] of Object.entries(taskRuntimeByTaskId)) {
    if (!isBusyTaskRuntimeStatus(runtimeState.status)) {
      continue;
    }

    const taskProvider = runtimeState.provider ?? providerByTaskId[taskId];
    if (!taskProvider) {
      if (normalizedActiveTaskId.length > 0 && normalizedActiveTaskId === taskId) {
        return true;
      }
      continue;
    }

    if (taskProvider === selectedProvider) {
      return true;
    }
  }

  return false;
}
