import { useCallback } from "react";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { logger } from "@/logger.js";
import type { TabStoreState } from "@/store/tabStore.js";

export function useConversationWorkspaceActions({
  services,
  addTab,
  createTask,
  setWorkspaceActionError,
}: {
  services: IServiceAccessor;
  addTab: TabStoreState["addTab"];
  createTask: (source: string) => Promise<void>;
  setWorkspaceActionError: (error: string | null) => void;
}) {
  const handleSelectConversationWorkspace = useCallback(
    (path: string) => {
      logger.info("[Root] select conversation workspace", { path });
      addTab(path, { workspacePurpose: "conversation" });
      setWorkspaceActionError(null);
    },
    [addTab, setWorkspaceActionError],
  );

  const handleResolveConversationWorkspace = useCallback(async () => {
    try {
      if (!services.projectService) throw new Error("project.service-unavailable");
      const result = await services.projectService.prepareSession();
      setWorkspaceActionError(null);
      return result.workspacePath;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("[Root] ensure conversation workspace failed", { error });
      setWorkspaceActionError(message);
      throw error;
    }
  }, [services.projectService, setWorkspaceActionError]);

  const handleEnsureConversationWorkspace = useCallback(async () => {
    const path = await handleResolveConversationWorkspace();
    handleSelectConversationWorkspace(path);
    return path;
  }, [handleResolveConversationWorkspace, handleSelectConversationWorkspace]);

  const handleCreateConversationTask = useCallback(
    () => createTask("task section new task"),
    [createTask],
  );

  return {
    handleSelectConversationWorkspace,
    handleResolveConversationWorkspace,
    handleEnsureConversationWorkspace,
    handleCreateConversationTask,
  };
}
