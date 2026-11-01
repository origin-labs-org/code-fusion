// ============================================================
// ============================================================

import { z } from "zod";
import { CreateWorkflowDiagnosticSchema } from "./create-workflow.js";
import { toToolJsonSchema } from "./json-schema.js";

export const EVAL_WORKFLOW_SNIPPET_TOOL_NAME = "EvalWorkflowSnippet";

export const EVAL_WORKFLOW_SNIPPET_DEFAULT_TIMEOUT_MS = 60_000;
export const EVAL_WORKFLOW_SNIPPET_MAX_TIMEOUT_MS = 600_000;
export const EVAL_WORKFLOW_SNIPPET_MIN_TIMEOUT_MS = 1_000;

export const EVAL_WORKFLOW_SNIPPET_SOURCE_ERROR =
  "Provide exactly one snippet source: `code` for the snippet inline, or `path` for a file holding it. Passing both, or neither, is ambiguous.";

export const EvalWorkflowSnippetInputSchema = z
  .object({
    code: z
      .string()
      .min(1)
      .optional()
      .describe("The snippet, inline. This OR `path`, never both."),
    
    path: z
      .string()
      .min(1)
      .optional()
      .describe("A file holding the snippet, read whole. This OR `code`, never both."),
    timeoutMs: z
      .number()
      .int()
      .min(EVAL_WORKFLOW_SNIPPET_MIN_TIMEOUT_MS)
      .max(EVAL_WORKFLOW_SNIPPET_MAX_TIMEOUT_MS)
      .optional()
      .describe("Wall clock for the whole snippet, in ms. Default 60000, at most 600000."),
  })
  .strict();

export type EvalWorkflowSnippetInput = z.infer<typeof EvalWorkflowSnippetInputSchema>;

export const EvalWorkflowSnippetInputJsonSchema = toToolJsonSchema(EvalWorkflowSnippetInputSchema);

export const EVAL_WORKFLOW_SNIPPET_MAX_LOGS = 100;
export const EVAL_WORKFLOW_SNIPPET_MAX_LOG_CHARS = 2_048;

export const EVAL_WORKFLOW_SNIPPET_MAX_ARTIFACT_BYTES = 256 * 1024;

export const EvalWorkflowSnippetOutputSchema = z
  .object({
    
    ok: z.boolean(),
    diagnostics: z.array(CreateWorkflowDiagnosticSchema),
    
    logs: z.array(z.string().max(EVAL_WORKFLOW_SNIPPET_MAX_LOG_CHARS)),
    
    response: z.string(),
    durationMs: z.number().int().nonnegative(),
  })
  .strict();

export type EvalWorkflowSnippetOutput = z.infer<typeof EvalWorkflowSnippetOutputSchema>;

export const EvalWorkflowSnippetOutputJsonSchema = toToolJsonSchema(
  EvalWorkflowSnippetOutputSchema,
);
