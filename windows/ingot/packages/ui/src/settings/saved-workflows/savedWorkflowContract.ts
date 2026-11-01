

export type SavedWorkflowProjectTarget = {
  projectId?: string | null;
  hostId?: string;
  workspacePath: string;
  workspaceIdentity?: string;
};

export interface SavedWorkflowsOpenRunParams {
  sessionId: string;
  runId: string;
  toolCallId: string;
  workflowName: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface SavedWorkflowsOpenArtifactParams {
  sessionId: string;
  runId: string;
  artifactId: string;
  title?: string;
  
  contentType?: string;
  workspacePath: string;
  workspaceIdentity?: string;
}

export interface SavedWorkflowGroupState {
  loaded: boolean;
  empty: boolean;
  
  count: number;
}

export type SavedWorkflowGroupMode = { kind: "list" } | { kind: "detail"; name: string };
