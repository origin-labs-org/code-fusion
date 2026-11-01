import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { RemoteWorkspaceRecoveryStatus } from "@/app-shell/types.js";

interface RemoteProjectPresentationFacts {
  reconnectingKeys: readonly string[];
  errors: Readonly<Record<string, string>>;
  recovery: Readonly<Record<string, RemoteWorkspaceRecoveryStatus>>;
  onReconnect?: (workspaceKey: string) => Promise<void>;
}
const EMPTY: RemoteProjectPresentationFacts = { reconnectingKeys: [], errors: {}, recovery: {} };
const Context = createContext<RemoteProjectPresentationFacts>(EMPTY);

export function RemoteProjectPresentationProvider({
  children,
  reconnectingKeys,
  errors,
  recovery,
  onReconnect,
}: RemoteProjectPresentationFacts & { children: ReactNode }) {
  const value = useMemo(
    () => ({ reconnectingKeys, errors, recovery, onReconnect }),
    [reconnectingKeys, errors, recovery, onReconnect],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useRemoteProjectPresentationFacts(workspaceKey: string) {
  const facts = useContext(Context);
  const recovery = facts.recovery[workspaceKey];
  return {
    reconnecting: facts.reconnectingKeys.includes(workspaceKey),
    projectError: facts.errors[workspaceKey],
    recoveryAttempt: recovery?.mode === "automatic" ? recovery.attempt : undefined,
    recoveryLimit: recovery?.limit,
  };
}

export function useRemoteProjectReconnect() {
  return useContext(Context).onReconnect;
}
