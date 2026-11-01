// ============================================================
// ============================================================
// `DynamicWorkflowRunPort.fillHole`（interfaces/dynamic-workflow-run.port.ts）。
//

import { z } from "zod";
import { CreateWorkflowOutputJsonSchema, CreateWorkflowOutputSchema } from "./create-workflow.js";
import { toToolJsonSchema } from "./json-schema.js";

export const FILL_WORKFLOW_HOLE_TOOL_NAME = "FillWorkflowHole";

export const FILL_WORKFLOW_HOLE_SOURCE_ERROR =
  "Provide exactly one body source: `script` for the hole's statements written inline, or `path` for a file holding them (usually the fill file a rejected attempt was saved to). Passing both, or neither, is ambiguous.";

const FillWorkflowHoleModelInputSchema = z.object({
  run_id: z
    .string()
    .min(1)
    .describe("ID of the run that is waiting at the hole (from the hole notification)."),
  hole_id: z
    .string()
    .min(1)
    .describe(
      "The hole's site id from the notification or from GetWorkflowRun's holes, e.g. `hole#21b40fca`.",
    ),
  
  script: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The body: only the statements of the hole's function, inline. This OR `path`, never both. It is compiled where the hole stands and sees every binding declared before it; it must return the hole's type.",
    ),
  
  path: z
    .string()
    .min(1)
    .optional()
    .describe(
      "A file holding those statements — usually the fill file named by a rejected attempt, edited in place. This OR `script`, never both.",
    ),
});

export const FillWorkflowHoleHoleSchema = z
  .object({
    
    name: z.string().min(1),
    
    type: z.string().min(1),
    
    draft_path: z.string().min(1).optional(),
    
    line: z.number().int().positive().optional(),
    owned_by_this_session: z.boolean(),
  })
  .strict();

export type FillWorkflowHoleHole = z.infer<typeof FillWorkflowHoleHoleSchema>;

export function isFillWorkflowHoleOwnedRun(hole: unknown): boolean {
  if (!hole || typeof hole !== "object") return false;
  return (hole as Record<string, unknown>).owned_by_this_session === true;
}

export const FillWorkflowHoleInputSchema = FillWorkflowHoleModelInputSchema.extend({
  hole: FillWorkflowHoleHoleSchema.optional(),
}).strict();

export type FillWorkflowHoleInput = z.infer<typeof FillWorkflowHoleInputSchema>;

export const FillWorkflowHoleInputJsonSchema = toToolJsonSchema(
  FillWorkflowHoleModelInputSchema.strict(),
);

export const FillWorkflowHoleOutputSchema = CreateWorkflowOutputSchema;
export type FillWorkflowHoleOutput = z.infer<typeof FillWorkflowHoleOutputSchema>;
export const FillWorkflowHoleOutputJsonSchema = CreateWorkflowOutputJsonSchema;
