import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppUsageRange,
  AppUsageSnapshot,
  CodingPlanUsageRange,
  CodingPlanUsageSnapshot,
  UsageStatsRange,
  UsageStatsSnapshot,
  CfAccountAccess,
  CfProviderAccountAccess,
} from "@origin-ai/cf-shared";
import { logger } from "@/logger.js";
import { useServices } from "@/hooks/useServices.js";
import { useStableAccountAccess } from "@/hooks/useStableAccountAccess.js";
import { USAGE_ENTITLEMENT_ACCESS_REFRESH_MS } from "@/lib/usageEntitlementRefreshPolicy.js";

interface UsageStatsState {
  snapshot: UsageStatsSnapshot | null;
  loading: boolean;
  error: string | null;
}

interface AppUsageStatsState {
  snapshot: AppUsageSnapshot | null;
  loading: boolean;
  error: string | null;
}

interface CodingPlanUsageStatsState {
  snapshot: CodingPlanUsageSnapshot | null;
  loading: boolean;
  error: string | null;
}

interface CodingPlanUsageCacheEntry {
  snapshot: CodingPlanUsageSnapshot | null;
  requestedAt: number | null;
  inFlight?: Promise<CodingPlanUsageSnapshot>;
}

const codingPlanUsageAccessCache = new WeakMap<object, Map<string, CodingPlanUsageCacheEntry>>();

export function shouldRefreshCodingPlanUsageOnAccess(params: {
  lastUpdatedAt: number | null;
  now: number;
}): boolean {
  return (
    params.lastUpdatedAt === null ||
    params.now - params.lastUpdatedAt >= USAGE_ENTITLEMENT_ACCESS_REFRESH_MS
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || String(error);
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return String(error);
}

const INITIAL_STATE: UsageStatsState = {
  snapshot: null,
  loading: false,
  error: null,
};

export function useUsageStats(
  range: UsageStatsRange,
  options: {
    dataSource?: "local" | "monitor";
    enabled?: boolean;
    preferredProviderId?: string;
    accountAccess?: CfProviderAccountAccess | CfAccountAccess;
    requirePreferredProvider?: boolean;
    allowEnvApiKey?: boolean;
  } = {},
) {
  const { usageStatsService } = useServices();
  const [state, setState] = useState<UsageStatsState>(INITIAL_STATE);
  const requestVersionRef = useRef(0);
  const dataSource = options.dataSource;
  const enabled = options.enabled ?? true;
  const preferredProviderId = options.preferredProviderId;
  const accountAccess = useStableAccountAccess(options.accountAccess);
  const requirePreferredProvider = options.requirePreferredProvider === true;
  const allowEnvApiKey = options.allowEnvApiKey;
  const requestScope = [
    dataSource ?? "",
    preferredProviderId ?? "",
    JSON.stringify(accountAccess ?? null),
    requirePreferredProvider ? "strict" : "relaxed",
    allowEnvApiKey === false ? "no-env" : "env",
  ].join("|");
  const lastRequestScopeRef = useRef(requestScope);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const keepPreviousSnapshot = lastRequestScopeRef.current === requestScope;
    lastRequestScopeRef.current = requestScope;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    setState((current) => ({
      snapshot: keepPreviousSnapshot ? current.snapshot : null,
      loading: true,
      error: null,
    }));

    try {
      const snapshot = await usageStatsService.getSnapshot({
        range,
        dataSource,
        preferredProviderId,
        accountAccess,
        requirePreferredProvider,
        allowEnvApiKey,
        timeZone,
      });
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setState({
        snapshot,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      const message = getErrorMessage(error);
      logger.warn("[useUsageStats] 读取 usage 统计失败", {
        dataSource,
        range,
        preferredProviderId,
        timeZone,
        error: message,
      });
      setState((current) => ({
        snapshot: lastRequestScopeRef.current === requestScope ? current.snapshot : null,
        loading: false,
        error: message,
      }));
    }
  }, [
    accountAccess,
    allowEnvApiKey,
    dataSource,
    enabled,
    preferredProviderId,
    range,
    requestScope,
    requirePreferredProvider,
    usageStatsService,
  ]);

  useEffect(() => {
    if (!enabled) {
      setState({
        snapshot: null,
        loading: false,
        error: null,
      });
      return;
    }

    void refresh();
  }, [enabled, refresh]);

  return {
    snapshot: state.snapshot,
    loading: state.loading,
    error: state.error,
    refresh,
  };
}

export function useAppUsageStats(range: AppUsageRange) {
  const { usageStatsService } = useServices();
  const [state, setState] = useState<AppUsageStatsState>({
    snapshot: null,
    loading: false,
    error: null,
  });
  const requestVersionRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setState((current) => ({
      snapshot: current.snapshot,
      loading: true,
      error: null,
    }));
    try {
      const snapshot = await usageStatsService.getAppUsageSnapshot({
        range,
        timeZone,
      });
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      setState({ snapshot, loading: false, error: null });
    } catch (error) {
      if (requestVersionRef.current !== requestVersion) {
        return;
      }
      const message = getErrorMessage(error);
      logger.warn("[useAppUsageStats] 读取本地使用统计失败", {
        range,
        timeZone,
        error: message,
      });
      setState((current) => ({
        snapshot: current.snapshot,
        loading: false,
        error: message,
      }));
    }
  }, [range, usageStatsService]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}

export function useCodingPlanUsageStats(
  range: CodingPlanUsageRange,
  options: {
    enabled?: boolean;
    preferredProviderId?: string;
    accountAccess?: CfProviderAccountAccess | CfAccountAccess;
    customStartDate?: string | null;
    customEndDate?: string | null;
  },
) {
  const { usageStatsService } = useServices();
  const requestScopeKey = [
    range,
    options.preferredProviderId ?? "",
    JSON.stringify(options.accountAccess ?? null),
    options.customStartDate?.trim() ?? "",
    options.customEndDate?.trim() ?? "",
  ].join("\0");
  const cachedUsage = codingPlanUsageAccessCache.get(usageStatsService)?.get(requestScopeKey);
  const [state, setState] = useState<CodingPlanUsageStatsState>({
    snapshot: cachedUsage?.snapshot ?? null,
    loading: false,
    error: null,
  });
  const latestSnapshotRef = useRef<CodingPlanUsageSnapshot | null>(cachedUsage?.snapshot ?? null);
  const requestVersionRef = useRef(0);
  const enabled = options.enabled ?? true;
  const preferredProviderId = options.preferredProviderId;
  const accountAccess = useStableAccountAccess(options.accountAccess);
  const customStartDate = options.customStartDate?.trim() || null;
  const customEndDate = options.customEndDate?.trim() || null;
  const requestIdentityKey = [
    preferredProviderId ?? "",
    JSON.stringify(accountAccess ?? null),
  ].join("\0");
  const lastRequestScopeKeyRef = useRef(requestIdentityKey);

  const refresh = useCallback(
    async (refreshOptions: { force?: boolean } = {}) => {
      if (!enabled || !preferredProviderId || !accountAccess) {
        latestSnapshotRef.current = null;
        setState({ snapshot: null, loading: false, error: null });
        return;
      }
      let serviceCache = codingPlanUsageAccessCache.get(usageStatsService);
      if (!serviceCache) {
        serviceCache = new Map();
        codingPlanUsageAccessCache.set(usageStatsService, serviceCache);
      }
      const cached = serviceCache.get(requestScopeKey);
      let request = cached?.inFlight;
      if (
        !request &&
        !refreshOptions.force &&
        cached?.snapshot &&
        !shouldRefreshCodingPlanUsageOnAccess({
          lastUpdatedAt: cached?.requestedAt ?? null,
          now: Date.now(),
        })
      ) {
        latestSnapshotRef.current = cached?.snapshot ?? null;
        setState({
          snapshot: cached?.snapshot ?? null,
          loading: false,
          error: null,
        });
        return;
      }
      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const keepPreviousSnapshot = lastRequestScopeKeyRef.current === requestIdentityKey;
      lastRequestScopeKeyRef.current = requestIdentityKey;
      if (!request || refreshOptions.force) {
        request = usageStatsService.getCodingPlanUsageSnapshot({
          range,
          customStartDate,
          customEndDate,
          preferredProviderId,
          accountAccess,
          timeZone,
        });
        serviceCache.set(requestScopeKey, {
          snapshot: cached?.snapshot ?? null,
          requestedAt: cached?.inFlight ? null : (cached?.requestedAt ?? null),
          inFlight: request,
        });
      }
      setState((current) => ({
        snapshot: keepPreviousSnapshot ? current.snapshot : null,
        loading: true,
        error: null,
      }));
      try {
        const snapshot = await request;
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        if (serviceCache.get(requestScopeKey)?.inFlight === request) {
          serviceCache.set(requestScopeKey, {
            snapshot,
            requestedAt: Date.now(),
          });
        }
        latestSnapshotRef.current = snapshot;
        setState({ snapshot, loading: false, error: null });
      } catch (error) {
        if (requestVersionRef.current !== requestVersion) {
          return;
        }
        const message = getErrorMessage(error);
        logger.warn("[useCodingPlanUsageStats] 读取 Coding Plan 使用统计失败", {
          range,
          preferredProviderId,
          timeZone,
          error: message,
        });
        if (serviceCache.get(requestScopeKey)?.inFlight === request) {
          serviceCache.delete(requestScopeKey);
        }
        latestSnapshotRef.current = null;
        setState({ snapshot: null, loading: false, error: message });
      }
    },
    [
      accountAccess,
      customEndDate,
      customStartDate,
      enabled,
      preferredProviderId,
      range,
      requestIdentityKey,
      requestScopeKey,
      usageStatsService,
    ],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}
