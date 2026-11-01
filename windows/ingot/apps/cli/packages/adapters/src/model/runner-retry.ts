import { ModelErrorCode, ModelFailureReason, type Logger } from "@origin-ai/cf-contracts";
import { isProviderBusinessError } from "./model-execution.js";
import { findProviderBusinessError, type ClassifiedModelFailure } from "./failure-classifier.js";
import { readMappedAiSdkProviderBusinessError } from "./failure-ai-sdk-provider-error.js";
import { unwrapRetryError } from "./failure-inspection.js";
import {
  AiSdkModelAdapterError,
  ModelErrorSource,
  type ModelErrorSource as ModelErrorSourceType,
} from "./errors.js";
import type { ResolvedAiSdkModelRetryOptions } from "./retry-policy.js";
import { modelStatusContextToLogContext, type ModelStatusContext } from "./runner-status.js";
import { modelFailureAttributionFields } from "./runner-telemetry.js";

const MAX_REASONABLE_RETRY_AFTER_MS = 5 * 60_000;
const RELIABLE_ATTRIBUTION_CONTEXT_KEYS = [
  "errorPhase",
  "exceptionKind",
  "providerCode",
  "providerRequestId",
  "reason",
  "responseBodySummary",
  "responseStatus",
  "retryable",
  "source",
  "statusCode",
] as const;

export class TerminalStreamChunkError extends Error {
  constructor(readonly adapterError: AiSdkModelAdapterError) {
    super(adapterError.message);
    this.name = "TerminalStreamChunkError";
    this.cause = adapterError.cause ?? adapterError;
  }
}

export function calculateRetryDelay(
  retry: ResolvedAiSdkModelRetryOptions,
  attempt: number,
  retryAfterMs?: number,
): number {
  const uncapped = retry.baseDelayMs * retry.backoffFactor ** Math.max(0, attempt - 1);
  const capped = Math.min(uncapped, retry.maxDelayMs);
  if (isReasonableRetryAfterMs(retryAfterMs, uncapped)) {
    return retryAfterMs;
  }

  if (!retry.jitter || capped === 0) {
    return capped;
  }

  return Math.round(capped * (0.5 + Math.random() * 0.5));
}

export async function sleep(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (delayMs <= 0) {
    if (abortSignal?.aborted) {
      throw createAbortError(abortSignal);
    }
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (abortSignal?.aborted) {
      reject(createAbortError(abortSignal));
      return;
    }

    const timeout = setTimeout(resolve, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError(abortSignal));
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function logRetryDelayDecision(input: {
  attempt: number;
  canRetry: boolean;
  delayMs?: number;
  failure: ClassifiedModelFailure;
  logger?: Logger;
  responseHeaders: Record<string, string>;
  statusContext: ModelStatusContext;
}): void {
  input.logger?.warn("Model retry delay decision inspected", {
    ...modelStatusContextToLogContext(input.statusContext, input.attempt),
    canRetry: input.canRetry,
    delayMs: input.delayMs,
    event: "model.retry.delay.resolved",
    nextAttempt: input.canRetry ? input.attempt + 1 : undefined,
    reason: input.failure.reason,
    retryAfterHeader: readHeader(input.responseHeaders, "retry-after"),
    retryAfterMs: input.failure.retryAfterMs,
    retryAfterMsHeader: readHeader(input.responseHeaders, "retry-after-ms"),
    retryAfterSource: retryAfterSource(input.failure.retryAfterMs, input.responseHeaders),
    retryReason: input.failure.retryReason,
    status: input.canRetry ? "waiting" : "failed",
    statusCode: input.failure.statusCode,
    xShouldRetryHeader: readHeader(input.responseHeaders, "x-should-retry"),
  });
}

export function toAdapterError(
  error: unknown,
  failure: ClassifiedModelFailure,
  statusContext: ModelStatusContext,
  attempt: number,
  additionalContext?: Record<string, unknown>,
): AiSdkModelAdapterError {
  const unwrapped = unwrapRetryError(error);
  const providerBusinessError =
    findProviderBusinessError(unwrapped) ?? readMappedAiSdkProviderBusinessError(unwrapped);
  const normalizedContext = {
    attempt,
    maxAttempts: statusContext.maxAttempts,
    modelId: statusContext.modelId,
    ...modelFailureAttributionFields(unwrapped, failure, additionalContext?.errorPhase),
    ...providerBusinessErrorContext(providerBusinessError),
    providerId: statusContext.providerId,
    providerKind: statusContext.providerKind,
    reason: failure.reason,
    requestId: statusContext.requestId,
    retryable: failure.retryable,
    ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
    source: modelFailureSource(providerBusinessError ?? error, failure, additionalContext),
    statusCode: failure.statusCode,
    traceId: statusContext.traceId,
    transport: statusContext.transport,
  };

  if (error instanceof AiSdkModelAdapterError) {
    return error.enrichContext({
      ...error.context,
      ...normalizedContext,
      ...additionalContext,
      ...existingReliableAttributionContext(error.context),
    });
  }

  return new AiSdkModelAdapterError(failure.code, failure.message, {
    cause: error,
    context: {
      ...normalizedContext,
      ...additionalContext,
    },
  });
}

function existingReliableAttributionContext(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!context) return {};

  return Object.fromEntries(
    RELIABLE_ATTRIBUTION_CONTEXT_KEYS.flatMap((key) =>
      context[key] === undefined ? [] : [[key, context[key]]],
    ),
  );
}

function modelFailureSource(
  error: unknown,
  failure: ClassifiedModelFailure,
  additionalContext?: Record<string, unknown>,
): ModelErrorSourceType {
  const reason = failure.reason;
  if (reason === ModelFailureReason.Cancelled) return ModelErrorSource.Runtime;
  if (
    reason === ModelFailureReason.NetworkError ||
    reason === ModelFailureReason.ProxyError ||
    reason === ModelFailureReason.StaleConnection ||
    reason === ModelFailureReason.StreamIdleTimeout ||
    reason === ModelFailureReason.Timeout ||
    reason === ModelFailureReason.TlsError
  ) {
    return ModelErrorSource.Network;
  }

  if (failure.statusCode !== undefined || isProviderBusinessError(error)) {
    return ModelErrorSource.Provider;
  }

  if (failure.code === ModelErrorCode.InvalidModelResponse) {
    return ModelErrorSource.Provider;
  }

  if (
    additionalContext?.streamFailurePhase === "response_body" ||
    additionalContext?.errorPhase === "response" ||
    additionalContext?.errorPhase === "stream" ||
    additionalContext?.errorPhase === "parse"
  ) {
    return ModelErrorSource.Provider;
  }

  if (
    reason === ModelFailureReason.InvalidRequest ||
    reason === ModelFailureReason.ProviderNotConfigured ||
    reason === ModelFailureReason.Unknown
  ) {
    return ModelErrorSource.Runtime;
  }

  return ModelErrorSource.Provider;
}

function isReasonableRetryAfterMs(
  value: number | undefined,
  exponentialDelayMs: number,
): value is number {
  return (
    value !== undefined &&
    Number.isFinite(value) &&
    value >= 0 &&
    (value <= MAX_REASONABLE_RETRY_AFTER_MS || value < exponentialDelayMs)
  );
}

function retryAfterSource(
  retryAfterMs: number | undefined,
  headers: Record<string, string>,
): string {
  const xShouldRetry = readHeader(headers, "x-should-retry")?.trim().toLowerCase();
  if (xShouldRetry === "false" || xShouldRetry === "0") {
    return "blocked_by_x_should_retry";
  }
  if (retryAfterMs !== undefined) {
    return "provider_header";
  }
  if (readHeader(headers, "retry-after-ms") !== undefined || readHeader(headers, "retry-after")) {
    return "header_unparsed_or_ignored";
  }
  return "missing";
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  return Object.entries(headers).find(([key]) => key.toLowerCase() === normalizedName)?.[1];
}

function createAbortError(abortSignal?: AbortSignal): Error {
  const reason = abortSignal?.reason;
  if (reason instanceof Error) {
    return reason;
  }
  const error = new Error("The model request was cancelled.");
  error.name = "AbortError";
  return error;
}

function providerBusinessErrorContext(error: unknown): Record<string, unknown> | undefined {
  if (!isProviderBusinessError(error)) {
    return undefined;
  }

  return {
    providerCode: error.providerCode,
    providerRequestId: error.providerRequestId,
    responseBodySummary: error.responseBodySummary,
    responseStatus: error.responseStatus,
  };
}
