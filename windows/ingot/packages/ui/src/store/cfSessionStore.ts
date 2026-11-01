
import { create } from "zustand";
import { shouldExposeE2EStoreBridge } from "@/lib/e2eStoreBridge.js";
import { type CfSessionStoreState } from "./cfSessionStoreTypes.js";
import { getWorkspaceState } from "./cfSessionStoreSelectors.js";
import { createNavigationSlice } from "./cfSessionStoreNavigation.js";
import { createTaskSlice } from "./cfSessionStoreTaskSlice.js";
import { createWorkspaceSlice } from "./cfSessionStoreWorkspaceSlice.js";
import { uiMemoryDiagnosticsRegistry } from "@/lib/memoryDiagnostics.js";

export const useCfSessionStore = create<CfSessionStoreState>()((set, get) => ({
  workspaces: {},
  ...createNavigationSlice(set, get),
  ...createWorkspaceSlice(set),
  ...createTaskSlice(set),
  getWorkspaceState: (workspacePath: string, workspaceIdentity?: string) =>
    getWorkspaceState(get(), workspacePath, workspaceIdentity),
}));

type CfSessionStoreE2EBridge = typeof useCfSessionStore;

declare global {
  interface Window {
    __cfSessionStoreE2E?: CfSessionStoreE2EBridge;
  }
}

if (shouldExposeE2EStoreBridge()) {
  window.__cfSessionStoreE2E = useCfSessionStore;
}

// ────────────────────────────────────────────
// ────────────────────────────────────────────
export * from "./cfSessionStoreTypes.js";
export * from "./cfSessionStoreSelectors.js";
// Re-export navigation types used externally:
export type {
  TaskNavigationHistory,
  TaskNavEntry,
  WorkspaceNavEntry,
} from "@/lib/taskNavigationHistory.js";

uiMemoryDiagnosticsRegistry.register("sessionStore", () => ({
  workspaces: Object.keys(useCfSessionStore.getState().workspaces).length,
}));
