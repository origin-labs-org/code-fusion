// ============================================================
// ============================================================
//

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";
import { SavedWorkflowEntrySchema, SavedWorkflowInvalidEntrySchema } from "./saved-workflow.js";

export const LIST_SAVED_WORKFLOWS_TOOL_NAME = "ListSavedWorkflows";

export const ListSavedWorkflowsInputSchema = z
  .object({})
  .strict();

export type ListSavedWorkflowsInput = z.infer<typeof ListSavedWorkflowsInputSchema>;

export const ListSavedWorkflowsInputJsonSchema = toToolJsonSchema(ListSavedWorkflowsInputSchema);

export const ListSavedWorkflowsOutputSchema = z
  .object({
    workflows: z.array(SavedWorkflowEntrySchema),
    
    invalid: z.array(SavedWorkflowInvalidEntrySchema).optional(),
  })
  .strict();

export type ListSavedWorkflowsOutput = z.infer<typeof ListSavedWorkflowsOutputSchema>;

export const ListSavedWorkflowsOutputJsonSchema = toToolJsonSchema(ListSavedWorkflowsOutputSchema);
