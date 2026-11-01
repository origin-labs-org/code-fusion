import { requestVerificationErrorAttribution } from "@/request-security-edition/errors.js";
import {
  MEDIA_BUDGET_CURRENT_ATTACHMENT_TOO_LARGE_ERROR_CODE,
  MEDIA_BUDGET_CURRENT_IMAGE_TOO_LARGE_ERROR_CODE,
  MEDIA_BUDGET_CURRENT_VIDEO_TOO_LARGE_ERROR_CODE,
} from "@origin-ai/cf-shared";
import {
  isGenericProviderInvalidRequestCode,
  isLocalModelValidationMessage,
  isQuotaMessage,
  resolveControlledUnknownMessageAttribution,
  resolveGenericProviderCodeAttribution,
  resolveKnownProviderCodeFailureReason,
  resolveLegacyProviderEnvelopeCode,
  resolveStableTransportCodeAttribution,
  resolveTrustedProviderCodeFailureReason,
} from "@/lib/chatErrorAttributionEvidence.js";
import type { CfUiError } from "@/lib/cfUiError.js";

const UNKNOWN_FAILURE_REASON = "unknown";

type TelemetryErrorSource = "provider" | "runtime" | "network" | "tool" | "";

interface TelemetryErrorAttribution {
  errorSource: TelemetryErrorSource;
  failureReason: string;
}

const RATE_LIMIT_MESSAGE_PATTERN =
  /error[_ -]?rate[_ -]?limited|rate[_ -]?limit|too many requests|request higher limits|throttl/iu;
const BALANCE_MESSAGE_PATTERN =
  /insufficient\s+(?:balance|funds|credit)|balance\s+(?:is\s+)?(?:insufficient|too\s+low)|Insufficient balance|余额不够/iu;
const PLAN_EXPIRED_MESSAGE_PATTERN = /(?:coding|subscription|套餐|plan).{0,24}(?:expired|到期)/iu;
const CONTEXT_MESSAGE_PATTERN =
  /context.{0,32}(?:length|window|exceed|limit)|prompt.{0,24}too long|Context.{0,16}(?:超|限制)/iu;
const AUTH_MESSAGE_PATTERN =
  /unauthori[sz]ed|authentication|invalid\s+(?:api\s+)?key|access\s+denied|鉴权|认证Failed/iu;
const NETWORK_MESSAGE_PATTERN =
  /network|connection|econn(?:reset|refused)|enotfound|tls|proxy|Network|Connection failed/iu;
const TIMEOUT_MESSAGE_PATTERN = /timeout|timed out|超时/iu;
const OVERLOAD_MESSAGE_PATTERN = /overload|overloaded|server busy|Service繁忙|过载/iu;
const INVALID_REQUEST_MESSAGE_PATTERN =
  /invalid\s+(?:request|argument|parameter)|bad request|参CountError|Request参Count/iu;
const EMPTY_MODEL_RESPONSE_MESSAGE_PATTERN =
  /model\s+(?:returned|returning)\s+no\s+content|Model未Back任何inner容/iu;
const PROVIDER_REJECTED_MESSAGE_PATTERN =
  /provider\s+rejected|method\s+not\s+allowed|param(?:eter)?\s+incorrect|参Count非法|unsupported\s+parameter/iu;
const PROVIDER_SERVER_ERROR_MESSAGE_PATTERN =
  /provider\s+returned\s+(?:a\s+)?server\s+error|internal\s+server\s+error/iu;
const PROVIDER_RATE_LIMIT_MESSAGE_PATTERN =
  /concurrency\s+limit|admission\s+concurrency|model\s+is\s+busy|system\s+is\s+busy/iu;
const ATTACHMENT_INVALID_MESSAGE_PATTERN =
  /(?:image|video)\s+attachments\s+are\s+too\s+large|unable\s+to\s+materialize\s+(?:image|video)\s+attachment\s+path/iu;
const QUEUE_FULL_MESSAGE_PATTERN = /request\s+queue\s+is\s+full/iu;
const CANCELLED_MESSAGE_PATTERN = /turn\s+was\s+cancelled/iu;

const STABLE_ERROR_ATTRIBUTION: Readonly<
  Record<string, { readonly source: "provider" | "runtime"; readonly reason: string }>
> = {
  model_config_missing: { source: "runtime", reason: "model_config_missing" },
  MODEL_CONFIG_MISSING: { source: "runtime", reason: "model_config_missing" },
  ModelConfigMissing: { source: "runtime", reason: "model_config_missing" },
  StreamRecoveryDiscarded: {
    source: "runtime",
    reason: "stream_recovery_discarded",
  },
  ERR_SQLITE_ERROR: { source: "runtime", reason: "storage_error" },
  INVALID_INPUT: { source: "runtime", reason: "invalid_input" },
  [MEDIA_BUDGET_CURRENT_ATTACHMENT_TOO_LARGE_ERROR_CODE]: {
    source: "runtime",
    reason: "invalid_input",
  },
  [MEDIA_BUDGET_CURRENT_IMAGE_TOO_LARGE_ERROR_CODE]: {
    source: "runtime",
    reason: "invalid_input",
  },
  [MEDIA_BUDGET_CURRENT_VIDEO_TOO_LARGE_ERROR_CODE]: {
    source: "runtime",
    reason: "invalid_input",
  },
  MessageAbortedError: { source: "runtime", reason: "cancelled" },
  StartPlanBusyAutoRetryExhaustedError: {
    source: "provider",
    reason: "rate_limited",
  },
  ...requestVerificationErrorAttribution,
};

const NETWORK_FAILURE_REASONS = new Set([
  "network_error",
  "proxy_error",
  "stale_connection",
  "stream_idle_timeout",
  "timeout",
  "tls_error",
]);

const RUNTIME_FAILURE_REASONS = new Set([
  "compact_rapid_refill_breaker",
  "storage_error",
  "model_config_missing",
  "stream_recovery_discarded",
  "invalid_input",
  "cancelled",
  "provider_not_configured",
]);

const PROVIDER_FAILURE_REASONS = new Set([
  "auth_failed",
  "balance_insufficient",
  "context_exceeded",
  "empty_model_response",
  "model_not_found",
  "plan_access_denied",
  "plan_expired",
  "provider_overloaded",
  "quota_exhausted",
  "server_error",
]);

function resolveSourceFromReason(reason: string): TelemetryErrorSource {
  if (NETWORK_FAILURE_REASONS.has(reason)) return "network";
  if (RUNTIME_FAILURE_REASONS.has(reason)) return "runtime";
  if (PROVIDER_FAILURE_REASONS.has(reason)) return "provider";
  return "";
}

function resolveSourceFromStatusCode(statusCode: number): TelemetryErrorSource {
  return statusCode === 408 || statusCode === 504 ? "network" : "provider";
}

function resolveSourceFromAdditionalEvidence(params: {
  error: CfUiError;
  displayMessage: string;
}): TelemetryErrorSource {
  const statusCode = params.error.attribution?.statusCode;
  if (statusCode !== undefined) {
    return resolveSourceFromStatusCode(statusCode);
  }
  if (params.error.attribution?.providerErrorCode?.trim()) {
    return "provider";
  }

  const message = `${params.displayMessage}\n${params.error.message}`;
  if (ATTACHMENT_INVALID_MESSAGE_PATTERN.test(message)) {
    return "runtime";
  }
  if (CANCELLED_MESSAGE_PATTERN.test(message)) {
    return "runtime";
  }
  if (QUEUE_FULL_MESSAGE_PATTERN.test(message)) {
    return "";
  }
  if (
    NETWORK_MESSAGE_PATTERN.test(message) ||
    TIMEOUT_MESSAGE_PATTERN.test(message) ||
    /epipe|certificate|socket/iu.test(message)
  ) {
    return "network";
  }
  if (
    EMPTY_MODEL_RESPONSE_MESSAGE_PATTERN.test(message) ||
    PROVIDER_SERVER_ERROR_MESSAGE_PATTERN.test(message) ||
    PROVIDER_RATE_LIMIT_MESSAGE_PATTERN.test(message) ||
    BALANCE_MESSAGE_PATTERN.test(message) ||
    PLAN_EXPIRED_MESSAGE_PATTERN.test(message) ||
    RATE_LIMIT_MESSAGE_PATTERN.test(message) ||
    CONTEXT_MESSAGE_PATTERN.test(message) ||
    AUTH_MESSAGE_PATTERN.test(message) ||
    OVERLOAD_MESSAGE_PATTERN.test(message) ||
    isQuotaMessage(message) ||
    /provider|model\s+request|upstream/iu.test(message)
  ) {
    return "provider";
  }
  return "";
}

export function resolveTelemetryAttribution(params: {
  error: CfUiError;
  displayMessage: string;
}): TelemetryErrorAttribution {
  const explicitSource = params.error.attribution?.source;
  const providerId = params.error.attribution?.providerId?.trim();
  const trustedProviderBusinessCode = providerId
    ? params.error.attribution?.providerErrorCode?.trim() || params.error.code?.trim() || ""
    : "";
  const trustedProviderReason = resolveTrustedProviderCodeFailureReason({
    providerId: params.error.attribution?.providerId,
    providerErrorCode: params.error.attribution?.providerErrorCode,
    errorCode: params.error.code,
  });
  const resolve = (
    failureReason: string,
    inferredSource: TelemetryErrorSource = "",
  ): TelemetryErrorAttribution => ({
    errorSource: explicitSource ?? inferredSource,
    failureReason,
  });
  const structuredReason = params.error.attribution?.reason?.trim();
  const message = `${params.displayMessage}\n${params.error.message}`;
  const transportErrorCode = (
    params.error.attribution?.providerErrorCode ??
    params.error.code ??
    ""
  )
    .trim()
    .toUpperCase();
  const stableTransportAttribution =
    !structuredReason || structuredReason === UNKNOWN_FAILURE_REASON
      ? resolveStableTransportCodeAttribution(transportErrorCode)
      : undefined;
  if (stableTransportAttribution) {
    return stableTransportAttribution;
  }
  const genericProviderAttribution =
    explicitSource === "provider" &&
    (!structuredReason || structuredReason === UNKNOWN_FAILURE_REASON)
      ? resolveGenericProviderCodeAttribution(params.error.attribution?.providerErrorCode)
      : undefined;
  if (genericProviderAttribution) {
    return genericProviderAttribution;
  }
  if (structuredReason && structuredReason !== UNKNOWN_FAILURE_REASON) {
    const unambiguousSource = resolveSourceFromReason(structuredReason);
    if (unambiguousSource === "network" || unambiguousSource === "runtime") {
      return { errorSource: unambiguousSource, failureReason: structuredReason };
    }
    if (
      explicitSource === "provider" &&
      structuredReason === "rate_limited" &&
      params.error.attribution?.retryable === false &&
      trustedProviderReason === "quota_exhausted"
    ) {
      return { errorSource: "provider", failureReason: "quota_exhausted" };
    }
    return resolve(
      structuredReason,
      resolveSourceFromReason(structuredReason) || resolveSourceFromAdditionalEvidence(params),
    );
  }

  if (
    params.error.code?.trim() === "invalid_model_request" &&
    !explicitSource &&
    isLocalModelValidationMessage(params.error.message)
  ) {
    return { errorSource: "runtime", failureReason: "invalid_request" };
  }

  const legacyProviderCode = resolveLegacyProviderEnvelopeCode(
    params.error.code,
    params.error.message,
  );
  const legacyProviderReason = resolveKnownProviderCodeFailureReason(legacyProviderCode);
  if (legacyProviderReason) {
    return {
      errorSource: resolveSourceFromReason(legacyProviderReason) || "provider",
      failureReason: legacyProviderReason,
    };
  }

  const stableAttribution = STABLE_ERROR_ATTRIBUTION[params.error.code?.trim() ?? ""];
  if (stableAttribution) {
    return resolve(stableAttribution.reason, stableAttribution.source);
  }

  if (trustedProviderReason) {
    return resolve(trustedProviderReason, "provider");
  }
  if (
    params.error.attribution?.source === "provider" &&
    isGenericProviderInvalidRequestCode(trustedProviderBusinessCode)
  ) {
    return resolve("invalid_request", "provider");
  }

  const statusCode = params.error.attribution?.statusCode;
  if (
    statusCode === 413 &&
    /chat history.{0,80}(?:message limit|too large)|input token.{0,80}(?:exceed|limit)|context.{0,80}(?:exceed|limit)/iu.test(
      message,
    )
  ) {
    return resolve("context_exceeded", "provider");
  }
  if (statusCode === 413 && /request body|payload limit|attachment|tool input/iu.test(message)) {
    return resolve("invalid_request", "provider");
  }
  if (statusCode === 405) {
    return resolve("invalid_request", "provider");
  }
  if (statusCode === 402 && BALANCE_MESSAGE_PATTERN.test(params.displayMessage)) {
    return resolve("balance_insufficient", "provider");
  }
  if (statusCode === 401 || statusCode === 403) {
    return resolve("auth_failed", "provider");
  }
  if (statusCode === 408 || statusCode === 504) {
    return { errorSource: "network", failureReason: "timeout" };
  }
  if (statusCode === 429) return resolve("rate_limited", "provider");
  if (statusCode === 404 || statusCode === 410) {
    return resolve("model_not_found", "provider");
  }
  if (statusCode === 400 || statusCode === 422) {
    return resolve("invalid_request", "provider");
  }
  if (statusCode !== undefined && statusCode >= 500 && statusCode <= 599) {
    return resolve("server_error", "provider");
  }

  const controlledMessageAttribution = resolveControlledUnknownMessageAttribution(message);
  if (
    controlledMessageAttribution &&
    (controlledMessageAttribution.errorSource !== "provider" ||
      explicitSource === undefined ||
      explicitSource === "provider")
  ) {
    return controlledMessageAttribution;
  }

  if (EMPTY_MODEL_RESPONSE_MESSAGE_PATTERN.test(message)) {
    return resolve("empty_model_response", "provider");
  }
  if (PROVIDER_REJECTED_MESSAGE_PATTERN.test(message)) {
    return resolve("invalid_request", resolveSourceFromAdditionalEvidence(params));
  }
  if (PROVIDER_SERVER_ERROR_MESSAGE_PATTERN.test(message)) {
    return resolve("server_error", "provider");
  }
  if (PROVIDER_RATE_LIMIT_MESSAGE_PATTERN.test(message)) {
    return resolve("rate_limited", "provider");
  }
  if (ATTACHMENT_INVALID_MESSAGE_PATTERN.test(message)) {
    return resolve("invalid_input", "runtime");
  }
  if (QUEUE_FULL_MESSAGE_PATTERN.test(message)) {
    return resolve("rate_limited");
  }
  if (CANCELLED_MESSAGE_PATTERN.test(message)) {
    return resolve("cancelled", "runtime");
  }
  if (BALANCE_MESSAGE_PATTERN.test(message)) {
    return resolve("balance_insufficient", "provider");
  }
  if (PLAN_EXPIRED_MESSAGE_PATTERN.test(message)) {
    return resolve("plan_expired", "provider");
  }
  if (RATE_LIMIT_MESSAGE_PATTERN.test(message)) {
    return resolve("rate_limited", "provider");
  }
  if (CONTEXT_MESSAGE_PATTERN.test(message)) {
    return resolve("context_exceeded", "provider");
  }
  if (AUTH_MESSAGE_PATTERN.test(message)) {
    return resolve("auth_failed", "provider");
  }
  if (NETWORK_MESSAGE_PATTERN.test(message)) {
    return resolve("network_error", "network");
  }
  if (TIMEOUT_MESSAGE_PATTERN.test(message)) {
    return resolve("timeout", "network");
  }
  if (OVERLOAD_MESSAGE_PATTERN.test(message)) {
    return resolve("provider_overloaded", "provider");
  }
  if (isQuotaMessage(message)) {
    return resolve("quota_exhausted", "provider");
  }
  if (INVALID_REQUEST_MESSAGE_PATTERN.test(message)) {
    return resolve("invalid_request");
  }

  return resolve(
    structuredReason || (params.error.attribution ? UNKNOWN_FAILURE_REASON : ""),
    resolveSourceFromAdditionalEvidence(params),
  );
}
