// 「Saving the run, and running it again」）：
//
//
import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import type { CfSavedWorkflowScope } from "@origin-ai/cf-shared";
import type { SavedWorkflowLaunchTarget } from "@/settings/saved-workflows/useSavedWorkflowLauncher.js";

export interface SavedWorkflowHubTarget {
  name: string;
  scope: CfSavedWorkflowScope;
  
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface SavedWorkflowHubHandlers {
  openWorkflow: (target: SavedWorkflowHubTarget) => void;
  navigateToRun: (target: SavedWorkflowLaunchTarget, sessionId: string) => void;
}

const SavedWorkflowHubContext = createContext<SavedWorkflowHubHandlers | null>(null);

export function SavedWorkflowHubProvider({
  children,
  navigateToRun,
  openWorkflow,
}: SavedWorkflowHubHandlers & { children: ReactNode }) {
  const ref = useRef({ openWorkflow, navigateToRun });
  ref.current = { openWorkflow, navigateToRun };
  const stable = useMemo<SavedWorkflowHubHandlers>(
    () => ({
      openWorkflow: (target) => ref.current.openWorkflow(target),
      navigateToRun: (target, sessionId) => ref.current.navigateToRun(target, sessionId),
    }),
    [],
  );
  return (
    <SavedWorkflowHubContext.Provider value={stable}>{children}</SavedWorkflowHubContext.Provider>
  );
}

export function useSavedWorkflowHub(): SavedWorkflowHubHandlers | null {
  return useContext(SavedWorkflowHubContext);
}
