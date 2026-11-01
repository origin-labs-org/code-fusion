import {
  resolveTelemetryModelId,
  resolveTelemetryProviderScope,
  type ArmsCustomEventPayload,
  type IPlatformService,
} from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";
import {
  getProviderBusinessErrorUiAction,
  isProviderBusinessErrorCode,
  resolveRequestVerificationBusinessCode,
  type ProviderBusinessErrorUiAction,
} from "@/lib/providerBusinessError.js";
import { resolveTelemetryAttribution } from "@/lib/chatErrorAttribution.js";
import type { CfUiError } from "@/lib/cfUiError.js";

export const CHAT_ERROR_BANNER_ARMS_EVENT_NAME = "chat_error_banner";
export const CHAT_ERROR_BANNER_ARMS_GROUP = "ui_error";
export type ChatErrorBannerSurface = "chat_input_error_banner" | "session_subscription_error";

const CHAT_ERROR_BANNER_MESSAGE_LIMIT = 500;

function sanitizeUnderlyingTelemetryText(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  if (
    /authorization|\b(?:bearer|basic)\s+\S+|(?:https?|wss?|file):\/\/|(?:api[_-]?key|token|password|secret)\s*["']?\s*[:=]|<(?:html|body|script|form|!doctype)\b/i.test(
      value,
    )
  ) {
    return "sensitive error redacted";
  }
  return truncateTelemetryText(value);
}

interface ChatProviderBusinessRecoveryAction {
  kind: ProviderBusinessErrorUiAction;
  providerBusinessCode: string;
}

export function resolveVisibleChatErrorTelemetryRecoveryAction(
  error: Pick<CfUiError, "code" | "message">,
): ChatProviderBusinessRecoveryAction | null {
  if (resolveRequestVerificationBusinessCode(error.code, error.message)) {
    return null;
  }
  if (!isProviderBusinessErrorCode(error.code)) {
    return null;
  }
  const kind = getProviderBusinessErrorUiAction(error.code);
  return kind ? { kind, providerBusinessCode: error.code } : null;
}

function truncateTelemetryText(value: string | undefined): string {
  if (!value) {
    return "";
  }
  return value.length > CHAT_ERROR_BANNER_MESSAGE_LIMIT
    ? value.slice(0, CHAT_ERROR_BANNER_MESSAGE_LIMIT)
    : value;
}

function normalizeTelemetryKeyPart(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/[:\s]+/g, "_").slice(0, 128);
}

function hashTelemetryFingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function resolveErrorKey(params: {
  errorKey?: string | null;
  error: CfUiError;
  displayMessage: string;
  providerBusinessRecoveryAction: ChatProviderBusinessRecoveryAction | null;
}): string {
  const providerBusinessRecoveryAction = params.providerBusinessRecoveryAction;
  const fingerprint = [
    params.errorKey?.trim() ?? "",
    params.error.taskId ?? "",
    params.error.code ?? "",
    params.error.traceId ?? "",
    params.error.message,
    params.displayMessage,
    providerBusinessRecoveryAction?.kind ?? "",
    providerBusinessRecoveryAction?.providerBusinessCode ?? "",
  ].join("\u001f");

  return [
    normalizeTelemetryKeyPart(params.error.taskId, "no-task"),
    normalizeTelemetryKeyPart(params.error.code, "UNKNOWN"),
    normalizeTelemetryKeyPart(params.error.traceId, "no-trace"),
    normalizeTelemetryKeyPart(providerBusinessRecoveryAction?.kind, "no-action"),
    normalizeTelemetryKeyPart(
      providerBusinessRecoveryAction?.providerBusinessCode,
      "no-provider-code",
    ),
    hashTelemetryFingerprint(fingerprint),
  ].join(":");
}

export function buildChatErrorBannerTelemetryPayload(params: {
  surface?: ChatErrorBannerSurface;
  errorKey?: string | null;
  displayMessage: string;
  error: CfUiError;
  providerBusinessRecoveryAction: ChatProviderBusinessRecoveryAction | null;
}): ArmsCustomEventPayload {
  const errorMsg = truncateTelemetryText(params.displayMessage);
  const underlyingErrorMessage = sanitizeUnderlyingTelemetryText(
    params.error.underlyingErrorMessage,
  );
  const taskId = params.error.taskId ?? "";
  const providerBusinessRecoveryAction = params.providerBusinessRecoveryAction;
  const attribution = params.error.attribution;
  const provider = resolveTelemetryProviderScope(attribution?.providerId);
  const { errorSource, failureReason } = resolveTelemetryAttribution({
    displayMessage: params.displayMessage,
    error: params.error,
  });

  return {
    name: CHAT_ERROR_BANNER_ARMS_EVENT_NAME,
    group: CHAT_ERROR_BANNER_ARMS_GROUP,
    value: 1,
    properties: {
      surface: params.surface ?? "chat_input_error_banner",
      error_key: resolveErrorKey({
        errorKey: params.errorKey,
        error: params.error,
        displayMessage: params.displayMessage,
        providerBusinessRecoveryAction,
      }),
      error_code: params.error.code ?? "",
      error_message: errorMsg,
      ...(underlyingErrorMessage ? { error_detail_message: underlyingErrorMessage } : {}),
      trace_id: params.error.traceId ?? "",
      task_id: taskId,
      has_detail: Boolean(params.error.detail),
      provider_business_action: providerBusinessRecoveryAction?.kind ?? "",
      provider_business_code: providerBusinessRecoveryAction?.providerBusinessCode ?? "",
      error_source: errorSource,
      failure_reason: failureReason,
      failure_phase: attribution?.errorPhase ?? "",
      failure_exception_kind: attribution?.exceptionKind ?? "",
      provider_scope: provider.providerScope,
      provider_id: provider.providerId,
      model_id: resolveTelemetryModelId(provider.providerScope, attribution?.modelId),
      provider_kind: attribution?.providerKind ?? "",
      transport: attribution?.transport ?? "",
      status_code: attribution?.statusCode ?? "",
      provider_error_code: attribution?.providerErrorCode ?? "",
      failure_retryable: attribution?.retryable ?? "",
    },
  };
}

export async function reportChatErrorBannerTelemetry(
  platform: Pick<IPlatformService, "reportArmsCustomEvent">,
  params: {
    surface?: ChatErrorBannerSurface;
    errorKey?: string | null;
    displayMessage: string;
    error: CfUiError;
    providerBusinessRecoveryAction: ChatProviderBusinessRecoveryAction | null;
  },
): Promise<void> {
  try {
    await platform.reportArmsCustomEvent(buildChatErrorBannerTelemetryPayload(params));
  } catch (error) {
    logger.warn("[ChatViewErrorBanner] ARMS reporting failed:", error);
  }
}
