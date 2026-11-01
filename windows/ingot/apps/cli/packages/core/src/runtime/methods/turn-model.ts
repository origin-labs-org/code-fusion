import {
  ModelRetryBudget,
  SESSION_ENTRY_MODEL_SELECTION,
  type Model,
  type ModelSelection,
  type TraceContext,
  type TurnInputIntentMetadata,
} from "@origin-ai/cf-contracts";
import { getCurrentModelInvocationContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";
import { cloneModelSelection } from "../model-selection.js";
import { createRefreshRuntimeHeadersBeforeModelAttempt } from "./model-runtime-headers.js";
import { createRuntimeModel, withModelInvocationContext } from "./runtime-model.js";
import { applyRuntimeExecutionState } from "../execution-state.js";
import { acceptOffPeakUserTakeover, selectionForPersistence } from "../off-peak/runtime.js";

const selectionAdmissions = new WeakMap<
  AgentRuntimeInternal,
  {
    sequence: number;
    commandId: string;
    persisted: Promise<void>;
  }
>();
const publishedSelections = new WeakMap<AgentRuntimeInternal, ModelSelection | undefined>();

export function captureHighspeedFallbackSelection(
  runtime: AgentRuntimeInternal,
  execution: import("../types.js").ModelExecutionContext | undefined,
): import("../types.js").ModelExecutionContext | undefined {
  if (!execution?.selectionFallback) return execution;
  return {
    ...execution,
    highspeedFallbackSelection: structuredClone(runtime.getSessionModelSelection()),
  };
}

export function recordPublishedModelSelection(
  runtime: AgentRuntimeInternal,
  selection: ModelSelection,
): void {
  publishedSelections.set(runtime, cloneModelSelection(selection));
}

export function acceptSubmissionModelSelection(
  runtime: AgentRuntimeInternal,
  intent: TurnInputIntentMetadata | undefined,
  _traceContext: TraceContext,
  modelExecution?: Pick<
    import("../types.js").ModelExecutionContext,
    "selectionScope" | "selectionFallback"
  > & {
    highspeedFallbackSelection?: ModelSelection;
  },
): Promise<void> {
  const selection =
    modelExecution?.selectionScope === "execution"
      ? (modelExecution.selectionFallback?.target ?? modelExecution.highspeedFallbackSelection)
      : intent?.modelSelection;
  if (!selection || !intent) return Promise.resolve();
  const previous = selectionAdmissions.get(runtime);
  if (
    previous &&
    (previous.commandId === intent.sourceCommandId ||
      (Number.isFinite(intent.admissionSeq) && intent.admissionSeq <= previous.sequence))
  ) {
    return previous.persisted;
  }
  const previousSelection = runtime.getSessionModelSelection();
  if (!publishedSelections.has(runtime)) publishedSelections.set(runtime, previousSelection);
  const appliedSelection = cloneModelSelection(selection);
  runtime.setSessionModelSelection(appliedSelection);
  acceptOffPeakUserTakeover(runtime);
  const persisted = (previous?.persisted ?? Promise.resolve()).then(async () => {
    if (runtime.sessionPersisted !== false)
      await persistRuntimeModelSelection(runtime, appliedSelection);
  });
  selectionAdmissions.set(runtime, {
    sequence: Number.isFinite(intent.admissionSeq)
      ? intent.admissionSeq
      : (previous?.sequence ?? 0),
    commandId: intent.sourceCommandId,
    persisted,
  });
  return persisted;
}

export function resolveExecutionModelRetryBudget(input: {
  selection: ModelSelection | undefined;
  selectionFallback: import("../types.js").ModelExecutionContext["selectionFallback"];
}): ModelRetryBudget | undefined {
  if (!input.selection || !input.selectionFallback) return undefined;
  return input.selection.providerId === input.selectionFallback.providerId
    ? ModelRetryBudget.SingleAttempt
    : undefined;
}

export function createTurnModel(
  runtime: AgentRuntimeInternal,
  options: {
    selection?: ModelSelection;
    requestDependencies?: import("@origin-ai/cf-contracts").ModelRequestDependencies;
    retryBudget?: ModelRetryBudget;
  } = {},
): Model {
  const selection = options.selection ?? runtime.getSessionModelSelection();
  const model = createRuntimeModel(runtime, {
    selection,
    requestDependencies: options.requestDependencies,
    retryBudget: options.retryBudget,
  });
  return withModelInvocationContext(model, (request) => ({
    refreshRuntimeHeadersBeforeAttempt: createRefreshRuntimeHeadersBeforeModelAttempt(runtime, {
      abortSignal: request.abortSignal,
      model,
      traceContext: getCurrentModelInvocationContext()?.traceContext ?? runtime.rootTraceContext,
    }),
  }));
}

export async function applySubmissionExecutionState(
  runtime: AgentRuntimeInternal,
  intent: TurnInputIntentMetadata | undefined,
  traceContext: TraceContext,
  modelExecution?: import("../types.js").ModelExecutionContext,
  preparedModel?: Model,
): Promise<Model | undefined> {
  const selection = intent?.modelSelection;
  let model = preparedModel;

  if (selection) {
    model ??= createTurnModel(runtime, {
      selection,
      requestDependencies: modelExecution?.requestDependencies,
      retryBudget: resolveExecutionModelRetryBudget({
        selection,
        selectionFallback: modelExecution?.selectionFallback,
      }),
    });
    await acceptSubmissionModelSelection(runtime, intent, traceContext, modelExecution);
    if (modelExecution?.selectionScope !== "execution") {
      const previousSelection = publishedSelections.get(runtime);
      publishedSelections.set(runtime, cloneModelSelection(selection));
      if (!sameModelSelection(previousSelection, selection)) {
        await runtime.emitModelSelected({
          model,
          modelSelection: selection,
          effectiveReasoningLevel: model.options.reasoningLevel,
          previousModelSelection: previousSelection,
          supportedThoughtLevels: model.optionSpecs.reasoningLevel.values,
          traceContext,
        });
      }
    }
  }

  if (intent?.mode !== undefined || intent?.planEnabled !== undefined) {
    await applyRuntimeExecutionState(runtime, intent, { source: "command", traceContext });
  }

  return model;
}

export function sameModelSelection(
  left: ModelSelection | undefined,
  right: ModelSelection,
): boolean {
  return (
    left?.providerId === right.providerId &&
    left.modelId === right.modelId &&
    left.options?.reasoningLevel === right.options?.reasoningLevel
  );
}

export async function persistRuntimeModelSelection(
  runtime: AgentRuntimeInternal,
  selection: ModelSelection,
): Promise<void> {
  if (!runtime.sessionStore?.saveSessionEntry) return;
  const persistentSelection = selectionForPersistence(runtime, selection);
  if (!persistentSelection) return;
  const timestamp = Date.now();
  try {
    await runtime.sessionStore.saveSessionEntry({
      id: `${runtime.sessionId}:runtime-model-selection`,
      sessionID: runtime.sessionId,
      type: SESSION_ENTRY_MODEL_SELECTION,
      touchSession: false,
      time: { created: timestamp, updated: timestamp },
      data: persistentSelection,
    });
  } catch (error) {
    runtime.logger?.warn("Session model selection persistence failed", {
      error: error instanceof Error ? error.message : String(error),
      event: "session.model_selection.persist_failed",
      modelId: selection.modelId,
      module: "core.runtime",
      providerId: selection.providerId,
      status: "failed",
      thoughtLevel: selection.options?.reasoningLevel,
    });
  }
}
