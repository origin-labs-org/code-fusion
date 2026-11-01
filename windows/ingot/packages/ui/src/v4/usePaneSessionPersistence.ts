import { useCallback, useEffect, useRef } from "react";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { logger } from "@/logger.js";
import { isRendererReloadNavigation } from "@/lib/rendererNavigation.js";

const STORAGE_PREFIX = "cf-v4-last-session:v1:";

function storageKey(workspaceKey: string): string {
  return `${STORAGE_PREFIX}${workspaceKey}`;
}

export function readPersistedPaneSession(workspaceKey: string): string | null {
  try {
    return localStorage.getItem(storageKey(workspaceKey));
  } catch {
    return null;
  }
}

export function persistPaneSession(workspaceKey: string, sessionId: string | null): void {
  try {
    if (sessionId) {
      localStorage.setItem(storageKey(workspaceKey), sessionId);
    } else {
      localStorage.removeItem(storageKey(workspaceKey));
    }
  } catch {
  }
}

export function useRemotePaneSessionLookup(
  workspacePath: string,
  workspaceIdentity?: string,
  remoteSessionId?: string,
) {
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId ?? null,
    workspaceIdentity ?? null,
  );
  const lookup = useCallback(
    async (taskId: string) => {
      const meta = await resolution.services.cfTaskService.getTaskMeta({
        workspacePath,
        workspaceIdentity,
        taskId,
      });
      return meta !== null;
    },
    [resolution.services, workspacePath, workspaceIdentity],
  );
  return resolution.connectionKind === "remote-ready" ? lookup : undefined;
}

export interface UsePaneSessionPersistenceParams {
  workspaceKey: string;
  activeSessionId: string | null;
  
  draftFocusVersion: number;
  
  enabled?: boolean;
  
  restoreOnStartup?: boolean;
  
  selectSession: (sessionId: string) => void;
  
  lookupSession?: (sessionId: string) => Promise<boolean>;
  onSessionMissing?: () => void;
}

export function shouldRestorePersistedPaneSession(params: {
  activeSessionId: string | null;
  draftFocusVersion: number;
  enabled: boolean;
  rendererReload: boolean;
  restoreOnStartup?: boolean;
}): boolean {
  return (
    params.enabled &&
    (params.rendererReload || params.restoreOnStartup === true) &&
    params.activeSessionId === null &&
    params.draftFocusVersion === 0
  );
}

export function usePaneSessionPersistence({
  workspaceKey,
  activeSessionId,
  draftFocusVersion,
  enabled = true,
  restoreOnStartup = false,
  selectSession,
  lookupSession,
  onSessionMissing,
}: UsePaneSessionPersistenceParams): void {
  const restoredKeysRef = useRef<Set<string>>(new Set());
  const startupRestoreAvailableRef = useRef(true);
  const pendingRestoreRef = useRef<{
    workspaceKey: string;
    sessionId: string;
  } | null>(null);
  const selectSessionRef = useRef(selectSession);
  selectSessionRef.current = selectSession;
  const onSessionMissingRef = useRef(onSessionMissing);
  onSessionMissingRef.current = onSessionMissing;

  const lastLookupRef = useRef<{
    workspaceKey: string;
    lookupSession: typeof lookupSession;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const attachmentChanged =
      lastLookupRef.current?.workspaceKey !== workspaceKey ||
      lastLookupRef.current?.lookupSession !== lookupSession;
    lastLookupRef.current = { workspaceKey, lookupSession };
    const restoringSession = pendingRestoreRef.current;
    const restoringSelection =
      restoringSession?.workspaceKey === workspaceKey &&
      restoringSession.sessionId === activeSessionId;
    if (!lookupSession || !activeSessionId || (!attachmentChanged && !restoringSelection)) return;
    let cancelled = false;
    void lookupSession(activeSessionId)
      .then((exists) => {
        if (cancelled || exists) return;
        pendingRestoreRef.current = null;
        persistPaneSession(workspaceKey, null);
        onSessionMissingRef.current?.();
      })
      .catch((error: unknown) => {
        if (!cancelled)
          logger.warn("[usePaneSessionPersistence] Failed to verify restored session", { workspaceKey, error });
      });
    return () => {
      cancelled = true;
    };
  }, [activeSessionId, draftFocusVersion, enabled, lookupSession, workspaceKey]);

  useEffect(() => {
    if (!enabled) return;
    if (restoredKeysRef.current.has(workspaceKey)) return;
    restoredKeysRef.current.add(workspaceKey);
    const startupRestoreAvailable = startupRestoreAvailableRef.current;
    startupRestoreAvailableRef.current = false;
    if (
      !shouldRestorePersistedPaneSession({
        activeSessionId,
        draftFocusVersion,
        enabled,
        rendererReload: startupRestoreAvailable && isRendererReloadNavigation(),
        restoreOnStartup: startupRestoreAvailable && restoreOnStartup,
      })
    ) {
      if (activeSessionId === null) {
        persistPaneSession(workspaceKey, null);
      }
      return;
    }
    const stored = readPersistedPaneSession(workspaceKey);
    if (stored) {
      pendingRestoreRef.current = { workspaceKey, sessionId: stored };
      selectSessionRef.current(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, restoreOnStartup, workspaceKey]);

  useEffect(() => {
    if (!enabled) return;
    if (!restoredKeysRef.current.has(workspaceKey)) return;
    const pendingRestore = pendingRestoreRef.current;
    if (pendingRestore?.workspaceKey === workspaceKey) {
      if (activeSessionId === null) {
        return;
      }
      pendingRestoreRef.current = null;
    }
    persistPaneSession(workspaceKey, activeSessionId);
  }, [activeSessionId, enabled, workspaceKey]);
}
