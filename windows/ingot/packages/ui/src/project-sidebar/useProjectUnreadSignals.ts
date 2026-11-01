import { useEffect, useRef } from "react";
import { useOptionalPlatform } from "@/hooks/usePlatform.js";
import type {
  ProjectTaskRef,
  WebRemoteControlStatus,
  WindowHostTaskUnreadSignal,
} from "@/project-sidebar/contract.js";
import { mutateProjectTask, readProjectTaskMeta } from "@/project-sidebar/task-mutation.js";
import { useBaseWorkspaceServices } from "@/hooks/useWorkspaceServices.js";
import { useTabStoreApi } from "@/store/TabStoreProvider.js";
import { isWorkspaceTab } from "@/store/tabStore.js";
import { useCfSessionStore } from "@/store/cfSessionStore.js";
import { onTaskNavigationCommitted } from "@/store/cfSessionStoreNavigation.js";
import { logger } from "@/logger.js";

interface ForegroundCompletionEntry {
  target: WindowHostTaskUnreadSignal["address"];
  written: boolean;
  marker?: number;
}
type ForegroundCompletionMap = Map<string, ForegroundCompletionEntry>;

export function useProjectUnreadSignals(
  scopes: Array<{ workspacePath: string; workspaceIdentity?: string }>,
  refresh: () => Promise<void>,
  observeRemoteViewing = false,
) {
  const services = useBaseWorkspaceServices();
  const availablePlatform = useOptionalPlatform();
  const platform = observeRemoteViewing ? availablePlatform : null;
  const tabs = useTabStoreApi();
  const scopeKey = JSON.stringify(scopes);
  const latestRefresh = useRef(refresh);
  latestRefresh.current = refresh;
  const received = useRef(new Map<string, { updatedAt: number; status: string }>());
  const foregroundCompletionsRef = useRef<ForegroundCompletionMap>(new Map());
  const foregroundQueuesRef = useRef(new Map<string, Promise<void>>());
  const foregroundPendingWritesRef = useRef(new Map<string, Promise<void>>());
  const foregroundPendingClearsRef = useRef(new Set<string>());
  const taskKey = (target: ProjectTaskRef) =>
    JSON.stringify([target.workspaceIdentity?.trim() || target.workspacePath, target.taskId]);
  const enqueueForegroundCommand = (
    target: ProjectTaskRef,
    command: () => Promise<void>,
  ) => {
    const key = taskKey(target);
    const previous = foregroundQueuesRef.current.get(key) ?? Promise.resolve();
    const current = previous.then(command);
    const settled = current
      .catch(() => {})
      .finally(() => {
        if (foregroundQueuesRef.current.get(key) === settled) {
          foregroundQueuesRef.current.delete(key);
        }
      });
    foregroundQueuesRef.current.set(key, settled);
    return current;
  };
  useEffect(() => {
    let disposed = false;
    const pending = new Set<{
      target: WindowHostTaskUnreadSignal["address"];
      viewed: boolean;
      started: boolean;
    }>();
    const ports = {
      service: services.cfTaskService,
      controller: services.windowControllerService,
    };
    const foregroundCompletions = foregroundCompletionsRef.current;
    const flushOnLeave = () => {
      const writes: Array<Promise<void>> = [];
      for (const [key, entry] of foregroundCompletions) {
        if (entry.written) continue;
        const pendingWrite = foregroundPendingWritesRef.current.get(key);
        if (pendingWrite) {
          writes.push(pendingWrite);
          continue;
        }
        const command = enqueueForegroundCommand(entry.target, async () => {
          if (foregroundCompletionsRef.current.get(key) !== entry) return;
          const meta = await mutateProjectTask(
            ports,
            entry.target,
            { kind: "mark-unread" },
            entry.target.remoteSessionId,
          );
          entry.written = true;
          if (meta?.unreadAt != null) entry.marker = meta.unreadAt;
        })
          .then(async () => {
            foregroundPendingWritesRef.current.delete(key);
            if (!disposed) await latestRefresh.current();
          })
          .catch((error: unknown) => {
            foregroundPendingWritesRef.current.delete(key);
            if (!disposed) {
              logger.warn("[project-sidebar] Failed to write unread mark on foreground completion", {
                ...entry.target,
                error,
              });
              void latestRefresh.current();
            }
          });
        foregroundPendingWritesRef.current.set(key, command);
        writes.push(command);
      }
      return Promise.all(writes);
    };
    const clearOnFocus = () => {
      for (const [key, entry] of [...foregroundCompletions]) {
        if (!entry.written || entry.marker == null) continue;
        if (foregroundPendingClearsRef.current.has(key)) continue;
        if (!(isDesktopViewing(entry.target) || isRemoteViewing(entry.target))) continue;
        foregroundPendingClearsRef.current.add(key);
        void enqueueForegroundCommand(entry.target, async () => {
          if (entry.marker == null) return;
          await mutateProjectTask(
            ports,
            entry.target,
            { kind: "mark-read", expectedUnreadAt: entry.marker },
            entry.target.remoteSessionId,
          );
          if (foregroundCompletionsRef.current.get(key) === entry) {
            foregroundCompletionsRef.current.delete(key);
          }
        })
          .then(async () => {
            foregroundPendingClearsRef.current.delete(key);
            if (!disposed) await latestRefresh.current();
          })
          .catch((error: unknown) => {
            foregroundPendingClearsRef.current.delete(key);
            if (!disposed) {
              logger.warn("[project-sidebar] Failed to auto-mark as read on foreground completion", { ...entry.target, error });
              void latestRefresh.current();
            }
          });
      }
    };
    let remoteView: WebRemoteControlStatus["mobileTaskView"];
    let statusEventSeen = false;
    let statusReady = !platform;
    let releaseStatus!: () => void;
    const initialStatus = new Promise<void>((resolve) => {
      releaseStatus = resolve;
    });
    if (statusReady) releaseStatus();
    const isRemoteViewing = (target: WindowHostTaskUnreadSignal["address"]) =>
      remoteView?.taskId === target.taskId &&
      (remoteView.workspaceIdentity?.trim() || remoteView.workspacePath) ===
        (target.workspaceIdentity?.trim() || target.workspacePath) &&
      (!remoteView.remoteSessionId ||
        !target.remoteSessionId ||
        remoteView.remoteSessionId === target.remoteSessionId);
    const acceptStatus = (status: WebRemoteControlStatus) => {
      if (disposed) return;
      const previousViewKey = remoteView
        ? JSON.stringify([taskKey(remoteView), remoteView.remoteSessionId])
        : null;
      remoteView = status.mobileTaskView;
      statusReady = true;
      releaseStatus();
      let pendingWrite = false;
      for (const operation of pending)
        if (isRemoteViewing(operation.target)) {
          operation.viewed = true;
          pendingWrite ||= operation.started;
        }
      if (
        !remoteView ||
        previousViewKey === JSON.stringify([taskKey(remoteView), remoteView.remoteSessionId]) ||
        pendingWrite
      )
        return;
      const target = remoteView;
      void enqueueForegroundCommand(target, async () => {
        const meta = await readProjectTaskMeta(ports, target, target.remoteSessionId);
        if (disposed || meta?.unreadAt == null) return;
        await mutateProjectTask(
          ports,
          target,
          { kind: "mark-read", expectedUnreadAt: meta.unreadAt },
          target.remoteSessionId,
        );
      })
        .then(() => {
          if (!disposed) return latestRefresh.current();
        })
        .catch((error) => {
          if (!disposed) {
            logger.warn("[project-sidebar] Failed to write read status when viewing task", { ...target, error });
            void latestRefresh.current();
          }
        });
    };
    const unsubscribeStatus = platform?.onWebRemoteControlStatusChanged?.((status) => {
      statusEventSeen = true;
      acceptStatus(status);
    });
    if (platform)
      void platform
        .getWebRemoteControlStatus()
        .then((status) => {
          if (!statusEventSeen) acceptStatus(status);
        })
        .catch((error) => {
          if (disposed || statusEventSeen) return;
          statusReady = true;
          releaseStatus();
          logger.warn("[project-sidebar] 查看状态初始读取失败", error);
        });
    const isDesktopViewing = (target: ProjectTaskRef) => {
      const tabState = tabs.getState();
      const tab = tabState.tabs.find((item) => item.id === tabState.activeTabId);
      const key = target.workspaceIdentity?.trim() || target.workspacePath;
      const state = useCfSessionStore.getState();
      const route = state.taskNavHistory.entries[state.taskNavHistory.cursor];
      return Boolean(
        route?.kind === "task" &&
        route.taskId === target.taskId &&
        (route.workspaceIdentity?.trim() || route.workspacePath) === key &&
        tab &&
        isWorkspaceTab(tab) &&
        (tab.workspaceIdentity?.trim() || tab.workspacePath) === key &&
        state.getWorkspaceState(target.workspacePath, target.workspaceIdentity).activeTaskId ===
          target.taskId,
      );
    };
    const onVisibilityChange = () => {
      if (document.hidden) flushOnLeave();
      else flushThenClear();
    };
    const flushThenClear = async () => {
      await flushOnLeave();
      clearOnFocus();
    };
    window.addEventListener("blur", flushOnLeave);
    window.addEventListener("focus", flushThenClear);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const navigation = onTaskNavigationCommitted((target) => {
      for (const operation of pending) {
        if (
          operation.target.taskId === target.taskId &&
          (operation.target.workspaceIdentity?.trim() || operation.target.workspacePath) ===
            (target.workspaceIdentity?.trim() || target.workspacePath) &&
          isDesktopViewing(target)
        )
          operation.viewed = true;
      }
    });
    const receive = (signal: WindowHostTaskUnreadSignal) => {
      if (disposed) return;
      const target = signal.address;
      const key = JSON.stringify([
        target.workspaceIdentity?.trim() || target.workspacePath,
        target.taskId,
      ]);
      const previous = received.current.get(key);
      if (
        previous &&
        (previous.updatedAt > signal.updatedAt ||
          (previous.updatedAt === signal.updatedAt && previous.status === signal.status))
      )
        return;
      received.current.set(key, signal);
      if (isDesktopViewing(target) || isRemoteViewing(target)) {
        foregroundCompletions.set(taskKey(target), { target, written: false });
        if (document.hidden) flushOnLeave();
        return;
      }
      foregroundCompletions.delete(taskKey(target));
      const operation = { target, viewed: false, started: false };
      pending.add(operation);
      let committed = false;
      void enqueueForegroundCommand(target, async () => {
        try {
          if (!statusReady) await initialStatus;
          if (disposed || operation.viewed || isDesktopViewing(target) || isRemoteViewing(target))
            return;
          operation.started = true;
          const meta = await mutateProjectTask(
            ports,
            target,
            { kind: "mark-unread" },
            target.remoteSessionId,
          );
          committed = true;
          if (disposed) return;
          if (operation.viewed && meta?.unreadAt != null)
            await mutateProjectTask(
              ports,
              target,
              { kind: "mark-read", expectedUnreadAt: meta.unreadAt },
              target.remoteSessionId,
            );
        } finally {
          pending.delete(operation);
        }
      })
        .then(async () => {
          if (!disposed) await latestRefresh.current();
        })
        .catch((error: unknown) => {
          if (disposed) return;
          if (!committed && received.current.get(key) === signal) received.current.delete(key);
          logger.warn("[project-sidebar] Failed to write unread on background completion", { ...target, error });
          void latestRefresh.current();
        })
        .finally(() => pending.delete(operation));
    };
    const subscriptions = services.windowControllerService
      ? [services.windowControllerService.onDynamicTaskUnreadSignal()(receive)]
      : scopes.map((scope) =>
          services.cfTaskService.onDynamicWorkspaceEvent(scope)((event) => {
            if (
              event.type !== "workspace_task_list_changed" ||
              event.reason !== "task_status_changed" ||
              event.unreadSignal !== "background_terminal" ||
              !event.taskMeta ||
              (event.taskMeta.status !== "completed" && event.taskMeta.status !== "error")
            )
              return;
            receive({
              address: {
                taskId: event.taskId ?? event.taskMeta.taskId,
                workspacePath: event.workspacePath,
                ...(event.workspaceIdentity ? { workspaceIdentity: event.workspaceIdentity } : {}),
              },
              updatedAt: event.taskMeta.updatedAt,
              status: event.taskMeta.status,
            });
          }),
        );
    return () => {
      disposed = true;
      subscriptions.forEach((subscription) => subscription.dispose());
      navigation.dispose();
      unsubscribeStatus?.();
      window.removeEventListener("blur", flushOnLeave);
      window.removeEventListener("focus", flushThenClear);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      releaseStatus();
    };
  }, [services, tabs, platform, services.windowControllerService ? "controller" : scopeKey]);
}
