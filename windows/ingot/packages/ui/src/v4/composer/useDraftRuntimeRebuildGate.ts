import { useCallback, useEffect, useReducer, useRef } from "react";
import { useCfSessionStore } from "@/store/cfSessionStore.js";

export const DRAFT_RUNTIME_REBUILD_TIMEOUT_MS = 5000;

export interface DraftRuntimeRebuildGateState {
  rebuilding: boolean;
  
  pendingFrom: string | null;
  
  epoch: number;
}

export type DraftRuntimeRebuildGateEvent =
  | { type: "runtimeRestart"; prewarmSessionId: string | null }
  | { type: "prewarmSessionChanged"; prewarmSessionId: string | null }
  | { type: "rebuildTimeout" };

export const DRAFT_RUNTIME_REBUILD_GATE_IDLE: DraftRuntimeRebuildGateState = {
  epoch: 0,
  pendingFrom: null,
  rebuilding: false,
};

export function reduceDraftRuntimeRebuildGate(
  state: DraftRuntimeRebuildGateState,
  event: DraftRuntimeRebuildGateEvent,
): DraftRuntimeRebuildGateState {
  switch (event.type) {
    case "runtimeRestart":
      return {
        epoch: state.epoch + 1,
        pendingFrom: event.prewarmSessionId,
        rebuilding: true,
      };
    case "prewarmSessionChanged":
      if (!state.rebuilding) return state;
      if (event.prewarmSessionId === null) return state;
      if (event.prewarmSessionId === state.pendingFrom) return state;
      return { epoch: state.epoch, pendingFrom: null, rebuilding: false };
    case "rebuildTimeout":
      if (!state.rebuilding) return state;
      return { ...state, rebuilding: false };
  }
}

export interface DraftRuntimeRebuildGate {
  
  rebuilding: boolean;
}

export function useDraftRuntimeRebuildGate(params: {
  
  enabled: boolean;
  workspacePath: string;
  workspaceIdentity?: string;
  
  prewarmSessionId: string | null;
  onRuntimeRestart?: (listener: () => void) => () => void;
  
  onRuntimeLifecycle?: (listener: (state: "available" | "unavailable") => void) => () => void;
  timeoutMs?: number;
}): DraftRuntimeRebuildGate {
  const {
    enabled,
    onRuntimeLifecycle,
    onRuntimeRestart,
    prewarmSessionId,
    timeoutMs = DRAFT_RUNTIME_REBUILD_TIMEOUT_MS,
    workspaceIdentity,
    workspacePath,
  } = params;
  const [state, dispatch] = useReducer(
    reduceDraftRuntimeRebuildGate,
    DRAFT_RUNTIME_REBUILD_GATE_IDLE,
  );

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const prewarmSessionIdRef = useRef(prewarmSessionId);
  prewarmSessionIdRef.current = prewarmSessionId;

  const handleRuntimeRestart = useCallback(() => {
    if (!enabledRef.current) return;
    dispatch({ prewarmSessionId: prewarmSessionIdRef.current, type: "runtimeRestart" });
    useCfSessionStore.getState().invalidateDraftRuntime(workspacePath, workspaceIdentity);
  }, [workspaceIdentity, workspacePath]);

  useEffect(() => {
    if (onRuntimeLifecycle) {
      return onRuntimeLifecycle((state) => {
        if (state === "unavailable") handleRuntimeRestart();
      });
    }
    if (!onRuntimeRestart) return;
    return onRuntimeRestart(handleRuntimeRestart);
  }, [handleRuntimeRestart, onRuntimeLifecycle, onRuntimeRestart]);

  useEffect(() => {
    dispatch({ prewarmSessionId, type: "prewarmSessionChanged" });
  }, [prewarmSessionId]);

  useEffect(() => {
    if (!state.rebuilding) return;
    const timer = setTimeout(() => dispatch({ type: "rebuildTimeout" }), timeoutMs);
    return () => clearTimeout(timer);
  }, [state.epoch, state.rebuilding, timeoutMs]);

  return { rebuilding: state.rebuilding };
}
