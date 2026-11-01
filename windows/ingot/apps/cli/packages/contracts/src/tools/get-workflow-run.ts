// ============================================================
// ============================================================

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";
import {
  GET_WORKFLOW_RUN_ROSTER_LIMITS,
  GetWorkflowRunHealthSchema,
  GetWorkflowRunPhaseSchema,
  GetWorkflowRunSubagentSchema,
} from "./get-workflow-run-roster.js";
import { WorkflowRunSummarySchema } from "./list-workflow-runs.js";

export * from "./get-workflow-run-roster.js";

export const GET_WORKFLOW_RUN_TOOL_NAME = "GetWorkflowRun";

export const GetWorkflowRunInputSchema = z
  .object({
    run_id: z
      .string()
      .min(1)
      .describe("The workflow run ID to inspect (as returned by CreateWorkflow or ListWorkflowRuns)"),
  })
  .strict();

export type GetWorkflowRunInput = z.infer<typeof GetWorkflowRunInputSchema>;

export const GetWorkflowRunInputJsonSchema = toToolJsonSchema(GetWorkflowRunInputSchema);

export const GetWorkflowRunUsageSchema = z
  .object({
    spentTokens: z.number(),
    nodesObserved: z.number(),
    nodesRunning: z.number(),
    nodesCompleted: z.number(),
    nodesFailed: z.number(),
  })
  .strict();

export const GetWorkflowRunActorSchema = z
  .object({
    siteId: z.string(),
    ordinal: z.number(),
    name: z.string().optional(),
  })
  .strict();

export const GetWorkflowRunLogEntrySchema = z
  .object({
    sequence: z.number(),
    message: z.string(),
    at: z.number().optional(),
  })
  .strict();

export const GetWorkflowRunPendingQuestionSchema = z
  .object({
    qid: z.string(),
    
    actor: z.string(),
    
    actorName: z.string().optional(),
    question: z.string(),
    context: z.string().optional(),
    
    askedAt: z.number(),
  })
  .strict();

export const GET_WORKFLOW_RUN_MAX_HOLES = 32;

export const GetWorkflowRunHoleSchema = z
  .object({
    
    siteId: z.string(),
    ordinal: z.number(),
    
    name: z.string(),
    
    type: z.string(),
    state: z.enum(["waiting", "filled"]),
    
    since: z.number().optional(),
    
    filledAt: z.number().optional(),
    
    filledBy: z.string().optional(),
  })
  .strict();

export type GetWorkflowRunHole = z.infer<typeof GetWorkflowRunHoleSchema>;

export const GetWorkflowRunArtifactSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["file", "markdown", "chart", "table", "metrics", "board"]),
    
    title: z.string().optional(),
    
    version: z.number(),
    
    contentType: z.string().optional(),
    
    bytes: z.number().optional(),
    
    sourcePath: z.string().optional(),
    
    itemCount: z.number(),
    
    primary: z.literal(true).optional(),
  })
  .strict();

export const GetWorkflowRunErrorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    
    providerStop: z
      .object({
        kind: z.enum([
          "auth",
          "not_configured",
          "model_unavailable",
          "invalid_request",
          "quota",
          "other",
        ]),
        reason: z.string(),
        providerId: z.string().optional(),
        providerLabel: z.string().optional(),
        modelId: z.string().optional(),
        providerCode: z.string().optional(),
        subagent: z.string().optional(),
        subagentName: z.string().optional(),
        phase: z.string().optional(),
        rawMessage: z.string().optional(),
        resetAt: z.number().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const GET_WORKFLOW_RUN_SUMMARY_MAX_CHARS = 400;

export const GetWorkflowRunOutputSchema = WorkflowRunSummarySchema.extend({
  
  summary: z.string().max(GET_WORKFLOW_RUN_SUMMARY_MAX_CHARS),
  
  generatedAt: z.number(),
  usage: GetWorkflowRunUsageSchema,
  
  maxConcurrency: z.number().int().positive().optional(),
  
  subagentModel: z.string().optional(),
  
  modelBindings: z.record(z.string()).optional(),
  
  scriptPath: z.string().optional(),
  actors: z.array(GetWorkflowRunActorSchema),
  
  logTail: z.array(GetWorkflowRunLogEntrySchema),
  
  phases: z.array(GetWorkflowRunPhaseSchema).max(GET_WORKFLOW_RUN_ROSTER_LIMITS.maxPhases).optional(),
  
  subagents: z.array(GetWorkflowRunSubagentSchema).max(GET_WORKFLOW_RUN_ROSTER_LIMITS.maxSubagents),
  
  subagentsTruncated: z.literal(true).optional(),
  
  health: GetWorkflowRunHealthSchema,
  
  result: z.string().optional(),
  
  error: GetWorkflowRunErrorSchema.optional(),
  
  pendingQuestions: z.array(GetWorkflowRunPendingQuestionSchema).optional(),
  
  holes: z.array(GetWorkflowRunHoleSchema).max(GET_WORKFLOW_RUN_MAX_HOLES).optional(),
  
  artifacts: z.array(GetWorkflowRunArtifactSchema).optional(),
}).strict();

export type GetWorkflowRunOutput = z.infer<typeof GetWorkflowRunOutputSchema>;

export const GetWorkflowRunOutputJsonSchema = toToolJsonSchema(GetWorkflowRunOutputSchema);
