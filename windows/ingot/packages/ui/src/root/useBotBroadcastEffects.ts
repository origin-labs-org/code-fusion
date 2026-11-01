import { useEffect } from "react";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import type { CfConfigOption } from "@origin-ai/cf-shared";
import {
  buildTaskContextUsageFromUsageUpdate,
  recordTaskContextUsageUpdate,
} from "@/lib/cfTaskUsageFallback.js";
import { normalizeCfUiError } from "@/lib/cfUiError.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import type { useTabStoreApi } from "@/store/TabStoreProvider.js";
import {
  resolveBotTaskBroadcastRefresh,
  resolveBotTaskBroadcastRuntimeStatus,
} from "@/root/botsTaskBroadcast.js";
import { resolveBotTaskStreamBroadcast } from "@/root/botsTaskStreamBroadcast.js";
import {
  insertTaskIntoTaskCaches,
  syncTaskMetaToTaskCaches,
} from "@/lib/taskListMetaSync.js";

export function syncBotTaskConfigOptionsToStore(params: {
  cfSessionStore: Pick<
    ReturnType<typeof useCfSessionStore.getState>,
    "setTaskConfigOptions"
  >;
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string;
  configOptions: CfConfigOption[];
}) {
  params.cfSessionStore.setTaskConfigOptions(
    params.workspacePath,
    params.taskId,
    params.configOptions,
    params.workspaceIdentity,
  );
}

export function shouldRefreshBotTaskList(
  event: string,
  hasTaskMeta: boolean,
): boolean {
  if (event === "created") {
    return true;
  }
  if (hasTaskMeta) {
    return false;
  }
  return event === "created" || event === "updated" || event === "completed" || event === "error";
}

export function shouldMirrorBotTaskStreamToStore(params: {
  activeTaskId: string | null;
  taskId: string;
  workspaceIdentity?: string;
}): boolean {
  if (params.activeTaskId !== params.taskId) {
    return true;
  }

  return Boolean(params.workspaceIdentity?.trim());
}

export function useBotBroadcastEffects(
  services: IServiceAccessor,
  tabStoreApi: ReturnType<typeof useTabStoreApi>,
) {
  useEffect(() => {
    const disposable = services.broadcastService.onMessage((message) => {
      const stream = resolveBotTaskStreamBroadcast(
        message,
        tabStoreApi.getState().tabs,
      );
      if (stream) {
        const cfSessionStore = useCfSessionStore.getState();
        const workspaceState = cfSessionStore.getWorkspaceState(
          stream.workspacePath,
          stream.workspaceIdentity,
        );
        if (
          !shouldMirrorBotTaskStreamToStore({
            activeTaskId: workspaceState.activeTaskId,
            taskId: stream.taskId,
            workspaceIdentity: stream.workspaceIdentity,
          })
        ) {
          return;
        }

        const event = stream.event;
        switch (event.type) {
          case "agent_message_chunk":
          case "agent_thought_chunk":
          case "tool_call":
            cfSessionStore.setTaskRuntimeState(
              stream.workspacePath,
              stream.taskId,
              "streaming",
              undefined,
              stream.workspaceIdentity,
            );
            break;
          case "permission_request":
            cfSessionStore.setTaskPermissionRequest(stream.workspacePath, stream.taskId, event, stream.workspaceIdentity);
            cfSessionStore.setTaskRuntimeState(
              stream.workspacePath,
              stream.taskId,
              "streaming",
              undefined,
              stream.workspaceIdentity,
            );
            break;
          case "task_complete":
            cfSessionStore.setTaskRuntimeState(
              stream.workspacePath,
              stream.taskId,
              "completed",
              undefined,
              stream.workspaceIdentity,
            );
            cfSessionStore.setTaskPermissionRequest(stream.workspacePath, stream.taskId, null, stream.workspaceIdentity);
            cfSessionStore.setTaskError(stream.workspacePath, stream.taskId, null, stream.workspaceIdentity);
            break;
          case "task_error": {
            const normalizedError = normalizeCfUiError(
              {
                message: event.error,
                detail: event.detail,
                code: event.code,
              },
              {
                fallbackCode: event.code ?? "UNKNOWN",
                traceId: event.traceId,
                taskId: event.taskId,
              },
            );
            cfSessionStore.setTaskRuntimeState(
              stream.workspacePath,
              stream.taskId,
              "failed",
              normalizedError.message,
              stream.workspaceIdentity,
            );
            cfSessionStore.setTaskPermissionRequest(stream.workspacePath, stream.taskId, null, stream.workspaceIdentity);
            cfSessionStore.setTaskError(stream.workspacePath, stream.taskId, normalizedError, stream.workspaceIdentity);
            break;
          }
          case "task_warning":
            cfSessionStore.setTaskError(
              stream.workspacePath,
              stream.taskId,
              normalizeCfUiError(
                {
                  message: event.warning,
                  detail: event.detail,
                  code: event.code,
                },
                {
                  fallbackCode: event.code ?? "WARNING",
                  traceId: event.traceId,
                  taskId: event.taskId,
                },
              ),
              stream.workspaceIdentity,
            );
            break;
          case "usage_update":
            {
              const workspaceState = cfSessionStore.getWorkspaceState(
                stream.workspacePath,
                stream.workspaceIdentity,
              );
              const previousUsage =
                workspaceState.taskRuntimeByTaskId[stream.taskId]?.usage ?? null;
              const incomingUsage = {
                size: event.size,
                used: event.used,
                cost: event.cost,
                ...(event.cache ? { cache: event.cache } : {}),
                ...(event.breakdown ? { breakdown: event.breakdown } : {}),
              };
              const nextUsage = buildTaskContextUsageFromUsageUpdate({
                currentUsage: previousUsage,
                incomingUsage,
              });
              recordTaskContextUsageUpdate({
                workspacePath: stream.workspacePath,
                workspaceIdentity: stream.workspaceIdentity,
                taskId: stream.taskId,
                size: event.size,
                used: event.used,
              });
              cfSessionStore.setTaskContextWindow(
                stream.workspacePath,
                stream.taskId,
                event.size,
                stream.workspaceIdentity,
              );
              cfSessionStore.setTaskUsage(
                stream.workspacePath,
                stream.taskId,
                nextUsage,
                stream.workspaceIdentity,
              );
            }
            break;
          case "session_info_update":
            if (event.apiRetry !== undefined) {
              cfSessionStore.setTaskApiRetryStatus(
                stream.workspacePath,
                stream.taskId,
                event.apiRetry ?? null,
                stream.workspaceIdentity,
              );
            }
            break;
        }
        return;
      }

      const refresh = resolveBotTaskBroadcastRefresh(
        message,
        tabStoreApi.getState().tabs,
      );
      if (!refresh) {
        return;
      }
      const cfSessionStore = useCfSessionStore.getState();
      const workspaceState = cfSessionStore.getWorkspaceState(
        refresh.workspacePath,
        refresh.workspaceIdentity,
      );
      const provider = refresh.task?.provider ?? refresh.provider;
      const shouldSyncVisibleTaskConfig = workspaceState.activeTaskId === refresh.taskId;
      if (provider && shouldSyncVisibleTaskConfig) {
        cfSessionStore.bindRuntimeProvider(
          refresh.workspacePath,
          provider,
          refresh.workspaceIdentity,
        );
      }
      if (refresh.configOptions) {
        syncBotTaskConfigOptionsToStore({
          cfSessionStore,
          workspacePath: refresh.workspacePath,
          workspaceIdentity: refresh.workspaceIdentity,
          taskId: refresh.taskId,
          configOptions: refresh.configOptions,
        });
      }
      cfSessionStore.setTaskRuntimeState(
        refresh.workspacePath,
        refresh.taskId,
        resolveBotTaskBroadcastRuntimeStatus(refresh.event),
        undefined,
        refresh.workspaceIdentity,
      );
      if (refresh.task) {
        const membership = { pinned: false, archived: false };
        if (refresh.event === "created") {
          insertTaskIntoTaskCaches({
            workspacePath: refresh.workspacePath,
            workspaceIdentity: refresh.workspaceIdentity,
            task: refresh.task,
            membership,
          });
        } else {
          syncTaskMetaToTaskCaches({
            workspacePath: refresh.workspacePath,
            workspaceIdentity: refresh.workspaceIdentity,
            task: refresh.task,
            membership,
            ensureInWorkspaceTaskCache: true,
          });
        }
      }
      if (refresh.event === "permission_request" && refresh.permissionRequest) {
        cfSessionStore.setTaskPermissionRequest(
          refresh.workspacePath,
          refresh.taskId,
          refresh.permissionRequest,
          refresh.workspaceIdentity,
        );
      } else if (refresh.event === "permission_resolved" && refresh.requestId) {
        cfSessionStore.removeTaskPermissionRequest(
          refresh.workspacePath,
          refresh.taskId,
          refresh.requestId,
          refresh.workspaceIdentity,
        );
      } else if (refresh.event === "elicitation_request" && refresh.elicitationRequest) {
        cfSessionStore.setTaskElicitationRequest(
          refresh.workspacePath,
          refresh.taskId,
          refresh.elicitationRequest,
          refresh.workspaceIdentity,
        );
      } else if (refresh.event === "elicitation_resolved" && refresh.requestId) {
        cfSessionStore.removeTaskElicitationRequest(
          refresh.workspacePath,
          refresh.taskId,
          refresh.requestId,
          refresh.workspaceIdentity,
        );
      } else if (refresh.event === "completed" || refresh.event === "error") {
        cfSessionStore.setTaskPermissionRequest(
          refresh.workspacePath,
          refresh.taskId,
          null,
          refresh.workspaceIdentity,
        );
      }
      if (shouldRefreshBotTaskList(refresh.event, Boolean(refresh.task))) {
        cfSessionStore.bumpTaskListVersion(refresh.workspacePath, refresh.workspaceIdentity);
      }
    });
    return () => disposable.dispose();
  }, [services.broadcastService, tabStoreApi]);
}
