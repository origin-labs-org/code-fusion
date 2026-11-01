import { z } from "zod";

export const CF_PROCESS_DIAGNOSTIC_PREFIX = "[cf-process-exception] ";
export const CF_PROCESS_DIAGNOSTIC_NAME_MAX_CHARS = 128;
export const CF_PROCESS_DIAGNOSTIC_MESSAGE_MAX_CHARS = 4_000;
export const CF_PROCESS_DIAGNOSTIC_STACK_MAX_CHARS = 16_000;
export const CF_PROCESS_DIAGNOSTIC_MAX_LINE_CHARS = 128 * 1024;
export const CF_AGENT_LIFECYCLE_LOG_MARKER = "[cf-agent-lifecycle-reported]";

const processErrorKindSchema = z.enum(["uncaughtException", "unhandledRejection"]);
export const cfProcessDiagnosticSchema = z
  .object({
    version: z.literal(1),
    errorId: z.uuid(),
    kind: processErrorKindSchema,
    origin: processErrorKindSchema,
    name: z.string().min(1).max(CF_PROCESS_DIAGNOSTIC_NAME_MAX_CHARS),
    message: z.string().max(CF_PROCESS_DIAGNOSTIC_MESSAGE_MAX_CHARS),
    stack: z.string().max(CF_PROCESS_DIAGNOSTIC_STACK_MAX_CHARS).optional(),
    occurredAt: z.number().int().nonnegative(),
  })
  .strict();
export type CfProcessDiagnostic = z.infer<typeof cfProcessDiagnosticSchema>;

export function parseCfProcessDiagnostic(line: string): CfProcessDiagnostic | undefined {
  if (
    !line.startsWith(CF_PROCESS_DIAGNOSTIC_PREFIX) ||
    line.length > CF_PROCESS_DIAGNOSTIC_MAX_LINE_CHARS
  ) {
    return undefined;
  }
  try {
    const result = cfProcessDiagnosticSchema.safeParse(
      JSON.parse(line.slice(CF_PROCESS_DIAGNOSTIC_PREFIX.length)),
    );
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
