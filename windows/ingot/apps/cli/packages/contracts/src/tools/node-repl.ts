import { z } from "zod";
import { toToolJsonSchema } from "./json-schema.js";

const JsInputBaseShape = {
  code: z.string().describe("JavaScript code to execute in the Node REPL session"),
  timeout_ms: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .optional()
    .describe(
      "Per-call timeout in milliseconds. You MUST provide this when the code is expected to run longer than 30000 ms, including all awaited operations. Set it to at least the estimated total runtime plus 15000 ms. If that exceeds the 120000 ms maximum, split the work into multiple calls.",
    ),
};
const JsUserTitleSchema = z
  .string()
  .min(1)
  .max(120)
  .describe(
    "Required short user-facing title in the user's language that describes the intended action without implementation terms such as js, JavaScript, or node_repl",
  );

export const JsInputSchema = z
  .object({
    ...JsInputBaseShape,
    title: JsUserTitleSchema,
  })
  .strict();
export type JsInput = z.infer<typeof JsInputSchema>;

export const JsRuntimeInputSchema = z
  .object({
    ...JsInputBaseShape,
    title: JsUserTitleSchema.optional(),
  })
  .strict();
export type JsRuntimeInput = z.infer<typeof JsRuntimeInputSchema>;

export const JsOutputSchema = z
  .object({
    result: z.string().optional(),
    logs: z.string(),
    error: z
      .object({
        name: z.string(),
        message: z.string(),
        stack: z.string().optional(),
      })
      .optional(),
    images: z.array(z.object({ base64: z.string(), mimeType: z.string() }).strict()).optional(),
    browserScreenshotPaths: z.array(z.string()).optional(),
    responseMeta: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type JsOutput = z.infer<typeof JsOutputSchema>;

export const JsInputJsonSchema = toToolJsonSchema(JsInputSchema);
export const JsOutputJsonSchema = toToolJsonSchema(JsOutputSchema);
