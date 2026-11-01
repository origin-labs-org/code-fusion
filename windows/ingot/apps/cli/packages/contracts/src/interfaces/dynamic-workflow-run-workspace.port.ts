// ============================================================
// ============================================================

import type { DynamicWorkflowRunError } from "./dynamic-workflow-run.port.js";

export type DynamicWorkflowRunWorkspaceNodeKind = "world-read" | "world-run";

export type DynamicWorkflowRunWorkspaceNodeStatus = "running" | "completed" | "failed";

export interface DynamicWorkflowRunWorkspaceNodeSummary {
  
  resultBytes: number;
  resultCount?: number;
  exitCode?: number;
  stdoutBytes?: number;
  stderrBytes?: number;
}

export interface DynamicWorkflowRunWorkspaceNode {
  siteId: string;
  ordinal: number;
  kind: DynamicWorkflowRunWorkspaceNodeKind;
  op?: string;
  args?: readonly unknown[];
  inputTruncated?: true;
  status: DynamicWorkflowRunWorkspaceNodeStatus;
  
  error?: DynamicWorkflowRunError;
  
  summary?: DynamicWorkflowRunWorkspaceNodeSummary;
  
  createdAt: number;
  updatedAt: number;
}

export interface DynamicWorkflowRunWorkspaceNodeResultQuery {
  
  maxBytes: number;
}

export interface DynamicWorkflowRunWorkspaceNodeResult {
  status: DynamicWorkflowRunWorkspaceNodeStatus;
  result?: unknown;
  error?: DynamicWorkflowRunError;
  truncated: boolean;
  totalBytes: number;
}
