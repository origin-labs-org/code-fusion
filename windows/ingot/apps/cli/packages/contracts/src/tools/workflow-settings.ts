// ============================================================
// ============================================================
// docs/dynamic-workflow/launch.md「Adjusting the settings in the window」。
//
//

import { z } from "zod";

const WORKFLOW_SETTINGS_MAX_MODEL_CHARS = 512;

export const WorkflowAdjustableSettingsSchema = z
  .object({
    
    subagent_model: z.boolean(),
    
    concurrency_ceiling: z.number().int().positive().optional(),
  })
  .strict();

export type WorkflowAdjustableSettings = z.infer<typeof WorkflowAdjustableSettingsSchema>;

export const WORKFLOW_MODEL_BINDINGS_MAX_ENTRIES = 64;

const WORKFLOW_MODEL_NAME_MAX_CHARS = 512;

export const WorkflowModelBindingsSchema = z
  .record(
    z.string().min(1).max(WORKFLOW_MODEL_NAME_MAX_CHARS),
    z.string().trim().min(1).max(WORKFLOW_SETTINGS_MAX_MODEL_CHARS),
  )
  .refine((bindings) => Object.keys(bindings).length <= WORKFLOW_MODEL_BINDINGS_MAX_ENTRIES, {
    message: `at most ${WORKFLOW_MODEL_BINDINGS_MAX_ENTRIES} model names`,
  });

export type WorkflowModelBindings = z.infer<typeof WorkflowModelBindingsSchema>;

export const WorkflowSettingsAdjustmentSchema = z.object({
  subagent_model: z
    .string()
    .trim()
    .min(1)
    .max(WORKFLOW_SETTINGS_MAX_MODEL_CHARS)
    .nullable()
    .optional(),
  max_concurrency: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional(),
});

export type WorkflowSettingsAdjustment = z.infer<typeof WorkflowSettingsAdjustmentSchema>;

export function parseWorkflowSettingsAdjustment(
  content: unknown,
): WorkflowSettingsAdjustment | undefined {
  const parsed = WorkflowSettingsAdjustmentSchema.safeParse(content);
  if (!parsed.success) return undefined;
  const adjustment: WorkflowSettingsAdjustment = {};
  if (parsed.data.subagent_model !== undefined) {
    adjustment.subagent_model = parsed.data.subagent_model;
  }
  if (parsed.data.max_concurrency !== undefined) {
    adjustment.max_concurrency = parsed.data.max_concurrency;
  }
  return Object.keys(adjustment).length === 0 ? undefined : adjustment;
}
