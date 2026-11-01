import type { UsageEntitlementSnapshot, UsageQuotaLimit } from "@origin-ai/cf-shared";

export type CodingPlanQuotaResetFormat = "date" | "dateTime" | "adaptive";

const TOKEN_LIMIT_TYPES = new Set(["TOKENS_LIMIT", "CREDIT_LIMIT"]);

const TOOL_LIMIT_TYPES = new Set(["TIME_LIMIT"]);

export function isSameLimitCategory(
  limitType: string,
  queryType: UsageQuotaLimit["type"],
): boolean {
  if (limitType === queryType) {
    return true;
  }
  if (TOKEN_LIMIT_TYPES.has(queryType)) {
    return TOKEN_LIMIT_TYPES.has(limitType);
  }
  if (TOOL_LIMIT_TYPES.has(queryType)) {
    return TOOL_LIMIT_TYPES.has(limitType);
  }
  return false;
}

export function findCodingPlanQuotaLimit(
  limits: UsageQuotaLimit[] | undefined,
  type: UsageQuotaLimit["type"],
  unit: number,
  number?: number,
): UsageQuotaLimit | null {
  return (
    limits?.find(
      (limit) =>
        isSameLimitCategory(limit.type, type) &&
        limit.unit === unit &&
        (number == null || limit.number === number),
    ) ?? null
  );
}

export function resolveMcpQuotaLimit(
  snapshot: UsageEntitlementSnapshot | null | undefined,
): UsageQuotaLimit | null {
  return snapshot?.mcpQuota?.aggregate ?? null;
}

export function normalizeQuotaPercentage(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

export function getQuotaRemainingPercentage(limit: UsageQuotaLimit | null): number | null {
  if (typeof limit?.percentage !== "number" || !Number.isFinite(limit.percentage)) {
    return null;
  }

  return Math.max(0, Math.min(100, 100 - limit.percentage));
}

export function formatQuotaRemainingPercentage(
  locale: string,
  limit: UsageQuotaLimit | null,
): string {
  const remainingPercentage = getQuotaRemainingPercentage(limit);
  if (remainingPercentage == null) {
    return "--";
  }

  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: remainingPercentage >= 10 ? 0 : 1,
  }).format(remainingPercentage)}%`;
}

export function formatStartPlanBucketResetTime(
  locale: string,
  value: number | null | undefined,
): string | undefined {
  return formatQuotaResetTime({ locale, value, format: "adaptive" });
}

export function formatQuotaResetTime(params: {
  locale: string;
  value: number | null | undefined;
  format: CodingPlanQuotaResetFormat;
  compactToday?: boolean;
}): string | undefined {
  if (!params.value) {
    return undefined;
  }

  const resetAt = new Date(params.value);
  if (Number.isNaN(resetAt.getTime())) {
    return undefined;
  }

  const now = new Date();
  const isToday =
    resetAt.getFullYear() === now.getFullYear() &&
    resetAt.getMonth() === now.getMonth() &&
    resetAt.getDate() === now.getDate();

  if (params.format === "date") {
    return new Intl.DateTimeFormat(params.locale, {
      month: "short",
      day: "numeric",
    }).format(resetAt);
  }

  if (params.format === "adaptive") {
    if (isToday) {
      return new Intl.DateTimeFormat(params.locale, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(resetAt);
    }
    return new Intl.DateTimeFormat(params.locale, {
      month: "short",
      day: "numeric",
    }).format(resetAt);
  }

  return new Intl.DateTimeFormat(params.locale, {
    ...(params.compactToday && isToday
      ? {}
      : {
          month: "short",
          day: "numeric",
        }),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(resetAt);
}
