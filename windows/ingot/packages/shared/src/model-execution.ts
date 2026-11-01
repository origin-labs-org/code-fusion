import { z } from "zod";
import { modelSelectionSchema } from "./model-selection.js";

export const modelExecutionSelectionFallbackReasonSchema = z.enum([
  "highspeed_card_expired",
  "highspeed_request_failed",
  "highspeed_selection_unavailable",
]);

export const modelExecutionSchema = z
  .object({
    memoryExtraction: z.literal("skip").optional(),
    selectionScope: z.literal("execution"),
    offPeak: z
      .object({
        executionId: z.string().min(1),
        ticketId: z.string().min(1),
        providerErrorCode: z.string().min(1),
      })
      .strict()
      .optional(),
    requestAuth: z
      .object({
        apiKey: z.string().min(1).optional(),
        apiKeyId: z.string().trim().min(1).optional(),
        accountScope: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        headers: z.record(z.string().min(1), z.string().min(1)).optional(),
      })
      .strict()
      .optional(),
    subagents: z
      .object({
        foregroundModel: z.literal("submission"),
        background: z.enum(["deny", "allow"]),
      })
      .strict()
      .optional(),
    
    selectionFallback: z
      .object({
        providerId: z.string().min(1),
        rules: z
          .array(
            z
              .object({
                reason: modelExecutionSelectionFallbackReasonSchema,
                providerErrorCode: z.string().min(1).optional(),
              })
              .strict(),
          )
          .min(1),
        target: modelSelectionSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ModelExecution = z.infer<typeof modelExecutionSchema>;
export type ModelExecutionSelectionFallback = NonNullable<ModelExecution["selectionFallback"]>;
export type ModelExecutionSelectionFallbackRule = ModelExecutionSelectionFallback["rules"][number];
export type ModelExecutionSelectionFallbackReason = z.infer<
  typeof modelExecutionSelectionFallbackReasonSchema
>;
