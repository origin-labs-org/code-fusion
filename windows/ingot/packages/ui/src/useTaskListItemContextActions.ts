import type { CfProvider } from "@origin-ai/cf-shared";
import { useCallback } from "react";
import { usePlatform } from "@/hooks/usePlatform.js";
import { useTaskNativeSessionLogFile } from "@/hooks/useTaskNativeSessionLogFile.js";
import { useTaskSessionFilePath } from "@/hooks/useTaskSessionFilePath.js";
import { useWorkspaceProviderConfigFile } from "@/hooks/useWorkspaceProviderConfigFile.js";
import { useWorkspaceOpenInEditorTarget } from "@/hooks/useWorkspaceOpenInEditorTarget.js";
import { readLastSelectedEditorId } from "@/lib/editorPreference.js";
import { sortInstalledEditorsForOpenWith } from "@/lib/openWithEditors.js";
import { logger } from "@/logger.js";

interface TaskPathState {
  loading: boolean;
  path: string | null;
  exists: boolean;
}

interface TaskListItemContextActionsResult {
  taskSessionFile: TaskPathState;
  taskNativeSessionLogFile: TaskPathState;
  providerConfigFile: TaskPathState;
  fileManagerLabel: string;
  handleCopyText: (label: string, value: string | null) => Promise<void>;
  handleOpenTaskPathInFileManager: () => Promise<void>;
  handleOpenProviderConfig: () => Promise<void>;
}

export function resolveProviderConfigOpenTargetPath(
  path: string,
  exists: boolean,
): string {
  if (exists) {
    return path;
  }

  const trimmedPath = path.replace(/[\\/]+$/, "");
  const lastSeparatorIndex = Math.max(
    trimmedPath.lastIndexOf("/"),
    trimmedPath.lastIndexOf("\\"),
  );

  if (lastSeparatorIndex < 0) {
    return path;
  }

  if (lastSeparatorIndex === 0) {
    return trimmedPath[0] ?? path;
  }

  const parentPath = trimmedPath.slice(0, lastSeparatorIndex);
  if (/^[A-Za-z]:$/.test(parentPath)) {
    return `${parentPath}\\`;
  }

  return parentPath || path;
}

export function useTaskListItemContextActions({
  workspacePath,
  remoteSessionId,
  workspaceIdentity,
  taskId,
  provider,
  intl,
  loadTaskPaths = true,
  loadProviderConfig = true,
}: {
  workspacePath: string;
  remoteSessionId?: string;
  workspaceIdentity?: string;
  taskId: string;
  provider?: CfProvider;
  intl: {
    formatMessage: (
      desc: { id: string },
      values?: Record<string, string>,
    ) => string;
  };
  loadTaskPaths?: boolean;
  loadProviderConfig?: boolean;
}): TaskListItemContextActionsResult {
  const platform = usePlatform();
  const workspaceOpenTarget = useWorkspaceOpenInEditorTarget({
    workspacePath,
    workspaceIdentity,
    workspaceRemoteSessionId: remoteSessionId,
  });
  const taskProvider = provider ?? "glm";
  const taskSessionFile = useTaskSessionFilePath(workspacePath, taskId, workspaceIdentity, {
    enabled: loadTaskPaths,
  });
  const taskNativeSessionLogFile = useTaskNativeSessionLogFile(
    workspacePath,
    taskId,
    provider ?? null,
    workspaceIdentity,
    { enabled: loadTaskPaths },
  );
  const providerConfigFile = useWorkspaceProviderConfigFile(
    workspacePath,
    taskProvider,
    remoteSessionId,
    workspaceIdentity,
    {
      serviceScope: remoteSessionId ? "base" : "workspace",
      enabled: loadProviderConfig,
    },
  );

  const handleCopyText = useCallback(
    async (label: string, value: string | null) => {
      if (!value) {
        return;
      }

      try {
        await navigator.clipboard.writeText(value);
        logger.info(`[TaskListItem] ${label} Copied: ${value}`);
      } catch (error) {
        logger.warn("[TaskListItem] 复制文本失败", {
          label,
          value,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [],
  );

  const handleOpenTaskPathInFileManager = useCallback(async () => {
    const hasRemoteWorkspaceScope = Boolean(
      remoteSessionId ||
        workspaceIdentity?.trim() ||
        workspaceOpenTarget.isRemoteWorkspace,
    );
    if (hasRemoteWorkspaceScope) {
      if (workspaceOpenTarget.remoteTarget?.kind !== "wsl") {
        logger.warn("[TaskListItem] 远程 workspace 不支持本机文件管理器", {
          taskId,
          path: workspacePath,
          remoteKind: workspaceOpenTarget.remoteTarget?.kind ?? "unresolved",
        });
        return;
      }

      const result = await platform.openInEditor("explorer", workspacePath, {
        pathKind: "directory",
        remoteTarget: workspaceOpenTarget.remoteTarget,
        workspaceIdentity,
      });
      if (!result.success) {
        logger.warn("[TaskListItem] 打开 WSL workspace 路径失败", {
          taskId,
          path: workspacePath,
          error: result.error ?? "unknown-error",
        });
      }
      return;
    }

    const isMac = isMacLike();
    const isWindows = isWindowsLike();
    if (isMac || isWindows) {
      const editorId = isMac ? "finder" : "explorer";
      const result = await platform.openInEditor(editorId, workspacePath);
      if (result.success) {
        return;
      }
    }

    const result = await platform.openInFileManager(workspacePath);
    if (!result.success) {
      logger.warn("[TaskListItem] 打开 workspace 路径失败", {
        taskId,
        path: workspacePath,
        error: result.error ?? "unknown-error",
      });
    }
  }, [
    platform,
    remoteSessionId,
    taskId,
    workspaceIdentity,
    workspaceOpenTarget.isRemoteWorkspace,
    workspaceOpenTarget.remoteTarget,
    workspacePath,
  ]);

  const handleOpenProviderConfig = useCallback(async () => {
    if (!providerConfigFile.path) {
      return;
    }

    const openTargetPath = resolveProviderConfigOpenTargetPath(
      providerConfigFile.path,
      providerConfigFile.exists,
    );

    try {
      const preferredEditorId = readLastSelectedEditorId();
      const editors = await platform.getInstalledEditors();
      const sortedEditors = sortInstalledEditorsForOpenWith(editors);
      const preferredEditor =
        sortedEditors.find((editor) => editor.id === preferredEditorId) ??
        sortedEditors[0] ??
        null;

      if (preferredEditor) {
        const result = await platform.openInEditor(
          preferredEditor.id,
          openTargetPath,
        );
        if (result.success) {
          return;
        }
      }

      const result = await platform.openInFileManager(openTargetPath);
      if (!result.success) {
        logger.warn("[TaskListItem] 打开 provider 配置失败", {
          taskId,
          provider: taskProvider,
          path: providerConfigFile.path,
          openTargetPath,
          error: result.error ?? "unknown-error",
        });
      }
    } catch (error) {
      logger.warn("[TaskListItem] 打开 provider 配置失败", {
        taskId,
        provider: taskProvider,
        path: providerConfigFile.path,
        openTargetPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, [
    platform,
    providerConfigFile.exists,
    providerConfigFile.path,
    taskId,
    taskProvider,
  ]);

  return {
    taskSessionFile,
    taskNativeSessionLogFile,
    providerConfigFile,
    fileManagerLabel: getFileManagerLabel(intl),
    handleCopyText,
    handleOpenTaskPathInFileManager,
    handleOpenProviderConfig,
  };
}

function isMacLike(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /mac/i.test(navigator.userAgent);
}

function isWindowsLike(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /windows/i.test(navigator.userAgent);
}

function getFileManagerLabel(intl: {
  formatMessage: (
    desc: { id: string },
    values?: Record<string, string>,
  ) => string;
}) {
  if (isMacLike()) {
    return intl.formatMessage({ id: "appHeader.openInFinder" });
  }

  if (isWindowsLike()) {
    return intl.formatMessage({ id: "appHeader.openInFileExplorer" });
  }

  return intl.formatMessage({ id: "appHeader.openInFileManager" });
}
