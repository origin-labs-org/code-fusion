/* oxlint-disable eslint(max-lines) */

import { create } from "zustand";
import type { FileManagerTarget } from "@/lib/workspaceSidePane.js";
import {
  createUuid,
  resolveWorkspaceKey,
  type RemoteTarget,
  type TabId,
  type TabState,
  type WorkspacePurpose,
} from "@origin-ai/cf-shared";
import {
  persistWorkspaceExpandedPreference,
  readWorkspaceExpansionState,
  resolveExpandedWorkspacePaths,
  type WorkspaceExpansionState,
} from "@/lib/workspaceExpansionPreference.js";
import { isSameWorkspaceTab } from "@/store/tabWorkspaceIdentity.js";

export const SETTINGS_TAB_ID = "__settings__" satisfies TabId;

export type WorkspaceAvailability = "available" | "unavailable-local-directory";

export interface SettingsTabState {
  id: typeof SETTINGS_TAB_ID;
  kind: "settings";
  label: "settings";
}

export interface WorkspaceTabState extends TabState {
  kind: "workspace";
  
  restorePaneSession?: boolean;
  
  availability?: WorkspaceAvailability;
  remoteSessionId?: string;
  remoteTarget?: RemoteTarget;
  remoteHistoryId?: string;
  workspaceIdentity?: string;
  
  previousWorkspaceIdentity?: string;
  localWorkspacePath?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface WorkspaceTabOptions {
  availability?: WorkspaceAvailability;
  remoteSessionId?: string;
  remoteTarget?: RemoteTarget;
  remoteHistoryId?: string;
  workspaceIdentity?: string;
  
  previousWorkspaceIdentity?: string;
  localWorkspacePath?: string;
  workspacePurpose?: WorkspacePurpose;
}

export interface RestorableWorkspaceTab {
  workspacePath: string;
  availability?: WorkspaceAvailability;
  remoteSessionId?: string;
  remoteTarget?: RemoteTarget;
  workspaceIdentity?: string;
  localWorkspacePath?: string;
  workspacePurpose?: WorkspacePurpose;
}

export type WindowTabState = WorkspaceTabState | SettingsTabState;

export function isWorkspaceTab(tab: WindowTabState): tab is WorkspaceTabState {
  return tab.kind === "workspace";
}

export function isWorkspaceTabReadOnly(tab: WindowTabState): tab is WorkspaceTabState & {
  availability: "unavailable-local-directory";
} {
  return isWorkspaceTab(tab) && tab.availability === "unavailable-local-directory";
}

export function isWorkspaceReadOnly(
  state: Pick<TabStoreState, "tabs">,
  workspacePath: string,
  workspaceIdentity?: string,
): boolean {
  const workspaceKey = workspaceIdentity?.trim() || workspacePath;
  return state.tabs.some(
    (tab) =>
      isWorkspaceTabReadOnly(tab) &&
      (tab.workspaceIdentity?.trim() || tab.workspacePath) === workspaceKey,
  );
}

export function isSettingsTab(tab: WindowTabState): tab is SettingsTabState {
  return tab.kind === "settings";
}

// ============================================================================
// ============================================================================

export interface TabStoreState {
  
  pendingFileManagerTarget: FileManagerTarget | null;
  requestFileManager: (target: FileManagerTarget) => void;
  consumeFileManager: (target: FileManagerTarget) => boolean;
  
  tabs: WindowTabState[];
  
  activeTabId: TabId | null;
  
  activeWorkspacePath: string | null;
  
  activeWorkspaceIdentity: string | null;
  
  expandedWorkspacePaths: Set<string>;
  
  addTab: (workspacePath: string, options?: WorkspaceTabOptions) => TabId;
  
  ensureWorkspaceTab: (workspacePath: string, options?: WorkspaceTabOptions) => TabId;
  
  closeTab: (tabId: TabId, origin?: "user-close" | "restore" | "rekey") => void;
  
  lastClosedWorkspaceEvent: {
    sequence: number;
    workspaceKey: string;
    origin: "user-close" | "restore" | "rekey";
  } | null;
  
  activateTab: (tabId: TabId) => void;
  
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  
  reorderWorkspaceTabs: (fromIndex: number, toIndex: number) => void;
  
  openSettingsTab: () => void;
  
  activateTabByPath: (path: string, options?: { workspaceIdentity?: string }) => boolean;
  
  toggleWorkspaceExpanded: (path: string) => void;
  
  expandAllWorkspaceTabs: (paths: string[]) => void;
  
  collapseAllWorkspaceTabs: (paths: string[]) => void;
  
  restoreTabs: (tabs: Array<string | RestorableWorkspaceTab>, activeIndex: number) => void;
  
  completeTabRestore: (tabs: Array<string | RestorableWorkspaceTab>) => void;
}

// ============================================================================
// ============================================================================

function labelFromPath(path: string): string {
  const segments = path.replace(/\\/g, "/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

function createWorkspaceTab(
  workspacePath: string,
  options?: WorkspaceTabOptions,
): WorkspaceTabState {
  return {
    id: createUuid(),
    kind: "workspace",
    workspacePath,
    label: labelFromPath(workspacePath),
    availability: options?.availability,
    remoteSessionId: options?.remoteSessionId,
    remoteTarget: options?.remoteTarget,
    workspaceIdentity: options?.workspaceIdentity,
    previousWorkspaceIdentity: options?.previousWorkspaceIdentity,
    localWorkspacePath: options?.localWorkspacePath,
    workspacePurpose: options?.workspacePurpose,
  };
}

function mergeWorkspaceTabOptions(
  tab: WorkspaceTabState,
  options?: WorkspaceTabOptions,
): WorkspaceTabState {
  const merged: WorkspaceTabState = {
    ...tab,
    availability: options?.availability ?? tab.availability,
    remoteSessionId: options?.remoteSessionId ?? tab.remoteSessionId,
    remoteTarget: options?.remoteTarget ?? tab.remoteTarget,
    remoteHistoryId: options?.remoteHistoryId ?? tab.remoteHistoryId,
    workspaceIdentity: options?.workspaceIdentity ?? tab.workspaceIdentity,
    previousWorkspaceIdentity: options?.previousWorkspaceIdentity ?? tab.previousWorkspaceIdentity,
    localWorkspacePath: options?.localWorkspacePath ?? tab.localWorkspacePath,
    workspacePurpose: options?.workspacePurpose ?? tab.workspacePurpose,
  };
  return Object.entries(merged).every(([key, value]) =>
    Object.is(tab[key as keyof WorkspaceTabState], value),
  )
    ? tab
    : merged;
}

function normalizeRestorableWorkspaceTab(
  tab: string | RestorableWorkspaceTab,
): RestorableWorkspaceTab {
  if (typeof tab === "string") {
    return {
      workspacePath: tab,
    };
  }

  return tab;
}

function createSettingsTab(): SettingsTabState {
  return {
    id: SETTINGS_TAB_ID,
    kind: "settings",
    label: "settings",
  };
}

function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  if (!movedItem) {
    return nextItems;
  }

  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

function ensureWorkspaceExpanded(
  expandedWorkspacePaths: Set<string>,
  workspacePath: string,
): Set<string> {
  if (expandedWorkspacePaths.has(workspacePath)) {
    return expandedWorkspacePaths;
  }

  const next = new Set(expandedWorkspacePaths);
  next.add(workspacePath);
  return next;
}

function pruneExpandedWorkspace(
  expandedWorkspacePaths: Set<string>,
  workspacePath: string,
): Set<string> {
  if (!expandedWorkspacePaths.has(workspacePath)) {
    return expandedWorkspacePaths;
  }

  const next = new Set(expandedWorkspacePaths);
  next.delete(workspacePath);
  return next;
}

// ============================================================================
// ============================================================================

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createTabStore(storage: StorageLike | null | undefined = undefined) {
  return create<TabStoreState>()((set, get) => ({
    tabs: [],
    pendingFileManagerTarget: null,
    requestFileManager: (target) => {
      set({ pendingFileManagerTarget: target });
      get().addTab(target.workspacePath, {
        workspaceIdentity: target.workspaceIdentity,
        remoteSessionId: target.workspaceRemoteSessionId,
      });
    },
    consumeFileManager: (target) => {
      if (get().pendingFileManagerTarget !== target) return false;
      set({ pendingFileManagerTarget: null });
      return true;
    },
    activeTabId: null,
    activeWorkspacePath: null,
    activeWorkspaceIdentity: null,
    expandedWorkspacePaths: new Set<string>(),

    addTab: (workspacePath: string, options) => {
      const existing = get().tabs.find(
        (tab): tab is WorkspaceTabState =>
          isWorkspaceTab(tab) && isSameWorkspaceTab(tab, workspacePath, options),
      );
      if (existing) {
        const merged = mergeWorkspaceTabOptions(existing, options);
        persistWorkspaceExpandedPreference(
          resolveWorkspaceKey({
            ...existing,
            workspaceIdentity: options?.workspaceIdentity ?? existing.workspaceIdentity,
          }),
          true,
          storage,
        );
        set((state) => ({
          tabs:
            merged === existing
              ? state.tabs
              : state.tabs.map((tab) => (tab.id === existing.id ? merged : tab)),
          activeTabId: existing.id,
          activeWorkspacePath: existing.workspacePath,
          activeWorkspaceIdentity: options?.workspaceIdentity ?? existing.workspaceIdentity ?? null,
          expandedWorkspacePaths: ensureWorkspaceExpanded(
            state.expandedWorkspacePaths,
            resolveWorkspaceKey({
              ...existing,
              workspaceIdentity: options?.workspaceIdentity ?? existing.workspaceIdentity,
            }),
          ),
        }));
        return existing.id;
      }

      const tab = createWorkspaceTab(workspacePath, options);
      persistWorkspaceExpandedPreference(resolveWorkspaceKey(tab), true, storage);
      set((state) => ({
        tabs: [tab, ...state.tabs],
        activeTabId: tab.id,
        activeWorkspacePath: workspacePath,
        activeWorkspaceIdentity: tab.workspaceIdentity ?? null,
        expandedWorkspacePaths: ensureWorkspaceExpanded(
          state.expandedWorkspacePaths,
          resolveWorkspaceKey(tab),
        ),
      }));
      return tab.id;
    },

    ensureWorkspaceTab: (workspacePath: string, options) => {
      const existing = get().tabs.find(
        (tab): tab is WorkspaceTabState =>
          isWorkspaceTab(tab) && isSameWorkspaceTab(tab, workspacePath, options),
      );
      if (existing) {
        persistWorkspaceExpandedPreference(
          resolveWorkspaceKey({
            ...existing,
            workspaceIdentity: options?.workspaceIdentity ?? existing.workspaceIdentity,
          }),
          true,
          storage,
        );
        set((state) => {
          const rekeysActiveWorkspace =
            state.activeTabId === existing.id ||
            (state.activeWorkspacePath === existing.workspacePath &&
              state.activeWorkspaceIdentity === existing.workspaceIdentity);
          return {
            tabs: state.tabs.map((tab) =>
              tab.id !== existing.id || !isWorkspaceTab(tab)
                ? tab
                : mergeWorkspaceTabOptions(tab, options),
            ),
            activeWorkspaceIdentity: rekeysActiveWorkspace
              ? (options?.workspaceIdentity ?? existing.workspaceIdentity ?? null)
              : state.activeWorkspaceIdentity,
            expandedWorkspacePaths: ensureWorkspaceExpanded(
              state.expandedWorkspacePaths,
              resolveWorkspaceKey({
                ...existing,
                workspaceIdentity: options?.workspaceIdentity ?? existing.workspaceIdentity,
              }),
            ),
          };
        });
        return existing.id;
      }

      const tab = createWorkspaceTab(workspacePath, options);
      persistWorkspaceExpandedPreference(resolveWorkspaceKey(tab), true, storage);
      set((state) => ({
        tabs: [tab, ...state.tabs],
        expandedWorkspacePaths: ensureWorkspaceExpanded(
          state.expandedWorkspacePaths,
          resolveWorkspaceKey(tab),
        ),
      }));
      return tab.id;
    },

    lastClosedWorkspaceEvent: null,

    closeTab: (tabId: TabId, origin = "user-close") => {
      const stateBefore = get();
      const { tabs, activeTabId } = stateBefore;
      const index = tabs.findIndex((t) => t.id === tabId);
      if (index === -1) {
        return;
      }

      const closingTab = tabs[index] ?? null;
      const newTabs = tabs.filter((t) => t.id !== tabId);
      const closedWorkspaceKey =
        closingTab && isWorkspaceTab(closingTab)
          ? closingTab.workspaceIdentity?.trim() ||
            (closingTab.remoteSessionId || closingTab.remoteTarget
              ? closingTab.workspacePath
              : null)
          : null;

      let newActiveTabId = activeTabId;
      if (activeTabId === tabId) {
        if (newTabs.length === 0) {
          newActiveTabId = null;
        } else {
          const newIndex = Math.min(index, newTabs.length - 1);
          newActiveTabId = newTabs[newIndex]!.id;
        }
      }

      const nextWorkspaceTab = newTabs.find((tab) => tab.id === newActiveTabId);
      const fallbackWorkspacePath = (() => {
        if (nextWorkspaceTab && isWorkspaceTab(nextWorkspaceTab)) {
          return nextWorkspaceTab.workspacePath;
        }

        if (closingTab && isWorkspaceTab(closingTab)) {
          const replacementWorkspace = newTabs.find(isWorkspaceTab);
          return replacementWorkspace?.workspacePath ?? null;
        }

        return stateBefore.activeWorkspacePath;
      })();
      const fallbackWorkspaceIdentity = (() => {
        if (nextWorkspaceTab && isWorkspaceTab(nextWorkspaceTab)) {
          return nextWorkspaceTab.workspaceIdentity ?? null;
        }

        if (closingTab && isWorkspaceTab(closingTab)) {
          const replacementWorkspace = newTabs.find(isWorkspaceTab);
          return replacementWorkspace?.workspaceIdentity ?? null;
        }

        return stateBefore.activeWorkspaceIdentity;
      })();

      const nextState = {
        tabs: newTabs,
        activeTabId: newActiveTabId,
        activeWorkspacePath: fallbackWorkspacePath,
        activeWorkspaceIdentity: fallbackWorkspaceIdentity,
        expandedWorkspacePaths: (() => {
          const prunedExpandedWorkspacePaths =
            closingTab && isWorkspaceTab(closingTab)
              ? pruneExpandedWorkspace(
                  stateBefore.expandedWorkspacePaths,
                  resolveWorkspaceKey(closingTab),
                )
              : stateBefore.expandedWorkspacePaths;

          return fallbackWorkspacePath
            ? ensureWorkspaceExpanded(
                prunedExpandedWorkspacePaths,
                fallbackWorkspaceIdentity?.trim() || fallbackWorkspacePath,
              )
            : prunedExpandedWorkspacePaths;
        })(),
      };

      if (fallbackWorkspacePath) {
        persistWorkspaceExpandedPreference(
          fallbackWorkspaceIdentity?.trim() || fallbackWorkspacePath,
          true,
          storage,
        );
      }

      set(nextState);
      if (closedWorkspaceKey) {
        set((state) => ({
          lastClosedWorkspaceEvent: {
            sequence: (state.lastClosedWorkspaceEvent?.sequence ?? 0) + 1,
            workspaceKey: closedWorkspaceKey,
            origin,
          },
        }));
      }
    },

    activateTab: (tabId: TabId) => {
      const stateBefore = get();
      const tab = stateBefore.tabs.find((t) => t.id === tabId);
      if (!tab) {
        return;
      }

      const nextState = {
        activeTabId: tabId,
        activeWorkspacePath: isWorkspaceTab(tab)
          ? tab.workspacePath
          : stateBefore.activeWorkspacePath,
        activeWorkspaceIdentity: isWorkspaceTab(tab)
          ? (tab.workspaceIdentity ?? null)
          : stateBefore.activeWorkspaceIdentity,
        expandedWorkspacePaths: isWorkspaceTab(tab)
          ? ensureWorkspaceExpanded(stateBefore.expandedWorkspacePaths, resolveWorkspaceKey(tab))
          : stateBefore.expandedWorkspacePaths,
      };

      if (isWorkspaceTab(tab)) {
        persistWorkspaceExpandedPreference(resolveWorkspaceKey(tab), true, storage);
      }

      set(nextState);
    },

    reorderTabs: (fromIndex: number, toIndex: number) => {
      set((state) => {
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= state.tabs.length ||
          toIndex >= state.tabs.length ||
          fromIndex === toIndex
        ) {
          return state;
        }

        const newTabs = moveItem(state.tabs, fromIndex, toIndex);
        return { tabs: newTabs };
      });
    },

    reorderWorkspaceTabs: (fromIndex: number, toIndex: number) => {
      set((state) => {
        const workspaceTabs = state.tabs.filter(isWorkspaceTab);
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= workspaceTabs.length ||
          toIndex >= workspaceTabs.length ||
          fromIndex === toIndex
        ) {
          return state;
        }

        const reorderedWorkspaceTabs = moveItem(workspaceTabs, fromIndex, toIndex);
        let workspaceIndex = 0;
        const newTabs = state.tabs.map((tab) => {
          if (!isWorkspaceTab(tab)) {
            return tab;
          }

          return reorderedWorkspaceTabs[workspaceIndex++] ?? tab;
        });

        return { tabs: newTabs };
      });
    },

    openSettingsTab: () => {
      const existing = get().tabs.find(isSettingsTab);
      if (existing) {
        set({ activeTabId: existing.id });
        return;
      }

      const settingsTab = createSettingsTab();
      set((state) => ({
        tabs: [...state.tabs, settingsTab],
        activeTabId: settingsTab.id,
      }));
    },

    toggleWorkspaceExpanded: (path: string) => {
      set((state) => {
        const expandedWorkspacePaths = new Set(state.expandedWorkspacePaths);
        const nextExpanded = !expandedWorkspacePaths.has(path);
        if (expandedWorkspacePaths.has(path)) {
          expandedWorkspacePaths.delete(path);
        } else {
          expandedWorkspacePaths.add(path);
        }

        persistWorkspaceExpandedPreference(path, nextExpanded, storage);

        return { expandedWorkspacePaths };
      });
    },

    expandAllWorkspaceTabs: (paths: string[]) => {
      set((state) => {
        const expandedWorkspacePaths = new Set(state.expandedWorkspacePaths);
        for (const path of paths) {
          expandedWorkspacePaths.add(path);
          persistWorkspaceExpandedPreference(path, true, storage);
        }
        return { expandedWorkspacePaths };
      });
    },

    collapseAllWorkspaceTabs: (paths: string[]) => {
      set((state) => {
        const expandedWorkspacePaths = new Set(state.expandedWorkspacePaths);
        for (const path of paths) {
          expandedWorkspacePaths.delete(path);
          persistWorkspaceExpandedPreference(path, false, storage);
        }
        return { expandedWorkspacePaths };
      });
    },

    activateTabByPath: (path: string, options) => {
      const stateBefore = get();
      const tab = stateBefore.tabs.find((currentTab): currentTab is WorkspaceTabState => {
        if (!isWorkspaceTab(currentTab) || currentTab.workspacePath !== path) {
          return false;
        }

        if (options?.workspaceIdentity) {
          return currentTab.workspaceIdentity === options.workspaceIdentity;
        }

        return true;
      });
      if (!tab) {
        return false;
      }

      const nextState = {
        activeTabId: tab.id,
        activeWorkspacePath: path,
        activeWorkspaceIdentity: tab.workspaceIdentity ?? null,
        expandedWorkspacePaths: ensureWorkspaceExpanded(
          stateBefore.expandedWorkspacePaths,
          resolveWorkspaceKey(tab),
        ),
      };

      persistWorkspaceExpandedPreference(resolveWorkspaceKey(tab), true, storage);

      set(nextState);
      return true;
    },

    restoreTabs: (tabsInput, activeIndex: number) => {
      if (tabsInput.length === 0) return;
      const tabs = tabsInput.map((tab) => {
        const normalized = normalizeRestorableWorkspaceTab(tab);
        return createWorkspaceTab(normalized.workspacePath, {
          remoteSessionId: normalized.remoteSessionId,
          remoteTarget: normalized.remoteTarget,
          workspaceIdentity: normalized.workspaceIdentity,
          workspacePurpose: normalized.workspacePurpose,
          availability: normalized.availability,
        });
      });
      const safeIndex = Math.min(Math.max(activeIndex, 0), tabs.length - 1);
      const activeWorkspaceTab = tabs[safeIndex];
      if (!activeWorkspaceTab || !isWorkspaceTab(activeWorkspaceTab)) {
        return;
      }
      activeWorkspaceTab.restorePaneSession = true;
      const expansionState: WorkspaceExpansionState = readWorkspaceExpansionState(storage);
      set({
        tabs,
        activeTabId: activeWorkspaceTab.id,
        activeWorkspacePath: activeWorkspaceTab.workspacePath,
        activeWorkspaceIdentity: activeWorkspaceTab.workspaceIdentity ?? null,
        expandedWorkspacePaths: resolveExpandedWorkspacePaths(
          tabs.map(resolveWorkspaceKey),
          expansionState,
        ),
      });
    },

    completeTabRestore: (tabsInput) => {
      if (tabsInput.length === 0) return;
      set((state) => {
        const consumedTabIds = new Set<TabId>();
        const completedTabs = tabsInput.map((tabInput) => {
          const normalized = normalizeRestorableWorkspaceTab(tabInput);
          const options: WorkspaceTabOptions = {
            remoteSessionId: normalized.remoteSessionId,
            remoteTarget: normalized.remoteTarget,
            workspaceIdentity: normalized.workspaceIdentity,
            localWorkspacePath: normalized.localWorkspacePath,
            workspacePurpose: normalized.workspacePurpose,
            availability: normalized.availability,
          };
          const existing = state.tabs.find(
            (tab): tab is WorkspaceTabState =>
              isWorkspaceTab(tab) &&
              !consumedTabIds.has(tab.id) &&
              isSameWorkspaceTab(tab, normalized.workspacePath, options),
          );
          if (existing) {
            consumedTabIds.add(existing.id);
            return mergeWorkspaceTabOptions(existing, options);
          }
          return createWorkspaceTab(normalized.workspacePath, options);
        });
        const extraWorkspaceTabs = state.tabs.filter(
          (tab): tab is WorkspaceTabState => isWorkspaceTab(tab) && !consumedTabIds.has(tab.id),
        );
        const nonWorkspaceTabs = state.tabs.filter((tab) => !isWorkspaceTab(tab));
        const tabs = [...extraWorkspaceTabs, ...completedTabs, ...nonWorkspaceTabs];
        const expansionState = readWorkspaceExpansionState(storage);

        return {
          tabs,
          activeTabId: state.activeTabId,
          activeWorkspacePath: state.activeWorkspacePath,
          activeWorkspaceIdentity: state.activeWorkspaceIdentity,
          expandedWorkspacePaths: resolveExpandedWorkspacePaths(
            tabs.filter(isWorkspaceTab).map(resolveWorkspaceKey),
            expansionState,
          ),
        };
      });
    },
  }));
}

export type TabStore = ReturnType<typeof createTabStore>;
