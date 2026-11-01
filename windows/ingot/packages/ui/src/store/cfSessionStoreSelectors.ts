
import type {
  CfTaskRuntimeStatus,
  CfTaskMeta,
} from "@origin-ai/cf-shared";
import { mergeTaskWithOptimisticMeta } from "@/lib/cfTaskMetaMerge.js";
import {
  DEFAULT_TASK_UI_STATE,
  DEFAULT_WORKSPACE_INIT_STATE,
  DEFAULT_TASK_RUNTIME_STATE,
  createDefaultWorkspaceState,
  getDefaultWorkspaceState,
  type CfSessionStoreState,
  type WorkspaceInitState,
  type TaskRuntimeState,
  type WorkspaceCfUIState,
} from "./cfSessionStoreTypes.js";

// ────────────────────────────────────────────
// ────────────────────────────────────────────

export function resolveWorkspaceStateKey(
  workspacePath: string,
  workspaceIdentity?: string,
): string {
  return workspaceIdentity?.trim() || workspacePath;
}

function copyTaskRecordEntries<T>(
  record: Record<string, T>,
  taskIds: ReadonlySet<string>,
): Record<string, T> {
  const entries = Object.entries(record).filter(([taskId]) => taskIds.has(taskId));
  return entries.length > 0 ? Object.fromEntries(entries) : {};
}

function collectIdentityTaskIds(
  baseState: WorkspaceCfUIState,
  workspaceIdentity: string,
): Set<string> {
  const normalizedIdentity = workspaceIdentity.trim();
  const taskIds = new Set<string>();
  for (const task of baseState.taskListCache ?? []) {
    if (task.workspaceIdentity?.trim() === normalizedIdentity) {
      taskIds.add(task.taskId);
    }
  }
  for (const task of Object.values(baseState.optimisticTaskListByTaskId)) {
    if (task.workspaceIdentity?.trim() === normalizedIdentity) {
      taskIds.add(task.taskId);
    }
  }
  return taskIds;
}

function createIdentityWorkspaceStateSeed(
  baseState: WorkspaceCfUIState | undefined,
  workspaceIdentity?: string,
): WorkspaceCfUIState {
  if (!baseState) {
    return createDefaultWorkspaceState(getDefaultWorkspaceState().selectedProvider);
  }

  const seededState = createDefaultWorkspaceState(baseState.selectedProvider);
  const migratedTaskIds = workspaceIdentity
    ? collectIdentityTaskIds(baseState, workspaceIdentity)
    : new Set<string>();
  const migratedTaskListCache =
    baseState.taskListCache?.filter((task) => migratedTaskIds.has(task.taskId)) ?? null;
  return {
    ...seededState,
    selectedSupplierKey: baseState.selectedSupplierKey,
    isGhostSupplier: baseState.isGhostSupplier,
    supplierMismatchReason: baseState.supplierMismatchReason,
    configOptions: baseState.configOptions,
    configOptionsStatus: baseState.configOptionsStatus,
    slashCommands: baseState.slashCommands,
    ...(migratedTaskIds.size > 0
      ? {
          activeTaskId:
            baseState.activeTaskId && migratedTaskIds.has(baseState.activeTaskId)
              ? baseState.activeTaskId
              : seededState.activeTaskId,
          optimisticTaskListByTaskId: copyTaskRecordEntries(
            baseState.optimisticTaskListByTaskId,
            migratedTaskIds,
          ),
          taskConfigOptionsByTaskId: copyTaskRecordEntries(
            baseState.taskConfigOptionsByTaskId,
            migratedTaskIds,
          ),
          taskConfigOptionsStatusByTaskId: copyTaskRecordEntries(
            baseState.taskConfigOptionsStatusByTaskId,
            migratedTaskIds,
          ),
          taskListCache: migratedTaskListCache,
          taskListVersion: baseState.taskListVersion,
          taskRuntimeByTaskId: copyTaskRecordEntries(
            baseState.taskRuntimeByTaskId,
            migratedTaskIds,
          ),
          taskUiByTaskId: copyTaskRecordEntries(baseState.taskUiByTaskId, migratedTaskIds),
          taskUnreadByTaskId: copyTaskRecordEntries(
            baseState.taskUnreadByTaskId,
            migratedTaskIds,
          ),
        }
      : {}),
  };
}

export function getWorkspaceState(
  state: CfSessionStoreState,
  workspacePath: string,
  workspaceIdentity?: string,
): WorkspaceCfUIState {
  const baseState = state.workspaces[workspacePath] ?? getDefaultWorkspaceState();
  const workspaceKey = resolveWorkspaceStateKey(workspacePath, workspaceIdentity);
  if (workspaceKey === workspacePath) {
    return baseState;
  }

  const identityState = state.workspaces[workspaceKey];
  if (!identityState) {
    return baseState;
  }

  return identityState;
}

export function updateWorkspaceState(
  state: CfSessionStoreState,
  workspacePath: string,
  updater: (current: WorkspaceCfUIState) => WorkspaceCfUIState,
  workspaceIdentity?: string,
): Pick<CfSessionStoreState, "workspaces"> {
  const workspaceKey = resolveWorkspaceStateKey(workspacePath, workspaceIdentity);
  const current =
    workspaceKey === workspacePath
      ? getWorkspaceState(state, workspacePath, workspaceIdentity)
      : (state.workspaces[workspaceKey] ??
        createIdentityWorkspaceStateSeed(state.workspaces[workspacePath], workspaceIdentity));
  const nextWorkspaceState = updater(current);

  if (nextWorkspaceState === current) {
    return { workspaces: state.workspaces };
  }

  if (workspaceKey === workspacePath) {
    return {
      workspaces: {
        ...state.workspaces,
        [workspacePath]: nextWorkspaceState,
      },
    };
  }

  return {
    workspaces: {
      ...state.workspaces,
      [workspaceKey]: nextWorkspaceState,
    },
  };
}

// ────────────────────────────────────────────
// Per-task accessor functions
// ────────────────────────────────────────────

export function getTaskRuntimeState(
  workspaceState: WorkspaceCfUIState,
  taskId: string,
): TaskRuntimeState {
  return workspaceState.taskRuntimeByTaskId[taskId] ?? DEFAULT_TASK_RUNTIME_STATE;
}

interface WorkspaceDisplayedTaskState {
  taskStatus: CfTaskRuntimeStatus;
  taskError: string | null;
}

export function getWorkspaceDisplayedTaskState(
  workspaceState: WorkspaceCfUIState,
): WorkspaceDisplayedTaskState {
  if (!workspaceState.activeTaskId) {
    return {
      taskStatus: workspaceState.draftRuntime.status,
      taskError: workspaceState.draftRuntime.error,
    };
  }

  const runtimeState = getTaskRuntimeState(workspaceState, workspaceState.activeTaskId);
  return {
    taskStatus: runtimeState.status,
    taskError: runtimeState.error,
  };
}

export function getTaskUiState(workspaceState: WorkspaceCfUIState, taskId: string) {
  return workspaceState.taskUiByTaskId[taskId] ?? DEFAULT_TASK_UI_STATE;
}

export function hasTaskPendingPermissionRequest(
  workspaceState: WorkspaceCfUIState,
  taskId: string,
): boolean {
  const taskUiState = getTaskUiState(workspaceState, taskId);
  return taskUiState.permissionRequest != null ||
    (taskUiState.pendingPermissionRequests?.length ?? 0) > 0;
}

export function hasTaskPendingHumanInterventionRequest(
  workspaceState: WorkspaceCfUIState,
  taskId: string,
): boolean {
  const taskUiState = getTaskUiState(workspaceState, taskId);
  return hasTaskPendingPermissionRequest(workspaceState, taskId) ||
    taskUiState.elicitationRequest != null ||
    (taskUiState.pendingElicitationRequests?.length ?? 0) > 0;
}

export function getTaskMeta(
  workspaceState:
    | WorkspaceCfUIState
    | Partial<Pick<WorkspaceCfUIState, "optimisticTaskListByTaskId" | "taskListCache">>,
  taskId: string,
): CfTaskMeta | null {
  const optimisticTask = workspaceState.optimisticTaskListByTaskId?.[taskId];
  const cachedTask = workspaceState.taskListCache?.find((task) => task.taskId === taskId) ?? null;

  if (!optimisticTask) {
    return cachedTask;
  }

  if (!cachedTask) {
    return optimisticTask;
  }

  return mergeTaskWithOptimisticMeta(cachedTask, optimisticTask);
}

export function getVisibleTaskMetas(
  workspaceState:
    | WorkspaceCfUIState
    | Partial<Pick<WorkspaceCfUIState, "optimisticTaskListByTaskId" | "taskListCache">>,
): CfTaskMeta[] {
  const taskById = new Map<string, CfTaskMeta>();

  for (const task of workspaceState.taskListCache ?? []) {
    taskById.set(task.taskId, task);
  }

  for (const task of Object.values(workspaceState.optimisticTaskListByTaskId ?? {})) {
    taskById.set(task.taskId, getTaskMeta(workspaceState, task.taskId) ?? task);
  }

  return Array.from(taskById.values());
}

export function getTaskUnreadIndicator(
  workspaceState:
    | WorkspaceCfUIState
    | Partial<
        Pick<
          WorkspaceCfUIState,
          "optimisticTaskListByTaskId" | "taskListCache" | "taskUnreadByTaskId"
        >
      >,
  taskId: string,
  fallbackTask?: Pick<CfTaskMeta, "unreadAt">,
): boolean {
  const storedTask = getTaskMeta(workspaceState, taskId);
  return (
    Boolean((storedTask ?? fallbackTask)?.unreadAt) ||
    workspaceState.taskUnreadByTaskId?.[taskId] === true
  );
}

// ────────────────────────────────────────────
// Standalone selector functions
// ────────────────────────────────────────────

export function selectWorkspaceCfState(
  state: CfSessionStoreState,
  workspacePath: string,
  workspaceIdentity?: string,
) {
  return getWorkspaceState(state, workspacePath, workspaceIdentity);
}

export function getWorkspaceInitState(
  workspaceState: Pick<WorkspaceCfUIState, "workspaceInit">,
): WorkspaceInitState {
  return workspaceState.workspaceInit ?? DEFAULT_WORKSPACE_INIT_STATE;
}
