import type { HookRunResult, Model, TraceContext, TurnState } from "./deps.js";
import type { HookEventName } from "@origin-ai/cf-contracts";
import type { RuntimeMessageEntry } from "../agent/message-history.js";

export interface AgentRuntimeHookMethods {
  runSessionStartHooks(
    source: "startup" | "resume" | "clear" | "compact",
    traceContext: TraceContext,
    signal?: AbortSignal,
    model?: Pick<Model, "providerId" | "modelId">,
  ): Promise<HookRunResult>;
  runUserPromptSubmitHooks(
    prompt: string,
    attachments: TurnState["attachments"] | undefined,
    traceContext: TraceContext,
    signal?: AbortSignal,
  ): Promise<HookRunResult>;
  runStopHooks(
    response: string,
    toolCallCount: number,
    traceContext: TraceContext,
    signal?: AbortSignal,
    stopHookActive?: boolean,
  ): Promise<HookRunResult>;
  injectHookAdditionalContextIntoMessageHistory(
    eventName: HookEventName,
    additionalContexts: readonly string[],
  ): RuntimeMessageEntry | undefined;
  shouldContinueAfterStopHooks(result: HookRunResult, continuationCount: number): boolean;
}
