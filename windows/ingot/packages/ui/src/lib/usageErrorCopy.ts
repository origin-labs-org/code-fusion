import type { IntlInstance } from "@/i18n/IntlProvider.js";

type UsageErrorSurface = "chatPlan" | "entitlement" | "stats";

const CREDENTIAL_ERROR_PATTERNS = [
  /token\s+(expired|incorrect)/i,
  /expired.*token/i,
  /incorrect.*token/i,
  /invalid.*(?:api\s*)?key/i,
  /(?:api\s*)?key.*invalid/i,
  /unauthorized/i,
  /forbidden/i,
  /\b40[13]\b/,
  /认证|鉴权|授权|密钥|无效|Expired/i,
];

const TEAM_PLAN_BUSINESS_ERROR_PATTERNS = [
  /企业主账Number/,
  /Team Plan/,
  /无法创建API\s*Key/i,
  /授权记录/,
];

export function isUsageTeamPlanBusinessError(error: string | null | undefined): boolean {
  if (!error) {
    return false;
  }

  return TEAM_PLAN_BUSINESS_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

export function isUsageCredentialError(error: string | null | undefined): boolean {
  if (!error) {
    return false;
  }

  return CREDENTIAL_ERROR_PATTERNS.some((pattern) => pattern.test(error));
}

export function formatUsageErrorMessage(
  intl: IntlInstance,
  surface: UsageErrorSurface,
  error: string | null | undefined,
): string {
  if (isUsageTeamPlanBusinessError(error) && error?.trim()) {
    return error.trim();
  }

  if (isUsageCredentialError(error)) {
    return intl.formatMessage({ id: `usage.error.${surface}.credential` });
  }

  return intl.formatMessage({ id: `usage.error.${surface}.generic` });
}
