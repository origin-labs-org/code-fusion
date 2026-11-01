// ============================================================
// ============================================================

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

export const LIST_WORKFLOW_RUNS_TOOL_NAME = "ListWorkflowRuns";

export const WORKFLOW_RUN_LIFECYCLE_STATUSES = [
  "completed",
  "errored",
  "pending",
  "running",
  "stopped",
] as const;

export const WORKFLOW_RUN_STOP_REASONS = [
  "user",
  "model",
  "provider",
  "interrupted",
  "superseded",
] as const;

export const LIST_WORKFLOW_RUNS_MIN_LIMIT = 1;
export const LIST_WORKFLOW_RUNS_MAX_LIMIT = 50;
export const LIST_WORKFLOW_RUNS_DEFAULT_LIMIT = 20;

export const ListWorkflowRunsInputSchema = z
  .object({
    limit: clampedLimit().describe(
      `Maximum number of runs to return (${LIST_WORKFLOW_RUNS_MIN_LIMIT}-${LIST_WORKFLOW_RUNS_MAX_LIMIT}, default ${LIST_WORKFLOW_RUNS_DEFAULT_LIMIT}). Most recently updated runs come first.`,
    ),
    statuses: z
      .array(z.enum(WORKFLOW_RUN_LIFECYCLE_STATUSES))
      .optional()
      .describe(
        "Optional status filter. Omit to see every run in this project. Pass [\"running\", \"pending\"] to see only what is still in flight.",
      ),
  })
  .strict();

export type ListWorkflowRunsInput = z.infer<typeof ListWorkflowRunsInputSchema>;

export const ListWorkflowRunsInputJsonSchema = toToolJsonSchema(ListWorkflowRunsInputSchema);

export const WorkflowRunSummarySchema = z.object({
  runId: z.string().min(1),
  
  label: z.string(),
  
  labelSource: z.enum(["name", "script"]),
  status: z.enum(WORKFLOW_RUN_LIFECYCLE_STATUSES),
  
  stopReason: z.enum(WORKFLOW_RUN_STOP_REASONS).optional(),
  
  resumedFrom: z.string().min(1).optional(),
  
  supersededBy: z.string().min(1).optional(),
  ownedByThisSession: z.boolean(),
  
  possiblyInterrupted: z.boolean().optional(),
  
  createdAt: z.number(),
  updatedAt: z.number(),
});

export const ListWorkflowRunsRunSchema = WorkflowRunSummarySchema.extend({
  spentTokens: z.number(),
}).strict();

export type ListWorkflowRunsRun = z.infer<typeof ListWorkflowRunsRunSchema>;

export const ListWorkflowRunsOutputSchema = z
  .object({
    runs: z.array(ListWorkflowRunsRunSchema),
    
    truncated: z.boolean().optional(),
  })
  .strict();

export type ListWorkflowRunsOutput = z.infer<typeof ListWorkflowRunsOutputSchema>;

export const ListWorkflowRunsOutputJsonSchema = toToolJsonSchema(ListWorkflowRunsOutputSchema);

function clampedLimit(): z.ZodEffects<z.ZodDefault<z.ZodNumber>, number, unknown> {
  return z.preprocess((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    return Math.min(
      LIST_WORKFLOW_RUNS_MAX_LIMIT,
      Math.max(LIST_WORKFLOW_RUNS_MIN_LIMIT, Math.trunc(value)),
    );
  }, z.number().int().min(LIST_WORKFLOW_RUNS_MIN_LIMIT).max(LIST_WORKFLOW_RUNS_MAX_LIMIT).default(LIST_WORKFLOW_RUNS_DEFAULT_LIMIT));
}
