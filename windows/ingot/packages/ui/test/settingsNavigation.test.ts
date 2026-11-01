import { afterEach, describe, expect, it, vi } from "vitest";

async function loadSettingsNavigation(env: "test" | "production") {
  vi.resetModules();
  vi.doMock("@origin-ai/cf-shared", async () => {
    const actual = await vi.importActual<typeof import("@origin-ai/cf-shared")>("@origin-ai/cf-shared");
    return {
      ...actual,
      CF_ENV: env,
    };
  });

  return import("../src/lib/settingsNavigation.js");
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("settingsNavigation", () => {
  it("保留 usage、hooks 和 memory 分区", async () => {
    const navigation = await loadSettingsNavigation("test");

    expect(navigation.isSettingsSectionEnabled("usage")).toBe(true);
    expect(navigation.resolveSettingsSection("usage", "modelProvider")).toBe("usage");
    expect(navigation.isSettingsSectionEnabled("hooks")).toBe(true);
    expect(navigation.resolveSettingsSection("hooks", "modelProvider")).toBe("hooks");
    expect(navigation.isSettingsSectionEnabled("memory")).toBe(true);
    expect(navigation.resolveSettingsSection("memory", "general")).toBe("memory");
  });

  it("通知已打开的设置页切换到新的分区意图", async () => {
    const eventTarget = new EventTarget();
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
    const navigation = await loadSettingsNavigation("test");
    const listener = vi.fn();

    const dispose = navigation.addPendingSettingsSectionListener(listener);
    navigation.setPendingSettingsSection("general");

    expect(listener).toHaveBeenCalledWith("general", {
      section: "general",
      usageTab: undefined,
      modelProviderId: undefined,
    });
    expect(storage.has("cf-settings-section-intent")).toBe(false);
    dispose();
  });

  it("Quick Pick MCP, Skill, and Command intents route directly to dedicated sections", async () => {
    const eventTarget = new EventTarget();
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    const navigation = await loadSettingsNavigation("test");
    const listener = vi.fn();
    const dispose = navigation.addPendingSettingsSectionListener(listener);

    navigation.setPendingSettingsPluginIntent("mcps");
    expect(listener).toHaveBeenLastCalledWith(
      "mcp",
      expect.objectContaining({
        section: "mcp",
      }),
    );

    navigation.setPendingSettingsPluginIntent("skills");
    expect(listener).toHaveBeenLastCalledWith(
      "skill",
      expect.objectContaining({ section: "skill" }),
    );
    navigation.setPendingSettingsPluginIntent("commands");
    expect(listener).toHaveBeenLastCalledWith(
      "commands",
      expect.objectContaining({ section: "commands" }),
    );
    dispose();
  });

  it("Plugin marketplace management entry carries one-time parent source", async () => {
    const eventTarget = new EventTarget();
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    const navigation = await loadSettingsNavigation("plugin-store-origin");

    const workspaceScopeKey = "remote:ssh:host-a:22:user:/workspace";
    navigation.setPendingSettingsPluginIntent("plugins", {
      origin: "plugin-store",
      scopeKey: workspaceScopeKey,
    });

    expect(navigation.consumePendingSettingsPluginOrigin()).toBe("plugin-store");
    expect(navigation.consumePendingSettingsPluginScopeKey()).toBe(workspaceScopeKey);
    expect(navigation.consumePendingSettingsPluginScopeKey()).toBe(workspaceScopeKey);
    navigation.clearPendingSettingsPluginScopeKey();
    expect(navigation.consumePendingSettingsPluginScopeKey()).toBeUndefined();
    expect(navigation.consumePendingSettingsPluginOrigin()).toBe("plugin-store");
    navigation.clearPendingSettingsPluginOrigin();
    expect(navigation.consumePendingSettingsPluginOrigin()).toBeUndefined();
  });

  it("Open settings page receives specific Workspace scopeKey; event does not leak to next mount after consumption", async () => {
    const eventTarget = new EventTarget();
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });
    const navigation = await loadSettingsNavigation("test");
    const listener = vi.fn();
    const dispose = navigation.addPendingSettingsSectionListener(listener);
    const scopeKey = "remote:ssh:host-b:22:user:/workspace";

    navigation.setPendingSettingsPluginIntent("plugins", {
      origin: "plugin-store",
      scopeKey,
    });

    expect(listener).toHaveBeenCalledWith(
      "plugin",
      expect.objectContaining({
        pluginOrigin: "plugin-store",
        pluginScopeKey: scopeKey,
        pluginTab: "plugins",
      }),
    );
    expect(storage.has("cf-settings-plugin-scope-key-intent")).toBe(false);
    expect(navigation.consumePendingSettingsPluginScopeKey()).toBeUndefined();
    dispose();
  });

  it("剩余额度详情入口写入 usage coding plan 跳转意图", async () => {
    const eventTarget = new EventTarget();
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      addEventListener: eventTarget.addEventListener.bind(eventTarget),
      removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
      dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
      localStorage: {
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => undefined,
      },
    });
    const navigation = await loadSettingsNavigation("test");
    const listener = vi.fn();
    const dispose = navigation.addPendingSettingsSectionListener(listener);

    navigation.setPendingSettingsUsageCodingPlanIntent();

    expect(listener).toHaveBeenCalledWith("usage", {
      section: "usage",
      usageTab: "codingPlan",
      modelProviderId: undefined,
    });
    expect(navigation.consumePendingSettingsUsageTab()).toBeUndefined();

    dispose();
    navigation.setPendingSettingsUsageCodingPlanIntent();

    expect(navigation.consumeInitialSettingsSection("general")).toBe("usage");
    expect(navigation.consumePendingSettingsUsageTab()).toBe("codingPlan");
  });

  it("provider loading 期间保留 coding plan 使用统计 tab 意图", async () => {
    const navigation = await loadSettingsNavigation("test");

    expect(
      navigation.shouldFallbackSettingsUsageTabToApp({
        activeTab: "codingPlan",
        checkingCodingPlanTab: false,
        loadingModelProviders: true,
        showCodingPlanTab: false,
      }),
    ).toBe(false);
    expect(
      navigation.shouldFallbackSettingsUsageTabToApp({
        activeTab: "codingPlan",
        checkingCodingPlanTab: true,
        loadingModelProviders: false,
        showCodingPlanTab: false,
      }),
    ).toBe(false);
    expect(
      navigation.shouldFallbackSettingsUsageTabToApp({
        activeTab: "codingPlan",
        checkingCodingPlanTab: false,
        loadingModelProviders: false,
        showCodingPlanTab: false,
      }),
    ).toBe(true);
  });

  it("Deprecated section intents fallback to safe section", async () => {
    const storage = new Map<string, string>([
      ["cf-settings-section-intent", "legacy-removed-section"],
    ]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        removeItem: (key: string) => storage.delete(key),
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
    const navigation = await loadSettingsNavigation("test");

    expect(navigation.consumePendingSettingsSection("modelProvider")).toBe("modelProvider");
    expect(storage.has("cf-settings-section-intent")).toBe(false);
  });

  it("Keep MCP settings section as dedicated entry", async () => {
    const sessionStorage = new Map<string, string>();
    const localStorage = new Map<string, string>([["cf-settings-last-section", "mcp"]]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => sessionStorage.get(key) ?? null,
        removeItem: (key: string) => sessionStorage.delete(key),
        setItem: (key: string, value: string) => {
          sessionStorage.set(key, value);
        },
      },
      localStorage: {
        getItem: (key: string) => localStorage.get(key) ?? null,
        removeItem: (key: string) => localStorage.delete(key),
        setItem: (key: string, value: string) => {
          localStorage.set(key, value);
        },
      },
    });
    const navigation = await loadSettingsNavigation("test");

    expect(navigation.consumeInitialSettingsSection("general")).toBe("mcp");
    expect(localStorage.get("cf-settings-last-section")).toBe("mcp");
  });

  it("Migrate old Skills one-time navigation intent to dedicated skill entry", async () => {
    const sessionStorage = new Map<string, string>([["cf-settings-section-intent", "skills"]]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => sessionStorage.get(key) ?? null,
        removeItem: (key: string) => sessionStorage.delete(key),
        setItem: (key: string, value: string) => sessionStorage.set(key, value),
      },
      localStorage: {
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => undefined,
      },
    });
    const navigation = await loadSettingsNavigation("test");

    expect(navigation.consumeInitialSettingsSection("general")).toBe("skill");
  });

  it("Clean up deprecated customize section", async () => {
    const localStorage = new Map<string, string>([["cf-settings-last-section", "customize"]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => localStorage.get(key) ?? null,
        removeItem: (key: string) => localStorage.delete(key),
        setItem: (key: string, value: string) => localStorage.set(key, value),
      },
      sessionStorage: {
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => undefined,
      },
    });
    const navigation = await loadSettingsNavigation("test");

    expect(navigation.readLastSettingsSectionPreference("general")).toBe("general");
    expect(localStorage.has("cf-settings-last-section")).toBe(false);
  });

  it("Migrate old code preview section to Appearance", async () => {
    const localStorage = new Map<string, string>([["cf-settings-last-section", "codePreview"]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => localStorage.get(key) ?? null,
        removeItem: (key: string) => localStorage.delete(key),
        setItem: (key: string, value: string) => localStorage.set(key, value),
      },
    });
    const navigation = await loadSettingsNavigation("test");

    expect(navigation.readLastSettingsSectionPreference()).toBe("appearance");
    expect(localStorage.get("cf-settings-last-section")).toBe("appearance");
  });

  it("Explicit settings section intent takes precedence over the last visited section", async () => {
    const sessionStorage = new Map<string, string>([
      ["cf-settings-section-intent", "modelProvider"],
    ]);
    const localStorage = new Map<string, string>([["cf-settings-last-section", "mcp"]]);
    vi.stubGlobal("window", {
      sessionStorage: {
        getItem: (key: string) => sessionStorage.get(key) ?? null,
        removeItem: (key: string) => sessionStorage.delete(key),
        setItem: (key: string, value: string) => {
          sessionStorage.set(key, value);
        },
      },
      localStorage: {
        getItem: (key: string) => localStorage.get(key) ?? null,
        removeItem: (key: string) => localStorage.delete(key),
        setItem: (key: string, value: string) => {
          localStorage.set(key, value);
        },
      },
    });
    const navigation = await loadSettingsNavigation("test");

    expect(navigation.consumeInitialSettingsSection("general")).toBe("modelProvider");
    expect(sessionStorage.has("cf-settings-section-intent")).toBe(false);
  });

  it("Record the last visited section in settings and clear invalid legacy values", async () => {
    const localStorage = new Map<string, string>([
      ["cf-settings-last-section", "legacy-removed-section"],
    ]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => localStorage.get(key) ?? null,
        removeItem: (key: string) => localStorage.delete(key),
        setItem: (key: string, value: string) => {
          localStorage.set(key, value);
        },
      },
      sessionStorage: {
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => undefined,
      },
    });
    const navigation = await loadSettingsNavigation("test");

    expect(navigation.readLastSettingsSectionPreference("general")).toBe("general");
    expect(localStorage.has("cf-settings-last-section")).toBe(false);

    navigation.writeLastSettingsSectionPreference("plugin");

    expect(localStorage.get("cf-settings-last-section")).toBe("plugin");
  });

  it("Preserve historical preferences for the hooks section", async () => {
    const localStorage = new Map<string, string>([["cf-settings-last-section", "hooks"]]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => localStorage.get(key) ?? null,
        removeItem: (key: string) => localStorage.delete(key),
        setItem: (key: string, value: string) => {
          localStorage.set(key, value);
        },
      },
      sessionStorage: {
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => undefined,
      },
    });
    const navigation = await loadSettingsNavigation("test");

    expect(navigation.readLastSettingsSectionPreference("general")).toBe("hooks");

    navigation.writeLastSettingsSectionPreference("hooks");

    expect(localStorage.get("cf-settings-last-section")).toBe("hooks");
  });
});

it("Device card focus intent supports initial mount and already-open settings, clearing after consumption", async () => {
  const events = new EventTarget();
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  });
  const navigation = await loadSettingsNavigation("test");
  navigation.setPendingSettingsSectionIntent("remoteDevices", { sourceServerId: "device-a" });
  expect(navigation.consumePendingSettingsSourceServerId()).toBe("device-a");
  expect(navigation.consumePendingSettingsSourceServerId()).toBeUndefined();
  const listener = vi.fn();
  const dispose = navigation.addPendingSettingsSectionListener(listener);
  navigation.setPendingSettingsSectionIntent("remoteDevices", { sourceServerId: "device-b" });
  expect(listener).toHaveBeenCalledWith(
    "remoteDevices",
    expect.objectContaining({ sourceServerId: "device-b" }),
  );
  expect(navigation.consumePendingSettingsSourceServerId()).toBeUndefined();
  dispose();
});

it("Keep device focus and failure details as independent intents, clearing storage upon mounted event consumption", async () => {
  const eventTarget = new EventTarget();
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
  const navigation = await loadSettingsNavigation("test");
  const listener = vi.fn();
  const dispose = navigation.addPendingSettingsSectionListener(listener);
  navigation.setPendingSettingsSectionIntent("remoteDevices", {
    sourceServerId: " source ",
    sourceServerDetails: true,
  });
  expect(listener).toHaveBeenLastCalledWith(
    "remoteDevices",
    expect.objectContaining({ sourceServerId: "source", sourceServerDetails: true }),
  );
  expect(storage.size).toBe(0);
  navigation.setPendingSettingsSectionIntent("remoteDevices", { sourceServerId: "source" });
  expect(listener.mock.calls.at(-1)?.[1].sourceServerDetails).toBeUndefined();
  dispose();
  navigation.setPendingSettingsSectionIntent("remoteDevices", {
    sourceServerId: "source",
    sourceServerDetails: true,
  });
  expect(navigation.consumePendingSettingsSourceServerId()).toBe("source");
  expect(navigation.consumePendingSettingsSourceServerDetails()).toBe(true);
  expect(navigation.consumePendingSettingsSourceServerDetails()).toBe(false);
  navigation.setPendingSettingsSectionIntent("remoteDevices", {
    sourceServerId: "source",
    sourceServerDetails: true,
  });
  navigation.setPendingSettingsSectionIntent("general");
  expect(navigation.consumePendingSettingsSourceServerDetails()).toBe(false);
});
