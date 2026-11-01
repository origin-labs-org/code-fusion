

import type {
  ModelRequestSessionType as ModelRequestSessionTypeValue,
  ResolvedModelApiCallObservation,
} from "@origin-ai/cf-contracts";
import { ModelApiActorKind, ModelApiOperation, ModelRequestSessionType } from "@origin-ai/cf-contracts";
import { isOpenCodeGoBaseUrl } from "./opencode-session.js";
import { MODEL_QUERY_SOURCE_HEADER } from "./model-request-headers.js";
import type { ModelStatusContext } from "./runner-status.js";

const MODEL_TRACE_HEADER = "x-cf-trace-id";
const MODEL_REQUEST_HEADER = "x-request-id";
const MODEL_SESSION_HEADER = "x-session-id";
const MODEL_QUERY_HEADER = "x-query-id";
const MODEL_SESSION_TYPE_HEADER = "x-cf-session-type";
const SESSION_ID_INTERNAL_PREFIX = "sess_";
const SESSION_ID_SUBAGENT_PREFIX = "subagent_agent_";
const QUERY_ID_INTERNAL_PREFIX = "query_";
const QUERY_SOURCE_HEADER_VALUE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;

export function createModelRequestAttributionHeaders(
  statusContext: ModelStatusContext,
): Record<string, string> {
  const sessionHeaderValue = normalizeModelSessionIdForAttribution(statusContext.sessionId);
  const queryHeaderValue = modelQueryHeaderValue(statusContext.queryId);
  const querySource = statusContext.querySource?.trim();
  const querySourceHeaderValue =
    querySource && QUERY_SOURCE_HEADER_VALUE_PATTERN.test(querySource) ? querySource : undefined;
  const openCodeSessionHeaderValue = isOpenCodeGoBaseUrl(statusContext.baseURL)
    ? sessionHeaderValue
    : undefined;
  return {
    [MODEL_REQUEST_HEADER]: statusContext.requestId,
    [MODEL_SESSION_TYPE_HEADER]: isModelRequestSessionType(statusContext.modelRequestSessionType)
      ? statusContext.modelRequestSessionType
      : ModelRequestSessionType.Other,
    [MODEL_TRACE_HEADER]: statusContext.traceId,
    ...(queryHeaderValue ? { [MODEL_QUERY_HEADER]: queryHeaderValue } : {}),
    ...(querySourceHeaderValue ? { [MODEL_QUERY_SOURCE_HEADER]: querySourceHeaderValue } : {}),
    ...(sessionHeaderValue ? { [MODEL_SESSION_HEADER]: sessionHeaderValue } : {}),
    ...(openCodeSessionHeaderValue ? { "x-opencode-session": openCodeSessionHeaderValue } : {}),
  };
}

export function resolveModelRequestSessionType(
  explicitType: unknown,
  modelCall: Pick<ResolvedModelApiCallObservation, "actorKind" | "operation">,
): ModelRequestSessionTypeValue {
  if (isModelRequestSessionType(explicitType)) return explicitType;
  if (modelCall.operation !== ModelApiOperation.AgentStep) {
    return ModelRequestSessionType.Other;
  }
  if (modelCall.actorKind === ModelApiActorKind.MainAgent) {
    return ModelRequestSessionType.Main;
  }
  if (modelCall.actorKind === ModelApiActorKind.Subagent) {
    return ModelRequestSessionType.Subagent;
  }
  return ModelRequestSessionType.Other;
}

function isModelRequestSessionType(value: unknown): value is ModelRequestSessionTypeValue {
  return (
    value === ModelRequestSessionType.Main ||
    value === ModelRequestSessionType.Subagent ||
    value === ModelRequestSessionType.SideChat ||
    value === ModelRequestSessionType.Other
  );
}

export function normalizeModelSessionIdForAttribution(
  sessionId: ModelStatusContext["sessionId"],
): string | undefined {
  if (!sessionId) return undefined;
  return stripHeaderInternalPrefixes(sessionId, [
    SESSION_ID_INTERNAL_PREFIX,
    SESSION_ID_SUBAGENT_PREFIX,
  ]);
}

function modelQueryHeaderValue(queryId: ModelStatusContext["queryId"]): string | undefined {
  if (!queryId) return undefined;
  return stripHeaderInternalPrefixes(queryId, [QUERY_ID_INTERNAL_PREFIX]);
}

function stripHeaderInternalPrefixes(value: string, prefixes: string[]): string {
  let headerValue = value;
  for (const prefix of prefixes) {
    if (headerValue.startsWith(prefix) && headerValue.length > prefix.length) {
      headerValue = headerValue.slice(prefix.length);
    }
  }
  return headerValue || value;
}
