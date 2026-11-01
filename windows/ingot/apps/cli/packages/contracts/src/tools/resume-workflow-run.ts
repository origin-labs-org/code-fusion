// ============================================================
// ============================================================
//
//

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

export const RESUME_WORKFLOW_RUN_TOOL_NAME = "ResumeWorkflowRun";

export const ResumeWorkflowRunInputSchema = z
  .object({
    run_id: z
      .string()
      .min(1)
      .describe(
        "The workflow run ID to resume — a cancelled run or one that failed with code `Interrupted`, as seen with GetWorkflowRun or ListWorkflowRuns",
      ),
  })
  .strict();

export type ResumeWorkflowRunInput = z.infer<typeof ResumeWorkflowRunInputSchema>;

export const ResumeWorkflowRunInputJsonSchema = toToolJsonSchema(ResumeWorkflowRunInputSchema);

export const ResumeWorkflowRunOutputSchema = z
  .object({
    ok: z.literal(true),
    runId: z.string().min(1),
    response: z.string(),
    status: z.literal("backgrounded"),
    backgroundTaskId: z.string().min(1),
  })
  .strict();

export type ResumeWorkflowRunOutput = z.infer<typeof ResumeWorkflowRunOutputSchema>;

export const ResumeWorkflowRunOutputJsonSchema = toToolJsonSchema(ResumeWorkflowRunOutputSchema);
