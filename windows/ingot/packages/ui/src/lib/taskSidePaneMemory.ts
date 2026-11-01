import type { GitChangeSourceId } from "@origin-ai/cf-shared";
import type { SidePaneFullViewState } from "@/side-pane-full-view/contract.js";
import {
  normalizeWorkspaceSidePaneState,
  type WorkspaceSidePaneState,
} from "@/lib/workspaceSidePane.js";

export interface TaskSidePaneMemoryState {
  sidePaneState: WorkspaceSidePaneState | null;
  isSidePaneCollapsed: boolean;
  
  sidePaneCollapsedByOwner: Record<string, boolean>;
  
  sidePaneFullViewByOwner: Record<string, SidePaneFullViewState>;
  
  pluginUiAutoOpenKeys: ReadonlySet<string>;
  activeGitSourceId: GitChangeSourceId;
  browserUrls: Record<string, string>;
  
  browserUrl: string | null;
}

const DEFAULT_TASK_SIDE_PANE_MEMORY_STATE: TaskSidePaneMemoryState = {
  sidePaneState: null,
  isSidePaneCollapsed: true,
  sidePaneCollapsedByOwner: {},
  sidePaneFullViewByOwner: {},
  pluginUiAutoOpenKeys: new Set(),
  activeGitSourceId: "unstaged",
  browserUrls: {},
  browserUrl: null,
};

export const TASK_SIDE_PANE_MEMORY_MAX_ENTRIES = 50;

const DRAFT_SIDE_PANE_OWNER_KEY = "__draft__";

const taskSidePaneMemory = new Map<string, TaskSidePaneMemoryState>();

function touchTaskSidePaneMemoryEntry(
  key: string,
  state: TaskSidePaneMemoryState,
): TaskSidePaneMemoryState {
  taskSidePaneMemory.delete(key);
  taskSidePaneMemory.set(key, state);
  return state;
}

function pruneTaskSidePaneMemory(): void {
  while (taskSidePaneMemory.size > TASK_SIDE_PANE_MEMORY_MAX_ENTRIES) {
    const oldestKey = taskSidePaneMemory.keys().next().value;
    if (!oldestKey) {
      return;
    }

    taskSidePaneMemory.delete(oldestKey);
  }
}

export function buildTaskSidePaneMemoryKey({
  workspacePath,
  workspaceIdentity,
  taskId,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string | null;
}): string | null {
  void taskId;
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  return workspaceKey.trim() ? workspaceKey : null;
}

export function readTaskSidePaneMemoryState(key: string | null): TaskSidePaneMemoryState {
  if (!key) {
    return DEFAULT_TASK_SIDE_PANE_MEMORY_STATE;
  }

  const state = taskSidePaneMemory.get(key);
  if (!state) {
    return DEFAULT_TASK_SIDE_PANE_MEMORY_STATE;
  }

  const normalizedState = {
    ...DEFAULT_TASK_SIDE_PANE_MEMORY_STATE,
    ...state,
    sidePaneState: normalizeWorkspaceSidePaneState(state.sidePaneState),
    sidePaneCollapsedByOwner: {
      ...DEFAULT_TASK_SIDE_PANE_MEMORY_STATE.sidePaneCollapsedByOwner,
      ...state.sidePaneCollapsedByOwner,
    },
    sidePaneFullViewByOwner: { ...state.sidePaneFullViewByOwner },
  };
  return touchTaskSidePaneMemoryEntry(key, normalizedState);
}

export function saveTaskSidePaneMemoryState(
  key: string | null,
  patch: Partial<TaskSidePaneMemoryState>,
): void {
  if (!key) {
    return;
  }

  const nextState = {
    ...DEFAULT_TASK_SIDE_PANE_MEMORY_STATE,
    ...taskSidePaneMemory.get(key),
    ...patch,
    sidePaneCollapsedByOwner: {
      ...DEFAULT_TASK_SIDE_PANE_MEMORY_STATE.sidePaneCollapsedByOwner,
      ...taskSidePaneMemory.get(key)?.sidePaneCollapsedByOwner,
      ...patch.sidePaneCollapsedByOwner,
    },
    sidePaneFullViewByOwner:
      patch.sidePaneFullViewByOwner ?? taskSidePaneMemory.get(key)?.sidePaneFullViewByOwner ?? {},
  };
  nextState.sidePaneState = normalizeWorkspaceSidePaneState(nextState.sidePaneState);
  touchTaskSidePaneMemoryEntry(key, nextState);
  pruneTaskSidePaneMemory();
}

export function getSidePaneCollapsedPreference(
  state: TaskSidePaneMemoryState,
  ownerTaskId: string | null | undefined,
): boolean | undefined {
  return state.sidePaneCollapsedByOwner[ownerTaskId ?? DRAFT_SIDE_PANE_OWNER_KEY];
}

export function saveTaskSidePaneCollapsedPreference(
  key: string | null,
  ownerTaskId: string | null | undefined,
  isSidePaneCollapsed: boolean,
): void {
  if (!key) return;

  const state = readTaskSidePaneMemoryState(key);
  const ownerKey = ownerTaskId ?? DRAFT_SIDE_PANE_OWNER_KEY;
  saveTaskSidePaneMemoryState(key, {
    isSidePaneCollapsed,
    sidePaneCollapsedByOwner: {
      ...state.sidePaneCollapsedByOwner,
      [ownerKey]: isSidePaneCollapsed,
    },
  });
}

export function peekTaskSidePaneFullView(
  key: string | null,
  ownerTaskId: string | null | undefined,
): SidePaneFullViewState | null {
  if (!key) return null;
  return (
    taskSidePaneMemory.get(key)?.sidePaneFullViewByOwner[
      ownerTaskId ?? DRAFT_SIDE_PANE_OWNER_KEY
    ] ?? null
  );
}

export function saveTaskSidePaneFullView(
  key: string | null,
  ownerTaskId: string | null | undefined,
  value: SidePaneFullViewState | null,
): void {
  if (!key) return;
  const ownerKey = ownerTaskId ?? DRAFT_SIDE_PANE_OWNER_KEY;
  const next = { ...taskSidePaneMemory.get(key)?.sidePaneFullViewByOwner };
  if (value) {
    next[ownerKey] = value;
  } else {
    delete next[ownerKey];
  }
  saveTaskSidePaneMemoryState(key, { sidePaneFullViewByOwner: next });
}

export function clearTaskSidePaneMemoryStateForTest(): void {
  taskSidePaneMemory.clear();
}

export function claimPluginUiSidePaneAutoOpen(
  workspaceKey: string | null,
  requestKey: string,
): boolean {
  if (!workspaceKey) return false;
  const state = readTaskSidePaneMemoryState(workspaceKey);
  if (state.pluginUiAutoOpenKeys.has(requestKey)) return false;
  saveTaskSidePaneMemoryState(workspaceKey, {
    pluginUiAutoOpenKeys: new Set([...state.pluginUiAutoOpenKeys, requestKey]),
  });
  return true;
}
