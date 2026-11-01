// ============================================================
// ============================================================
//
//

import { z } from "zod";

export const WORKFLOW_WORKSPACE_LIMITS = {
  
  maxNodes: 2000,
  
  maxOpLength: 32,
  
  maxArgs: 16,
  
  maxErrorMessageLength: 2000,
  
  resultMaxBytes: 32 * 1024,
} as const;

export const workflowRunWorkspaceNodeKindSchema = z.enum(["world-read", "world-run"]);
export type WorkflowRunWorkspaceNodeKind = z.infer<typeof workflowRunWorkspaceNodeKindSchema>;

export const workflowRunWorkspaceNodeStatusSchema = z.enum(["running", "completed", "failed"]);
export type WorkflowRunWorkspaceNodeStatus = z.infer<typeof workflowRunWorkspaceNodeStatusSchema>;

export const workflowRunWorkspaceNodeErrorSchema = z
  .object({
    code: z.string().min(1).max(64),
    message: z.string().max(WORKFLOW_WORKSPACE_LIMITS.maxErrorMessageLength),
  })
  .strict();
export type WorkflowRunWorkspaceNodeError = z.infer<typeof workflowRunWorkspaceNodeErrorSchema>;

export const workflowRunWorkspaceNodeSummarySchema = z
  .object({
    resultBytes: z.number().int().nonnegative(),
    resultCount: z.number().int().nonnegative().optional(),
    exitCode: z.number().int().optional(),
    stdoutBytes: z.number().int().nonnegative().optional(),
    stderrBytes: z.number().int().nonnegative().optional(),
  })
  .strict();
export type WorkflowRunWorkspaceNodeSummary = z.infer<typeof workflowRunWorkspaceNodeSummarySchema>;

export const workflowRunWorkspaceNodeSchema = z
  .object({
    siteId: z.string().min(1).max(64),
    ordinal: z.number().int().nonnegative(),
    kind: workflowRunWorkspaceNodeKindSchema,
    op: z.string().min(1).max(WORKFLOW_WORKSPACE_LIMITS.maxOpLength).optional(),
    args: z.array(z.unknown()).max(WORKFLOW_WORKSPACE_LIMITS.maxArgs).optional(),
    inputTruncated: z.literal(true).optional(),
    status: workflowRunWorkspaceNodeStatusSchema,
    error: workflowRunWorkspaceNodeErrorSchema.optional(),
    summary: workflowRunWorkspaceNodeSummarySchema.optional(),
    
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type WorkflowRunWorkspaceNode = z.infer<typeof workflowRunWorkspaceNodeSchema>;

export const v4ConversationWorkflowRunWorkspaceParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
  })
  .strict();
export type V4ConversationWorkflowRunWorkspaceParams = z.infer<
  typeof v4ConversationWorkflowRunWorkspaceParamsSchema
>;

export const v4ConversationWorkflowRunWorkspaceResultSchema = z
  .object({
    
    nodes: z.array(workflowRunWorkspaceNodeSchema).max(WORKFLOW_WORKSPACE_LIMITS.maxNodes),
    
    truncated: z.boolean().optional(),
  })
  .strict();
export type V4ConversationWorkflowRunWorkspaceResult = z.infer<
  typeof v4ConversationWorkflowRunWorkspaceResultSchema
>;

export const v4ConversationWorkflowRunNodeResultParamsSchema = z
  .object({
    sessionId: z.string().min(1),
    runId: z.string().min(1),
    siteId: z.string().min(1).max(64),
    ordinal: z.number().int().nonnegative(),
    
    maxBytes: z.number().int().positive().max(WORKFLOW_WORKSPACE_LIMITS.resultMaxBytes).optional(),
  })
  .strict();
export type V4ConversationWorkflowRunNodeResultParams = z.infer<
  typeof v4ConversationWorkflowRunNodeResultParamsSchema
>;

export const v4ConversationWorkflowRunNodeResultResultSchema = z
  .object({
    status: workflowRunWorkspaceNodeStatusSchema,
    
    result: z.unknown().optional(),
    error: workflowRunWorkspaceNodeErrorSchema.optional(),
    truncated: z.boolean(),
    
    totalBytes: z.number().int().nonnegative(),
  })
  .strict();
export type V4ConversationWorkflowRunNodeResultResult = z.infer<
  typeof v4ConversationWorkflowRunNodeResultResultSchema
>;
