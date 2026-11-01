// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { usePluginManagementStore } = await import("@/store/pluginManagementStore.js");

const WORKSPACE = "/tmp/workspace";
const CUA_PLUGIN_ID = "computer-use@cf-plugins-official";
const OTHER_PLUGIN_ID = "some-other-plugin@mp";

function resetStore(overrides: Record<string, unknown> = {}): void {
  usePluginManagementStore.setState({
    workspacePath: WORKSPACE,
    workspaceIdentity: null,
    plugins: [],
    error: null,
    lastFailedPluginId: null,
    togglingPluginId: null,
    activeOperations: [],
    ...overrides,
  });
}

function pluginService(overrides: Record<string, unknown> = {}): never {
  return {
    listPlugins: vi.fn(async () => ({ plugins: [], diagnostics: [] })),
    getPluginsOverview: vi.fn(async () => ({
      plugins: [],
      marketplaces: [],
      availablePlugins: [],
      installedPlugins: [],
      restorableBuiltins: [],
      diagnostics: [],
    })),
    setPluginEnabled: vi.fn(async () => {}),
    validatePlugin: vi.fn(async () => ({ diagnostics: [] })),
    ...overrides,
  } as never;
}

beforeEach(() => {
  resetStore();
});

describe("pluginManagementStore 错误归属", () => {
  it("Log target plugin id when setEnabled fails", async () => {
    const service = pluginService({
      setPluginEnabled: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const ok = await usePluginManagementStore.getState().setEnabled(OTHER_PLUGIN_ID, true, service);
    expect(ok).toBe(false);
    const state = usePluginManagementStore.getState();
    expect(state.error).toContain("boom");
    expect(state.lastFailedPluginId).toBe(OTHER_PLUGIN_ID);
  });

  it("Log null when validateSource fails (no target plugin)", async () => {
    const service = pluginService({
      validatePlugin: vi.fn(async () => {
        throw new Error("bad source");
      }),
    });
    await usePluginManagementStore.getState().validateSource("https://example.com/mp", service);
    const state = usePluginManagementStore.getState();
    expect(state.error).toContain("bad source");
    expect(state.lastFailedPluginId).toBeNull();
  });

  it("新的成功操作清空 error 与归属", async () => {
    const failing = pluginService({
      setPluginEnabled: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    await usePluginManagementStore.getState().setEnabled(CUA_PLUGIN_ID, true, failing);
    expect(usePluginManagementStore.getState().lastFailedPluginId).toBe(CUA_PLUGIN_ID);

    const succeeding = pluginService();
    const ok = await usePluginManagementStore
      .getState()
      .setEnabled(CUA_PLUGIN_ID, true, succeeding);
    expect(ok).toBe(true);
    const state = usePluginManagementStore.getState();
    expect(state.error).toBeNull();
    expect(state.lastFailedPluginId).toBeNull();
  });
});
