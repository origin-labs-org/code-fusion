import type { CfProvider } from "@origin-ai/cf-shared";
import { selectWorkspaceCfState, useCfSessionStore } from "@/store/cfSessionStore.js";
import type { WorkspaceCfUIState } from "@/store/cfSessionStoreTypes.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";

export function resolveChatViewActiveTaskProvider(
  taskId: string | null,
  workspaceState: Pick<
    WorkspaceCfUIState,
    "selectedProvider" | "taskListCache" | "optimisticTaskListByTaskId"
  >,
): CfProvider {
  if (!taskId) {
    return workspaceState.selectedProvider;
  }

  return (
    workspaceState.optimisticTaskListByTaskId[taskId]?.provider ??
    workspaceState.taskListCache?.find((task) => task.taskId === taskId)?.provider ??
    workspaceState.selectedProvider
  );
}

export function useChatViewActiveTaskProvider(
  taskId: string | null,
  workspacePath: string,
  workspaceIdentity?: string,
) {
  const activeTabWorkspaceIdentity = useTabStore((state) => {
    if (!state.activeTabId) {
      return undefined;
    }

    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (!activeTab || !isWorkspaceTab(activeTab) || activeTab.workspacePath !== workspacePath) {
      return undefined;
    }

    return activeTab.workspaceIdentity;
  });
  const resolvedWorkspaceIdentity = workspaceIdentity ?? activeTabWorkspaceIdentity;

  return useCfSessionStore((state) => {
    const workspaceState = selectWorkspaceCfState(
      state,
      workspacePath,
      resolvedWorkspaceIdentity,
    );

    return resolveChatViewActiveTaskProvider(taskId, workspaceState);
  });
}
