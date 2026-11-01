import type { CfTaskRuntimeStatus } from "@origin-ai/cf-shared";
import { getWorkspaceDisplayedTaskState } from "@/store/cfSessionStore.js";
import type { CfSessionStoreState, WorkspaceCfUIState } from "@/store/cfSessionStore.js";

interface RemoteWorkspaceRuntimeTab {
  workspacePath: string;
  workspaceIdentity?: string;
}

interface MarkRemoteWorkspaceRunningTasksFailedParams {
  tabs: RemoteWorkspaceRuntimeTab[];
  getWorkspaceState: CfSessionStoreState["getWorkspaceState"];
  setTaskRuntimeState: CfSessionStoreState["setTaskRuntimeState"];
  reason: string;
}

function isRunningRuntimeStatus(status: CfTaskRuntimeStatus): boolean {
  return status === "creating" || status === "restoring" || status === "streaming";
}

function shouldTreatPersistedRunningTaskAsRunning(
  workspaceState: WorkspaceCfUIState,
  taskId: string,
): boolean {
  const runtimeState = workspaceState.taskRuntimeByTaskId[taskId];
  if (!runtimeState) {
    return true;
  }

  return isRunningRuntimeStatus(runtimeState.status);
}

function collectRemoteWorkspaceRunningTaskIds(workspaceState: WorkspaceCfUIState): string[] {
  const taskIds = new Set<string>();

  if (
    workspaceState.activeTaskId &&
    isRunningRuntimeStatus(getWorkspaceDisplayedTaskState(workspaceState).taskStatus)
  ) {
    taskIds.add(workspaceState.activeTaskId);
  }

  for (const [taskId, runtimeState] of Object.entries(workspaceState.taskRuntimeByTaskId)) {
    if (isRunningRuntimeStatus(runtimeState.status)) {
      taskIds.add(taskId);
    }
  }

  for (const task of workspaceState.taskListCache ?? []) {
    if (
      task.status === "running" &&
      shouldTreatPersistedRunningTaskAsRunning(workspaceState, task.taskId)
    ) {
      taskIds.add(task.taskId);
    }
  }

  for (const task of Object.values(workspaceState.optimisticTaskListByTaskId)) {
    if (
      task.status === "running" &&
      shouldTreatPersistedRunningTaskAsRunning(workspaceState, task.taskId)
    ) {
      taskIds.add(task.taskId);
    }
  }

  return [...taskIds];
}

export function markRemoteWorkspaceRunningTasksFailed({
  tabs,
  getWorkspaceState,
  setTaskRuntimeState,
  reason,
}: MarkRemoteWorkspaceRunningTasksFailedParams): number {
  const markedTaskKeys = new Set<string>();

  for (const tab of tabs) {
    const workspaceState = getWorkspaceState(tab.workspacePath, tab.workspaceIdentity);
    const workspaceKey = tab.workspaceIdentity?.trim() || tab.workspacePath;

    for (const taskId of collectRemoteWorkspaceRunningTaskIds(workspaceState)) {
      const taskKey = `${workspaceKey}\0${taskId}`;
      if (markedTaskKeys.has(taskKey)) {
        continue;
      }

      markedTaskKeys.add(taskKey);
      setTaskRuntimeState(tab.workspacePath, taskId, "failed", reason, tab.workspaceIdentity);
    }
  }

  return markedTaskKeys.size;
}
