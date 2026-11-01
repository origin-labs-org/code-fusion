// ============================================================
// ============================================================

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";
import { CreateWorkflowDiagnosticSchema } from "./create-workflow.js";
import {
  SAVED_WORKFLOW_MAX_NAME_CHARS,
  SavedWorkflowArgsDeclarationSchema,
  SavedWorkflowScopeSchema,
  SavedWorkflowShadowingSchema,
} from "./saved-workflow.js";

export const SAVE_WORKFLOW_TOOL_NAME = "SaveWorkflow";

export const SAVE_WORKFLOW_SOURCE_ERROR =
  "Provide exactly one script source: `script` for the body inline, or `script_path` for the file holding it (a draft, usually). Passing both, or neither, is ambiguous.";

export const SAVE_WORKFLOW_SENTINEL_IN_SCRIPT_ERROR =
  "The `script` must be the workflow body only — it already starts with a `/* cf-workflow` metadata block. Pass the metadata through the `description` / `whenToUse` / `args` fields instead; the block is written for you.";

export const SaveWorkflowInputSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(SAVED_WORKFLOW_MAX_NAME_CHARS)
      .describe("File-safe identifier: letters, digits, dot, dash and underscore."),
    description: z.string().min(1).describe("One line saying what the workflow does."),
    whenToUse: z.string().min(1).optional().describe("When this workflow is the right answer."),
    args: SavedWorkflowArgsDeclarationSchema.optional().describe(
      "Argument declarations the script reads off `args`.",
    ),
    script: z
      .string()
      .optional()
      .describe(
        "The script body, inline, without a metadata block. This OR `script_path`, never both.",
      ),
    script_path: z
      .string()
      .min(1)
      .optional()
      .describe(
        "A file holding the script body, usually a draft a result named. This OR `script`, never both.",
      ),
    scope: SavedWorkflowScopeSchema.describe(
      '"project" when the script depends on this repository; "global" when it depends on nothing in it. Required, no default.',
    ),
    
    run_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Provenance only: the id of the run this workflow was distilled from, when saving a workflow that just ran. Pass it whenever you know it; it does not change what is saved.",
      ),
    
    path: z.string().min(1).optional(),
    
    overwrite: z.boolean().optional(),
    
    shadowing: SavedWorkflowShadowingSchema.optional(),
  })
  .strict();

export type SaveWorkflowInput = z.infer<typeof SaveWorkflowInputSchema>;

export const SaveWorkflowInputJsonSchema = toToolJsonSchema(SaveWorkflowInputSchema);

export const SaveWorkflowOutputSchema = z
  .object({
    diagnostics: z.array(CreateWorkflowDiagnosticSchema),
    ok: z.boolean(),
    response: z.string(),
    name: z.string().min(1),
    scope: SavedWorkflowScopeSchema,
    
    path: z.string().min(1),
    overwritten: z.boolean().optional(),
  })
  .strict();

export type SaveWorkflowOutput = z.infer<typeof SaveWorkflowOutputSchema>;

export const SaveWorkflowOutputJsonSchema = toToolJsonSchema(SaveWorkflowOutputSchema);
