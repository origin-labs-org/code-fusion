import { create } from "zustand";
import { isRendererReloadNavigation } from "@/lib/rendererNavigation.js";
import {
  persistPaneLayout,
  readPersistedPaneLayout,
} from "@/v4/paneLayoutPersistence.js";
import {
  bindPaneSession,
  closePane,
  confirmRestoredPaneSession,
  focusPane,
  INITIAL_PANE_LAYOUT,
  openSessionInNewPane,
  replacePaneBinding,
  setSplitNodeRatio,
  splitPaneAt,
  splitPaneAtSide,
  type PaneBinding,
  type PaneLayoutSnapshot,
  type PaneSplitSide,
  type PaneWorkspaceScope,
  type SplitDirection,
} from "@/v4/paneLayoutTree.js";

const persistedPaneLayoutAtModuleLoad = readPersistedPaneLayout();
const restoredPaneLayoutAtModuleLoad = isRendererReloadNavigation()
  ? persistedPaneLayoutAtModuleLoad
  : null;

export function hadPersistedPaneLayoutAtModuleLoad(): boolean {
  return persistedPaneLayoutAtModuleLoad !== null;
}

export * from "@/v4/paneLayoutTree.js";
export * from "@/v4/paneLayoutPersistence.js";

export interface PaneLayoutStore extends PaneLayoutSnapshot {
  
  splitPane: (
    anchorPaneId: string,
    direction: SplitDirection,
    scope: PaneWorkspaceScope,
  ) => void;
  
  splitPaneWithBinding: (
    anchorPaneId: string,
    side: PaneSplitSide,
    binding: PaneBinding,
  ) => void;
  
  openSessionInNewPane: (scope: PaneWorkspaceScope, sessionId: string) => void;
  
  replacePaneBinding: (paneId: string, binding: PaneBinding) => void;
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  bindPaneSession: (paneId: string, sessionId: string) => void;
  setSplitRatio: (splitId: string, ratio: number) => void;
  confirmRestoredPaneSession: (paneId: string) => void;
  
  resetToPrimaryPane: () => void;
}

export const usePaneLayoutStore = create<PaneLayoutStore>()((set) => ({
  ...(restoredPaneLayoutAtModuleLoad ?? INITIAL_PANE_LAYOUT),

  splitPane: (anchorPaneId, direction, scope) => {
    set((state) =>
      splitPaneAt(state, anchorPaneId, direction, {
        workspaceScope: scope,
        sessionId: null,
      }),
    );
  },

  splitPaneWithBinding: (anchorPaneId, side, binding) => {
    set((state) => splitPaneAtSide(state, anchorPaneId, side, binding));
  },

  openSessionInNewPane: (scope, sessionId) => {
    set((state) => openSessionInNewPane(state, scope, sessionId));
  },

  replacePaneBinding: (paneId, binding) => {
    set((state) => replacePaneBinding(state, paneId, binding));
  },

  closePane: (paneId) => {
    set((state) => closePane(state, paneId));
  },

  focusPane: (paneId) => {
    set((state) => focusPane(state, paneId));
  },

  bindPaneSession: (paneId, sessionId) => {
    set((state) => bindPaneSession(state, paneId, sessionId));
  },

  setSplitRatio: (splitId, ratio) => {
    set((state) => setSplitNodeRatio(state, splitId, ratio));
  },

  confirmRestoredPaneSession: (paneId) => {
    set((state) => confirmRestoredPaneSession(state, paneId));
  },

  resetToPrimaryPane: () => {
    set(INITIAL_PANE_LAYOUT);
  },
}));

usePaneLayoutStore.subscribe((state) => {
  persistPaneLayout(state);
});
