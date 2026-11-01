import type {
  CfSavedWorkflowEntry,
  CfSavedWorkflowMeta,
  CfSavedWorkflowScope,
  CfWorkflowsForRunCandidate,
  CfWorkflowsSaveResult,
} from "@origin-ai/cf-shared";
import type { WorkflowRunSavedState } from "@/store/workflowRunSavedStore.js";
import type {
  SavedWorkflowLaunchError,
  SavedWorkflowLaunchTarget,
} from "@/settings/saved-workflows/useSavedWorkflowLauncher.js";

export interface WorkflowRunSaveTarget {
  projectId?: string | null;
  hostId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
  remoteSessionId?: string;
}

export interface WorkflowRunSaveHost extends WorkflowRunSaveTarget {
  sessionId?: string;
  runId: string;
  
  candidates?: readonly CfWorkflowsForRunCandidate[];
  
  onNavigateToRun?: (target: SavedWorkflowLaunchTarget, sessionId: string) => void;
}

export interface WorkflowRunSaveSubmit {
  name: string;
  scope: CfSavedWorkflowScope;
  meta: CfSavedWorkflowMeta;
  overwrite?: boolean;
}

export interface WorkflowRunSaveController {
  
  saved: WorkflowRunSavedState | undefined;
  
  entry: CfSavedWorkflowEntry | undefined;
  
  runArgs: Record<string, unknown> | undefined;
  
  directSaveUnsupported: boolean;
  
  scopeLocked: boolean;
  saving: boolean;
  save: (input: WorkflowRunSaveSubmit) => Promise<CfWorkflowsSaveResult>;
  
  checkNameTaken: (name: string, scope: CfSavedWorkflowScope) => Promise<boolean>;
  launching: boolean;
  launchError: SavedWorkflowLaunchError | null;
  clearLaunchError: () => void;
  
  launch: (
    entry: CfSavedWorkflowEntry,
    args: Record<string, unknown>,
    target?: WorkflowRunSaveTarget,
  ) => Promise<{ ok: true } | { ok: false; error: SavedWorkflowLaunchError }>;
}
