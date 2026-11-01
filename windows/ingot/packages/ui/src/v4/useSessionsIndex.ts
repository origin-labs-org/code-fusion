import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { SessionSummary } from "@origin-ai/cf-shared/cf-protocol-v4";
import { useServices } from "@/hooks/useServices.js";
import { createAgentSessionsIndexTransport } from "@/v4/agentSessionsIndexTransport.js";
import {
  SessionsIndexStore,
  type SessionsIndexStoreStatus,
} from "@/v4/sessionsIndexStore.js";

export interface UseSessionsIndexResult {
  sessions: SessionSummary[];
  status: SessionsIndexStoreStatus;
}

export function useSessionsIndex(
  workspacePath: string,
  workspaceIdentity?: string,
): UseSessionsIndexResult {
  const { cfAgentService } = useServices();

  const store = useMemo(
    () => new SessionsIndexStore(),
    [workspacePath, workspaceIdentity, cfAgentService],
  );

  useEffect(() => {
    const transport = createAgentSessionsIndexTransport(cfAgentService, {
      workspacePath,
      ...(workspaceIdentity ? { workspaceIdentity } : {}),
    });
    void store.connect(transport, { forceSnapshot: true });
    return () => store.close();
  }, [store, workspacePath, workspaceIdentity, cfAgentService]);

  const state = useSyncExternalStore(store.subscribe, store.getState);
  const sessions = useMemo(() => store.getSessions(), [store, state]);

  return { sessions, status: store.getStatus() };
}
