import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import type { TaskChatMessage as TestChatMessage } from "@/lib/taskChatMessageTypes.js";
import type { BrowserNavigationRequest } from "@/hooks/useAppPanels.js";
import { logger } from "@/logger.js";
import {
  getWorkspaceDisplayedTaskState,
  getWorkspaceInitState,
  useCfSessionStore,
} from "@/store/cfSessionStore.js";

export function useWorkspaceShellLifecycle({
  workspaceAbsPath,
  workspaceIdentity,
  services,
  setBrowserNavigationRequest,
  setTestMessages,
}: {
  workspaceAbsPath: string;
  workspaceIdentity?: string;
  services: IServiceAccessor;
  setBrowserNavigationRequest: Dispatch<SetStateAction<BrowserNavigationRequest | null>>;
  setTestMessages: Dispatch<SetStateAction<TestChatMessage[] | null>>;
}) {
  const previousWorkspaceAbsPathRef = useRef(workspaceAbsPath);

  useEffect(() => {
    if (previousWorkspaceAbsPathRef.current === workspaceAbsPath) {
      return;
    }

    previousWorkspaceAbsPathRef.current = workspaceAbsPath;

    setBrowserNavigationRequest(null);
    setTestMessages(null);
  }, [setBrowserNavigationRequest, setTestMessages, workspaceAbsPath]);

  useEffect(() => {
    return () => {
      const currentWorkspaceState = useCfSessionStore
        .getState()
        .getWorkspaceState(workspaceAbsPath);
      const displayedTaskState = getWorkspaceDisplayedTaskState(currentWorkspaceState);
      if (
        currentWorkspaceState.activeTaskId ||
        displayedTaskState.taskStatus === "creating" ||
        displayedTaskState.taskStatus === "streaming"
      ) {
        return;
      }

      const workspaceInitState = getWorkspaceInitState(currentWorkspaceState);
      if (workspaceInitState.status === "idle") {
        return;
      }

      const provider = currentWorkspaceState.selectedProvider;
      logger.info(
        `[App] 回退 workspace 预热Status workspace=${workspaceAbsPath} provider=${provider}`,
      );
      useCfSessionStore
        .getState()
        .setWorkspaceInitAttempts(workspaceAbsPath, 0, workspaceIdentity);
      useCfSessionStore
        .getState()
        .setWorkspaceInitState(workspaceAbsPath, "idle", null, workspaceIdentity);

      void services.cfTaskService
        .releaseWorkspacePreparation({
          workspacePath: workspaceAbsPath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          provider,
        })
        .catch((error: unknown) => {
          logger.error(
            `[App] 释放 workspace 预热态Failed workspace=${workspaceAbsPath} provider=${provider}:`,
            error,
          );
        });
    };
  }, [services.cfTaskService, workspaceIdentity, workspaceAbsPath]);
}
