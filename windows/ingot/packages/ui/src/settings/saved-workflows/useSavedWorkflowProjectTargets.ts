import { useMemo } from "react";
import type { CfAgentWorkspaceTarget } from "@origin-ai/cf-services";
import type { AutomationWorkspaceOption } from "@/settings/automationWorkspaceOptions.js";
import type { SavedWorkflowProjectTarget } from "@/settings/saved-workflows/savedWorkflowContract.js";
import type { SavedWorkflowLaunchTarget } from "@/settings/saved-workflows/useSavedWorkflowLauncher.js";

interface SavedWorkflowProjectTargets {
  
  target: CfAgentWorkspaceTarget;
  
  projectTarget: SavedWorkflowProjectTarget;
  
  launchTarget: SavedWorkflowLaunchTarget;
}

export function useSavedWorkflowProjectTargets(
  project: Pick<AutomationWorkspaceOption, "workspacePath" | "workspaceIdentity" | "projectId" | "hostId">,
  remoteSessionId: string | null,
): SavedWorkflowProjectTargets {
  const target = useMemo<CfAgentWorkspaceTarget>(
    () => ({
      projectId: project.projectId, hostId: project.hostId,
      workspacePath: project.workspacePath,
      ...(project.workspaceIdentity?.trim()
        ? { workspaceIdentity: project.workspaceIdentity }
        : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
    }),
    [project.projectId, project.hostId, project.workspacePath, project.workspaceIdentity, remoteSessionId],
  );
  const projectTarget = useMemo<SavedWorkflowProjectTarget>(
    () => ({
      projectId: project.projectId, hostId: project.hostId,
      workspacePath: project.workspacePath,
      ...(project.workspaceIdentity ? { workspaceIdentity: project.workspaceIdentity } : {}),
    }),
    [project.projectId, project.hostId, project.workspacePath, project.workspaceIdentity],
  );
  const launchTarget = useMemo<SavedWorkflowLaunchTarget>(
    () => ({
      projectId: project.projectId, hostId: project.hostId,
      workspacePath: project.workspacePath,
      ...(project.workspaceIdentity ? { workspaceIdentity: project.workspaceIdentity } : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
    }),
    [project.projectId, project.hostId, project.workspacePath, project.workspaceIdentity, remoteSessionId],
  );
  return { target, projectTarget, launchTarget };
}
