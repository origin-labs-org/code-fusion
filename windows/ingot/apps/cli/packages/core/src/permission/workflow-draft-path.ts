// ============================================================
// ============================================================
//

import nodePath from "node:path";

import { WORKFLOW_DRAFTS_DIR } from "@origin-ai/cf-contracts";

export interface WorkflowDraftPathModule {
  isAbsolute: (path: string) => boolean;
  relative: (from: string, to: string) => string;
  resolve: (...paths: string[]) => string;
}

export interface WorkflowDraftPathInput {
  
  filePath: string;
  
  workingDirectory: string;
  
  pathModule?: WorkflowDraftPathModule;
}

const WORKFLOW_DRAFT_PREAPPROVED_TOOL_NAMES = new Set(["Edit", "Write"]);

export interface WorkflowDraftWriteInput {
  toolName: string;
  
  input: unknown;
  
  workingDirectory?: string;
  pathModule?: WorkflowDraftPathModule;
}

export function isPreapprovedWorkflowDraftWrite(input: WorkflowDraftWriteInput): boolean {
  if (!WORKFLOW_DRAFT_PREAPPROVED_TOOL_NAMES.has(input.toolName)) return false;
  if (typeof input.workingDirectory !== "string") return false;
  if (!input.input || typeof input.input !== "object") return false;
  const filePath = (input.input as Record<string, unknown>).file_path;
  if (typeof filePath !== "string") return false;
  return isWorkflowDraftPath({
    filePath,
    pathModule: input.pathModule,
    workingDirectory: input.workingDirectory,
  });
}

export function isWorkflowDraftPath(input: WorkflowDraftPathInput): boolean {
  const path = input.pathModule ?? nodePath;
  if (input.workingDirectory.length === 0 || input.filePath.length === 0) return false;

  const draftsDir = path.resolve(input.workingDirectory, WORKFLOW_DRAFTS_DIR);
  const resolved = path.resolve(input.workingDirectory, input.filePath);
  const relativePath = path.relative(draftsDir, resolved);

  return (
    relativePath.length > 0 && !path.isAbsolute(relativePath) && !relativePath.startsWith("..")
  );
}
