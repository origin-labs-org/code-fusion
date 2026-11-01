export interface V4ChatRootBrowserSnapshot {
  activeInputId: string | null;
  bridgeError: string | null;
  canStop: boolean;
  modelSwitchPending: boolean;
  paneSessionId: string | null;
  queueCount: number;
  runtimeStatus: string;
  taskId: string | null;
  workspaceKey: string | null;
}

type BrowserWorkspaceState = {
  draftRuntime?: { status?: string | null };
  modelSwitchPending?: boolean;
  taskRuntimeByTaskId?: Record<
    string,
    { activeInputId?: string | null; status?: string | null }
  >;
};

export function readV4ChatRootSnapshotInBrowser(
  v4PaneTestId: string,
  v4QueueItemPrefix: string,
  v4StopTestId: string,
): V4ChatRootBrowserSnapshot {
  const pane = document.querySelector<HTMLElement>(`[data-testid="${v4PaneTestId}"]`);
  const canStop = Boolean(
    pane?.querySelector(`[data-testid="${v4StopTestId}"]`),
  );
  const paneSessionId = pane?.getAttribute("data-session-id") ?? null;
  const taskId = paneSessionId && paneSessionId !== "draft" ? paneSessionId : null;
  const e2eWindow = window as Window & {
    __cfSessionStoreE2E?: {
      getState?: () => { workspaces?: Record<string, BrowserWorkspaceState> };
    };
    __cfTabStoreE2E?: {
      getState?: () => {
        activeWorkspaceIdentity?: string | null;
        activeWorkspacePath?: string | null;
      };
    };
  };
  const tabState = e2eWindow.__cfTabStoreE2E?.getState?.();
  const workspaceKey =
    tabState?.activeWorkspaceIdentity?.trim() || tabState?.activeWorkspacePath || null;
  const sessionState = e2eWindow.__cfSessionStoreE2E?.getState?.();
  const workspace = workspaceKey ? sessionState?.workspaces?.[workspaceKey] : undefined;
  const taskRuntime = taskId ? workspace?.taskRuntimeByTaskId?.[taskId] : undefined;
  const runtimeStatus = taskId
    ? taskRuntime?.status
    : workspace?.draftRuntime?.status;
  const bridgeError = !pane
    ? "v4-pane-missing"
    : !e2eWindow.__cfTabStoreE2E?.getState
      ? "tab-store-bridge-missing"
      : !e2eWindow.__cfSessionStoreE2E?.getState
        ? "session-store-bridge-missing"
        : !workspaceKey
          ? "active-workspace-key-missing"
          : !workspace
            ? "active-workspace-not-found"
            : null;

  return {
    activeInputId: taskRuntime?.activeInputId ?? null,
    bridgeError,
    canStop,
    modelSwitchPending: workspace?.modelSwitchPending === true,
    paneSessionId,
    queueCount: document.querySelectorAll(
      `li[data-testid^="${v4QueueItemPrefix}-"][data-queue-item-id]`,
    ).length,
    runtimeStatus: canStop ? "streaming" : (runtimeStatus ?? "idle"),
    taskId,
    workspaceKey,
  };
}
