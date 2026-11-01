
import { useCallback } from "react";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import {
  canGoBack as navCanGoBack,
  canGoForward as navCanGoForward,
  isAutomationsNavEntry,
  isPluginStoreNavEntry,
  type AutomationsNavigationTab,
} from "@/lib/taskNavigationHistory.js";
import { shouldBlockTaskSelectionDuringModelRestart } from "@/lib/taskSwitchGuard.js";
import { logger } from "@/logger.js";
import { toast } from "@/components/ui/toast.js";
import { getVisibleTaskMetas, useCfSessionStore } from "@/store/cfSessionStore.js";
import { buildTaskEntityKey, buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";
import {
  markTaskQueryCacheScopesStale,
  reconcileTaskQueryCacheUnread,
  rollbackTaskQueryCacheUnread,
  setTaskQueryCacheUnreadOverlay,
  useTaskQueryCacheStore,
} from "@/store/taskQueryCacheStore.js";
import { taskNavigationTargetExists } from "@/lib/taskNavigationTarget.js";
import { getRemoteWorkspaceSession } from "@/store/remoteWorkspaceSessionStore.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { bumpTaskListMembershipVersion } from "@/v4/taskListMembershipVersion.js";

export interface AutomationsNavigationTarget {
  workspacePath: string;
  workspaceIdentity?: string;
  automationId?: string;
  automationTab?: AutomationsNavigationTab;
}

export function useWorkspaceTaskNavigation({
  intl,
  workspaceAbsPath,
  workspaceIdentity,
  activateTabByPath,
  onNavigateToTask,
  onNavigateToAutomations,
  onNavigateToPluginStore,
}: {
  intl: { formatMessage: (descriptor: { id: string }) => string };
  workspaceAbsPath: string;
  workspaceIdentity?: string;
  activateTabByPath: (workspacePath: string, options?: { workspaceIdentity?: string }) => boolean;
  onNavigateToTask?: () => void;
  onNavigateToAutomations?: (target: AutomationsNavigationTarget) => void;
  onNavigateToPluginStore?: (target: Omit<AutomationsNavigationTarget, "automationId">) => void;
}) {
  const baseServices = useBaseWorkspaceServices();
  const tabStoreApi = useTabStoreApi();
  const setActiveTaskId = useCfSessionStore((s) => s.setActiveTaskId);
  const taskNavHistory = useCfSessionStore((s) => s.taskNavHistory);
  const taskNavPushAutomations = useCfSessionStore((s) => s.taskNavPushAutomations);
  const taskNavPushPluginStore = useCfSessionStore((s) => s.taskNavPushPluginStore);
  const taskNavGoBack = useCfSessionStore((s) => s.taskNavGoBack);
  const taskNavGoForward = useCfSessionStore((s) => s.taskNavGoForward);
  const removeTaskFromNavHistory = useCfSessionStore((s) => s.removeTaskFromNavHistory);

  const handleSelectTask = useCallback(
    (
      targetWorkspacePath: string,
      taskId: string,
      targetWorkspaceIdentityHint?: string,
      selectedRowUnreadAt?: number,
    ) => {
      const targetWorkspaceState = useCfSessionStore
        .getState()
        .getWorkspaceState(targetWorkspacePath, targetWorkspaceIdentityHint);
      if (
        shouldBlockTaskSelectionDuringModelRestart(
          targetWorkspaceState.modelSwitchPending,
          targetWorkspaceState.modelSwitchStage,
        )
      ) {
        logger.info(
          `[App] ModelRun时重建Medium，Ignore task 切换 workspace=${targetWorkspacePath} taskId=${taskId} stage=${targetWorkspaceState.modelSwitchStage}`,
        );
        toast(intl.formatMessage({ id: "taskList.switchBlockedByModelRestart" }));
        return;
      }

      activateTabByPath(
        targetWorkspacePath,
        targetWorkspaceIdentityHint
          ? { workspaceIdentity: targetWorkspaceIdentityHint }
          : undefined,
      );
      const activeTab = tabStoreApi
        .getState()
        .tabs.find((tab) => tab.id === tabStoreApi.getState().activeTabId);
      const targetWorkspaceKey = buildTaskWorkspaceKey(
        targetWorkspacePath,
        targetWorkspaceIdentityHint,
      );
      const activeWorkspaceTabMatchesTarget = Boolean(
        activeTab &&
        isWorkspaceTab(activeTab) &&
        buildTaskWorkspaceKey(activeTab.workspacePath, activeTab.workspaceIdentity) ===
          targetWorkspaceKey,
      );
      const resolvedRemoteSessionId =
        activeTab && isWorkspaceTab(activeTab) && activeWorkspaceTabMatchesTarget
          ? activeTab.remoteSessionId
          : undefined;
      const targetWorkspaceIdentity =
        activeTab && isWorkspaceTab(activeTab) && activeWorkspaceTabMatchesTarget
          ? (activeTab.workspaceIdentity ?? targetWorkspaceIdentityHint)
          : targetWorkspaceIdentityHint;
      const targetTask = {
        taskId,
        workspacePath: targetWorkspacePath,
        ...(targetWorkspaceIdentity ? { workspaceIdentity: targetWorkspaceIdentity } : {}),
      };
      const taskEntityKey = buildTaskEntityKey(targetTask);
      const cachedTaskMeta = useTaskQueryCacheStore.getState().taskMetaByEntityKey[taskEntityKey];
      const previousUnreadAt = cachedTaskMeta?.unreadAt;
      const expectedUnreadAt =
        typeof selectedRowUnreadAt === "number" ? selectedRowUnreadAt : previousUnreadAt;
      const shouldClearUnread = typeof expectedUnreadAt === "number";
      const isRemoteWorkspace = Boolean(
        targetWorkspaceIdentity ||
        (activeTab &&
          isWorkspaceTab(activeTab) &&
          activeWorkspaceTabMatchesTarget &&
          (activeTab.remoteSessionId || activeTab.remoteTarget)),
      );

      if (shouldClearUnread) {
        setTaskQueryCacheUnreadOverlay(targetTask, undefined);
        const targetServices = resolvedRemoteSessionId
          ? (getRemoteWorkspaceSession(resolvedRemoteSessionId)?.services ?? null)
          : isRemoteWorkspace
            ? null
            : baseServices;
        if (!targetServices) {
          rollbackTaskQueryCacheUnread(targetTask, previousUnreadAt);
          logger.warn(
            `[App] 选择 task 时Skip未读Persistence，Remote workspace Disconnected workspace=${targetWorkspacePath} taskId=${taskId}`,
          );
        } else {
          void targetServices.cfTaskService
            .setTaskUnread({
              ...targetTask,
              unread: false,
              expectedUnreadAt,
            })
            .then((meta) => {
              reconcileTaskQueryCacheUnread(targetTask, meta.unreadAt);
              bumpTaskListMembershipVersion();
            })
            .catch((error: unknown) => {
              rollbackTaskQueryCacheUnread(targetTask, previousUnreadAt);
              markTaskQueryCacheScopesStale([targetTask]);
              bumpTaskListMembershipVersion();
              logger.warn(
                `[App] 选择 task 时清除未读StatusFailed workspace=${targetWorkspacePath} taskId=${taskId}:`,
                error instanceof Error ? error.message : String(error),
              );
            });
        }
      }

      setActiveTaskId(targetWorkspacePath, taskId, targetWorkspaceIdentity);
      onNavigateToTask?.();
    },
    [activateTabByPath, intl, onNavigateToTask, baseServices, tabStoreApi, setActiveTaskId],
  );

  const handleOpenAutomations = useCallback(
    (automationId?: string, automationTab?: AutomationsNavigationTab) => {
      const normalizedAutomationId = automationId?.trim() || undefined;
      taskNavPushAutomations(
        workspaceAbsPath,
        workspaceIdentity,
        normalizedAutomationId,
        automationTab,
      );
      onNavigateToAutomations?.({
        workspacePath: workspaceAbsPath,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
        ...(normalizedAutomationId ? { automationId: normalizedAutomationId } : {}),
        ...(automationTab ? { automationTab } : {}),
      });
    },
    [onNavigateToAutomations, taskNavPushAutomations, workspaceAbsPath, workspaceIdentity],
  );

  const handleOpenPluginStore = useCallback(() => {
    taskNavPushPluginStore(workspaceAbsPath, workspaceIdentity);
    onNavigateToPluginStore?.({ workspacePath: workspaceAbsPath, workspaceIdentity });
  }, [onNavigateToPluginStore, taskNavPushPluginStore, workspaceAbsPath, workspaceIdentity]);

  const handleTaskNavBack = useCallback(() => {
    const currentWorkspaceState = useCfSessionStore
      .getState()
      .getWorkspaceState(workspaceAbsPath);
    if (
      shouldBlockTaskSelectionDuringModelRestart(
        currentWorkspaceState.modelSwitchPending,
        currentWorkspaceState.modelSwitchStage,
      )
    ) {
      logger.info(
        "[App] Model runtime is rebuilding, ignoring task backward navigation workspace=" +
          workspaceAbsPath +
          " stage=" +
          currentWorkspaceState.modelSwitchStage,
      );
      toast(intl.formatMessage({ id: "taskList.switchBlockedByModelRestart" }));
      return;
    }

    let entry = taskNavGoBack();
    const taskMetaByEntityKey = useTaskQueryCacheStore.getState().taskMetaByEntityKey;
    while (entry) {
      const currentEntry = entry;
      if (isAutomationsNavEntry(currentEntry)) {
        activateTabByPath(
          currentEntry.workspacePath,
          currentEntry.workspaceIdentity
            ? { workspaceIdentity: currentEntry.workspaceIdentity }
            : undefined,
        );
        onNavigateToAutomations?.({
          workspacePath: currentEntry.workspacePath,
          ...(currentEntry.workspaceIdentity
            ? { workspaceIdentity: currentEntry.workspaceIdentity }
            : {}),
          ...(currentEntry.automationId ? { automationId: currentEntry.automationId } : {}),
          ...(currentEntry.automationTab ? { automationTab: currentEntry.automationTab } : {}),
        });
        return;
      }
      if (isPluginStoreNavEntry(currentEntry)) {
        activateTabByPath(
          currentEntry.workspacePath,
          currentEntry.workspaceIdentity
            ? { workspaceIdentity: currentEntry.workspaceIdentity }
            : undefined,
        );
        onNavigateToPluginStore?.(currentEntry);
        return;
      }
      const navWorkspaceState = useCfSessionStore
        .getState()
        .getWorkspaceState(currentEntry.workspacePath, currentEntry.workspaceIdentity);
      const exists = taskNavigationTargetExists({
        entry: currentEntry,
        visibleTasks: getVisibleTaskMetas(navWorkspaceState),
        taskMetaByEntityKey,
      });
      if (exists) {
        handleSelectTask(
          currentEntry.workspacePath,
          currentEntry.taskId,
          currentEntry.workspaceIdentity,
        );
        return;
      }

      removeTaskFromNavHistory(currentEntry.taskId);
      entry = taskNavGoBack();
    }

    toast(intl.formatMessage({ id: "taskNav.noMoreBack" }));
  }, [
    activateTabByPath,
    handleSelectTask,
    intl,
    onNavigateToAutomations,
    onNavigateToPluginStore,
    removeTaskFromNavHistory,
    taskNavGoBack,
    workspaceAbsPath,
  ]);

  const handleTaskNavForward = useCallback(() => {
    const currentWorkspaceState = useCfSessionStore
      .getState()
      .getWorkspaceState(workspaceAbsPath);
    if (
      shouldBlockTaskSelectionDuringModelRestart(
        currentWorkspaceState.modelSwitchPending,
        currentWorkspaceState.modelSwitchStage,
      )
    ) {
      logger.info(
        "[App] Model runtime is rebuilding, ignoring task forward navigation workspace=" +
          workspaceAbsPath +
          " stage=" +
          currentWorkspaceState.modelSwitchStage,
      );
      toast(intl.formatMessage({ id: "taskList.switchBlockedByModelRestart" }));
      return;
    }

    let entry = taskNavGoForward();
    const taskMetaByEntityKey = useTaskQueryCacheStore.getState().taskMetaByEntityKey;
    while (entry) {
      const currentEntry = entry;
      if (isAutomationsNavEntry(currentEntry)) {
        activateTabByPath(
          currentEntry.workspacePath,
          currentEntry.workspaceIdentity
            ? { workspaceIdentity: currentEntry.workspaceIdentity }
            : undefined,
        );
        onNavigateToAutomations?.({
          workspacePath: currentEntry.workspacePath,
          ...(currentEntry.workspaceIdentity
            ? { workspaceIdentity: currentEntry.workspaceIdentity }
            : {}),
          ...(currentEntry.automationId ? { automationId: currentEntry.automationId } : {}),
          ...(currentEntry.automationTab ? { automationTab: currentEntry.automationTab } : {}),
        });
        return;
      }
      if (isPluginStoreNavEntry(currentEntry)) {
        activateTabByPath(
          currentEntry.workspacePath,
          currentEntry.workspaceIdentity
            ? { workspaceIdentity: currentEntry.workspaceIdentity }
            : undefined,
        );
        onNavigateToPluginStore?.(currentEntry);
        return;
      }
      const navWorkspaceState = useCfSessionStore
        .getState()
        .getWorkspaceState(currentEntry.workspacePath, currentEntry.workspaceIdentity);
      const exists = taskNavigationTargetExists({
        entry: currentEntry,
        visibleTasks: getVisibleTaskMetas(navWorkspaceState),
        taskMetaByEntityKey,
      });
      if (exists) {
        handleSelectTask(
          currentEntry.workspacePath,
          currentEntry.taskId,
          currentEntry.workspaceIdentity,
        );
        return;
      }

      removeTaskFromNavHistory(currentEntry.taskId);
      entry = taskNavGoForward();
    }

    toast(intl.formatMessage({ id: "taskNav.noMoreForward" }));
  }, [
    activateTabByPath,
    handleSelectTask,
    intl,
    onNavigateToAutomations,
    onNavigateToPluginStore,
    removeTaskFromNavHistory,
    taskNavGoForward,
    workspaceAbsPath,
  ]);

  const canGoBack = navCanGoBack(taskNavHistory);
  const canGoForward = navCanGoForward(taskNavHistory);
  const currentWorkspaceState = useCfSessionStore.getState().getWorkspaceState(workspaceAbsPath);
  const isTaskSwitchLockedByModelRestart = shouldBlockTaskSelectionDuringModelRestart(
    currentWorkspaceState.modelSwitchPending,
    currentWorkspaceState.modelSwitchStage,
  );
  const canTaskNavBack = canGoBack && !isTaskSwitchLockedByModelRestart;
  const canTaskNavForward = canGoForward && !isTaskSwitchLockedByModelRestart;

  return {
    handleSelectTask,
    handleOpenAutomations,
    handleOpenPluginStore,
    handleTaskNavBack,
    handleTaskNavForward,
    canGoBack,
    canGoForward,
    canTaskNavBack,
    canTaskNavForward,
  };
}
