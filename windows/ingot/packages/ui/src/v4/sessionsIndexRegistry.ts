import type { ICfAgentService } from "@origin-ai/cf-services";
import { logger } from "@/logger.js";
import { remoteAgentServiceGeneration } from "@/lib/remoteAgentServiceGeneration.js";
import { findRemoteWorkspaceSessionIdForAgentService } from "@/store/remoteWorkspaceSessionStore.js";
import { createAgentSessionsIndexTransport } from "@/v4/agentSessionsIndexTransport.js";
import { SessionsIndexStore } from "@/v4/sessionsIndexStore.js";

export type SessionsIndexAgentService = Pick<
  ICfAgentService,
  | "subscribeSessionsIndexV4"
  | "resyncSessionsIndexV4"
  | "helloConversationV4"
  | "initializeConversationV4"
  | "unsubscribeSessionsIndexV4"
  | "onDynamicSessionsIndexFrame"
  | "onAgentRuntimeRestarted"
>;

interface RegistryEntry {
  key: string;
  agentService: SessionsIndexAgentService;
  agentServiceGeneration: number;
  store: SessionsIndexStore;
  refCount: number;
}

const registry = new Map<string, RegistryEntry>();
const entriesByStore = new WeakMap<SessionsIndexStore, RegistryEntry>();

const reportedScopeEndpointMismatches = new Set<string>();

export const LOCAL_SESSIONS_INDEX_ENDPOINT = "__base__";

export interface SessionsIndexScope {
  
  workspaceKey: string;
  workspacePath: string;
  workspaceIdentity?: string;
  
  endpointKey?: string;
}

function reportScopeEndpointMismatch(
  scope: SessionsIndexScope,
  agentService: SessionsIndexAgentService,
): void {
  const remoteSessionId = findRemoteWorkspaceSessionIdForAgentService(agentService);
  if (!remoteSessionId) return;
  const endpointKey = scope.endpointKey ?? LOCAL_SESSIONS_INDEX_ENDPOINT;
  if (endpointKey === remoteSessionId) return;
  const reportKey = `${endpointKey}\0${scope.workspaceKey}\0${remoteSessionId}`;
  if (reportedScopeEndpointMismatches.has(reportKey)) return;
  reportedScopeEndpointMismatches.add(reportKey);
  logger.lifecycle.warn("[v4-sessions-index] Scope endpoint does not match remote proxy affiliation", {
    event: "v4.sessions_index.scope_endpoint_mismatch",
    endpointKey,
    remoteSessionId,
    workspaceKey: scope.workspaceKey,
    workspacePath: scope.workspacePath,
  });
}

export function resetSessionsIndexScopeEndpointMismatchReportsForTest(): void {
  reportedScopeEndpointMismatches.clear();
}

function createSessionsIndexTransport(
  scope: SessionsIndexScope,
  agentService: SessionsIndexAgentService,
) {
  const workspaceIdentity = scope.workspaceIdentity?.trim();
  return createAgentSessionsIndexTransport(agentService, {
    workspacePath: scope.workspacePath,
    ...(workspaceIdentity ? { workspaceIdentity } : {}),
  });
}

export function buildSessionsIndexEntryKey(
  scope: Pick<SessionsIndexScope, "workspaceKey" | "endpointKey">,
  agentService?: SessionsIndexAgentService,
): string {
  const entryKey = `${scope.endpointKey ?? LOCAL_SESSIONS_INDEX_ENDPOINT}\0${scope.workspaceKey}`;
  return agentService
    ? `${entryKey}\0service-generation:${remoteAgentServiceGeneration(agentService)}`
    : entryKey;
}

export function acquireSessionsIndex(
  scope: SessionsIndexScope,
  agentService: SessionsIndexAgentService,
): SessionsIndexStore {
  reportScopeEndpointMismatch(scope, agentService);
  const entryKey = buildSessionsIndexEntryKey(scope);
  const incomingServiceGeneration = remoteAgentServiceGeneration(agentService);
  const existing = registry.get(entryKey);
  if (existing?.agentService === agentService) {
    existing.refCount += 1;
    return existing.store;
  }
  if (
    existing &&
    (scope.endpointKey ?? LOCAL_SESSIONS_INDEX_ENDPOINT) !== LOCAL_SESSIONS_INDEX_ENDPOINT
  ) {
    existing.refCount += 1;
    if (incomingServiceGeneration > existing.agentServiceGeneration) {
      existing.agentService = agentService;
      existing.agentServiceGeneration = incomingServiceGeneration;
      const transport = createSessionsIndexTransport(scope, agentService);
      void existing.store.replaceTransport(transport).catch((error) => {
        logger.warn("[v4-sessions-index] remote transport replacement failed", error);
      });
    }
    return existing.store;
  }
  if (existing) {
    registry.delete(entryKey);
    if (existing.refCount <= 0) {
      existing.store.close();
      entriesByStore.delete(existing.store);
    }
  }
  const store = new SessionsIndexStore();
  const transport = createSessionsIndexTransport(scope, agentService);
  void store.connect(transport, { forceSnapshot: true });
  const entry: RegistryEntry = {
    key: entryKey,
    agentService,
    agentServiceGeneration: incomingServiceGeneration,
    store,
    refCount: 1,
  };
  registry.set(entryKey, entry);
  entriesByStore.set(store, entry);
  return store;
}

export function releaseSessionsIndex(
  scope: Pick<SessionsIndexScope, "workspaceKey" | "endpointKey">,
  store: SessionsIndexStore,
): void {
  const entryKey = buildSessionsIndexEntryKey(scope);
  const entry = entriesByStore.get(store);
  if (!entry || entry.key !== entryKey) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    entry.store.close();
    entriesByStore.delete(entry.store);
    if (registry.get(entryKey) === entry) registry.delete(entryKey);
  }
}

export function sessionsIndexRegistrySize(): number {
  return registry.size;
}
