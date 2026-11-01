import type { ToolExecutionSpanWriter } from "@origin-ai/cf-contracts";
import type { ExecutableToolCall, ToolExecutionResult } from "../types.js";
import type { ToolExecuteOptions, ToolExecutorDeps } from "./types.js";

export async function runToolCallWithTelemetry(
  deps: ToolExecutorDeps,
  toolCall: ExecutableToolCall,
  options: ToolExecuteOptions | undefined,
  execute: (telemetry: ToolExecutionSpanWriter | undefined) => Promise<ToolExecutionResult>,
): Promise<ToolExecutionResult> {
  const scope = deps.agentTelemetry?.startTool({
    registeredToolName: toolCall.name,
    toolCallId: toolCall.id,
  });
  if (!scope) return execute(undefined);
  return scope.run(async () => {
    try {
      return await execute(scope);
    } catch (error) {
      if (options?.signal?.aborted) {
        scope.finishCancelled("abort_signal");
      } else {
        scope.finishFailed("unhandled", "unknown", error);
      }
      throw error;
    }
  });
}
