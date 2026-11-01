import { useEffect, useMemo, useRef, useState } from "react";
import type { CfSkillReferenceCatalogEntry } from "@origin-ai/cf-shared";
import { useWorkspaceServicesResolution } from "@/hooks/useWorkspaceServices.js";
import { logger } from "@/logger.js";

export interface ConversationSkillCatalogState {
  skills: CfSkillReferenceCatalogEntry[];
  authority: "session" | "workspace" | null;
  loading: boolean;
  error: string | null;
}

interface ScopedConversationSkillCatalogState {
  scope: object | null;
  value: ConversationSkillCatalogState;
}

const EMPTY_STATE: ConversationSkillCatalogState = {
  skills: [],
  authority: null,
  loading: false,
  error: null,
};

const EMPTY_SCOPED_STATE: ScopedConversationSkillCatalogState = {
  scope: null,
  value: EMPTY_STATE,
};

export interface UseSkillsOptions {
  workspacePath: string;
  workspaceIdentity?: string;
  sessionId: string | null;
  enabled: boolean;
  preferredRemoteSessionId?: string;
}

export function useSkills(options: UseSkillsOptions): ConversationSkillCatalogState {
  const resolution = useWorkspaceServicesResolution(
    options.workspacePath,
    options.preferredRemoteSessionId,
    options.workspaceIdentity,
  );
  const [scopedState, setScopedState] =
    useState<ScopedConversationSkillCatalogState>(EMPTY_SCOPED_STATE);
  const [runtimeRevision, setRuntimeRevision] = useState(0);
  const requestSeqRef = useRef(0);
  const workspaceKey = options.workspaceIdentity?.trim() || options.workspacePath;
  const remoteSessionId =
    resolution.remoteSessionId ?? options.preferredRemoteSessionId ?? undefined;
  const services = resolution.services;
  const rpcReady = resolution.rpcReady;
  const requestKey = `${workspaceKey}|${remoteSessionId ?? "local"}|${options.sessionId ?? "draft"}|runtime:${runtimeRevision}`;

  useEffect(() => {
    if (!options.enabled || !options.sessionId || !rpcReady) return;
    const subscription = services.cfAgentService.onAgentRuntimeRestarted((event) => {
      if (event.workspaceKey !== workspaceKey) return;
      setRuntimeRevision((current) => current + 1);
    });
    return () => subscription.dispose();
  }, [options.enabled, options.sessionId, rpcReady, services, workspaceKey]);

  const requestScope = useMemo(
    () => ({}),
    [options.enabled, remoteSessionId, requestKey, rpcReady, services],
  );

  useEffect(() => {
    if (!options.enabled || !options.workspacePath || !rpcReady) return;
    const seq = ++requestSeqRef.current;
    let cancelled = false;
    setScopedState({
      scope: requestScope,
      value: { skills: [], authority: null, loading: true, error: null },
    });
    const params = {
      workspacePath: options.workspacePath,
      ...(options.workspaceIdentity ? { workspaceIdentity: options.workspaceIdentity } : {}),
      ...(remoteSessionId ? { remoteSessionId } : {}),
      ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    };
    services.cfAgentService
      .getSkillReferenceCatalog(params)
      .then((result) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        setScopedState({
          scope: requestScope,
          value: {
            skills: result.skills,
            authority: result.authority,
            loading: false,
            error: null,
          },
        });
      })
      .catch((error: unknown) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("[useSkills] 拉取对话 Skill catalog 失败", {
          error: message,
          requestKey,
        });
        setScopedState({
          scope: requestScope,
          value: { skills: [], authority: null, loading: false, error: message },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    options.enabled,
    options.sessionId,
    options.workspaceIdentity,
    options.workspacePath,
    remoteSessionId,
    requestKey,
    requestScope,
    rpcReady,
    services,
  ]);

  if (!options.enabled || !options.workspacePath || !rpcReady || scopedState.scope !== requestScope) {
    return EMPTY_STATE;
  }
  return scopedState.value;
}
