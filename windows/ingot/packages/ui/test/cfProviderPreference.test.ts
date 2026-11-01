import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCfSessionStore } from "../src/store/cfSessionStore.js";
import { LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY } from "../src/lib/cfProviderPreference.js";

function createStorageMock(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));

  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
  };
}

describe("agent provider preference", () => {
  beforeEach(() => {
    useCfSessionStore.setState((state) => ({
      ...state,
      workspaces: {},
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("startDraft also immediately normalizes the latest selection when choosing an old provider", () => {
    const storage = createStorageMock();
    vi.stubGlobal("window", { localStorage: storage });

    useCfSessionStore.getState().startDraft("/tmp/workspace-draft", "gemini");

    expect(storage.getItem(LAST_SELECTED_AGENT_PROVIDER_STORAGE_KEY)).toBe("glm");
    expect(
      useCfSessionStore.getState().getWorkspaceState("/tmp/workspace-draft").selectedProvider,
    ).toBe("glm");
  });
});
