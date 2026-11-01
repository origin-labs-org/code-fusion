import { useCallback, useEffect, useRef, useState } from "react";
import type { WebRemoteControlWorkspaceTarget } from "@origin-ai/cf-shared";
import { getErrorMessage } from "@/lib/errorMessage.js";
import { logger } from "@/logger.js";
import type { WebRemoteControlWorkspaceSwitcherApi } from "@/root/types.js";

export function useHomeOnlyWorkspaces(switcher: WebRemoteControlWorkspaceSwitcherApi) {
  const [state, setState] = useState<{
    workspaces: WebRemoteControlWorkspaceTarget[] | null;
    error: string | null;
  }>({ workspaces: null, error: null });
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await switcher.listWorkspaces();
      if (request === generation.current) setState({ workspaces: result.workspaces, error: null });
    } catch (cause) {
      if (request !== generation.current) return;
      const error = getErrorMessage(cause);
      logger.warn("[project-sidebar] home-only 工作区列表读取失败", { error });
      setState((current) => ({ ...current, error }));
    }
  }, [switcher]);
  useEffect(() => {
    void reload();
    const unsubscribe = switcher.onWorkspaceListUpdated?.((result) => {
      generation.current += 1;
      setState({ workspaces: result.workspaces, error: null });
    });
    return () => {
      generation.current += 1;
      unsubscribe?.();
    };
  }, [switcher, reload]);
  return { ...state, reload };
}
