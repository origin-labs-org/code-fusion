interface ConnectivityWorkspaceTab {
  workspacePath: string;
  workspaceIdentity?: string | null;
  remoteSessionId?: string | null;
  remoteTarget?: unknown;
  localWorkspacePath?: string | null;
}

function isRemoteWorkspaceTab(tab: ConnectivityWorkspaceTab | null | undefined): boolean {
  return Boolean(
    tab?.workspaceIdentity?.trim() || tab?.remoteSessionId?.trim() || tab?.remoteTarget,
  );
}

export function resolveModelProviderConnectivityWorkspacePath(params: {
  activeWorkspacePath?: string | null;
  activeWorkspaceIdentity?: string | null;
  activeWorkspaceTab?: ConnectivityWorkspaceTab | null;
  workspaceTabs: readonly ConnectivityWorkspaceTab[];
}): string {
  const rememberedLocalPath = params.activeWorkspaceTab?.localWorkspacePath?.trim();
  if (rememberedLocalPath) {
    return rememberedLocalPath;
  }

  const activeWorkspaceIsRemote = Boolean(
    params.activeWorkspaceIdentity?.trim() || isRemoteWorkspaceTab(params.activeWorkspaceTab),
  );
  if (!activeWorkspaceIsRemote) {
    const activeLocalPath = params.activeWorkspaceTab?.workspacePath.trim();
    if (activeLocalPath) {
      return activeLocalPath;
    }
    const activeWorkspacePath = params.activeWorkspacePath?.trim();
    if (activeWorkspacePath) {
      return activeWorkspacePath;
    }
  }

  const localTab = params.workspaceTabs.find((tab) => !isRemoteWorkspaceTab(tab));
  return localTab?.workspacePath.trim() ?? "";
}
