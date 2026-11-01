
import {
  normalizeAgentProviderToCfAgent,
  type CfApiRetryStatus,
  type CfConfigOption,
  type CfPermissionRequest,
  type CfElicitationRequest,
  type CfProvider,
  type CfTaskRuntimeStatus,
  type CfTaskMeta,
} from "@origin-ai/cf-shared";
import type { CfUiError } from "@/lib/cfUiError.js";
import { removeTaskFromHistory } from "@/lib/taskNavigationHistory.js";
import { mergeTaskWithOptimisticMeta } from "@/lib/cfTaskMetaMerge.js";
import type {
  ConfigOptionsStatus,
  ElicitationFormDraft,
  CfSessionStoreState,
  TaskUsageState,
} from "@/store/cfSessionStoreTypes.js";
import { getDefaultWorkspaceState } from "@/store/cfSessionStoreTypes.js";
import { clearPersistedComposerDraft } from "@/lib/chatComposerDraftStorage.js";
import { areConfigOptionsEquivalent } from "@/lib/configOptionsEquality.js";
import {
  getTaskRuntimeState,
  getTaskUiState,
  getWorkspaceState,
  resolveWorkspaceStateKey,
  updateWorkspaceState,
} from "@/store/cfSessionStoreSelectors.js";

type SetFn = (
  partial:
    | CfSessionStoreState
    | Partial<CfSessionStoreState>
    | ((state: CfSessionStoreState) => CfSessionStoreState | Partial<CfSessionStoreState>),
) => void;

function sortTasksByUpdatedAt(tasks: readonly CfTaskMeta[]): CfTaskMeta[] {
  return [...tasks].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    if (right.createdAt !== left.createdAt) {
      return right.createdAt - left.createdAt;
    }
    return right.taskId.localeCompare(left.taskId);
  });
}

function arePermissionOptionsEqual(
  left: CfPermissionRequest["options"],
  right: CfPermissionRequest["options"],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((option, index) => {
    const otherOption = right[index];
    if (!otherOption) {
      return false;
    }

    return (
      option.optionId === otherOption.optionId &&
      option.kind === otherOption.kind &&
      option.name === otherOption.name
    );
  });
}

function arePermissionRequestsEquivalent(
  left: CfPermissionRequest,
  right: CfPermissionRequest,
): boolean {
  if (left === right) {
    return true;
  }

  return (
    left.requestId === right.requestId &&
    left.taskId === right.taskId &&
    left.traceId === right.traceId &&
    left.inputId === right.inputId &&
    left.kind === right.kind &&
    left.title === right.title &&
    left.description === right.description &&
    arePermissionOptionsEqual(left.options, right.options)
  );
}

function areTaskUsageCostsEqual(
  left: TaskUsageState["cost"] | undefined,
  right: TaskUsageState["cost"] | undefined,
): boolean {
  const normalizedLeft = left ?? null;
  const normalizedRight = right ?? null;
  if (normalizedLeft === null || normalizedRight === null) {
    return normalizedLeft === normalizedRight;
  }
  return (
    normalizedLeft.amount === normalizedRight.amount &&
    normalizedLeft.currency === normalizedRight.currency
  );
}

function areTaskUsageCachesEqual(
  left: TaskUsageState["cache"] | undefined,
  right: TaskUsageState["cache"] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.inputTokens === right.inputTokens &&
    left.cacheReadTokens === right.cacheReadTokens &&
    left.cacheWriteTokens === right.cacheWriteTokens &&
    left.latestHitRate === right.latestHitRate &&
    left.hitRate === right.hitRate &&
    left.hitRateRequestCount === right.hitRateRequestCount &&
    left.totalInputTokens === right.totalInputTokens &&
    left.totalCacheReadTokens === right.totalCacheReadTokens &&
    left.totalCacheWriteTokens === right.totalCacheWriteTokens
  );
}

function areTaskUsageBreakdownsEqual(
  left: TaskUsageState["breakdown"] | undefined,
  right: TaskUsageState["breakdown"] | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every(
    (item, index) => item.source === right[index]?.source && item.chars === right[index]?.chars,
  );
}

function areTaskUsageStatesEqual(
  left: TaskUsageState | null,
  right: TaskUsageState | null,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.size === right.size &&
    left.used === right.used &&
    areTaskUsageCostsEqual(left.cost, right.cost) &&
    areTaskUsageCachesEqual(left.cache, right.cache) &&
    areTaskUsageBreakdownsEqual(left.breakdown, right.breakdown)
  );
}

function normalizeTaskContextWindow(contextWindow: number | null): number | null {
  if (contextWindow === null) {
    return null;
  }
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }
  return Math.floor(contextWindow);
}

function updateWorkspaceStateForIdentityScopedTaskState(
  state: CfSessionStoreState,
  workspacePath: string,
  workspaceIdentity: string | undefined,
  updater: (
    current: ReturnType<typeof getDefaultWorkspaceState>,
  ) => ReturnType<typeof getDefaultWorkspaceState>,
): Pick<CfSessionStoreState, "workspaces"> {
  const workspaceKey = resolveWorkspaceStateKey(workspacePath, workspaceIdentity);
  if (workspaceKey === workspacePath) {
    return updateWorkspaceState(state, workspacePath, updater);
  }
  const current = state.workspaces[workspaceKey] ?? getDefaultWorkspaceState();
  return {
    workspaces: {
      ...state.workspaces,
      [workspaceKey]: updater(current),
    },
  };
}

export function createTaskSlice(set: SetFn) {
  return {
    setTaskRuntimeState: (
      workspacePath: string,
      taskId: string,
      status: CfTaskRuntimeStatus,
      error?: string | null,
      workspaceIdentity?: string,
      provider?: CfProvider,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const currentTaskRuntime = getTaskRuntimeState(current, taskId);
            const isRunningStatus =
              status === "creating" || status === "restoring" || status === "streaming";
            const nextTaskRuntime = {
              ...currentTaskRuntime,
              status,
              error: error ?? null,
              provider: provider ?? currentTaskRuntime.provider,
              activeTurnKind: isRunningStatus ? currentTaskRuntime.activeTurnKind : undefined,
              activeInputId: isRunningStatus ? currentTaskRuntime.activeInputId : undefined,
              activeInputOwnerClientId: isRunningStatus
                ? currentTaskRuntime.activeInputOwnerClientId
                : undefined,
            };
            return {
              ...current,
              taskRuntimeByTaskId: {
                ...current.taskRuntimeByTaskId,
                [taskId]: nextTaskRuntime,
              },
            };
          },
          workspaceIdentity,
        ),
      );
    },

    setTaskUsage: (
      workspacePath: string,
      taskId: string,
      usage: TaskUsageState | null,
      workspaceIdentity?: string,
    ) => {
      set((state) => {
        const current = getWorkspaceState(state, workspacePath, workspaceIdentity);
        const currentRuntime = getTaskRuntimeState(current, taskId);
        if (areTaskUsageStatesEqual(currentRuntime.usage, usage)) {
          return state;
        }
        return updateWorkspaceStateForIdentityScopedTaskState(
          state,
          workspacePath,
          workspaceIdentity,
          (current) => ({
            ...current,
            taskRuntimeByTaskId: {
              ...current.taskRuntimeByTaskId,
              [taskId]: {
                ...getTaskRuntimeState(current, taskId),
                usage,
              },
            },
          }),
        );
      });
    },

    setTaskContextWindow: (
      workspacePath: string,
      taskId: string,
      contextWindow: number | null,
      workspaceIdentity?: string,
    ) => {
      const normalizedContextWindow = normalizeTaskContextWindow(contextWindow);
      set((state) => {
        const current = getWorkspaceState(state, workspacePath, workspaceIdentity);
        const currentRuntime = getTaskRuntimeState(current, taskId);
        if (currentRuntime.contextWindow === normalizedContextWindow) {
          return state;
        }
        return updateWorkspaceStateForIdentityScopedTaskState(
          state,
          workspacePath,
          workspaceIdentity,
          (current) => ({
            ...current,
            taskRuntimeByTaskId: {
              ...current.taskRuntimeByTaskId,
              [taskId]: {
                ...getTaskRuntimeState(current, taskId),
                contextWindow: normalizedContextWindow,
              },
            },
          }),
        );
      });
    },

    setTaskApiRetryStatus: (
      workspacePath: string,
      taskId: string,
      apiRetry: CfApiRetryStatus | null,
      workspaceIdentity?: string,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => ({
            ...current,
            taskRuntimeByTaskId: {
              ...current.taskRuntimeByTaskId,
              [taskId]: {
                ...getTaskRuntimeState(current, taskId),
                apiRetry,
              },
            },
          }),
          workspaceIdentity,
        ),
      );
    },

    setTaskConfigOptions: (
      workspacePath: string,
      taskId: string,
      options: CfConfigOption[],
      workspaceIdentity?: string,
      status: ConfigOptionsStatus = "ready",
    ) => {
      const normalizedOptions = [...options];
      set((state) => {
        const current = getWorkspaceState(state, workspacePath, workspaceIdentity);
        const currentOptions = current.taskConfigOptionsByTaskId[taskId] ?? [];
        const currentStatus = current.taskConfigOptionsStatusByTaskId[taskId] ?? "ready";
        if (
          currentStatus === status &&
          areConfigOptionsEquivalent(currentOptions, normalizedOptions)
        ) {
          return state;
        }

        return updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            return {
              ...current,
              taskConfigOptionsByTaskId: {
                ...current.taskConfigOptionsByTaskId,
                [taskId]: normalizedOptions,
              },
              taskConfigOptionsStatusByTaskId: {
                ...current.taskConfigOptionsStatusByTaskId,
                [taskId]: status,
              },
            };
          },
          workspaceIdentity,
        );
      });
    },

    setTaskPermissionRequest: (
      workspacePath: string,
      taskId: string,
      request: CfPermissionRequest | null,
      workspaceIdentity?: string,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const taskUiState = getTaskUiState(current, taskId);
            if (request === null) {
              if (
                taskUiState.permissionRequest === null &&
                taskUiState.pendingPermissionRequests.length === 0
              ) {
                return current;
              }

              return {
                ...current,
                taskUiByTaskId: {
                  ...current.taskUiByTaskId,
                  [taskId]: {
                    ...taskUiState,
                    permissionRequest: null,
                    pendingPermissionRequests: [],
                  },
                },
              };
            }

            const currentPermissionRequest = taskUiState.permissionRequest;
            const pendingPermissionRequests = taskUiState.pendingPermissionRequests ?? [];

            let nextPermissionRequest = currentPermissionRequest;
            let nextPendingPermissionRequests = pendingPermissionRequests;

            if (currentPermissionRequest?.requestId === request.requestId) {
              if (arePermissionRequestsEquivalent(currentPermissionRequest, request)) {
                return current;
              }
              nextPermissionRequest = request;
            } else if (currentPermissionRequest === null) {
              nextPermissionRequest = request;
              nextPendingPermissionRequests = pendingPermissionRequests.filter(
                (item) => item.requestId !== request.requestId,
              );
            } else {
              const existingPendingIndex = pendingPermissionRequests.findIndex(
                (item) => item.requestId === request.requestId,
              );
              if (existingPendingIndex >= 0) {
                const existingPendingRequest = pendingPermissionRequests[existingPendingIndex];
                if (!existingPendingRequest) {
                  return current;
                }
                if (arePermissionRequestsEquivalent(existingPendingRequest, request)) {
                  return current;
                }
                nextPendingPermissionRequests = pendingPermissionRequests.map((item, index) =>
                  index === existingPendingIndex ? request : item,
                );
              } else {
                nextPendingPermissionRequests = [...pendingPermissionRequests, request];
              }
            }

            return {
              ...current,
              taskUiByTaskId: {
                ...current.taskUiByTaskId,
                [taskId]: {
                  ...taskUiState,
                  permissionRequest: nextPermissionRequest,
                  pendingPermissionRequests: nextPendingPermissionRequests,
                },
              },
            };
          },
          workspaceIdentity,
        ),
      );
    },

    removeTaskPermissionRequest: (
      workspacePath: string,
      taskId: string,
      requestId: string,
      workspaceIdentity?: string,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const taskUiState = getTaskUiState(current, taskId);
            const currentPermissionRequest = taskUiState.permissionRequest;
            const pendingPermissionRequests = taskUiState.pendingPermissionRequests ?? [];

            if (currentPermissionRequest?.requestId === requestId) {
              const [nextPermissionRequest, ...restPendingPermissionRequests] =
                pendingPermissionRequests;
              return {
                ...current,
                taskUiByTaskId: {
                  ...current.taskUiByTaskId,
                  [taskId]: {
                    ...taskUiState,
                    permissionRequest: nextPermissionRequest ?? null,
                    pendingPermissionRequests: restPendingPermissionRequests,
                  },
                },
              };
            }

            const pendingPermissionIndex = pendingPermissionRequests.findIndex(
              (item) => item.requestId === requestId,
            );
            if (pendingPermissionIndex < 0) {
              return current;
            }

            return {
              ...current,
              taskUiByTaskId: {
                ...current.taskUiByTaskId,
                [taskId]: {
                  ...taskUiState,
                  pendingPermissionRequests: pendingPermissionRequests.filter(
                    (_item, index) => index !== pendingPermissionIndex,
                  ),
                },
              },
            };
          },
          workspaceIdentity,
        ),
      );
    },

    setTaskElicitationRequest: (
      workspacePath: string,
      taskId: string,
      request: CfElicitationRequest | null,
      workspaceIdentity?: string,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const taskUiState = getTaskUiState(current, taskId);
            if (request === null) {
              return {
                ...current,
                taskUiByTaskId: {
                  ...current.taskUiByTaskId,
                  [taskId]: {
                    ...taskUiState,
                    elicitationRequest: null,
                    pendingElicitationRequests: [],
                  },
                },
              };
            }

            const currentElicitationRequest = taskUiState.elicitationRequest;
            const pendingElicitationRequests = taskUiState.pendingElicitationRequests ?? [];

            let nextElicitationRequest = currentElicitationRequest;
            let nextPendingElicitationRequests = pendingElicitationRequests;

            if (currentElicitationRequest?.requestId === request.requestId) {
              nextElicitationRequest = request;
            } else if (currentElicitationRequest === null) {
              nextElicitationRequest = request;
              nextPendingElicitationRequests = pendingElicitationRequests.filter(
                (item) => item.requestId !== request.requestId,
              );
            } else {
              const existingPendingIndex = pendingElicitationRequests.findIndex(
                (item) => item.requestId === request.requestId,
              );
              if (existingPendingIndex >= 0) {
                nextPendingElicitationRequests = pendingElicitationRequests.map((item, index) =>
                  index === existingPendingIndex ? request : item,
                );
              } else {
                nextPendingElicitationRequests = [...pendingElicitationRequests, request];
              }
            }

            return {
              ...current,
              taskUiByTaskId: {
                ...current.taskUiByTaskId,
                [taskId]: {
                  ...taskUiState,
                  elicitationRequest: nextElicitationRequest,
                  pendingElicitationRequests: nextPendingElicitationRequests,
                },
              },
            };
          },
          workspaceIdentity,
        ),
      );
    },

    removeTaskElicitationRequest: (
      workspacePath: string,
      taskId: string,
      requestId: string,
      workspaceIdentity?: string,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const taskUiState = getTaskUiState(current, taskId);
            const currentElicitationRequest = taskUiState.elicitationRequest;
            const pendingElicitationRequests = taskUiState.pendingElicitationRequests ?? [];

            if (currentElicitationRequest?.requestId === requestId) {
              const [nextElicitationRequest, ...restPendingElicitationRequests] =
                pendingElicitationRequests;
              return {
                ...current,
                taskUiByTaskId: {
                  ...current.taskUiByTaskId,
                  [taskId]: {
                    ...taskUiState,
                    elicitationRequest: nextElicitationRequest ?? null,
                    pendingElicitationRequests: restPendingElicitationRequests,
                  },
                },
              };
            }

            return {
              ...current,
              taskUiByTaskId: {
                ...current.taskUiByTaskId,
                [taskId]: {
                  ...taskUiState,
                  pendingElicitationRequests: pendingElicitationRequests.filter(
                    (item) => item.requestId !== requestId,
                  ),
                },
              },
            };
          },
          workspaceIdentity,
        ),
      );
    },

    setTaskElicitationFormDraft: (
      workspacePath: string,
      taskId: string,
      requestId: string,
      draft: ElicitationFormDraft,
      workspaceIdentity?: string,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const taskUiState = getTaskUiState(current, taskId);
            return {
              ...current,
              taskUiByTaskId: {
                ...current.taskUiByTaskId,
                [taskId]: {
                  ...taskUiState,
                  elicitationFormDraftsByRequestId: {
                    ...taskUiState.elicitationFormDraftsByRequestId,
                    [requestId]: draft,
                  },
                },
              },
            };
          },
          workspaceIdentity,
        ),
      );
    },

    removeTaskElicitationFormDraft: (
      workspacePath: string,
      taskId: string,
      requestId: string,
      workspaceIdentity?: string,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const taskUiState = getTaskUiState(current, taskId);
            if (!(requestId in taskUiState.elicitationFormDraftsByRequestId)) {
              return current;
            }
            const nextDrafts = { ...taskUiState.elicitationFormDraftsByRequestId };
            delete nextDrafts[requestId];
            return {
              ...current,
              taskUiByTaskId: {
                ...current.taskUiByTaskId,
                [taskId]: {
                  ...taskUiState,
                  elicitationFormDraftsByRequestId: nextDrafts,
                },
              },
            };
          },
          workspaceIdentity,
        ),
      );
    },

    setTaskError: (
      workspacePath: string,
      taskId: string,
      error: CfUiError | null,
      workspaceIdentity?: string,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => ({
            ...current,
            taskUiByTaskId: {
              ...current.taskUiByTaskId,
              [taskId]: {
                ...getTaskUiState(current, taskId),
                error,
              },
            },
          }),
          workspaceIdentity,
        ),
      );
    },

    initializeBackgroundTaskRuntime: (
      workspacePath: string,
      params: {
        task: CfTaskMeta;
        provider: CfProvider;
        activeInputId: string;
        workspaceIdentity?: string;
      },
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const existingTask = current.optimisticTaskListByTaskId[params.task.taskId];
            const nextTask = existingTask
              ? mergeTaskWithOptimisticMeta(params.task, existingTask)
              : params.task;
            const currentTaskRuntime = getTaskRuntimeState(current, params.task.taskId);
            const cachedTasks = current.taskListCache ?? [];
            const nextTaskListCache =
              current.taskListCache === null
                ? current.taskListCache
                : sortTasksByUpdatedAt([
                    nextTask,
                    ...cachedTasks.filter((cachedTask) => cachedTask.taskId !== params.task.taskId),
                  ]);

            return {
              ...current,
              selectedProvider: normalizeAgentProviderToCfAgent(params.provider),
              optimisticTaskListByTaskId: {
                ...current.optimisticTaskListByTaskId,
                [params.task.taskId]: nextTask,
              },
              taskListCache: nextTaskListCache,
              taskRuntimeByTaskId: {
                ...current.taskRuntimeByTaskId,
                [params.task.taskId]: {
                  ...currentTaskRuntime,
                  status: "streaming",
                  error: null,
                  provider: params.provider,
                  activeInputId: params.activeInputId,
                },
              },
            };
          },
          params.workspaceIdentity ?? params.task.workspaceIdentity,
        ),
      );
    },

    upsertOptimisticTaskListItem: (
      workspacePath: string,
      task: CfTaskMeta,
      workspaceIdentity?: string,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const existingTask = current.optimisticTaskListByTaskId[task.taskId];
            const nextTask = existingTask ? mergeTaskWithOptimisticMeta(task, existingTask) : task;

            return {
              ...current,
              optimisticTaskListByTaskId: {
                ...current.optimisticTaskListByTaskId,
                [task.taskId]: nextTask,
              },
            };
          },
          workspaceIdentity ?? task.workspaceIdentity,
        ),
      );
    },

    removeOptimisticTaskListItem: (
      workspacePath: string,
      taskId: string,
      workspaceIdentity?: string,
    ) => {
      set((state) =>
        updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const { [taskId]: _removedTaskMeta, ...restOptimisticTaskListByTaskId } =
              current.optimisticTaskListByTaskId;
            return {
              ...current,
              optimisticTaskListByTaskId: restOptimisticTaskListByTaskId,
            };
          },
          workspaceIdentity,
        ),
      );
    },

    removeTaskState: (workspacePath: string, taskId: string, workspaceIdentity?: string) => {
      clearPersistedComposerDraft(workspacePath, taskId, workspaceIdentity);
      set((state) => {
        const workspaceUpdate = updateWorkspaceState(
          state,
          workspacePath,
          (current) => {
            const { [taskId]: _removedTaskRuntime, ...restTaskRuntimeByTaskId } =
              current.taskRuntimeByTaskId;
            const { [taskId]: _removedTaskUi, ...restTaskUiByTaskId } = current.taskUiByTaskId;
            const { [taskId]: _removedTaskConfigOptions, ...restTaskConfigOptionsByTaskId } =
              current.taskConfigOptionsByTaskId;
            const {
              [taskId]: _removedTaskConfigOptionsStatus,
              ...restTaskConfigOptionsStatusByTaskId
            } = current.taskConfigOptionsStatusByTaskId;
            const { [taskId]: _removedTaskUnread, ...restTaskUnreadByTaskId } =
              current.taskUnreadByTaskId;
            const { [taskId]: _removedTaskMeta, ...restOptimisticTaskListByTaskId } =
              current.optimisticTaskListByTaskId;

            const shouldCloseDeletedTask = current.activeTaskId === taskId;

            return {
              ...current,
              activeTaskId: shouldCloseDeletedTask ? null : current.activeTaskId,
              draftRuntime: shouldCloseDeletedTask
                ? { status: "idle", error: null }
                : current.draftRuntime,
              taskRuntimeByTaskId: restTaskRuntimeByTaskId,
              taskUiByTaskId: restTaskUiByTaskId,
              taskConfigOptionsByTaskId: restTaskConfigOptionsByTaskId,
              taskConfigOptionsStatusByTaskId: restTaskConfigOptionsStatusByTaskId,
              taskUnreadByTaskId: restTaskUnreadByTaskId,
              optimisticTaskListByTaskId: restOptimisticTaskListByTaskId,
            };
          },
          workspaceIdentity,
        );

        return {
          ...workspaceUpdate,
          taskNavHistory: removeTaskFromHistory(state.taskNavHistory, taskId),
        };
      });
    },
  };
}
