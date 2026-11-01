import { ModelErrorCode } from "@origin-ai/cf-contracts";
import { AiSdkModelAdapterError } from "./errors.js";

export function normalizeModelToolName(
  value: unknown,
  context: Record<string, unknown>,
): string {
  if (typeof value === "string") {
    const toolName = value.trim();
    if (toolName) {
      return toolName;
    }

    const toolCallId = context.toolCallId;
    const hasClosableToolCallId =
      typeof toolCallId === "string" && toolCallId.trim().length > 0;
    if (context.providerExecuted !== true && hasClosableToolCallId) {
      return value;
    }
  }

  throw new AiSdkModelAdapterError(
    ModelErrorCode.InvalidModelResponse,
    "Model returned an invalid tool call: tool name is empty.",
    { context },
  );
}
