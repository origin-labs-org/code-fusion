import {
  STREAM_RECOVERY_DISCARDED_ERROR_NAME,
  STREAM_RECOVERY_DISCARDED_FINISH,
  ModelErrorCode,
  SessionEventType,
  TurnMachineImpl,
  traceContextToLogContext,
} from "../deps.js";
import type { MessageId, Model, TraceContext } from "../deps.js";
import type { ModelSelection } from "@origin-ai/cf-contracts";
import { isModelContextExceededError, projectExecutionErrorPayload } from "../helpers/index.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { ModelExecutionContext } from "../types.js";
import { recordModelHistoryRound, type RegularTurnLoopState } from "./turn-loop-state.js";
import { createTurnModel } from "./turn-model.js";

type SelectionFallbackDeclaration = NonNullable<ModelExecutionContext["selectionFallback"]>;

export interface ExecutionSelectionFallbackMatch {
  reason: SelectionFallbackDeclaration["rules"][number]["reason"];
  providerErrorCode?: string;
  statusCode?: number;
}

export interface ExecutionSelectionCreationFallbackMatch {
  reason: "highspeed_selection_unavailable";
}

export type ExecutionFallbackCandidateSource = "declared_target" | "session_selection";

export interface ExecutionFallbackCandidate {
  source: ExecutionFallbackCandidateSource;
  selection: ModelSelection;
}

export interface ExecutionSelectionFallbackResult {
  applied: boolean;
  settledAcceptedTools: boolean;
}

export function matchExecutionSelectionCreationFallback(input: {
  error: unknown;
  selection: ModelSelection | undefined;
  selectionFallback: ModelExecutionContext["selectionFallback"];
  selectionScope: ModelExecutionContext["selectionScope"] | undefined;
}): ExecutionSelectionCreationFallbackMatch | undefined {
  const fallback = input.selectionFallback;
  if (input.selectionScope !== "execution" || !input.selection || !fallback) return undefined;
  if (input.selection.providerId !== fallback.providerId) return undefined;
  const code =
    typeof input.error === "object" && input.error !== null && "code" in input.error
      ? (input.error as { code?: unknown }).code
      : undefined;
  if (code !== ModelErrorCode.ProviderNotFound && code !== ModelErrorCode.ModelNotFound) {
    return undefined;
  }
  return { reason: "highspeed_selection_unavailable" };
}

export function resolveExecutionFallbackCandidates(input: {
  declaredTarget: ModelSelection | undefined;
  executionProviderId: string;
  sessionSelection: ModelSelection | undefined;
}): ExecutionFallbackCandidate[] {
  const candidates: ExecutionFallbackCandidate[] = [];
  const seen = new Set<string>();
  const push = (
    source: ExecutionFallbackCandidateSource,
    selection: ModelSelection | undefined,
  ) => {
    if (!selection || selection.providerId === input.executionProviderId) return;
    const key = `${selection.providerId}/${selection.modelId}$${selection.options?.reasoningLevel ?? ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ source, selection });
  };
  push("declared_target", input.declaredTarget);
  push("session_selection", input.sessionSelection);
  return candidates;
}

export function matchExecutionSelectionFallback(input: {
  error: unknown;
  executionProviderId: string;
  selectionFallback: ModelExecutionContext["selectionFallback"];
  turnAborted: boolean;
}): ExecutionSelectionFallbackMatch | undefined {
  const fallback = input.selectionFallback;
  if (!fallback || input.turnAborted) return undefined;
  if (input.executionProviderId !== fallback.providerId) return undefined;
  if (isModelContextExceededError(input.error)) return undefined;
  const attribution = projectExecutionErrorPayload(input.error).attribution;
  if (
    (attribution?.source !== "provider" && attribution?.source !== "network") ||
    attribution.providerId !== fallback.providerId
  ) {
    return undefined;
  }
  const providerErrorCode = attribution.providerErrorCode;
  const rule = fallback.rules.find(
    (candidate) =>
      candidate.providerErrorCode === undefined ||
      candidate.providerErrorCode === providerErrorCode,
  );
  if (!rule) return undefined;
  return {
    reason: rule.reason,
    ...(providerErrorCode !== undefined ? { providerErrorCode } : {}),
    ...(attribution?.statusCode !== undefined ? { statusCode: attribution.statusCode } : {}),
  };
}

export async function applyExecutionSelectionFallback(
  runtime: AgentRuntimeInternal,
  state: RegularTurnLoopState,
  input: {
    assistantCreatedAt: number;
    assistantMessageId: MessageId;
    error: unknown;
    executionModel: Model;
    match: ExecutionSelectionFallbackMatch;
    modelTraceContext: TraceContext;
    streamingToolCoordinator: {
      settleForModelFallback(assistantCreatedAt: number): Promise<boolean>;
    };
  },
): Promise<ExecutionSelectionFallbackResult> {
  const executionModelSelection = {
    providerId: input.executionModel.providerId,
    modelId: input.executionModel.modelId,
  };
  const executionProviderId = String(executionModelSelection.providerId);
  const declaredTarget = state.selectionFallback?.target;
  const sessionSelection = state.highspeedFallbackSelection;
  const candidates = resolveExecutionFallbackCandidates({
    declaredTarget,
    executionProviderId,
    sessionSelection,
  });
  const skippedCandidates: Array<{
    source: ExecutionFallbackCandidateSource;
    providerId: string;
    modelId: string;
    error: string;
  }> = [];
  let resolved: { candidate: ExecutionFallbackCandidate; model: Model } | undefined;
  for (const candidate of candidates) {
    try {
      resolved = { candidate, model: createTurnModel(runtime, { selection: candidate.selection }) };
      break;
    } catch (error) {
      skippedCandidates.push({
        source: candidate.source,
        providerId: candidate.selection.providerId,
        modelId: candidate.selection.modelId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const failureAttribution = {
    ...(input.match.statusCode !== undefined ? { statusCode: input.match.statusCode } : {}),
    ...(input.match.providerErrorCode !== undefined
      ? { providerErrorCode: input.match.providerErrorCode }
      : {}),
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
  };
  const settledAcceptedTools = await input.streamingToolCoordinator.settleForModelFallback(
    input.assistantCreatedAt,
  );
  if (!resolved) {
    runtime.logger?.warn(
      "Execution model request failed but no fallback target could be resolved",
      {
        ...traceContextToLogContext(input.modelTraceContext),
        event: "model.execution_selection.fallback_unavailable",
        module: "core.runtime",
        status: "failed",
        reason: input.match.reason,
        fromProviderId: executionProviderId,
        fromModelId: String(executionModelSelection.modelId),
        hasDeclaredTarget: declaredTarget !== undefined,
        hasSessionSelection: sessionSelection !== undefined,
        skippedCandidates,
        ...failureAttribution,
      },
    );
    state.highspeedFallbackUnavailable = true;
    return { applied: false, settledAcceptedTools };
  }
  const fallbackSelection = resolved.candidate.selection;
  const fallbackModel = resolved.model;
  runtime.logger?.warn("Execution model request failed; falling back to the original model", {
    ...traceContextToLogContext(input.modelTraceContext),
    event: "model.execution_selection.fallback",
    module: "core.runtime",
    status: "completed",
    reason: input.match.reason,
    fromProviderId: executionProviderId,
    fromModelId: String(executionModelSelection.modelId),
    toProviderId: fallbackSelection.providerId,
    toModelId: fallbackSelection.modelId,
    toSource: resolved.candidate.source,
    ...(skippedCandidates.length > 0 ? { skippedCandidates } : {}),
    ...failureAttribution,
  });
  await runtime.persistAssistantMessage(
    input.assistantMessageId,
    state.userMessageId,
    input.assistantCreatedAt,
    {
      completed: Date.now(),
      error: {
        name: STREAM_RECOVERY_DISCARDED_ERROR_NAME,
        data: {
          message:
            "Execution-model output was discarded before continuing with the fallback model.",
        },
      },
      finish: STREAM_RECOVERY_DISCARDED_FINISH,
    },
    input.modelTraceContext,
    input.executionModel,
  );
  const fallbackEvent = runtime.createEvent(
    SessionEventType.TurnExecutionModelFallback,
    {
      ...(state.inputId ? { inputId: state.inputId } : {}),
      reason: input.match.reason,
      fromModelSelection: executionModelSelection,
      toModelSelection: {
        providerId: fallbackSelection.providerId,
        modelId: fallbackSelection.modelId,
      },
    },
    state.turnTraceContext,
  );
  await runtime.appendEvent(fallbackEvent, state.turnTraceContext);
  state.events.push(fallbackEvent);
  state.model = fallbackModel;
  state.selectionFallback = undefined;
  if (!settledAcceptedTools) {
    state.modelResponse = "";
    state.modelStepCount += 1;
    recordModelHistoryRound(state);
    state.turnMachine = new TurnMachineImpl(state.turnMachine.receiveModelResponse(""));
    state.turnMachine = new TurnMachineImpl(state.turnMachine.aggregateResults());
  }
  return { applied: true, settledAcceptedTools };
}
