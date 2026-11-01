import { buildTaskWorkspaceKey } from "@/lib/taskQueryCache.js";

interface WorkspaceShellTargetTab {
  workspacePath: string;
  remoteSessionId?: string;
  workspaceIdentity?: string;
}

export interface RootWorkspaceShellTarget {
  workspaceShellPath: string | null;
  workspaceIdentity?: string;
  workspaceRemoteSessionId?: string;
}

function normalizeOptionalString(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function resolveRootWorkspaceShellTarget({
  activeWorkspaceTab,
  activeWorkspacePath,
  activeWorkspaceIdentity,
  workspaceTabs,
}: {
  activeWorkspaceTab: WorkspaceShellTargetTab | null;
  activeWorkspacePath: string | null;
  activeWorkspaceIdentity: string | null;
  
  workspaceTabs: readonly WorkspaceShellTargetTab[];
}): RootWorkspaceShellTarget {
  if (activeWorkspaceTab) {
    return {
      workspaceShellPath: activeWorkspaceTab.workspacePath,
      workspaceIdentity: normalizeOptionalString(activeWorkspaceTab.workspaceIdentity),
      workspaceRemoteSessionId: normalizeOptionalString(activeWorkspaceTab.remoteSessionId),
    };
  }

  const workspaceIdentity = normalizeOptionalString(activeWorkspaceIdentity);
  const coveredWorkspaceTab =
    activeWorkspacePath === null
      ? undefined
      : workspaceTabs.find(
          (tab) =>
            buildTaskWorkspaceKey(tab.workspacePath, tab.workspaceIdentity) ===
            buildTaskWorkspaceKey(activeWorkspacePath, workspaceIdentity),
        );

  return {
    workspaceShellPath: activeWorkspacePath,
    workspaceIdentity,
    workspaceRemoteSessionId: normalizeOptionalString(coveredWorkspaceTab?.remoteSessionId),
  };
}
