// ============================================================
// submit_result Tool - actor terminal structured-result submission
// ============================================================

import { z } from "zod";
import { TOOL_JSON_SCHEMA_VERSION, toToolJsonSchema } from "./json-schema.js";

export const SUBMIT_RESULT_TOOL_NAME = "submit_result";

export const SubmitResultInputSchema = z
  .object({
    result: z
      .unknown()
      .describe(
        "The structured result for this ask, matching the JSON schema given in the ask instructions.",
      ),
  })
  .strict();

export type SubmitResultInput = z.infer<typeof SubmitResultInputSchema>;

export const SubmitResultInputJsonSchema = toToolJsonSchema(SubmitResultInputSchema);

export function typedSubmitResultInputSchema(
  resultSchema: Record<string, unknown>,
): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      result: {
        description: "The structured result for this ask.",
        ...resultSchema,
      },
    },
    required: ["result"],
    additionalProperties: false,
    $schema: TOOL_JSON_SCHEMA_VERSION,
  };
}

export const SubmitResultOutputSchema = z
  .object({
    status: z.literal("accepted"),
  })
  .strict();

export type SubmitResultOutput = z.infer<typeof SubmitResultOutputSchema>;

export const SubmitResultOutputJsonSchema = toToolJsonSchema(SubmitResultOutputSchema);
