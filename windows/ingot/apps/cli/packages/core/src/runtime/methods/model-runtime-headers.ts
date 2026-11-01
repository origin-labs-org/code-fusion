import type { RequestVerificationReason } from "@origin-ai/cf-shared";
import { traceContextToLogContext } from "../deps.js";
import type { ModelRequestAuth } from "@origin-ai/cf-contracts";
import type { CfProviderAccountAccess } from "@origin-ai/cf-shared";
import type { Model, TraceContext } from "../deps.js";
import type { AgentRuntimeInternal } from "../internal.js";

export function createRefreshRuntimeHeadersBeforeModelAttempt(
  runtime: AgentRuntimeInternal,
  input: {
    abortSignal?: AbortSignal;
    model: Model;
    traceContext: TraceContext;
  },
):
  | ((attemptInput: {
      accountAccess?: CfProviderAccountAccess;
      expectedAccountScope?: string;
      rejectedProjectTokenFingerprint?: string;
      attempt: number;
      reason?: RequestVerificationReason;
      abortSignal?: AbortSignal;
    }) => Promise<{
      headersApplied: boolean;
      requestAuth?: ModelRequestAuth;
    }>)
  | undefined {
  const runtimeHeadersPort = runtime.providerRuntimeHeadersPort;
  if (
    !runtimeHeadersPort ||
    !(
      runtimeHeadersPort.shouldRefreshBeforeModelRequest?.({
        providerId: String(input.model.providerId),
        modelId: String(input.model.modelId),
      }) ?? true
    )
  ) {
    return undefined;
  }

  return async (attemptInput) => {
    const refreshResult = await runtimeHeadersPort.refreshBeforeModelRequest({
      accountAccess: attemptInput.accountAccess,
      expectedAccountScope: attemptInput.expectedAccountScope,
      rejectedProjectTokenFingerprint: attemptInput.rejectedProjectTokenFingerprint,
      abortSignal: attemptInput.abortSignal ?? input.abortSignal,
      modelId: String(input.model.modelId),
      providerId: String(input.model.providerId),
      reason: attemptInput.reason ?? "model-request",
      sessionId: runtime.sessionId,
      traceContext: input.traceContext,
      turnId: input.traceContext.turnId,
    });
    if (!refreshResult.headersApplied) {
      throw new Error("Provider runtime headers were not applied before model request attempt.");
    }
    runtime.logger?.debug("Provider runtime headers refreshed before model request attempt", {
      ...traceContextToLogContext(input.traceContext),
      attempt: attemptInput.attempt,
      event: "model.request.runtime_headers_refreshed",
      headersApplied: refreshResult.headersApplied,
      module: "core.runtime",
      providerId: String(input.model.providerId),
    });
    return refreshResult;
  };
}
