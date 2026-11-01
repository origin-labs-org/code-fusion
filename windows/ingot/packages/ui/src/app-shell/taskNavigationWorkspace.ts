export type TaskNavigationWorkspaceResult =
  | { accepted: true; openedLocalTab: boolean }
  | { accepted: false; reason: "remote_attachment_missing" };

export function ensureTaskNavigationWorkspace(params: {
  workspacePath: string;
  workspaceIdentity?: string;
  activateTabByPath: (workspacePath: string, options?: { workspaceIdentity?: string }) => boolean;
  addLocalWorkspaceTab: (workspacePath: string) => void;
}): TaskNavigationWorkspaceResult {
  const workspaceIdentity = params.workspaceIdentity?.trim();
  if (
    params.activateTabByPath(
      params.workspacePath,
      workspaceIdentity ? { workspaceIdentity } : undefined,
    )
  ) {
    return { accepted: true, openedLocalTab: false };
  }

  if (workspaceIdentity) {
    return { accepted: false, reason: "remote_attachment_missing" };
  }

  params.addLocalWorkspaceTab(params.workspacePath);
  return { accepted: true, openedLocalTab: true };
}
