import { resolveWorkspaceKey, type RemoteTarget, type WorkspacePurpose } from "@origin-ai/cf-shared";

export interface AutomationWorkspaceOption {
  projectId?: string | null;
  hostId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
  remoteTarget?: RemoteTarget;
  label: string;
  workspacePurpose?: WorkspacePurpose;
}

export function resolveAutomationWorkspaceSelectionKey(
  workspace: Pick<
    AutomationWorkspaceOption,
    "workspacePath" | "workspaceIdentity" | "projectId" | "hostId"
  >,
): string {
  return workspace.projectId
    ? JSON.stringify([workspace.hostId ?? "local", workspace.projectId])
    : resolveWorkspaceKey(workspace);
}

export function findAutomationWorkspaceOptionByKey(
  options: readonly AutomationWorkspaceOption[],
  workspaceKey: string | null,
): AutomationWorkspaceOption | undefined {
  return options.find((option) => resolveAutomationWorkspaceSelectionKey(option) === workspaceKey);
}

export function reconcileAutomationWorkspaceSelectionKey(
  options: readonly AutomationWorkspaceOption[],
  currentWorkspaceKey: string | null,
  preferredWorkspace?: Pick<
    AutomationWorkspaceOption,
    "workspacePath" | "workspaceIdentity" | "projectId" | "hostId"
  >,
): string | null {
  const current = findAutomationWorkspaceOptionByKey(options, currentWorkspaceKey);
  if (current) return resolveAutomationWorkspaceSelectionKey(current);

  const preferredKey = preferredWorkspace
    ? resolveAutomationWorkspaceSelectionKey(preferredWorkspace)
    : null;
  const preferred = findAutomationWorkspaceOptionByKey(options, preferredKey);
  if (preferred) return resolveAutomationWorkspaceSelectionKey(preferred);

  const first = options[0];
  return first ? resolveAutomationWorkspaceSelectionKey(first) : null;
}
