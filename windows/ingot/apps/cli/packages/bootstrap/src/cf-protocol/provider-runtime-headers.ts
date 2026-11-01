import { requestVerificationTimeoutMessage } from "@origin-ai/cf-shared";
import { randomUUID } from "node:crypto";
import {
  cfProtocolMethods,
  cfProtocolNotifications,
  cfProviderRuntimeHeadersResponseSchema,
  type CfWorkspaceRef,
} from "@origin-ai/cf-shared";
import type { CfAppOptions } from "../app/types.js";
import {
  ProtocolRequestError,
  protocolTraceFromTraceContext,
  type CfProtocolAgentServerContext,
} from "./server-types.js";

const PROVIDER_RUNTIME_HEADERS_TIMEOUT_MS = 180_000;
const CLIENT_REQUEST_TIMEOUT_CODE = -32022;

export function createProviderRuntimeHeadersPort(
  context: CfProtocolAgentServerContext,
  workspace: CfWorkspaceRef,
): NonNullable<CfAppOptions["providerRuntimeHeadersPort"]> {
  return {
    shouldRefreshBeforeModelRequest() {
      return true;
    },
    async refreshBeforeModelRequest(input) {
      const requestId = `${input.sessionId}:provider-runtime-headers:${randomUUID()}`;
      let result;
      try {
        result = await context.requestClient(
          cfProtocolMethods.interactionRequestProviderRuntimeHeaders,
          {
            requestId,
            sessionId: input.sessionId,
            turnId: input.turnId,
            workspace,
            modelSelection: { providerId: input.providerId, modelId: input.modelId },
            providerId: input.providerId,
            ...(input.accountAccess ? { accountAccess: input.accountAccess } : {}),
            ...(input.expectedAccountScope
              ? { expectedAccountScope: input.expectedAccountScope }
              : {}),
            ...(input.rejectedProjectTokenFingerprint
              ? { rejectedProjectTokenFingerprint: input.rejectedProjectTokenFingerprint }
              : {}),
            reason: input.reason,
          },
          cfProviderRuntimeHeadersResponseSchema,
          {
            signal: input.abortSignal,
            trace: protocolTraceFromTraceContext(input.traceContext),
            timeoutMs: PROVIDER_RUNTIME_HEADERS_TIMEOUT_MS,
          },
        );
      } catch (error) {
        const timedOut =
          error instanceof ProtocolRequestError && error.code === CLIENT_REQUEST_TIMEOUT_CODE;
        if (input.abortSignal?.aborted || timedOut) {
          context.notify({
            method: cfProtocolNotifications.providerRuntimeHeadersCancelled,
            trace: protocolTraceFromTraceContext(input.traceContext),
            params: { workspace, sessionId: input.sessionId, requestId },
          });
        }
        if (timedOut) {
          const timeoutError = new ProtocolRequestError(
            CLIENT_REQUEST_TIMEOUT_CODE,
            requestVerificationTimeoutMessage,
            error.data,
          );
          timeoutError.cause = error;
          throw timeoutError;
        }
        throw error;
      }
      if (!result.headersApplied) {
        throw new ProtocolRequestError(
          -32031,
          result.errorMessage ??
            "Provider runtime headers were not applied before model request attempt.",
          {
            providerId: input.providerId,
            ...(input.rejectedProjectTokenFingerprint
              ? { rejectedProjectTokenFingerprint: input.rejectedProjectTokenFingerprint }
              : {}),
            reason: input.reason,
            workspaceKey: workspace.workspaceKey,
          },
        );
      }
      return result;
    },
  };
}
