
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IUsageStatsService } from "@origin-ai/cf-services";
import type {
  CodingPlanResetScopeRequest,
  CodingPlanResetStatusSnapshot,
  CodingPlanResetType,
  CfAccountAccess,
  CfProviderAccountAccess,
} from "@origin-ai/cf-shared";
import { toast } from "@/components/ui/toast.js";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useStableAccountAccess } from "@/hooks/useStableAccountAccess.js";
import { useCfIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import {
  requestCodingPlanResetOpportunityWhenDue,
  subscribeCodingPlanQuotaResetPolling,
} from "@/lib/codingPlanQuotaResetCoordinator.js";
import {
  CODING_PLAN_QUOTA_RESET_DONE_DISPLAY_MS,
  CODING_PLAN_QUOTA_RESET_TYPES,
  applyCodingPlanQuotaResetStatus,
  completeCodingPlanQuotaResetEntitlementRefresh,
  failCodingPlanQuotaResetManualUse,
  hasUsableCodingPlanQuotaResetOpportunity,
  resolveCodingPlanQuotaResetStatusVisible,
  startCodingPlanQuotaResetManualUse,
  type CodingPlanQuotaResetUiEntries,
  type CodingPlanQuotaResetUiEntry,
} from "@/lib/codingPlanQuotaResetUi.js";
import type {
  CodingPlanQuotaResetAutomaticObservation,
  CodingPlanQuotaResetAutoPlayReservation,
  CodingPlanQuotaResetAutoPlayReservationAttempt,
  CodingPlanQuotaResetAutoPlayedSlot,
} from "@/store/codingPlanQuotaResetState.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";

const STATUS_FRESHNESS_MS = 1_500;
const USE_STATUS_RETRY_DELAYS_MS = [0, 250, 750, 1_500] as const;
const EMPTY_ENTRIES: Record<string, CodingPlanQuotaResetUiEntries> = {};
const EMPTY_PLAYED: Record<string, CodingPlanQuotaResetAutoPlayedSlot> = {};
const EMPTY_AUTOMATIC_OBSERVATIONS: Record<
  string,
  {
    fiveHour: CodingPlanQuotaResetAutomaticObservation | null;
    week: CodingPlanQuotaResetAutomaticObservation | null;
  }
> = {};
const NOOP_SET_ENTRY = (
  _sourceKey: string,
  _resetType: CodingPlanResetType,
  _entry: CodingPlanQuotaResetUiEntry | null,
) => {};
const NOOP_RESERVE_AUTO_PLAY = async (
  _sourceKey: string,
  _resetType: CodingPlanResetType,
  _completedAt: number,
): Promise<CodingPlanQuotaResetAutoPlayReservationAttempt> => ({
  status: "blocked",
});
const NOOP_COMMIT_AUTO_PLAY = (_reservation: CodingPlanQuotaResetAutoPlayReservation): boolean =>
  false;
const NOOP_RELEASE_AUTO_PLAY = async (
  _reservation: CodingPlanQuotaResetAutoPlayReservation,
): Promise<void> => {};

function entryKeyForType(resetType: CodingPlanResetType): keyof CodingPlanQuotaResetUiEntries {
  return resetType === "WEEK" ? "week" : "fiveHour";
}

function latestUsedAtForType(
  snapshot: CodingPlanResetStatusSnapshot,
  resetType: CodingPlanResetType,
): number | null {
  return (
    (resetType === "WEEK"
      ? snapshot.latestWeekResetHistory?.usedAt
      : snapshot.latestFiveHourResetHistory?.usedAt) ?? null
  );
}

function withEntry(
  entries: CodingPlanQuotaResetUiEntries,
  resetType: CodingPlanResetType,
  entry: CodingPlanQuotaResetUiEntry | null,
): CodingPlanQuotaResetUiEntries {
  return resetType === "WEEK" ? { ...entries, week: entry } : { ...entries, fiveHour: entry };
}

function suppressAutomaticAnimationFromPreviousAuthEpoch(
  entry: CodingPlanQuotaResetUiEntry | null,
  observation: CodingPlanQuotaResetAutomaticObservation | null,
  authSessionSeq: number,
): CodingPlanQuotaResetUiEntry | null {
  if (
    observation !== null &&
    observation.authSessionSeq !== authSessionSeq &&
    entry?.status === "completed" &&
    entry.startedAt === null &&
    entry.observedAt !== null &&
    entry.completedAt === observation.completedAt
  ) {
    return { ...entry, observedAt: null };
  }
  return entry;
}

interface CachedResetStatus {
  fetchedAt: number;
  snapshot: CodingPlanResetStatusSnapshot;
}

interface SharedManualResetAttempt {
  startedAt: number;
  baselineUsedAt: number | null;
  completedAt: number | null;
}

const statusInflightByService = new WeakMap<
  IUsageStatsService,
  Map<string, Promise<CodingPlanResetStatusSnapshot>>
>();
const statusCacheByService = new WeakMap<IUsageStatsService, Map<string, CachedResetStatus>>();
const historyReadInflightByService = new WeakMap<IUsageStatsService, Map<string, Promise<void>>>();
const historyReadCompletedByService = new WeakMap<IUsageStatsService, Set<string>>();
const manualResetAttemptByService = new WeakMap<
  IUsageStatsService,
  Map<string, SharedManualResetAttempt>
>();

function buildScopeKey(scope: CodingPlanResetScopeRequest): string {
  return JSON.stringify([scope.preferredProviderId, scope.accountAccess]);
}

function buildManualAttemptKey(
  scope: CodingPlanResetScopeRequest,
  resetType: CodingPlanResetType,
): string {
  return `${buildScopeKey(scope)}::${resetType}`;
}

function getServiceMap<T>(
  owner: WeakMap<IUsageStatsService, Map<string, T>>,
  service: IUsageStatsService,
): Map<string, T> {
  const existing = owner.get(service);
  if (existing) {
    return existing;
  }
  const created = new Map<string, T>();
  owner.set(service, created);
  return created;
}

async function requestCodingPlanResetStatus(params: {
  service: IUsageStatsService;
  scope: CodingPlanResetScopeRequest;
  force: boolean;
  authSessionSeq: number;
}): Promise<CodingPlanResetStatusSnapshot> {
  const scopeKey = `${params.authSessionSeq}::${buildScopeKey(params.scope)}`;
  const cache = getServiceMap(statusCacheByService, params.service);
  const cached = cache.get(scopeKey);
  if (!params.force && cached && Date.now() - cached.fetchedAt < STATUS_FRESHNESS_MS) {
    return cached.snapshot;
  }

  const inflight = getServiceMap(statusInflightByService, params.service);
  const existing = inflight.get(scopeKey);
  if (existing) {
    return existing;
  }

  const request = params.service
    .getCodingPlanResetStatus(params.scope)
    .then((snapshot) => {
      cache.set(scopeKey, { fetchedAt: Date.now(), snapshot });
      return snapshot;
    })
    .finally(() => {
      inflight.delete(scopeKey);
      if (inflight.size === 0) {
        statusInflightByService.delete(params.service);
      }
    });
  inflight.set(scopeKey, request);
  return request;
}

function startSharedManualResetAttempt(params: {
  service: IUsageStatsService;
  scope: CodingPlanResetScopeRequest;
  startedAt: number;
  resetType: CodingPlanResetType;
  authSessionSeq: number;
}): void {
  const attemptKey = buildManualAttemptKey(params.scope, params.resetType);
  const cached = statusCacheByService
    .get(params.service)
    ?.get(`${params.authSessionSeq}::${buildScopeKey(params.scope)}`)?.snapshot;
  const baselineUsedAt = cached ? latestUsedAtForType(cached, params.resetType) : null;
  getServiceMap(manualResetAttemptByService, params.service).set(attemptKey, {
    startedAt: params.startedAt,
    baselineUsedAt,
    completedAt: null,
  });
}

function clearSharedManualResetAttempt(
  service: IUsageStatsService,
  scope: CodingPlanResetScopeRequest,
  resetType: CodingPlanResetType,
): void {
  const attempts = manualResetAttemptByService.get(service);
  if (!attempts) {
    return;
  }
  attempts.delete(buildManualAttemptKey(scope, resetType));
  if (attempts.size === 0) {
    manualResetAttemptByService.delete(service);
  }
}

function resolveSharedManualResetStartedAt(params: {
  service: IUsageStatsService;
  scope: CodingPlanResetScopeRequest;
  snapshot: CodingPlanResetStatusSnapshot;
  resetType: CodingPlanResetType;
}): number | null {
  const attempts = manualResetAttemptByService.get(params.service);
  const attemptKey = buildManualAttemptKey(params.scope, params.resetType);
  const attempt = attempts?.get(attemptKey);
  if (!attempt) {
    return null;
  }

  const latestUsedAt = latestUsedAtForType(params.snapshot, params.resetType);
  if (latestUsedAt === null || latestUsedAt === attempt.baselineUsedAt) {
    return null;
  }
  if (attempt.completedAt === null) {
    attempt.completedAt = latestUsedAt;
    return attempt.startedAt;
  }
  if (attempt.completedAt === latestUsedAt) {
    return attempt.startedAt;
  }

  clearSharedManualResetAttempt(params.service, params.scope, params.resetType);
  return null;
}

function markHistoryReadOnce(params: {
  service: IUsageStatsService;
  scope: CodingPlanResetScopeRequest;
  usedAt: number;
}): Promise<void> {
  const historyKey = String(params.usedAt);
  let completed = historyReadCompletedByService.get(params.service);
  if (!completed) {
    completed = new Set<string>();
    historyReadCompletedByService.set(params.service, completed);
  }
  if (completed.has(historyKey)) {
    return Promise.resolve();
  }

  const inflight = getServiceMap(historyReadInflightByService, params.service);
  const existing = inflight.get(historyKey);
  if (existing) {
    return existing;
  }

  const request = params.service
    .markCodingPlanResetHistoryRead(params.scope)
    .then(() => {
      completed?.add(historyKey);
    })
    .finally(() => {
      inflight.delete(historyKey);
      if (inflight.size === 0) {
        historyReadInflightByService.delete(params.service);
      }
    });
  inflight.set(historyKey, request);
  return request;
}

function createIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues(bytes);
  if (bytes.some((value) => value !== 0)) {
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function wait(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface CodingPlanQuotaResetTypeController {
  entry: CodingPlanQuotaResetUiEntry | null;
  
  opportunityVisible: boolean;
  
  processing: boolean;
  
  done: boolean;
  statusVisible: boolean;
  
  reset: () => Promise<void>;
}

export interface CodingPlanQuotaResetUiController extends CodingPlanQuotaResetTypeController {
  enabled: boolean;
  week: CodingPlanQuotaResetTypeController;
  
  reserveAutomaticCompletion: (
    resetType: CodingPlanResetType,
    completedAt: number,
  ) => Promise<CodingPlanQuotaResetAutoPlayReservationAttempt>;
  
  commitAutomaticCompletion: (reservation: CodingPlanQuotaResetAutoPlayReservation) => boolean;
  
  releaseAutomaticCompletion: (
    reservation: CodingPlanQuotaResetAutoPlayReservation,
  ) => Promise<void>;
}

export function useCodingPlanQuotaResetUi({
  sourceKey,
  preferredProviderId,
  accountAccess,
  enabled: requestedEnabled = true,
  onEntitlementRefresh,
}: {
  sourceKey: string | null | undefined;
  preferredProviderId?: string | null;
  accountAccess?: CfProviderAccountAccess | CfAccountAccess | null;
  enabled?: boolean;
  onEntitlementRefresh?: () => void | Promise<void>;
}): CodingPlanQuotaResetUiController {
  const { intl } = useCfIntl();
  const services = useOptionalBaseWorkspaceServices();
  const usageStatsService = services?.usageStatsService;
  const stableAccountAccess = useStableAccountAccess(accountAccess);
  const scope = useMemo<CodingPlanResetScopeRequest | null>(() => {
    const normalizedProviderId = preferredProviderId?.trim();
    if (!normalizedProviderId || !stableAccountAccess) {
      return null;
    }
    return {
      preferredProviderId: normalizedProviderId,
      accountAccess: stableAccountAccess,
    };
  }, [preferredProviderId, stableAccountAccess]);
  const enabled = Boolean(requestedEnabled && sourceKey?.trim() && usageStatsService && scope);
  const entriesBySource = useCfStoreWithDefault(
    (state) => state.codingPlanQuotaResetUiBySource,
    EMPTY_ENTRIES,
  );
  const setEntry = useCfStoreWithDefault(
    (state) => state.setCodingPlanQuotaResetUiEntry,
    NOOP_SET_ENTRY,
  );
  const reserveAutoPlay = useCfStoreWithDefault(
    (state) => state.reserveCodingPlanQuotaResetAutoPlay,
    NOOP_RESERVE_AUTO_PLAY,
  );
  const commitAutoPlay = useCfStoreWithDefault(
    (state) => state.commitCodingPlanQuotaResetAutoPlay,
    NOOP_COMMIT_AUTO_PLAY,
  );
  const releaseAutoPlay = useCfStoreWithDefault(
    (state) => state.releaseCodingPlanQuotaResetAutoPlay,
    NOOP_RELEASE_AUTO_PLAY,
  );
  const observationsBySource = useCfStoreWithDefault(
    (state) => state.codingPlanQuotaResetAutomaticObservationsBySource,
    EMPTY_AUTOMATIC_OBSERVATIONS,
  );
  const playedBySource = useCfStoreWithDefault(
    (state) => state.codingPlanQuotaResetAutoPlayedBySource,
    EMPTY_PLAYED,
  );
  const authSessionSeq = useCfStoreWithDefault((state) => state.authSessionSeq, 0);
  const authSessionSeqRef = useRef(authSessionSeq);
  authSessionSeqRef.current = authSessionSeq;
  const storedEntries = sourceKey ? entriesBySource[sourceKey] : undefined;
  const storedObservations = sourceKey ? observationsBySource[sourceKey] : undefined;
  const fiveHourObservation = storedObservations?.fiveHour ?? null;
  const weekObservation = storedObservations?.week ?? null;
  const fiveHourEntry = useMemo(
    () =>
      suppressAutomaticAnimationFromPreviousAuthEpoch(
        enabled ? (storedEntries?.fiveHour ?? null) : null,
        fiveHourObservation,
        authSessionSeq,
      ),
    [authSessionSeq, enabled, fiveHourObservation, storedEntries?.fiveHour],
  );
  const weekEntry = useMemo(
    () =>
      suppressAutomaticAnimationFromPreviousAuthEpoch(
        enabled ? (storedEntries?.week ?? null) : null,
        weekObservation,
        authSessionSeq,
      ),
    [authSessionSeq, enabled, storedEntries?.week, weekObservation],
  );
  const automaticObservationsRef = useRef({
    FIVE_HOUR: fiveHourObservation,
    WEEK: weekObservation,
  });
  automaticObservationsRef.current = {
    FIVE_HOUR: fiveHourObservation,
    WEEK: weekObservation,
  };
  const playedBySourceRef = useRef(playedBySource);
  playedBySourceRef.current = playedBySource;
  const entriesRef = useRef<CodingPlanQuotaResetUiEntries>({
    fiveHour: fiveHourEntry,
    week: weekEntry,
  });
  const initialRefreshCompletedAt = (entry: CodingPlanQuotaResetUiEntry | null): number | null =>
    entry?.status === "completed" && !entry.quotaOverridePending ? entry.completedAt : null;
  const lastEntitlementRefreshRef = useRef<
    Record<CodingPlanResetType, { sourceKey: string | null; completedAt: number | null }>
  >({
    FIVE_HOUR: {
      sourceKey: sourceKey ?? null,
      completedAt: initialRefreshCompletedAt(fiveHourEntry),
    },
    WEEK: {
      sourceKey: sourceKey ?? null,
      completedAt: initialRefreshCompletedAt(weekEntry),
    },
  });
  const [now, setNow] = useState(() => Date.now());
  const onEntitlementRefreshRef = useRef(onEntitlementRefresh);

  useEffect(() => {
    onEntitlementRefreshRef.current = onEntitlementRefresh;
  }, [onEntitlementRefresh]);

  useEffect(() => {
    entriesRef.current = { fiveHour: fiveHourEntry, week: weekEntry };
  }, [fiveHourEntry, weekEntry]);

  const applyStatusForType = useCallback(
    async (
      snapshot: CodingPlanResetStatusSnapshot,
      resetType: CodingPlanResetType,
    ): Promise<CodingPlanQuotaResetUiEntry | null> => {
      if (
        !sourceKey ||
        !usageStatsService ||
        !scope ||
        authSessionSeqRef.current !== authSessionSeq
      ) {
        return null;
      }
      const key = entryKeyForType(resetType);
      const previous = entriesRef.current[key];
      const manualStartedAt = resolveSharedManualResetStartedAt({
        service: usageStatsService,
        scope,
        snapshot,
        resetType,
      });
      let next = applyCodingPlanQuotaResetStatus(
        previous,
        snapshot,
        Date.now(),
        manualStartedAt,
        resetType,
      );
      next = suppressAutomaticAnimationFromPreviousAuthEpoch(
        next,
        automaticObservationsRef.current[resetType],
        authSessionSeq,
      );
      const playedUsedAt = playedBySourceRef.current[sourceKey]?.[key] ?? null;
      const isNewCompletionInWindow =
        previous?.status !== "completed" || previous.completedAt !== next?.completedAt;
      if (
        playedUsedAt !== null &&
        isNewCompletionInWindow &&
        next?.status === "completed" &&
        next.startedAt === null &&
        next.observedAt !== null &&
        next.completedAt === playedUsedAt
      ) {
        next = { ...next, observedAt: null };
      }
      entriesRef.current = withEntry(entriesRef.current, resetType, next);
      setEntry(sourceKey, resetType, next, authSessionSeq);

      const completedAt = next?.status === "completed" ? next.completedAt : null;
      const isNewCompletion = completedAt !== null && completedAt !== previous?.completedAt;
      if (snapshot.hasUnreadHistory && completedAt !== null) {
        void markHistoryReadOnce({
          service: usageStatsService,
          scope,
          usedAt: completedAt,
        }).catch((error) => {
          logger.warn("[coding-plan-reset] history read failed", {
            sourceKey,
            resetType,
            error: toErrorMessage(error),
          });
        });
      }

      const refreshState = lastEntitlementRefreshRef.current[resetType];
      const entitlementAlreadyRefreshed =
        refreshState.sourceKey === sourceKey && refreshState.completedAt === completedAt;
      const refreshEntitlement = onEntitlementRefreshRef.current;
      if (completedAt !== null && !entitlementAlreadyRefreshed && refreshEntitlement) {
        try {
          await refreshEntitlement();
          if (authSessionSeqRef.current !== authSessionSeq) {
            return entriesRef.current[key];
          }
          lastEntitlementRefreshRef.current[resetType] = {
            sourceKey,
            completedAt,
          };
          next = completeCodingPlanQuotaResetEntitlementRefresh(next, completedAt);
          entriesRef.current = withEntry(entriesRef.current, resetType, next);
          setEntry(sourceKey, resetType, next, authSessionSeq);
        } catch (error) {
          logger.warn("[coding-plan-reset] entitlement refresh failed", {
            sourceKey,
            resetType,
            error: toErrorMessage(error),
          });
        }
      }

      if (isNewCompletion) {
        logger.info("[coding-plan-reset] completed", {
          sourceKey,
          resetType,
          completedAt,
        });
      }
      return next;
    },
    [authSessionSeq, scope, setEntry, sourceKey, usageStatsService],
  );

  const applyStatus = useCallback(
    async (snapshot: CodingPlanResetStatusSnapshot): Promise<CodingPlanQuotaResetUiEntries> => {
      for (const resetType of CODING_PLAN_QUOTA_RESET_TYPES) {
        await applyStatusForType(snapshot, resetType);
      }
      return entriesRef.current;
    },
    [applyStatusForType],
  );

  const refreshStatus = useCallback(
    async (force = false): Promise<CodingPlanQuotaResetUiEntries> => {
      if (!enabled || !usageStatsService || !scope) {
        return entriesRef.current;
      }
      const previous = entriesRef.current;
      const snapshot = await requestCodingPlanResetStatus({
        service: usageStatsService,
        scope,
        force,
        authSessionSeq,
      });
      const next = await applyStatus(snapshot);
      const anyTypeResetInFlight = CODING_PLAN_QUOTA_RESET_TYPES.some((resetType) => {
        const key = entryKeyForType(resetType);
        const entry = next[key];
        const previousEntry = previous[key];
        const justCompleted =
          entry?.status === "completed" &&
          entry.completedAt !== null &&
          entry.completedAt !== previousEntry?.completedAt;
        return (
          entry?.status === "processing" || previousEntry?.status === "processing" || justCompleted
        );
      });
      if (anyTypeResetInFlight) {
        return next;
      }

      try {
        const result = await requestCodingPlanResetOpportunityWhenDue({
          service: usageStatsService,
          authSessionSeq,
          scope,
        });
        if (result === null) {
          return next;
        }
        if (!result.granted) {
          return next;
        }
        const confirmedSnapshot = await requestCodingPlanResetStatus({
          service: usageStatsService,
          scope,
          force: true,
          authSessionSeq,
        });
        return applyStatus(confirmedSnapshot);
      } catch (error) {
        logger.warn("[coding-plan-reset] opportunity request failed", {
          sourceKey,
          error: toErrorMessage(error),
        });
        return next;
      }
    },
    [applyStatus, authSessionSeq, enabled, scope, sourceKey, usageStatsService],
  );

  useEffect(() => {
    if (!enabled || !usageStatsService || !scope) {
      return;
    }
    return subscribeCodingPlanQuotaResetPolling({
      service: usageStatsService,
      authSessionSeq,
      scope,
      refresh: () => refreshStatus(false),
    });
  }, [authSessionSeq, enabled, refreshStatus, scope, usageStatsService]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const nowMs = Date.now();
    setNow(nowMs);
    const anyUsable =
      hasUsableCodingPlanQuotaResetOpportunity(fiveHourEntry, nowMs) ||
      hasUsableCodingPlanQuotaResetOpportunity(weekEntry, nowMs);
    if (!anyUsable) {
      return;
    }
    const ticker = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(ticker);
  }, [enabled, fiveHourEntry, weekEntry]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const completed = [fiveHourEntry, weekEntry].filter(
      (candidate): candidate is CodingPlanQuotaResetUiEntry =>
        candidate?.status === "completed" && candidate.observedAt !== null,
    );
    if (completed.length === 0) {
      return;
    }
    const nowMs = Date.now();
    const nextBoundary = completed
      .map((entry) => (entry.observedAt ?? 0) + CODING_PLAN_QUOTA_RESET_DONE_DISPLAY_MS)
      .filter((boundary) => boundary > nowMs)
      .sort((left, right) => left - right)[0];
    if (nextBoundary === undefined) {
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), nextBoundary - nowMs);
    return () => window.clearTimeout(timer);
  }, [enabled, fiveHourEntry, weekEntry, now]);

  const reset = useCallback(
    async (resetType: CodingPlanResetType) => {
      if (!enabled || !sourceKey || !usageStatsService || !scope) {
        return;
      }
      const key = entryKeyForType(resetType);
      if (!hasUsableCodingPlanQuotaResetOpportunity(entriesRef.current[key], Date.now())) {
        return;
      }
      const priorAttempt = manualResetAttemptByService
        .get(usageStatsService)
        ?.get(buildManualAttemptKey(scope, resetType));
      if (priorAttempt) {
        const reconciled = await refreshStatus(true);
        if (
          priorAttempt.completedAt === null ||
          !hasUsableCodingPlanQuotaResetOpportunity(reconciled[key], Date.now())
        ) {
          return;
        }
      }
      const current = entriesRef.current[key];
      const startedAt = Date.now();
      if (!current || !hasUsableCodingPlanQuotaResetOpportunity(current, startedAt)) {
        return;
      }
      const idempotencyKey = current.idempotencyKey ?? createIdempotencyKey();
      const processing = startCodingPlanQuotaResetManualUse(current, idempotencyKey, startedAt);
      if (!processing) {
        return;
      }
      startSharedManualResetAttempt({
        service: usageStatsService,
        scope,
        startedAt,
        resetType,
        authSessionSeq,
      });
      entriesRef.current = withEntry(entriesRef.current, resetType, processing);
      setEntry(sourceKey, resetType, processing, authSessionSeq);

      let useAccepted = false;
      try {
        await usageStatsService.useCodingPlanReset({
          ...scope,
          idempotencyKey,
          resetType,
        });
        useAccepted = true;

        for (const delayMs of USE_STATUS_RETRY_DELAYS_MS) {
          await wait(delayMs);
          const confirmed = await refreshStatus(true);
          if (confirmed[key]?.status === "completed") {
            return;
          }
        }
        throw new Error("coding_plan_reset_status_not_confirmed");
      } catch (error) {
        if (!useAccepted) {
          clearSharedManualResetAttempt(usageStatsService, scope, resetType);
        }
        const message = toErrorMessage(error);
        const failed = failCodingPlanQuotaResetManualUse(entriesRef.current[key], message);
        entriesRef.current = withEntry(entriesRef.current, resetType, failed);
        setEntry(sourceKey, resetType, failed, authSessionSeq);
        logger.warn("[coding-plan-reset] manual reset failed", {
          sourceKey,
          resetType,
          error: message,
        });
        toast(intl.formatMessage({ id: "codingPlan.quotaReset.failed" }), {
          variant: "warning",
        });
        throw error;
      }
    },
    [authSessionSeq, enabled, intl, refreshStatus, scope, setEntry, sourceKey, usageStatsService],
  );

  const resetFiveHour = useCallback(() => reset("FIVE_HOUR"), [reset]);
  const resetWeek = useCallback(() => reset("WEEK"), [reset]);
  const reserveAutomaticCompletion = useCallback(
    async (
      resetType: CodingPlanResetType,
      completedAt: number,
    ): Promise<CodingPlanQuotaResetAutoPlayReservationAttempt> => {
      if (!enabled || !sourceKey) {
        return { status: "blocked" };
      }
      try {
        return await reserveAutoPlay(sourceKey, resetType, completedAt);
      } catch (error) {
        logger.warn("[coding-plan-reset] autoplay reservation failed", {
          sourceKey,
          resetType,
          completedAt,
          error: toErrorMessage(error),
        });
        return { status: "retry", retryAfterMs: 500 };
      }
    },
    [enabled, reserveAutoPlay, sourceKey],
  );

  const commitAutomaticCompletion = useCallback(
    (reservation: CodingPlanQuotaResetAutoPlayReservation): boolean => commitAutoPlay(reservation),
    [commitAutoPlay],
  );

  const releaseAutomaticCompletion = useCallback(
    async (reservation: CodingPlanQuotaResetAutoPlayReservation): Promise<void> => {
      try {
        await releaseAutoPlay(reservation);
      } catch (error) {
        logger.warn("[coding-plan-reset] autoplay reservation release failed", {
          sourceKey: reservation.sourceKey,
          resetType: reservation.resetType,
          completedAt: reservation.completedAt,
          error: toErrorMessage(error),
        });
      }
    },
    [releaseAutoPlay],
  );

  const buildTypeController = (
    entry: CodingPlanQuotaResetUiEntry | null,
    resetFn: () => Promise<void>,
  ): CodingPlanQuotaResetTypeController => ({
    entry,
    opportunityVisible: hasUsableCodingPlanQuotaResetOpportunity(entry, now),
    processing: entry?.status === "processing",
    done: entry?.status === "completed",
    statusVisible: enabled && resolveCodingPlanQuotaResetStatusVisible(entry, now),
    reset: resetFn,
  });

  return {
    enabled,
    ...buildTypeController(fiveHourEntry, resetFiveHour),
    week: buildTypeController(weekEntry, resetWeek),
    reserveAutomaticCompletion,
    commitAutomaticCompletion,
    releaseAutomaticCompletion,
  };
}
