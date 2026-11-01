import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CfTaskMeta } from "@origin-ai/cf-shared";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { compareCfTaskListItems } from "@/lib/taskListOrdering.js";
import { mapSessionSummaryToTaskMeta } from "@/v4/mapSessionSummaryToTaskMeta.js";
import {
  buildTaskListItemIdentityKey,
  stabilizeTaskListItems,
} from "@/v4/taskListItemStabilization.js";
import {
  LOCAL_SESSIONS_INDEX_ENDPOINT,
  buildSessionsIndexEntryKey,
  type SessionsIndexAgentService,
  type SessionsIndexScope,
} from "@/v4/sessionsIndexRegistry.js";
import type { SessionsIndexStore } from "@/v4/sessionsIndexStore.js";
import {
  WorkspaceSessionsIndexSubscriptionSet,
  type WorkspaceSessionsIndexBinding,
} from "@/v4/workspaceSessionsIndexSubscriptionSet.js";

export interface WorkspaceSessionsIndexScope {
  workspacePath: string;
  workspaceIdentity?: string;
  
  endpointKey?: string;
  
  agentService?: SessionsIndexAgentService;
}

export interface WorkspaceSessionsIndexItemsResult {
  
  items: CfTaskMeta[];
  
  sourceRevisionByScopeKey: Readonly<Record<string, string>>;
  
  hydratingEndpointKeys: string[];
}

function workspaceKeyOf(scope: WorkspaceSessionsIndexScope): string {
  return scope.workspaceIdentity?.trim() || scope.workspacePath;
}

function entryKeyOf(scope: WorkspaceSessionsIndexScope): string {
  return buildSessionsIndexEntryKey({
    workspaceKey: workspaceKeyOf(scope),
    ...(scope.endpointKey ? { endpointKey: scope.endpointKey } : {}),
  });
}

export function buildWorkspaceSessionsIndexSourceKey(
  scope: Pick<WorkspaceSessionsIndexScope, "workspacePath" | "workspaceIdentity" | "endpointKey">,
): string {
  return entryKeyOf(scope);
}

function toRegistryScope(scope: WorkspaceSessionsIndexScope): SessionsIndexScope {
  return {
    workspaceKey: workspaceKeyOf(scope),
    workspacePath: scope.workspacePath,
    ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
    ...(scope.endpointKey ? { endpointKey: scope.endpointKey } : {}),
  };
}

function buildScopeBindingKey(
  scope: WorkspaceSessionsIndexScope,
  agentService: SessionsIndexAgentService,
): string {
  return `${buildSessionsIndexEntryKey(toRegistryScope(scope), agentService)}\0path:${scope.workspacePath}`;
}

function isHydratingStore(store: SessionsIndexStore): boolean {
  return (
    store.getState().workspaceId === null &&
    (store.getStatus() === "idle" || store.getStatus() === "connecting")
  );
}

export function useWorkspaceSessionsIndexItems(
  scopes: WorkspaceSessionsIndexScope[],
): WorkspaceSessionsIndexItemsResult {
  const baseServices = useBaseWorkspaceServices();
  const baseAgentService = baseServices.cfAgentService;

  const signature = useMemo(
    () =>
      scopes
        .map((scope) => {
          const agentService = scope.agentService ?? baseAgentService;
          return agentService
            ? buildScopeBindingKey(scope, agentService)
            : `${entryKeyOf(scope)} ${scope.workspacePath} service-unavailable`;
        })
        .sort()
        .join("|"),
    [scopes, baseAgentService],
  );
  const scopesRef = useRef(scopes);
  scopesRef.current = scopes;

  const [tick, setTick] = useState(0);
  const bumpTick = useCallback(() => setTick((n) => n + 1), []);
  const subscriptionSetRef = useRef<WorkspaceSessionsIndexSubscriptionSet | null>(null);
  if (subscriptionSetRef.current === null) {
    subscriptionSetRef.current = new WorkspaceSessionsIndexSubscriptionSet(bumpTick);
  }
  const subscriptionSet = subscriptionSetRef.current;

  useEffect(() => {
    const bindings: WorkspaceSessionsIndexBinding[] = [];
    for (const scope of scopesRef.current) {
      const agentService = scope.agentService ?? baseAgentService;
      if (!agentService) {
        continue;
      }
      bindings.push({ scope: toRegistryScope(scope), agentService });
    }
    subscriptionSet.reconcile(bindings);
  }, [signature, baseAgentService, subscriptionSet]);

  useEffect(
    () => () => {
      subscriptionSet.dispose();
    },
    [subscriptionSet],
  );

  const previousItemsRef = useRef<CfTaskMeta[]>([]);
  const previousHydratingRef = useRef<string[]>([]);
  return useMemo(() => {
    const metas: CfTaskMeta[] = [];
    const hydratingEndpointKeys = new Set<string>();
    const sourceRevisionByScopeKey: Record<string, string> = {};
    const previousByKey = new Map(
      previousItemsRef.current.map((meta) => [buildTaskListItemIdentityKey(meta), meta]),
    );
    for (const scope of scopesRef.current) {
      const sourceKey = entryKeyOf(scope);
      const agentService = scope.agentService ?? baseAgentService;
      const bindingRevision = agentService
        ? buildScopeBindingKey(scope, agentService)
        : `${sourceKey} service-unavailable`;
      const store = subscriptionSet.getStore({
        workspaceKey: workspaceKeyOf(scope),
        ...(scope.endpointKey ? { endpointKey: scope.endpointKey } : {}),
      });
      if (!store) {
        sourceRevisionByScopeKey[sourceKey] = `${bindingRevision}:missing`;
        continue;
      }
      const storeState = store.getState();
      sourceRevisionByScopeKey[sourceKey] =
        `${bindingRevision}:${storeState.logEpoch ?? "none"}:${storeState.seq}:${store.getStatus()}`;
      if (isHydratingStore(store)) {
        hydratingEndpointKeys.add(scope.endpointKey ?? LOCAL_SESSIONS_INDEX_ENDPOINT);
      }
      for (const summary of store.getSessions()) {
        metas.push(
          mapSessionSummaryToTaskMeta(summary, {
            workspacePath: scope.workspacePath,
            ...(scope.workspaceIdentity ? { workspaceIdentity: scope.workspaceIdentity } : {}),
            previous: previousByKey.get(buildSummaryIdentityKey(scope, summary.sessionId)),
          }),
        );
      }
    }
    metas.sort((a, b) => compareCfTaskListItems(a, b, "updated"));
    const items = stabilizeTaskListItems(previousItemsRef.current, metas);
    previousItemsRef.current = items;
    const nextHydrating = [...hydratingEndpointKeys].sort();
    const hydrating =
      nextHydrating.length === previousHydratingRef.current.length &&
      nextHydrating.every((key, index) => key === previousHydratingRef.current[index])
        ? previousHydratingRef.current
        : nextHydrating;
    previousHydratingRef.current = hydrating;
    return {
      items,
      sourceRevisionByScopeKey,
      hydratingEndpointKeys: hydrating,
    };
  }, [signature, subscriptionSet, tick]);
}

function buildSummaryIdentityKey(scope: WorkspaceSessionsIndexScope, sessionId: string): string {
  return `${scope.workspaceIdentity?.trim() || scope.workspacePath}::${sessionId}`;
}
