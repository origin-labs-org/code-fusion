import { useEffect, useMemo, useRef, useState } from "react";
import type { IDisposable } from "@origin-ai/cf-rpc";
import type { GitRepositorySummary } from "@origin-ai/cf-shared";
import {
  buildGitAutoRefreshWatchPaths,
  parseGitAutoRefreshWatchPaths,
  shouldEnableGitAutoRefreshForWorkspace,
  stringifyGitAutoRefreshWatchPaths,
} from "@/lib/gitAutoRefresh.js";
import { logger } from "@/logger.js";
import { useWorkspaceServices } from "@/hooks/useWorkspaceServices.js";

const GIT_AUTO_REFRESH_DEBOUNCE_MS = 60_000;

interface GitWatcherRegistration {
  subscription: IDisposable;
  unwatch: () => Promise<void>;
}

export function useGitAutoRefresh({
  workspacePath,
  workspaceIdentity,
  remoteSessionId,
  gitSummary,
  gitSummaryWorkspaceKey,
  enabled,
  onRefreshGit,
}: {
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  gitSummary: GitRepositorySummary;
  gitSummaryWorkspaceKey: string;
  enabled: boolean;
  onRefreshGit: () => void;
}) {
  const workspaceServices = useWorkspaceServices(workspacePath, remoteSessionId, workspaceIdentity);
  const { fileWatcherService, systemService } = workspaceServices;
  const refreshRef = useRef(onRefreshGit);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentWorkspaceKey = workspaceIdentity?.trim() || workspacePath;
  const canWatchCurrentWorkspace = shouldEnableGitAutoRefreshForWorkspace({
    enabled,
    currentWorkspaceKey,
    summaryWorkspaceKey: gitSummaryWorkspaceKey,
  });
  const [workspacePlatformState, setWorkspacePlatformState] = useState<{
    service: typeof systemService;
    platform: string;
  } | null>(null);
  const workspacePlatform =
    workspacePlatformState?.service === systemService ? workspacePlatformState.platform : null;
  useEffect(() => {
    if (!canWatchCurrentWorkspace || !gitSummary.isGitAvailable || !gitSummary.isRepository) {
      return;
    }

    let cancelled = false;
    void systemService
      .info()
      .then((info) => {
        if (!cancelled) {
          setWorkspacePlatformState({ service: systemService, platform: info.platform });
        }
      })
      .catch(() => {
      });

    return () => {
      cancelled = true;
    };
  }, [canWatchCurrentWorkspace, gitSummary.isGitAvailable, gitSummary.isRepository, systemService]);
  const watchPathSignature = useMemo(
    () =>
      stringifyGitAutoRefreshWatchPaths(
        canWatchCurrentWorkspace
          ? buildGitAutoRefreshWatchPaths(
              gitSummary,
              workspacePlatform ? { platform: workspacePlatform } : null,
            )
          : [],
      ),
    [
      canWatchCurrentWorkspace,
      gitSummary.isGitAvailable,
      gitSummary.isRepository,
      gitSummary.repoRoot,
      gitSummary.workspacePath,
      gitSummary.autoRefreshWatchPaths,
      workspacePlatform,
    ],
  );
  const watchPaths = useMemo(
    () => parseGitAutoRefreshWatchPaths(watchPathSignature),
    [watchPathSignature],
  );

  refreshRef.current = onRefreshGit;

  useEffect(() => {
    let cancelled = false;
    const registrations: GitWatcherRegistration[] = [];

    const scheduleRefresh = (path: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        logger.debug("[GitAutoRefresh] Git status changed; refreshing repository status", {
          workspacePath,
          path,
        });
        refreshRef.current();
      }, GIT_AUTO_REFRESH_DEBOUNCE_MS);
    };

    for (const watchPath of watchPaths) {
      void fileWatcherService
        .watch({
          path: watchPath.path,
          recursive: watchPath.recursive,
        })
        .then(({ id }) => {
          if (cancelled) {
            void fileWatcherService.unwatch({ id });
            return;
          }

          const subscription = fileWatcherService.onDynamicChange(id)((event) => {
            scheduleRefresh(event.dirPath);
          });
          registrations.push({
            subscription,
            unwatch: () => fileWatcherService.unwatch({ id }),
          });
        })
        .catch((error) => {
          if (cancelled) {
            return;
          }
          logger.warn("[GitAutoRefresh] 监听 Git 工作区失败", {
            workspacePath,
            path: watchPath.path,
            recursive: watchPath.recursive,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }

    return () => {
      cancelled = true;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      for (const registration of registrations) {
        registration.subscription.dispose();
        void registration.unwatch().catch((error) => {
          logger.warn("[GitAutoRefresh] 停止监听 Git 工作区失败", {
            workspacePath,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    };
  }, [fileWatcherService, watchPaths, workspacePath]);
}
