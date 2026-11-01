import type { RuntimeModelTextResult } from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { toTokenUsageInfo } from "../helpers/index.js";
import {
  countContextPrefixMessages,
  createRuntimeAssistantEntry,
  createRuntimeUserEntry,
  type RuntimeMessageEntry,
} from "../../agent/message-history.js";
import type { RegularTurnLoopState, TurnRequestState } from "./turn-loop-state.js";

export const OUTPUT_TOKEN_CONTINUE_PROMPT =
  "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.";

export const OUTPUT_TOKEN_LIMIT_ERROR_MESSAGE =
  "The model's response exceeded the output token maximum.";

const MAX_OUTPUT_TOKEN_CONTINUATIONS = 3;
const OUTPUT_LIMIT_RAW_REASONS = new Set([
  "max_tokens",
  "max_output_tokens",
  "model_context_window_exceeded",
]);

type OutputTokenContinuationDecision = "continue" | "exhausted" | "none";

export function classifyOutputTokenContinuation(input: {
  finishReason: string | undefined;
  rawFinishReason: string | undefined;
  toolCallCount: number;
  continuationCount: number;
}): OutputTokenContinuationDecision {
  if (input.toolCallCount > 0) return "none";
  if (!isOutputTokenLimitFinishReason(input.finishReason, input.rawFinishReason)) {
    return "none";
  }
  return input.continuationCount < MAX_OUTPUT_TOKEN_CONTINUATIONS ? "continue" : "exhausted";
}

export function isOutputTokenLimitFinishReason(
  finishReason: string | undefined,
  rawFinishReason: string | undefined,
): boolean {

  return finishReason === "length" || OUTPUT_LIMIT_RAW_REASONS.has(rawFinishReason ?? "");
}

function createOutputTokenContinuationEntry(): RuntimeMessageEntry {
  return {
    ...createRuntimeUserEntry(OUTPUT_TOKEN_CONTINUE_PROMPT),
    queryScope: "output_token_continuation",
  };
}

function isOutputTokenContinuationEntry(entry: RuntimeMessageEntry): boolean {
  return entry.kind !== "attachment" && entry.queryScope === "output_token_continuation";
}

export function filterOutputTokenContinuationEntries(
  entries: readonly RuntimeMessageEntry[],
): readonly RuntimeMessageEntry[] {
  const firstContinuation = entries.findIndex(isOutputTokenContinuationEntry);
  if (firstContinuation < 0) return entries;
  return entries.filter((entry) => !isOutputTokenContinuationEntry(entry));
}

export function preserveCanonicalContextPrefix(
  currentCanonicalEntries: readonly RuntimeMessageEntry[],
  turnLocalEntries: readonly RuntimeMessageEntry[],
): readonly RuntimeMessageEntry[] {
  return [
    ...currentCanonicalEntries.slice(0, countContextPrefixMessages(currentCanonicalEntries)),
    ...turnLocalEntries.slice(countContextPrefixMessages(turnLocalEntries)),
  ];
}

export function appendTurnRequestEntries(
  state: TurnRequestState,
  entries: readonly RuntimeMessageEntry[],
): void {
  if (entries.length === 0) return;
  state.entries = [...state.entries, ...entries];
}

export function commitTurnRequestEntries(
  runtime: AgentRuntimeInternal,
  state: TurnRequestState,
  entries: readonly RuntimeMessageEntry[],
): void {
  if (entries.length === 0) return;
  runtime.messageHistory.addEntries(entries);
  appendTurnRequestEntries(state, entries);
}

export function commitAssistantToTurnRequest(
  runtime: AgentRuntimeInternal,
  state: RegularTurnLoopState,
  result: RuntimeModelTextResult,
  toolCalls: Parameters<typeof createRuntimeAssistantEntry>[1],
): boolean {
  const reasoning = result.reasoning?.filter(hasAssistantReasoningContent);
  const hasAssistantContent =
    state.modelResponse.length > 0 || (reasoning?.length ?? 0) > 0 || (toolCalls?.length ?? 0) > 0;
  if (!hasAssistantContent) return false;
  const modelRef = { providerId: state.model.providerId, modelId: state.model.modelId };
  commitTurnRequestEntries(runtime, state.turnRequestState, [
    createRuntimeAssistantEntry(
      state.modelResponse,
      toolCalls,
      reasoning,
      modelRef,
      toTokenUsageInfo(result.usage),
    ),
  ]);
  return true;
}

export function hasAssistantReasoningContent(
  reasoning: NonNullable<RuntimeModelTextResult["reasoning"]>[number],
): boolean {
  return reasoning.text.length > 0 || Object.keys(reasoning.providerOptions ?? {}).length > 0;
}

export function appendOutputTokenContinuation(state: TurnRequestState): void {
  appendTurnRequestEntries(state, [createOutputTokenContinuationEntry()]);
  state.outputTokenContinuationCount += 1;
}

export function completeOutputTokenRecovery(state: TurnRequestState): void {
  state.outputTokenContinuationCount = 0;
}

export function finishOutputTokenRecovery(state: TurnRequestState): void {
  completeOutputTokenRecovery(state);
}
