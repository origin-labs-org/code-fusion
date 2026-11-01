
export const SUSPICIOUS_EMPTY_MODEL_RESULT_MESSAGE =
  "Model returned no text, no tool calls, and no usage before completing the turn.";

import {
  requestVerificationActionMessages,
  requestVerificationRecoveryAction,
  type RequestVerificationRecoveryAction,
} from "@/request-security-edition/errors.js";
export {
  resolveRequestVerificationBusinessCode,
  isRequestVerificationTerminalError,
  isRequestVerificationRejectedMessage,
  REQUEST_VERIFICATION_REJECTED_MESSAGE,
} from "@/request-security-edition/errors.js";

import { isOffPeakTicketExpiredError } from "@origin-ai/cf-shared";

export const PROVIDER_BUSINESS_ERROR_CODES = [
  "1006",
  "1005",
  "3006",
  "3001",
  "3007",
  "3008",
  "3009",
  "3010",
  "3002",
  "3102",
  "2007",
  "429",
] as const;

export type ProviderBusinessErrorCode = (typeof PROVIDER_BUSINESS_ERROR_CODES)[number];

export type ProviderBusinessErrorUiAction =
  | "login"
  | "refresh-quota"
  | "switch-model"
  | RequestVerificationRecoveryAction
  | "retry-later"
  | "upgrade";

export const PROVIDER_BUSINESS_ERROR_MESSAGE_IDS: Record<ProviderBusinessErrorCode, string> = {
  "1006": "cf.error.providerBusiness.1006",
  "1005": "cf.error.providerBusiness.1005",
  "3006": "cf.error.providerBusiness.3006",
  "3002": "cf.error.providerBusiness.3002",
  "3001": "cf.error.providerBusiness.3001",
  "3007": "cf.error.providerBusiness.3007",
  "3008": "cf.error.providerBusiness.3008",
  "3009": "cf.error.providerBusiness.3009",
  "3010": "cf.error.providerBusiness.3010",
  "3102": "cf.error.providerBusiness.3102",
  "2007": "cf.error.providerBusiness.2007",
  "429": "cf.error.providerBusiness.429",
};

export const PROVIDER_BUSINESS_ERROR_ACTION_MESSAGE_IDS: Record<
  ProviderBusinessErrorUiAction,
  string
> = {
  login: "chat.error.action.relogin",
  "refresh-quota": "chat.error.action.refreshQuota",
  "switch-model": "chat.error.action.switchModel",
  ...requestVerificationActionMessages,
  "retry-later": "chat.error.action.retryLater",
  upgrade: "chat.quota.action.upgrade",
};

const PROVIDER_BUSINESS_ERROR_UI_ACTIONS: Record<
  ProviderBusinessErrorCode,
  ProviderBusinessErrorUiAction | null
> = {
  "1006": "login",
  "1005": "refresh-quota",
  "3006": "switch-model",
  "3001": null,
  "3007": requestVerificationRecoveryAction,
  "3008": "upgrade",
  "3009": "upgrade",
  "3010": "upgrade",
  "3002": "retry-later",
  "3102": null,
  "2007": "retry-later",
  "429": "retry-later",
};

export function isProviderBusinessErrorCode(
  code: string | undefined,
): code is ProviderBusinessErrorCode {
  if (!code) {
    return false;
  }
  return (PROVIDER_BUSINESS_ERROR_CODES as readonly string[]).includes(code);
}

export function getProviderBusinessErrorMessageId(code: string | undefined): string | undefined {
  if (!isProviderBusinessErrorCode(code)) {
    return undefined;
  }
  return PROVIDER_BUSINESS_ERROR_MESSAGE_IDS[code];
}

export function getProviderBusinessErrorUiAction(
  code: string | undefined,
): ProviderBusinessErrorUiAction | null {
  if (!isProviderBusinessErrorCode(code)) {
    return null;
  }
  return PROVIDER_BUSINESS_ERROR_UI_ACTIONS[code];
}

const START_PLAN_QUOTA_EXHAUSTED_WRAPPER_CODES = new Set([
  "PROVIDER_BUSINESS_ERROR",
  "SEND_FAILED",
  "unknown_error",
]);

export function resolveStartPlanQuotaExhaustedBusinessCode(
  code: string | undefined,
  message: string | undefined,
): "1005" | undefined {
  if (code === "1005") {
    return "1005";
  }

  const normalizedCode = code?.trim();
  const normalizedMessage = message?.trim().toLowerCase();
  if (!normalizedMessage) {
    return undefined;
  }

  // PROVIDER_BUSINESS_ERROR / SEND_FAILED / unknown_error + "exceed limit/exceed quota limit"。
  if (
    (normalizedMessage.includes("exceed limit") ||
      normalizedMessage.includes("exceed quota limit") ||
      normalizedMessage.includes("quota exceeded")) &&
    (!normalizedCode || START_PLAN_QUOTA_EXHAUSTED_WRAPPER_CODES.has(normalizedCode))
  ) {
    return "1005";
  }

  return undefined;
}

const CONCURRENT_LIMIT_BUSINESS_CODES = new Set(["3008", "3009", "3010"]);

const CONCURRENT_LIMIT_WRAPPER_CODES = new Set([
  "PROVIDER_BUSINESS_ERROR",
  "SEND_FAILED",
  "unknown_error",
  "MODEL_RATE_LIMITED",
]);

const CONCURRENT_LIMIT_MESSAGE_PATTERNS = ["concurrent", "concurrency", "并发"];

const MODEL_SCOPED_CONCURRENT_LIMIT_MESSAGE_PATTERNS = ["model", "模型"];

export const START_PLAN_BUSY_AUTO_RETRY_EXHAUSTED_MESSAGE =
  "Start Plan is busy and automatic model stream recovery reached the maximum retry count.";

export type StartPlanConcurrentLimitBannerReason = "initial-busy" | "retry-exhausted-busy";

export const GLM_QUOTA_BANNER_BUSINESS_CODES = [
  "1308",
  "1309",
  "1310",
  "1311",
  "1313",
  "1314",
  "1315",
  "1316",
  "1317",
  "1318",
  "1319",
  "1320",
  "1321",
] as const;

export type GlmQuotaBannerBusinessCode = (typeof GLM_QUOTA_BANNER_BUSINESS_CODES)[number];

const GLM_QUOTA_BANNER_BUSINESS_CODE_SET = new Set<string>(GLM_QUOTA_BANNER_BUSINESS_CODES);

export function resolveStartPlanConcurrentLimitBusinessCode(
  code: string | undefined,
  message: string | undefined,
): "3008" | "3009" | "3010" | undefined {
  if (code === "3008") {
    return "3008";
  }
  if (code === "3009") {
    return "3009";
  }
  if (code === "3010") {
    return "3010";
  }

  const normalizedCode = code?.trim();
  const normalizedMessage = message?.trim().toLowerCase();
  if (!normalizedMessage) {
    return undefined;
  }

  if (
    CONCURRENT_LIMIT_MESSAGE_PATTERNS.some((pattern) => normalizedMessage.includes(pattern)) &&
    (!normalizedCode || CONCURRENT_LIMIT_WRAPPER_CODES.has(normalizedCode))
  ) {
    return MODEL_SCOPED_CONCURRENT_LIMIT_MESSAGE_PATTERNS.some((pattern) =>
      normalizedMessage.includes(pattern),
    )
      ? "3009"
      : "3008";
  }

  return undefined;
}

export function isConcurrentLimitBusinessCode(code: string | undefined): boolean {
  return Boolean(code && CONCURRENT_LIMIT_BUSINESS_CODES.has(code));
}

export function resolveGlmQuotaBannerBusinessCode(
  code: string | undefined,
): GlmQuotaBannerBusinessCode | undefined {
  const normalizedCode = code?.trim();
  if (normalizedCode && GLM_QUOTA_BANNER_BUSINESS_CODE_SET.has(normalizedCode)) {
    return normalizedCode as GlmQuotaBannerBusinessCode;
  }
  return undefined;
}

export function resolveStartPlanConcurrentLimitBannerReason(
  message: string | undefined,
): StartPlanConcurrentLimitBannerReason {
  return message?.trim() === START_PLAN_BUSY_AUTO_RETRY_EXHAUSTED_MESSAGE
    ? "retry-exhausted-busy"
    : "initial-busy";
}

export function shouldRefreshQuotaOnProviderBusinessRetry(code: string | undefined): boolean {
  return code === "2007" || code === "1005";
}

export function resolveOffPeakTicketExpiredBusinessCode(
  code: string | undefined,
  message: string | undefined,
): "3102" | undefined {
  if (code?.trim() === "3102") {
    return "3102";
  }
  return isOffPeakTicketExpiredError(message) ? "3102" : undefined;
}

export function isSuspiciousEmptyModelResultMessage(message: string | undefined): boolean {
  if (!message) {
    return false;
  }

  return (
    message.includes(SUSPICIOUS_EMPTY_MODEL_RESULT_MESSAGE) ||
    message.includes("Model returned no text")
  );
}
