import { useCallback } from "react";
import type { CfSavedWorkflowRun } from "@origin-ai/cf-shared";
import type {
  SavedWorkflowsOpenArtifactParams,
  SavedWorkflowsOpenRunParams,
} from "@/settings/saved-workflows/savedWorkflowContract.js";

export interface SavedWorkflowRunOpenTarget {
  workspacePath: string;
  workspaceIdentity?: string;
}

export function useSavedWorkflowRunOpeners(options: {
  
  resolveTarget: (run: CfSavedWorkflowRun) => SavedWorkflowRunOpenTarget | null;
  onOpenWorkflowRun?: (params: SavedWorkflowsOpenRunParams) => void;
  onOpenWorkflowArtifact?: (params: SavedWorkflowsOpenArtifactParams) => void;
}): {
  handleOpenRun: (run: CfSavedWorkflowRun, workflowName: string) => void;
  handleOpenArtifact: (run: CfSavedWorkflowRun, artifactId: string) => void;
} {
  const { onOpenWorkflowArtifact, onOpenWorkflowRun, resolveTarget } = options;

  const handleOpenRun = useCallback(
    (run: CfSavedWorkflowRun, workflowName: string) => {
      if (!run.parentSessionId || !run.toolCallId) return;
      const target = resolveTarget(run);
      if (!target) return;
      onOpenWorkflowRun?.({
        sessionId: run.parentSessionId,
        runId: run.runId,
        toolCallId: run.toolCallId,
        workflowName,
        workspacePath: target.workspacePath,
        ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
      });
    },
    [onOpenWorkflowRun, resolveTarget],
  );

  const handleOpenArtifact = useCallback(
    (run: CfSavedWorkflowRun, artifactId: string) => {
      if (!run.parentSessionId) return;
      const target = resolveTarget(run);
      if (!target) return;
      const artifact = run.artifacts?.find((candidate) => candidate.id === artifactId);
      onOpenWorkflowArtifact?.({
        sessionId: run.parentSessionId,
        runId: run.runId,
        artifactId,
        ...(artifact?.title === undefined ? {} : { title: artifact.title }),
        ...(artifact?.contentType === undefined ? {} : { contentType: artifact.contentType }),
        workspacePath: target.workspacePath,
        ...(target.workspaceIdentity ? { workspaceIdentity: target.workspaceIdentity } : {}),
      });
    },
    [onOpenWorkflowArtifact, resolveTarget],
  );

  return { handleOpenArtifact, handleOpenRun };
}
