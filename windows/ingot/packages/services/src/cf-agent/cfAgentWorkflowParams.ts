import type {
  CfSavedWorkflowMeta,
  CfSavedWorkflowScope,
  CfWorkflowsForRunCandidate,
} from "@origin-ai/cf-shared";
import type { CfAgentWorkspaceTarget } from "./cfAgentPluginParams.js";

//
export type CfAgentSavedWorkflowTarget =
  | (CfAgentWorkspaceTarget & { scope?: CfSavedWorkflowScope })
  | ({ scope: "global" } & Partial<CfAgentWorkspaceTarget>);

export type CfAgentListSavedWorkflowsParams = CfAgentSavedWorkflowTarget;

export type CfAgentGetSavedWorkflowParams = CfAgentSavedWorkflowTarget & {
  name: string;
};

export type CfAgentUpdateSavedWorkflowMetaParams = CfAgentSavedWorkflowTarget & {
  name: string;
  meta: CfSavedWorkflowMeta;
};

export type CfAgentDeleteSavedWorkflowParams = CfAgentSavedWorkflowTarget & {
  name: string;
};

export type CfAgentListSavedWorkflowRunsParams = CfAgentSavedWorkflowTarget & {
  
  name?: string;
  
  limit: number;
};

export type CfAgentMoveSavedWorkflowParams = CfAgentWorkspaceTarget & {
  name: string;
};

export type CfAgentSaveSavedWorkflowFromRunParams = CfAgentWorkspaceTarget & {
  
  runId: string;
  name: string;
  meta: CfSavedWorkflowMeta;
  
  scope?: CfSavedWorkflowScope;
  
  overwrite?: boolean;
};

export type CfAgentFindSavedWorkflowForRunParams = CfAgentWorkspaceTarget & {
  runId: string;
  
  candidates?: readonly CfWorkflowsForRunCandidate[];
};
