import { useEffect, useLayoutEffect, useRef } from "react";
import type {
  WebRemoteControlMobileTaskView,
  WebRemoteControlTaskViewSwitcher,
} from "@/web-remote-control/contract.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import { logger } from "@/logger.js";

export function WebRemoteControlTaskViewReporter({
  enabled,
  activeTaskId,
  workspacePath,
  workspaceIdentity,
  switcher,
}: {
  enabled: boolean;
  activeTaskId: string | null;
  workspacePath: string;
  workspaceIdentity?: string;
  switcher?: WebRemoteControlTaskViewSwitcher;
}) {
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  const navigationCommitted = useCfSessionStore((state) => {
    const route = state.taskNavHistory.entries[state.taskNavHistory.cursor];
    return (
      route?.kind === "task" &&
      route.taskId === activeTaskId &&
      (route.workspaceIdentity?.trim() || route.workspacePath) === workspaceKey &&
      state.getWorkspaceState(workspacePath, workspaceIdentity).activeTaskId === activeTaskId
    );
  });
  const viewing = enabled && navigationCommitted && activeTaskId !== null;
  const viewKey = viewing ? JSON.stringify([workspaceKey, activeTaskId]) : null;
  const updateNavigation = switcher?.updateMobileViewState;
  const updateView = switcher?.updateMobileTaskView;
  const hasViewReporter = Boolean(updateView);
  const committed = useRef<{
    view: WebRemoteControlMobileTaskView | null;
    updateView: WebRemoteControlTaskViewSwitcher["updateMobileTaskView"];
  }>({ view: null, updateView: undefined });
  useLayoutEffect(() => {
    committed.current = {
      view: viewing
        ? {
            workspacePath,
            ...(workspaceIdentity ? { workspaceIdentity } : {}),
            taskId: activeTaskId,
          }
        : null,
      updateView,
    };
  });

  useEffect(() => {
    if (!updateNavigation) return;
    void updateNavigation(workspaceKey, activeTaskId ?? undefined).catch((error: unknown) => {
      logger.warn("[WebRemoteControlTaskViewReporter] 同步导航位置失败", {
        workspaceKey,
        activeTaskId,
        error,
      });
    });
  }, [activeTaskId, workspaceKey, updateNavigation]);

  useEffect(() => {
    const initialReporter = committed.current.updateView;
    if (!initialReporter) return;
    let lastReported: string | null | undefined;
    const publish = (view: WebRemoteControlMobileTaskView | null) => {
      const key = view
        ? JSON.stringify([view.workspaceIdentity?.trim() || view.workspacePath, view.taskId])
        : null;
      if (lastReported === key) return;
      lastReported = key;
      void (committed.current.updateView ?? initialReporter)(view).catch((error: unknown) => {
        if (lastReported === key) lastReported = undefined;
        logger.warn("[WebRemoteControlTaskViewReporter] Failed to sync viewing state", { view, error });
      });
    };
    const sync = () =>
      publish(document.visibilityState === "visible" ? committed.current.view : null);
    const hide = () => publish(null);
    sync();
    document.addEventListener("visibilitychange", sync);
    document.addEventListener("freeze", hide);
    document.addEventListener("resume", sync);
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      document.removeEventListener("freeze", hide);
      document.removeEventListener("resume", sync);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", sync);
      hide();
    };
  }, [viewKey, hasViewReporter]);
  return null;
}
