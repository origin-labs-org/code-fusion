
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  UsageEntitlementSnapshot,
  CfAccountAccess,
  CfProviderAccountAccess,
} from "@origin-ai/cf-shared";
import type { IUsageStatsService } from "@origin-ai/cf-services";
import { useOptionalBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useStableAccountAccess } from "@/hooks/useStableAccountAccess.js";
import { useCfStoreWithDefault } from "@/store/StoreProvider.js";
import { logger } from "@/logger.js";
import {
  readCachedUsageEntitlementSnapshot,
  writeCachedUsageEntitlementSnapshot,
} from "@/lib/usageEntitlementCache.js";
import {
  hasSharedEntitlementFailure,
  buildEntitlementFreshnessKey,
  beginSharedEntitlementRequest,
  publishSharedEntitlementSnapshot,
  readSharedEntitlementSnapshot,
  recordSharedEntitlementAccess,
  recordSharedEntitlementFailure,
  shouldDeferSharedEntitlementRefresh,
  shouldDeferSharedEntitlementAccess,
  shouldUseSharedEntitlementSnapshot,
  subscribeSharedEntitlementSnapshot,
  USAGE_ENTITLEMENT_ACCESS_REFRESH_MS,
  type UsageEntitlementRefreshReason,
  type UsageEntitlementRequestOptions,
} from "@/lib/usageEntitlementRefreshPolicy.js";

interface UsageEntitlementState {
  snapshot: UsageEntitlementSnapshot | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: UsageEntitlementState = {
  snapshot: null,
  loading: false,
  error: null,
};

export const USAGE_ENTITLEMENT_REFRESH_TIMEOUT_MS = 20_000;

export interface UsageEntitlementRefreshOptions {
  silent?: boolean;
  force?: boolean;
  reason?: UsageEntitlementRefreshReason;
}

const entitlementInflightRequests = new WeakMap<
  IUsageStatsService,
  Map<string, Promise<UsageEntitlementSnapshot>>
>();

function getSharedEntitlementSnapshot(params: {
  usageStatsService: IUsageStatsService;
  options: UsageEntitlementRequestOptions;
  requestKey: string;
}): Promise<UsageEntitlementSnapshot> {
  let serviceRequests = entitlementInflightRequests.get(params.usageStatsService);
  if (!serviceRequests) {
    serviceRequests = new Map();
    entitlementInflightRequests.set(params.usageStatsService, serviceRequests);
  }

  const requestKey = params.requestKey;
  const inflight = serviceRequests.get(requestKey);
  if (inflight) {
    return inflight;
  }

  const upstreamRequest = params.usageStatsService.getEntitlementSnapshot({
    ...(params.options.invalidateBalanceCache ? { invalidateBalanceCache: true } : {}),
    includeSubscription: params.options.includeSubscription,
    preferredProviderId: params.options.preferredProviderId,
    accountAccess: params.options.accountAccess,
    allowDisabledPreferredProvider: params.options.allowDisabledPreferredProvider,
    requirePreferredProvider: params.options.requirePreferredProvider,
    allowEnvApiKey: params.options.allowEnvApiKey,
  });
  const request = withUsageEntitlementTimeout(upstreamRequest).finally(() => {
    if (serviceRequests.get(requestKey) !== request) {
      return;
    }
    serviceRequests.delete(requestKey);
    if (serviceRequests.size === 0) {
      entitlementInflightRequests.delete(params.usageStatsService);
    }
  });
  serviceRequests.set(requestKey, request);
  return request;
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

function createUsageEntitlementTimeoutError(timeoutMs: number): Error {
  return new Error(`usage_entitlement_request_timeout:${timeoutMs}`);
}

export function withUsageEntitlementTimeout<T>(
  request: Promise<T>,
  timeoutMs = USAGE_ENTITLEMENT_REFRESH_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(createUsageEntitlementTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([request, timeout]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

export interface UseUsageEntitlementOptions {
  enabled?: boolean;
  includeSubscription?: boolean;
  preferredProviderId?: string;
  accountAccess?: CfProviderAccountAccess | CfAccountAccess;
  allowDisabledPreferredProvider?: boolean;
  requirePreferredProvider?: boolean;
  allowEnvApiKey?: boolean;
  cacheKey?: string;
  refreshOnMount?: boolean;
  mountRefreshReason?: "initial" | "access";
}

export function useUsageEntitlement(options: UseUsageEntitlementOptions = {}) {
  const services = useOptionalBaseWorkspaceServices();
  return useUsageEntitlementWithService(services?.usageStatsService, options);
}

export function useUsageEntitlementWithService(
  usageStatsService: IUsageStatsService | undefined,
  options: UseUsageEntitlementOptions = {},
) {
  const [state, setState] = useState<UsageEntitlementState>(INITIAL_STATE);
  const requestVersionRef = useRef(0);
  const activeFreshnessKeyRef = useRef<string | null>(null);
  const latestSnapshotRef = useRef<UsageEntitlementSnapshot | null>(null);
  const includeSubscription = options.includeSubscription ?? false;
  const preferredProviderId = options.preferredProviderId;
  const accountAccess = useStableAccountAccess(options.accountAccess);
  const allowDisabledPreferredProvider = options.allowDisabledPreferredProvider === true;
  const requirePreferredProvider = options.requirePreferredProvider === true;
  const allowEnvApiKey = options.allowEnvApiKey;
  const authScope = useCfStoreWithDefault(
    (store) => (store.user ? `${store.user.id}:${store.authSessionSeq}` : "signed-out"),
    "unscoped",
  );
  const enabled =
    (options.enabled ?? true) && Boolean(usageStatsService) && authScope !== "signed-out";
  const suppliedCacheKey = options.cacheKey?.trim() ?? "";
  const freshnessCacheKey =
    authScope === "unscoped" ? suppliedCacheKey : `${suppliedCacheKey}:auth:${authScope}`;
  const cacheKey = suppliedCacheKey ? freshnessCacheKey : "";
  const refreshOnMount = options.refreshOnMount ?? false;
  const mountRefreshReason = options.mountRefreshReason ?? "initial";
  const requestOptions = useMemo(
    () =>
      ({
        includeSubscription,
        preferredProviderId,
        accountAccess,
        allowDisabledPreferredProvider,
        requirePreferredProvider,
        allowEnvApiKey,
      }) satisfies UsageEntitlementRequestOptions,
    [
      allowDisabledPreferredProvider,
      accountAccess,
      allowEnvApiKey,
      includeSubscription,
      preferredProviderId,
      requirePreferredProvider,
    ],
  );
  const freshnessKey = useMemo(
    () =>
      buildEntitlementFreshnessKey({
        cacheKey: freshnessCacheKey,
        options: requestOptions,
      }),
    [freshnessCacheKey, requestOptions],
  );

  const requestScope = useMemo(() => ({}), [usageStatsService, enabled, freshnessKey]);
  const currentRequestScope = useRef<object | null>(requestScope);
  currentRequestScope.current = requestScope;
  useEffect(() => {
    currentRequestScope.current = requestScope;
    return () => {
      if (currentRequestScope.current === requestScope) currentRequestScope.current = null;
    };
  }, [requestScope]);

  const refresh = useCallback(
    async (refreshOptions: UsageEntitlementRefreshOptions = {}) => {
      if (!enabled || !usageStatsService || currentRequestScope.current !== requestScope) {
        return;
      }
      const reason = refreshOptions.reason ?? "manual";
      const sharedSnapshot =
        refreshOptions.force === true
          ? null
          : reason === "initial"
            ? shouldUseSharedEntitlementSnapshot({
                freshnessKey,
                intervalMs: Number.POSITIVE_INFINITY,
                now: Date.now(),
                usageStatsService,
              })
            : reason === "access"
              ? shouldUseSharedEntitlementSnapshot({
                  freshnessKey,
                  intervalMs: USAGE_ENTITLEMENT_ACCESS_REFRESH_MS,
                  now: Date.now(),
                  usageStatsService,
                })
              : null;
      if (sharedSnapshot) {
        setState({
          snapshot: sharedSnapshot,
          loading: false,
          error: null,
        });
        latestSnapshotRef.current = sharedSnapshot;
        return;
      }
      if (
        refreshOptions.force !== true &&
        reason === "access" &&
        shouldDeferSharedEntitlementAccess({
          freshnessKey,
          now: Date.now(),
          usageStatsService,
        })
      ) {
        setState((current) => ({ ...current, loading: false }));
        return;
      }
      if (
        refreshOptions.force !== true &&
        (reason === "initial" || reason === "access") &&
        shouldDeferSharedEntitlementRefresh({
          freshnessKey,
          now: Date.now(),
          usageStatsService,
        })
      ) {
        setState((current) => ({
          ...current,
          loading: false,
        }));
        return;
      }

      const sharedRequest = beginSharedEntitlementRequest({
        usageStatsService,
        freshnessKey,
        invalidate: reason === "purchase",
      });
      const requestVersion = requestVersionRef.current + 1;
      requestVersionRef.current = requestVersion;
      if (reason === "access") {
        recordSharedEntitlementAccess({
          freshnessKey,
          now: Date.now(),
          usageStatsService,
        });
      }
      logger.debug("[useUsageEntitlement] Starting to read entitlement info", {
        reason,
        includeSubscription,
        preferredProviderId,
        accountAccess,
        cacheKey,
        freshnessKey,
      });
      setState((current) => ({
        snapshot: current.snapshot,
        loading: refreshOptions.silent && current.snapshot ? false : true,
        error: null,
      }));

      try {
        const snapshot = await getSharedEntitlementSnapshot({
          usageStatsService,
          requestKey: sharedRequest.requestKey,
          options:
            reason === "purchase"
              ? { ...requestOptions, invalidateBalanceCache: true }
              : requestOptions,
        });
        if (
          currentRequestScope.current !== requestScope ||
          requestVersionRef.current !== requestVersion ||
          !sharedRequest.isCurrent()
        ) {
          return;
        }
        publishSharedEntitlementSnapshot({
          usageStatsService,
          freshnessKey,
          snapshot,
        });
        logger.debug("[useUsageEntitlement] Entitlement info updated", {
          reason,
          providerId: snapshot.provider?.id ?? null,
          scope: snapshot.context?.scope ?? null,
          organizationId: snapshot.context?.organizationId ?? null,
          projectId: snapshot.context?.projectId ?? null,
          cacheKey,
          freshnessKey,
        });
        latestSnapshotRef.current = snapshot;
        setState({
          snapshot,
          loading: false,
          error: null,
        });
        writeCachedUsageEntitlementSnapshot({ cacheKey, snapshot });
      } catch (error) {
        if (
          currentRequestScope.current !== requestScope ||
          requestVersionRef.current !== requestVersion ||
          !sharedRequest.isCurrent()
        ) {
          return;
        }
        recordSharedEntitlementFailure({
          usageStatsService,
          freshnessKey,
        });
        const message = getErrorMessage(error);
        logger.warn("[useUsageEntitlement] Failed to read entitlement info", {
          includeSubscription,
          error: message,
        });
        if (
          !latestSnapshotRef.current?.subscription?.details.length &&
          !(refreshOptions.silent && latestSnapshotRef.current)
        ) {
          latestSnapshotRef.current = null;
        }
        setState((current) => {
          if (
            current.snapshot &&
            (refreshOptions.silent || current.snapshot.subscription?.details.length)
          ) {
            return {
              snapshot: current.snapshot,
              loading: false,
              error: message,
            };
          }
          return {
            snapshot: null,
            loading: false,
            error: message,
          };
        });
      }
    },
    [cacheKey, enabled, freshnessKey, requestOptions, usageStatsService, requestScope],
  );

  useEffect(() => {
    if (!enabled || !usageStatsService) {
      return;
    }
    return subscribeSharedEntitlementSnapshot({
      usageStatsService,
      freshnessKey,
      listener: (snapshot, error) => {
        if (currentRequestScope.current !== requestScope) return;
        latestSnapshotRef.current = snapshot;
        setState({
          snapshot,
          loading: false,
          error: error ?? null,
        });
      },
    });
  }, [enabled, freshnessKey, usageStatsService, requestScope]);

  useEffect(() => {
    if (!enabled) {
      setState({
        snapshot: null,
        loading: false,
        error: null,
      });
      activeFreshnessKeyRef.current = null;
      latestSnapshotRef.current = null;
      return;
    }

    const freshnessKeyChanged = activeFreshnessKeyRef.current !== freshnessKey;
    if (freshnessKeyChanged) {
      requestVersionRef.current += 1;
      activeFreshnessKeyRef.current = freshnessKey;
      latestSnapshotRef.current = null;
      setState(INITIAL_STATE);
    }

    const cachedSnapshot = readCachedUsageEntitlementSnapshot({ cacheKey });
    const sharedSnapshot = usageStatsService
      ? readSharedEntitlementSnapshot({ usageStatsService, freshnessKey })
      : null;
    const initialSnapshot = sharedSnapshot ?? cachedSnapshot;
    if (initialSnapshot) {
      setState({
        snapshot: initialSnapshot,
        loading: false,
        error:
          usageStatsService && hasSharedEntitlementFailure({ usageStatsService, freshnessKey })
            ? "usage_entitlement_refresh_failed"
            : null,
      });
      latestSnapshotRef.current = initialSnapshot;
    }

    if (refreshOnMount) {
      void refresh({
        silent: Boolean(initialSnapshot),
        force: mountRefreshReason === "initial" && !initialSnapshot,
        reason: mountRefreshReason,
      });
    }
  }, [
    cacheKey,
    enabled,
    freshnessKey,
    refresh,
    refreshOnMount,
    mountRefreshReason,
    usageStatsService,
  ]);

  return {
    snapshot: enabled && activeFreshnessKeyRef.current === freshnessKey ? state.snapshot : null,
    loading: enabled && state.loading,
    error: enabled && activeFreshnessKeyRef.current === freshnessKey ? state.error : null,
    refresh,
  };
}
