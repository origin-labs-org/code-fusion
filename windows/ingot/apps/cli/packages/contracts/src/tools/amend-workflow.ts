// ============================================================
// AmendWorkflow Tool - revise a run: stop it if it is still going, import its finished work, start the revision
// ============================================================
//

import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";
import {
  WorkflowAdjustableSettingsSchema,
  WorkflowModelBindingsSchema,
} from "./workflow-settings.js";
import {
  WORKFLOW_RUN_LIFECYCLE_STATUSES,
  WORKFLOW_RUN_STOP_REASONS,
} from "./list-workflow-runs.js";

export const AMEND_WORKFLOW_TOOL_NAME = "AmendWorkflow";

export const AMEND_WORKFLOW_SOURCE_ERROR =
  "Provide at most one revised script: `path` for the script file you edited (the usual form), or `script` for the whole revised script inline. Passing both is ambiguous; omit both to keep the predecessor's script unchanged.";

const AmendWorkflowModelInputSchema = z.object({
  run_id: z
    .string()
    .min(1)
    .describe("ID of the run to amend (from a result, a notification, GetWorkflowRun or ListWorkflowRuns)."),
  
  script: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The whole revised script, inline. This OR `path`, never both; omit both to keep the predecessor's script.",
    ),
  
  path: z
    .string()
    .min(1)
    .optional()
    .describe(
      "The revised script's file, usually the predecessor's own script file edited in place. This OR `script`, never both.",
    ),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Display label for the new run; defaults to the predecessor's."),
  
  max_concurrency: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe(
      "Omit to keep the predecessor's limit, null to return to the default, a number to set one above or below it (only when the user asks).",
    ),
  
  subagent_model: z
    .string()
    .trim()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "Omit to keep the predecessor's choice, null for the session model, a model id to set one (only when the user asks, never a model under another provider the user did not name — ask them first if one would help).",
    ),
});

export const AmendWorkflowPredecessorSchema = z
  .object({
    name: z.string().min(1).optional(),
    status: z.enum(WORKFLOW_RUN_LIFECYCLE_STATUSES),
    stop_reason: z.enum(WORKFLOW_RUN_STOP_REASONS).optional(),
    owned_by_this_session: z.boolean(),
    
    script_inherited: z.literal(true).optional(),
    
    introduces_providers: z.array(z.string().min(1)).nonempty().optional(),
  })
  .strict();

export type AmendWorkflowPredecessor = z.infer<typeof AmendWorkflowPredecessorSchema>;

export function isAmendWorkflowOwnedPredecessor(predecessor: unknown): boolean {
  if (!predecessor || typeof predecessor !== "object") return false;
  const facts = predecessor as Record<string, unknown>;
  return (
    facts.owned_by_this_session === true &&
    facts.stop_reason !== "user" &&
    facts.introduces_providers === undefined
  );
}

export const AmendWorkflowInputSchema = AmendWorkflowModelInputSchema.extend({
  predecessor: AmendWorkflowPredecessorSchema.optional(),
  
  script_line_offset: z.number().int().nonnegative().optional(),
  
  adjustable_settings: WorkflowAdjustableSettingsSchema.optional(),
  
  model_bindings: WorkflowModelBindingsSchema.optional(),
}).strict();

export type AmendWorkflowInput = z.infer<typeof AmendWorkflowInputSchema>;

export const AmendWorkflowInputJsonSchema = toToolJsonSchema(
  AmendWorkflowModelInputSchema.strict(),
);
