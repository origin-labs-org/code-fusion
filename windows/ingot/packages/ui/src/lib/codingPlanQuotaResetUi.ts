import type {
  CodingPlanResetStatusSnapshot,
  CodingPlanResetType,
  UsageQuotaLimit,
} from "@origin-ai/cf-shared";

export const CODING_PLAN_QUOTA_RESET_PROGRESS_DURATION_MS = 500;
export const CODING_PLAN_QUOTA_RESET_DONE_DISPLAY_MS = 2_600;
export const CODING_PLAN_QUOTA_RESET_AUTOMATIC_PROCESSING_MS = 1_000;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

export function resolveCodingPlanQuotaResetDurationMs(resetType: CodingPlanResetType): number {
  return resetType === "WEEK" ? WEEK_MS : FIVE_HOURS_MS;
}

export type CodingPlanQuotaResetUiStatus = "available" | "processing" | "completed";

export interface CodingPlanQuotaResetUiEntry {
  status: CodingPlanQuotaResetUiStatus;
  
  opportunityCount: number;
  
  opportunityExpiresAt: number | null;
  
  startedAt: number | null;
  
  completedAt: number | null;
  
  observedAt: number | null;
  
  quotaOverridePending: boolean;
  nextResetAt: number | null;
  
  idempotencyKey: string | null;
  error: string | null;
}

export interface CodingPlanQuotaResetCelebrationState {
  sourceKey: string | null;
  
  celebratedCompletedAt: number | null;
}

export interface CodingPlanQuotaResetUiEntries {
  fiveHour: CodingPlanQuotaResetUiEntry | null;
  week: CodingPlanQuotaResetUiEntry | null;
}

export const CODING_PLAN_QUOTA_RESET_TYPES = [
  "FIVE_HOUR",
  "WEEK",
] as const satisfies readonly CodingPlanResetType[];

export function advanceCodingPlanQuotaResetCelebration(
  previous: CodingPlanQuotaResetCelebrationState | null,
  input: {
    sourceKey: string | null;
    completedAt: number | null;
    
    automaticCompletion: boolean;
  },
): {
  state: CodingPlanQuotaResetCelebrationState;
  shouldCelebrate: boolean;
} {
  const sourceChanged = previous?.sourceKey !== input.sourceKey;
  const celebratedCompletedAt = sourceChanged ? null : (previous?.celebratedCompletedAt ?? null);
  const shouldCelebrate = Boolean(
    input.sourceKey &&
    input.automaticCompletion &&
    input.completedAt !== null &&
    input.completedAt !== celebratedCompletedAt,
  );

  return {
    state: {
      sourceKey: input.sourceKey,
      celebratedCompletedAt: shouldCelebrate ? input.completedAt : celebratedCompletedAt,
    },
    shouldCelebrate,
  };
}

function createAvailableEntry(
  opportunityCount: number,
  opportunityExpiresAt: number,
  idempotencyKey: string | null,
): CodingPlanQuotaResetUiEntry {
  return {
    status: "available",
    opportunityCount,
    opportunityExpiresAt,
    startedAt: null,
    completedAt: null,
    observedAt: null,
    quotaOverridePending: false,
    nextResetAt: null,
    idempotencyKey,
    error: null,
  };
}

function createCompletedEntry(
  previous: CodingPlanQuotaResetUiEntry | null,
  completedAt: number,
  observedAt: number,
  manualStartedAt: number | null,
  nextResetMs: number,
  remainingOpportunities: ReadonlyArray<{ expireAt: number }>,
): CodingPlanQuotaResetUiEntry {
  const isSameCompletion = previous?.status === "completed" && previous.completedAt === completedAt;
  return {
    status: "completed",
    opportunityCount: remainingOpportunities.length,
    opportunityExpiresAt: remainingOpportunities[0]?.expireAt ?? null,
    startedAt: isSameCompletion
      ? previous.startedAt
      : previous?.status === "processing"
        ? previous.startedAt
        : manualStartedAt,
    completedAt,
    observedAt: isSameCompletion ? (previous.observedAt ?? observedAt) : observedAt,
    quotaOverridePending: isSameCompletion ? previous.quotaOverridePending : true,
    nextResetAt: completedAt + nextResetMs,
    idempotencyKey: null,
    error: null,
  };
}

export function applyCodingPlanQuotaResetStatus(
  previous: CodingPlanQuotaResetUiEntry | null,
  status: CodingPlanResetStatusSnapshot,
  now: number,
  manualStartedAt: number | null = null,
  resetType: CodingPlanResetType = "FIVE_HOUR",
): CodingPlanQuotaResetUiEntry | null {
  const availableResets =
    resetType === "WEEK" ? status.availableWeekResets : status.availableFiveHourResets;
  const latestUsedAt =
    (resetType === "WEEK"
      ? status.latestWeekResetHistory?.usedAt
      : status.latestFiveHourResetHistory?.usedAt) ?? null;
  const otherUsedAt =
    (resetType === "WEEK"
      ? status.latestFiveHourResetHistory?.usedAt
      : status.latestWeekResetHistory?.usedAt) ?? null;
  const ownsUnread =
    status.hasUnreadHistory &&
    latestUsedAt !== null &&
    (otherUsedAt === null || latestUsedAt >= otherUsedAt);
  const validOpportunities = availableResets
    .filter((item) => Number.isFinite(item.expireAt) && item.expireAt > now)
    .sort((left, right) => left.expireAt - right.expireAt);
  const hasValidOpportunity = validOpportunities.length > 0;
  const shouldComplete = Boolean(
    latestUsedAt !== null &&
    (previous?.status === "processing"
      ? manualStartedAt !== null
      : ownsUnread ||
        ((manualStartedAt !== null ||
          (previous?.status === "completed" && previous.completedAt === latestUsedAt)) &&
          !hasValidOpportunity)),
  );
  if (shouldComplete && latestUsedAt !== null) {
    return createCompletedEntry(
      previous,
      latestUsedAt,
      now,
      manualStartedAt,
      resolveCodingPlanQuotaResetDurationMs(resetType),
      validOpportunities,
    );
  }

  if (previous?.status === "processing") {
    return previous;
  }

  const earliest = validOpportunities[0];
  if (earliest) {
    return createAvailableEntry(
      validOpportunities.length,
      earliest.expireAt,
      previous?.status === "available" ? previous.idempotencyKey : null,
    );
  }

  return null;
}

export function hasUsableCodingPlanQuotaResetOpportunity(
  entry: CodingPlanQuotaResetUiEntry | null,
  now: number,
): boolean {
  return Boolean(
    entry &&
    entry.status !== "processing" &&
    entry.opportunityCount > 0 &&
    entry.opportunityExpiresAt !== null &&
    entry.opportunityExpiresAt > now,
  );
}

export function resolveCodingPlanQuotaResetActionCompletedAt(controller: {
  entry: CodingPlanQuotaResetUiEntry | null;
  opportunityVisible: boolean;
}): number | null {
  return controller.opportunityVisible ? null : (controller.entry?.completedAt ?? null);
}

export function startCodingPlanQuotaResetManualUse(
  entry: CodingPlanQuotaResetUiEntry | null,
  idempotencyKey: string,
  now: number,
): CodingPlanQuotaResetUiEntry | null {
  if (!entry || !hasUsableCodingPlanQuotaResetOpportunity(entry, now)) {
    return entry;
  }

  return {
    ...entry,
    status: "processing",
    opportunityCount: entry.opportunityCount,
    opportunityExpiresAt: entry.opportunityExpiresAt,
    startedAt: now,
    completedAt: null,
    observedAt: null,
    quotaOverridePending: false,
    nextResetAt: null,
    idempotencyKey: entry.idempotencyKey ?? idempotencyKey,
    error: null,
  };
}

export function failCodingPlanQuotaResetManualUse(
  entry: CodingPlanQuotaResetUiEntry | null,
  error: string,
): CodingPlanQuotaResetUiEntry | null {
  if (!entry || entry.status !== "processing") {
    return entry;
  }

  return {
    ...entry,
    status: "available",
    opportunityCount: entry.opportunityCount,
    opportunityExpiresAt: entry.opportunityExpiresAt,
    startedAt: null,
    completedAt: null,
    observedAt: null,
    quotaOverridePending: false,
    nextResetAt: null,
    error,
  };
}

export function resolveCodingPlanQuotaResetRemainingPercentage(
  remainingPercentage: number | null,
  entry: CodingPlanQuotaResetUiEntry | null,
): number | null {
  return entry?.status === "completed" && entry.quotaOverridePending ? 100 : remainingPercentage;
}

export function mergeCodingPlanQuotaResetOpportunityBadges(
  items: ReadonlyArray<{
    count: number;
    expiresAt: number | null;
    visible: boolean;
  }>,
): { count: number; expiresAt: number | null; visible: boolean } {
  const visibleItems = items.filter((item) => item.visible && item.count > 0);
  return {
    count: visibleItems.reduce((sum, item) => sum + item.count, 0),
    expiresAt:
      visibleItems
        .map((item) => item.expiresAt)
        .filter((value): value is number => value !== null)
        .sort((left, right) => left - right)[0] ?? null,
    visible: visibleItems.length > 0,
  };
}

export function completeCodingPlanQuotaResetEntitlementRefresh(
  entry: CodingPlanQuotaResetUiEntry | null,
  completedAt: number,
): CodingPlanQuotaResetUiEntry | null {
  if (
    entry?.status !== "completed" ||
    entry.completedAt !== completedAt ||
    !entry.quotaOverridePending
  ) {
    return entry;
  }
  return { ...entry, quotaOverridePending: false };
}

export function resolveCodingPlanQuotaResetLimit(
  limit: UsageQuotaLimit | null | undefined,
  entry: CodingPlanQuotaResetUiEntry | null,
): UsageQuotaLimit | null {
  if (!limit) {
    return null;
  }
  if (entry?.status !== "completed") {
    return limit;
  }
  if (!entry.quotaOverridePending) {
    return limit.nextResetTime == null && entry.nextResetAt !== null
      ? { ...limit, nextResetTime: entry.nextResetAt }
      : limit;
  }

  return {
    ...limit,
    percentage: 0,
    nextResetTime: entry.nextResetAt ?? limit.nextResetTime,
  };
}

export function resolveCodingPlanQuotaResetStatusVisible(
  entry: CodingPlanQuotaResetUiEntry | null,
  now: number,
  doneDisplayMs: number = CODING_PLAN_QUOTA_RESET_DONE_DISPLAY_MS,
): boolean {
  if (entry?.status !== "completed" || entry.startedAt !== null || entry.observedAt === null) {
    return false;
  }
  return now - entry.observedAt < doneDisplayMs;
}

export type CodingPlanQuotaResetAutomaticPhase = "processing" | "completed";

export function resolveCodingPlanQuotaResetAutomaticPhase(
  entry: CodingPlanQuotaResetUiEntry | null,
  now: number,
  dismissed: boolean,
  processingMs: number = CODING_PLAN_QUOTA_RESET_AUTOMATIC_PROCESSING_MS,
): CodingPlanQuotaResetAutomaticPhase | null {
  if (dismissed) {
    return null;
  }
  if (entry?.status !== "completed" || entry.startedAt !== null || entry.observedAt === null) {
    return null;
  }
  return now - entry.observedAt < processingMs ? "processing" : "completed";
}

export function pruneCodingPlanQuotaResetConfettiArms(
  arms: Record<CodingPlanResetType, number | null>,
  automaticCompletedAtByType: Record<CodingPlanResetType, number | null>,
): Record<CodingPlanResetType, number | null> {
  let changed = false;
  const next = { ...arms };
  for (const resetType of CODING_PLAN_QUOTA_RESET_TYPES) {
    const armed = next[resetType];
    if (armed !== null && automaticCompletedAtByType[resetType] !== armed) {
      next[resetType] = null;
      changed = true;
    }
  }
  return changed ? next : arms;
}
