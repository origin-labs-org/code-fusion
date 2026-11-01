import { create } from "zustand";
import type { RemoteTarget, WorkspacePurpose } from "@origin-ai/cf-shared";
import type { IServiceAccessor } from "@origin-ai/cf-services";
import { remoteAgentServiceGeneration } from "@/lib/remoteAgentServiceGeneration.js";
import { createRemoteWorkspaceDisconnectedError } from "@/lib/remoteWorkspaceServiceError.js";

export interface RemoteWorkspaceSession {
  sessionId: string;
  sourceServerId?: string;
  workspacePath?: string;
  workspaceIdentity?: string;
  workspacePurpose?: WorkspacePurpose;
  
  previousWorkspaceIdentity?: string;
  target?: RemoteTarget;
  services: IServiceAccessor;
  dispose?: (reason?: Error) => void;
}

export type RemoteWorkspaceConnectionOverlay = "disconnected" | "reconnecting";

interface RemoteWorkspaceSessionState {
  baseServices: IServiceAccessor | null;
  sessionsById: Record<string, RemoteWorkspaceSession>;
  sessionIdByWorkspacePath: Record<string, string>;
  sessionIdByWorkspaceIdentity: Record<string, string>;
  connectionOverlayByWorkspaceKey: Record<string, RemoteWorkspaceConnectionOverlay>;
  registerBaseServices: (services: IServiceAccessor) => void;
  registerSession: (session: RemoteWorkspaceSession) => void;
  unregisterSession: (sessionId: string) => void;
  bindWorkspacePath: (workspacePath: string, sessionId: string) => void;
  unbindWorkspacePath: (workspacePath: string) => void;
  bindWorkspaceIdentity: (workspaceIdentity: string, sessionId: string) => void;
  unbindWorkspaceIdentity: (workspaceIdentity: string) => void;
  setConnectionOverlay: (workspaceKey: string, state: RemoteWorkspaceConnectionOverlay) => void;
  clearConnectionOverlay: (workspaceKey: string) => void;
}

export const useRemoteWorkspaceSessionStore = create<RemoteWorkspaceSessionState>()((set) => ({
  baseServices: null,
  sessionsById: {},
  sessionIdByWorkspacePath: {},
  sessionIdByWorkspaceIdentity: {},
  connectionOverlayByWorkspaceKey: {},
  registerBaseServices: (services) =>
    set({
      baseServices: services,
    }),
  registerSession: (session) =>
    set((state) => ({
      sessionsById: {
        ...state.sessionsById,
        [session.sessionId]: session,
      },
    })),
  unregisterSession: (sessionId) =>
    set((state) => {
      const nextSessionsById = { ...state.sessionsById };
      delete nextSessionsById[sessionId];

      const nextSessionIdByWorkspacePath = Object.fromEntries(
        Object.entries(state.sessionIdByWorkspacePath).filter(
          ([, currentSessionId]) => currentSessionId !== sessionId,
        ),
      );

      const nextSessionIdByWorkspaceIdentity = Object.fromEntries(
        Object.entries(state.sessionIdByWorkspaceIdentity).filter(
          ([, currentSessionId]) => currentSessionId !== sessionId,
        ),
      );

      return {
        sessionsById: nextSessionsById,
        sessionIdByWorkspacePath: nextSessionIdByWorkspacePath,
        sessionIdByWorkspaceIdentity: nextSessionIdByWorkspaceIdentity,
      };
    }),
  bindWorkspacePath: (workspacePath, sessionId) =>
    set((state) => ({
      sessionIdByWorkspacePath: {
        ...state.sessionIdByWorkspacePath,
        [workspacePath]: sessionId,
      },
    })),
  unbindWorkspacePath: (workspacePath) =>
    set((state) => {
      if (!(workspacePath in state.sessionIdByWorkspacePath)) {
        return state;
      }

      const nextSessionIdByWorkspacePath = {
        ...state.sessionIdByWorkspacePath,
      };
      delete nextSessionIdByWorkspacePath[workspacePath];

      return {
        ...state,
        sessionIdByWorkspacePath: nextSessionIdByWorkspacePath,
      };
    }),
  bindWorkspaceIdentity: (workspaceIdentity, sessionId) =>
    set((state) => ({
      sessionIdByWorkspaceIdentity: {
        ...state.sessionIdByWorkspaceIdentity,
        [workspaceIdentity]: sessionId,
      },
    })),
  unbindWorkspaceIdentity: (workspaceIdentity) =>
    set((state) => {
      if (!(workspaceIdentity in state.sessionIdByWorkspaceIdentity)) {
        return state;
      }

      const nextSessionIdByWorkspaceIdentity = {
        ...state.sessionIdByWorkspaceIdentity,
      };
      delete nextSessionIdByWorkspaceIdentity[workspaceIdentity];

      return {
        ...state,
        sessionIdByWorkspaceIdentity: nextSessionIdByWorkspaceIdentity,
      };
    }),
  setConnectionOverlay: (workspaceKey, overlay) =>
    set((state) => ({
      connectionOverlayByWorkspaceKey: {
        ...state.connectionOverlayByWorkspaceKey,
        [workspaceKey]: overlay,
      },
    })),
  clearConnectionOverlay: (workspaceKey) =>
    set((state) => {
      if (!(workspaceKey in state.connectionOverlayByWorkspaceKey)) {
        return state;
      }
      const next = { ...state.connectionOverlayByWorkspaceKey };
      delete next[workspaceKey];
      return { connectionOverlayByWorkspaceKey: next };
    }),
}));

export function registerRemoteWorkspaceSession(session: RemoteWorkspaceSession): void {
  if (session.services.cfAgentService) {
    remoteAgentServiceGeneration(session.services.cfAgentService);
  }
  const previousSession = useRemoteWorkspaceSessionStore.getState().sessionsById[session.sessionId];
  if (previousSession && previousSession !== session) {
    previousSession.dispose?.(createRemoteWorkspaceDisconnectedError());
  }
  useRemoteWorkspaceSessionStore.getState().registerSession(session);
}

export function registerBaseWorkspaceServices(services: IServiceAccessor): void {
  useRemoteWorkspaceSessionStore.getState().registerBaseServices(services);
}

export function unregisterRemoteWorkspaceSession(sessionId: string): void {
  const session = useRemoteWorkspaceSessionStore.getState().sessionsById[sessionId];
  useRemoteWorkspaceSessionStore.getState().unregisterSession(sessionId);
  session?.dispose?.(createRemoteWorkspaceDisconnectedError());
}

export function bindRemoteWorkspacePath(workspacePath: string, sessionId: string): void {
  useRemoteWorkspaceSessionStore.getState().bindWorkspacePath(workspacePath, sessionId);
}

export function unbindRemoteWorkspacePath(workspacePath: string): void {
  useRemoteWorkspaceSessionStore.getState().unbindWorkspacePath(workspacePath);
}

export function bindRemoteWorkspaceIdentity(workspaceIdentity: string, sessionId: string): void {
  useRemoteWorkspaceSessionStore.getState().bindWorkspaceIdentity(workspaceIdentity, sessionId);
}

export function unbindRemoteWorkspaceIdentity(workspaceIdentity: string): void {
  useRemoteWorkspaceSessionStore.getState().unbindWorkspaceIdentity(workspaceIdentity);
}

export function setRemoteWorkspaceConnectionState(
  workspaceKey: string,
  state: RemoteWorkspaceConnectionOverlay,
): void {
  useRemoteWorkspaceSessionStore.getState().setConnectionOverlay(workspaceKey, state);
}

export function clearRemoteWorkspaceConnectionState(workspaceKey: string): void {
  useRemoteWorkspaceSessionStore.getState().clearConnectionOverlay(workspaceKey);
}

export function getRemoteWorkspaceConnectionState(
  workspaceKey: string,
): RemoteWorkspaceConnectionOverlay | undefined {
  return useRemoteWorkspaceSessionStore.getState().connectionOverlayByWorkspaceKey[workspaceKey];
}

export function getRemoteWorkspaceSession(sessionId: string): RemoteWorkspaceSession | null {
  return useRemoteWorkspaceSessionStore.getState().sessionsById[sessionId] ?? null;
}

export function findRemoteWorkspaceSessionIdForAgentService(agentService: object): string | null {
  for (const session of Object.values(useRemoteWorkspaceSessionStore.getState().sessionsById)) {
    if (session.services.cfAgentService === agentService) {
      return session.sessionId;
    }
  }
  return null;
}

export function getRemoteWorkspaceServicesForPath(workspacePath: string): IServiceAccessor | null {
  const state = useRemoteWorkspaceSessionStore.getState();
  const sessionId = state.sessionIdByWorkspacePath[workspacePath];
  if (!sessionId) {
    return null;
  }

  return state.sessionsById[sessionId]?.services ?? null;
}

export function getRemoteWorkspaceServicesForIdentity(
  workspaceIdentity: string,
): IServiceAccessor | null {
  const state = useRemoteWorkspaceSessionStore.getState();
  const sessionId = state.sessionIdByWorkspaceIdentity[workspaceIdentity];
  if (!sessionId) {
    return null;
  }

  return state.sessionsById[sessionId]?.services ?? null;
}

export function getRegisteredBaseWorkspaceServices(): IServiceAccessor | null {
  return useRemoteWorkspaceSessionStore.getState().baseServices;
}

export function resolveRegisteredWorkspaceServices(params: {
  workspacePath?: string;
  workspaceIdentity?: string;
}): IServiceAccessor | null {
  if (params.workspaceIdentity?.trim()) {
    return (
      getRemoteWorkspaceServicesForIdentity(params.workspaceIdentity) ??
      getRegisteredBaseWorkspaceServices()
    );
  }

  if (params.workspacePath?.trim()) {
    return (
      getRemoteWorkspaceServicesForPath(params.workspacePath) ??
      getRegisteredBaseWorkspaceServices()
    );
  }

  return getRegisteredBaseWorkspaceServices();
}
