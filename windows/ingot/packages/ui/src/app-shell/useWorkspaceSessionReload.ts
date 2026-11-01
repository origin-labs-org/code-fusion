import { useCallback, useRef, useState } from "react";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import type { CfProvider } from "@origin-ai/cf-shared";
import { toast } from "@/components/ui/toast.js";
import {
  buildWorkspaceSessionReloadDraftError,
  shouldDebounceWorkspaceSessionReload,
} from "@/lib/workspaceSessionReloadPlan.js";
import { resolveWorkspaceModelConfigSyncScope } from "@/lib/modelConfigSync.js";
import { prepareWorkspaceWithCfSessionService } from "@/hooks/useWorkspacePrepare.js";
import { logger } from "@/logger.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import { useTabStore } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";

export function useWorkspaceSessionReload({
  intl,
  services,
  workspaceAbsPath,
  reloadSessionDisabled,
}: {
  intl: { formatMessage: (descriptor: { id: string }) => string };
  services: IServiceAccessor;
  workspaceAbsPath: string;
  reloadSessionDisabled: boolean;
}) {
  const [reloadSessionPending, setReloadSessionPending] = useState(false);
  const workspaceIdentity = useTabStore((state) => {
    if (!state.activeTabId) {
      return undefined;
    }

    const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
    if (!activeTab || !isWorkspaceTab(activeTab) || activeTab.workspacePath !== workspaceAbsPath) {
      return undefined;
    }

    return activeTab.workspaceIdentity;
  });
  const lastReloadSessionTriggeredAtRef = useRef<number | null>(null);

  const handleReloadSession = useCallback(
    async (options?: { resumeTaskId?: string | null; provider?: CfProvider | null }) => {
      if (reloadSessionDisabled || reloadSessionPending) {
        return;
      }

      const now = Date.now();
      if (shouldDebounceWorkspaceSessionReload(lastReloadSessionTriggeredAtRef.current, now)) {
        logger.info(`[App] Ignore重复 workspace session 重建Request workspace=${workspaceAbsPath}`);
        return;
      }
      lastReloadSessionTriggeredAtRef.current = now;
      setReloadSessionPending(true);

      const cfSessionStore = useCfSessionStore.getState();
      const latestWorkspaceState = cfSessionStore.getWorkspaceState(
        workspaceAbsPath,
        workspaceIdentity,
      );
      const actionScope = resolveWorkspaceModelConfigSyncScope(latestWorkspaceState);
      const provider: CfProvider = options?.provider ?? actionScope.provider;
      const resumeTaskId =
        options?.resumeTaskId?.trim() || latestWorkspaceState.activeTaskId || undefined;
      const shouldPrepareWorkspace = !resumeTaskId;

      cfSessionStore.setWorkspaceInitState(
        workspaceAbsPath,
        "initializing",
        null,
        workspaceIdentity,
      );
      if (shouldPrepareWorkspace) {
        cfSessionStore.setConfigOptionsStatus(workspaceAbsPath, "loading", workspaceIdentity);
        cfSessionStore.setDraftError(workspaceAbsPath, null, workspaceIdentity);
        cfSessionStore.setTaskState(workspaceAbsPath, "idle", null, workspaceIdentity);
      }

      try {
        await services.cfTaskService.restartWorkspaceProcess({
          workspacePath: workspaceAbsPath,
          ...(workspaceIdentity ? { workspaceIdentity } : {}),
          provider,
          resumeTaskId,
        });

        if (shouldPrepareWorkspace) {
          const prepareResult = await prepareWorkspaceWithCfSessionService({
            workspacePath: workspaceAbsPath,
            workspaceIdentity,
            provider,
            cfSessionService: services.cfSessionService,
          });

          const latestAfterPrepare = cfSessionStore.getWorkspaceState(
            workspaceAbsPath,
            workspaceIdentity,
          );
          if (latestAfterPrepare.selectedProvider === provider) {
            const latestAfterResolve = cfSessionStore.getWorkspaceState(
              workspaceAbsPath,
              workspaceIdentity,
            );
            if (latestAfterResolve.selectedProvider === provider) {
              cfSessionStore.setConfigOptions(
                workspaceAbsPath,
                prepareResult.configOptions ?? [],
                workspaceIdentity,
              );
              cfSessionStore.setConfigOptionsStatus(
                workspaceAbsPath,
                "ready",
                workspaceIdentity,
              );
              cfSessionStore.setSlashCommands(
                workspaceAbsPath,
                prepareResult.slashCommands ?? [],
                workspaceIdentity,
              );
              cfSessionStore.setDraftError(workspaceAbsPath, null, workspaceIdentity);
            }
          }
        }

        cfSessionStore.setWorkspaceInitAttempts(workspaceAbsPath, 0, workspaceIdentity);
        cfSessionStore.setWorkspaceInitState(workspaceAbsPath, "ready", null, workspaceIdentity);

        logger.info(
          `[App] workspace session 重建Completed workspace=${workspaceAbsPath} provider=${provider} resumeTaskId=${resumeTaskId ?? "<none>"}`,
        );
        toast(intl.formatMessage({ id: "appHeader.reloadSessionSuccess" }));
      } catch (error) {
        const reloadDraftError = buildWorkspaceSessionReloadDraftError(error, {
          workspacePath: workspaceAbsPath,
          provider,
        });
        const message = reloadDraftError.message;
        logger.warn(
          `[App] workspace session 重建Failed workspace=${workspaceAbsPath} provider=${provider}`,
          {
            resumeTaskId: resumeTaskId ?? null,
            message,
          },
        );
        cfSessionStore.setWorkspaceInitState(
          workspaceAbsPath,
          "failed",
          message,
          workspaceIdentity,
        );
        if (shouldPrepareWorkspace) {
          cfSessionStore.setConfigOptionsStatus(workspaceAbsPath, "error", workspaceIdentity);
          cfSessionStore.setDraftError(workspaceAbsPath, reloadDraftError, workspaceIdentity);
        }
        toast(intl.formatMessage({ id: "appHeader.reloadSessionFailed" }));
      } finally {
        setReloadSessionPending(false);
      }
    },
    [
      intl,
      reloadSessionDisabled,
      reloadSessionPending,
      services.cfTaskService,
      services.cfSessionService,
      workspaceAbsPath,
      workspaceIdentity,
    ],
  );

  return {
    reloadSessionPending,
    handleReloadSession,
  };
}
