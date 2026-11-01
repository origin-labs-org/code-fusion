import { resolveWorkspaceKey, type CfSavedWorkflowRun } from "@origin-ai/cf-shared";
import type { CfAgentSavedWorkflowTarget } from "@origin-ai/cf-services";
import type { AutomationWorkspaceOption } from "@/settings/automationWorkspaceOptions.js";
import type { SavedWorkflowProjectTarget } from "@/settings/saved-workflows/savedWorkflowContract.js";
import type { SavedWorkflowRunProject } from "@/settings/saved-workflows/SavedWorkflowRunHistoryPanel.js";

export const GLOBAL_SAVED_WORKFLOW_TARGET: CfAgentSavedWorkflowTarget = { scope: "global" };

function basenameOfPath(path: string): string {
  return (
    path
      .replace(/[\\/]+$/u, "")
      .split(/[\\/]/u)
      .filter(Boolean)
      .pop() ?? path
  );
}

export function resolveGlobalActionTarget(
  localProjects: readonly AutomationWorkspaceOption[],
  activeProjectKey: string | null,
): SavedWorkflowProjectTarget | null {
  const active = localProjects.find((project) => resolveWorkspaceKey(project) === activeProjectKey);
  const target = active ?? localProjects[0];
  if (!target) return null;
  return {
    projectId: target.projectId, hostId: target.hostId,
    workspacePath: target.workspacePath,
    ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
  };
}

export function findProjectByCwd(
  localProjects: readonly AutomationWorkspaceOption[],
  cwd: string | undefined,
): AutomationWorkspaceOption | null {
  if (!cwd) return null;
  return localProjects.find((project) => project.workspacePath === cwd) ?? null;
}

export function buildGlobalRunProjectResolver(
  localProjects: readonly AutomationWorkspaceOption[],
): (run: CfSavedWorkflowRun) => SavedWorkflowRunProject | null {
  return (run) => {
    if (!run.cwd) return null;
    const project = findProjectByCwd(localProjects, run.cwd);
    if (project) {
      return { label: project.label, title: run.cwd, canOpen: true };
    }
    return { label: basenameOfPath(run.cwd), title: run.cwd, canOpen: false };
  };
}
