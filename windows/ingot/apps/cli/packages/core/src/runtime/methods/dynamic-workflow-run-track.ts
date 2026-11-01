import { CREATE_WORKFLOW_TOOL_NAME, type TraceContext } from "@origin-ai/cf-contracts";
import type { ExecutableToolCall } from "../../tool/types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { activateDynamicWorkflowTools } from "./dynamic-workflow-activation.js";

export async function trackResumedDynamicWorkflowRun(
  this: AgentRuntimeInternal,
  input: { runId: string; toolCallId?: string; name?: string; traceContext?: TraceContext },
): Promise<void> {
  const traceContext = input.traceContext ?? this.rootTraceContext;
  const toolCall: ExecutableToolCall = {
    id: input.toolCallId ?? `resume-${input.runId}`,
    name: CREATE_WORKFLOW_TOOL_NAME,
    input: input.name === undefined ? {} : { name: input.name },
  };
  await this.executor.trackExternalBackgroundTask(
    toolCall,
    { backgroundTaskId: input.runId, status: "backgrounded" },
    traceContext,
    undefined,
  );
  await activateDynamicWorkflowTools.call(this, { source: "run_control", traceContext });
}
