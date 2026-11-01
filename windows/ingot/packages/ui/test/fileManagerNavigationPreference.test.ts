import type { IBroadcastService } from "@origin-ai/cf-services";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createCfStore,
  FILE_MANAGER_NAVIGATION_PREFERENCES_STORAGE_KEY,
} from "@/store/index.js";

const localStorageState = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageState.get(key) ?? null,
    setItem: (key: string, value: string) => {
      localStorageState.set(key, value);
    },
    removeItem: (key: string) => {
      localStorageState.delete(key);
    },
    clear: () => {
      localStorageState.clear();
    },
  },
});

Object.defineProperty(globalThis, "document", {
  configurable: true,
  value: {
    documentElement: {
      classList: {
        contains: () => false,
        toggle: () => {},
      },
    },
  },
});

const mockBroadcastService: IBroadcastService = {
  send: async () => {},
  onMessage: () => ({ dispose: () => {} }),
};

function isNavigationOpen(
  store: ReturnType<typeof createCfStore>,
  workspaceKey: string,
): boolean {
  return store.getState().fileManagerNavigationOpenByWorkspace[workspaceKey] ?? true;
}

describe("file manager navigation preference", () => {
  beforeEach(() => {
    localStorageState.clear();
  });

  it("Same workspace across store rebuilds restores last visibility state", () => {
    const firstStore = createCfStore(mockBroadcastService);

    firstStore.getState().setFileManagerNavigationOpen("workspace-a", false);

    expect(isNavigationOpen(firstStore, "workspace-a")).toBe(false);
    expect(isNavigationOpen(createCfStore(mockBroadcastService), "workspace-a")).toBe(false);
  });

  it("Different workspaces save visibility states separately", () => {
    const store = createCfStore(mockBroadcastService);

    store.getState().setFileManagerNavigationOpen("workspace-a", false);

    expect(isNavigationOpen(store, "workspace-a")).toBe(false);
    expect(isNavigationOpen(store, "workspace-b")).toBe(true);

    store.getState().setFileManagerNavigationOpen("workspace-b", false);
    store.getState().setFileManagerNavigationOpen("workspace-a", true);

    expect(isNavigationOpen(store, "workspace-a")).toBe(true);
    expect(isNavigationOpen(store, "workspace-b")).toBe(false);
  });

  it("Corrupted or invalid persisted data falls back to expanded by default", () => {
    localStorageState.set(FILE_MANAGER_NAVIGATION_PREFERENCES_STORAGE_KEY, "not-json");
    expect(isNavigationOpen(createCfStore(mockBroadcastService), "workspace-a")).toBe(true);

    localStorageState.set(
      FILE_MANAGER_NAVIGATION_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ "workspace-a": "false", "workspace-b": false }),
    );
    const store = createCfStore(mockBroadcastService);

    expect(isNavigationOpen(store, "workspace-a")).toBe(true);
    expect(isNavigationOpen(store, "workspace-b")).toBe(false);
  });
});
