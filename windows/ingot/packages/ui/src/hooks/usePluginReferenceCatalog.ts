import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CfPluginReferenceCatalogEntry,
  CfPluginsReferenceCatalogResult,
} from "@origin-ai/cf-shared";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { logger } from "@/logger.js";

export interface PluginReferenceCatalogState {
  entries: CfPluginReferenceCatalogEntry[];
  authority: "session" | "workspace" | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: PluginReferenceCatalogState = {
  entries: [],
  authority: null,
  loading: false,
  error: null,
};

interface ScopedPluginReferenceCatalogState {
  scope: object | null;
  value: PluginReferenceCatalogState;
}

const EMPTY_SCOPED_STATE: ScopedPluginReferenceCatalogState = {
  scope: null,
  value: EMPTY_STATE,
};

export interface PluginReferenceCatalogOptions {
  preferredRemoteSessionId?: string;
  
  refreshRevision?: number;
  
  dedupeSessionRequest?: boolean;
  suppressErrorLog?: boolean;
}

let sessionCatalogRequests = new WeakMap<
  object,
  Map<string, Promise<CfPluginsReferenceCatalogResult>>
>();

export function clearPluginReferenceCatalogCacheForTest(): void {
  sessionCatalogRequests = new WeakMap();
}

function releaseSessionCatalogRequest(
  services: object,
  serviceCache: Map<string, Promise<CfPluginsReferenceCatalogResult>>,
  requestKey: string,
  request: Promise<CfPluginsReferenceCatalogResult>,
): void {
  if (serviceCache.get(requestKey) !== request) return;
  serviceCache.delete(requestKey);
  if (serviceCache.size === 0) {
    sessionCatalogRequests.delete(services);
  }
}

function releaseSessionCatalogRequestWhenSettled(
  services: object,
  serviceCache: Map<string, Promise<CfPluginsReferenceCatalogResult>>,
  requestKey: string,
  request: Promise<CfPluginsReferenceCatalogResult>,
): void {
  const release = () => releaseSessionCatalogRequest(services, serviceCache, requestKey, request);
  void request.then(release, release);
}

export function usePluginReferenceCatalog(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  sessionId: string | null,
  enabled: boolean,
  options?: PluginReferenceCatalogOptions,
): PluginReferenceCatalogState {
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    options?.preferredRemoteSessionId,
    workspaceIdentity,
  );
  const [scopedState, setScopedState] =
    useState<ScopedPluginReferenceCatalogState>(EMPTY_SCOPED_STATE);
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const requestSeqRef = useRef(0);
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const remoteSessionId =
    resolution.remoteSessionId ?? options?.preferredRemoteSessionId ?? undefined;
  const requestKey = `${workspaceKey}|${remoteSessionId ?? "local"}|${sessionId ?? "draft"}|runtime:${runtimeRevision}|refresh:${options?.refreshRevision ?? 0}`;
  const services = resolution.services;
  const rpcReady = resolution.rpcReady;

  useEffect(() => {
    if (!enabled || !workspacePath || !sessionId || !rpcReady) return;
    const subscription = services.cfAgentService.onAgentRuntimeRestarted((event) => {
      if (event.workspaceKey !== workspaceKey) return;
      setRuntimeRevision((current) => current + 1);
    });
    return () => subscription.dispose();
  }, [enabled, rpcReady, services, sessionId, workspaceKey, workspacePath]);
  const requestScope = useMemo(
    () => ({}),
    [enabled, remoteSessionId, requestKey, rpcReady, services, workspacePath],
  );

  useEffect(() => {
    if (!enabled || !workspacePath || !rpcReady) {
      return;
    }
    const seq = ++requestSeqRef.current;
    let cancelled = false;
    setScopedState({
      scope: requestScope,
      value: { entries: [], authority: null, loading: true, error: null },
    });
    const params = {
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
    let request: Promise<CfPluginsReferenceCatalogResult>;
    let requestServiceCache: Map<string, Promise<CfPluginsReferenceCatalogResult>> | undefined;
    if (options?.dedupeSessionRequest && sessionId) {
      let serviceCache = sessionCatalogRequests.get(services);
      if (!serviceCache) {
        serviceCache = new Map();
        sessionCatalogRequests.set(services, serviceCache);
      }
      const cached = serviceCache.get(requestKey);
      request = cached ?? services.pluginManagementService.getPluginReferenceCatalog(params);
      requestServiceCache = serviceCache;
      if (!cached) {
        serviceCache.set(requestKey, request);
        releaseSessionCatalogRequestWhenSettled(services, serviceCache, requestKey, request);
      }
    } else {
      request = services.pluginManagementService.getPluginReferenceCatalog(params);
    }
    request
      .then((result) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        setScopedState({
          scope: requestScope,
          value: {
            entries: result.plugins,
            authority: result.authority,
            loading: false,
            error: null,
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        if (!options?.suppressErrorLog) {
          logger.warn("[usePluginReferenceCatalog] 拉取 Plugin 引用 catalog 失败", {
            error: message,
            requestKey,
          });
        }
        setScopedState({
          scope: requestScope,
          value: {
            entries: [],
            authority: null,
            loading: false,
            error: message,
          },
        });
      });
    return () => {
      cancelled = true;
      if (requestServiceCache) {
        releaseSessionCatalogRequest(services, requestServiceCache, requestKey, request);
      }
    };
  }, [
    enabled,
    options?.dedupeSessionRequest,
    options?.suppressErrorLog,
    remoteSessionId,
    requestKey,
    requestScope,
    rpcReady,
    services,
    sessionId,
    workspaceIdentity,
    workspacePath,
  ]);

  if (!enabled || !workspacePath || !rpcReady || scopedState.scope !== requestScope) {
    return EMPTY_STATE;
  }
  return scopedState.value;
}
