import { afterEach, describe, expect, it, vi } from "vitest";
import enUS from "../src/i18n/locales/en-US.js";
import zhCN from "../src/i18n/locales/zh-CN.js";
import { isSettingsSectionAvailable } from "../src/settings/settingsPageConfig.js";

async function loadSettingsPageConfig(env: "test" | "production") {
  vi.resetModules();
  vi.doMock("@origin-ai/cf-shared", async () => {
    const actual = await vi.importActual<typeof import("@origin-ai/cf-shared")>("@origin-ai/cf-shared");
    return {
      ...actual,
      CF_ENV: env,
    };
  });
  return import("../src/settings/settingsPageConfig.js");
}

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("settingsPageConfig", () => {
  it("only exposes remote device management on desktop", () => {
    expect(isSettingsSectionAvailable("remoteDevices", true)).toBe(true);
    expect(isSettingsSectionAvailable("remoteDevices", false)).toBe(false);
    expect(isSettingsSectionAvailable("general", false)).toBe(true);
  });
  it("Display public sections grouped and ordered by settings page", async () => {
    const { createSettingsPageConfig } = await loadSettingsPageConfig("test");
    const { settingsSectionGroups, settingsSections } = createSettingsPageConfig({});
    expect(
      settingsSectionGroups.map((group) => ({
        id: group.id,
        sections: group.sections.map((section) => section.id),
      })),
    ).toEqual([
      {
        id: "basics",
        sections: [
          "general",
          "appearance",
          "modelProvider",
          "browser",
          "remoteDevices",
          "shortcuts",
        ],
      },
      {
        id: "agentCapabilities",
        sections: ["memory", "subagents", "plugin", "mcp", "skill", "commands", "hooks"],
      },
      { id: "dataAndStats", sections: ["usage", "archives"] },
    ]);
    expect(settingsSections.map((section) => section.id)).toEqual([
      "general",
      "appearance",
      "modelProvider",
      "memory",
      "subagents",
      "plugin",
      "mcp",
      "skill",
      "commands",
      "hooks",
      "browser",
      "remoteDevices",
      "shortcuts",
      "usage",
      "archives",
    ]);
  });

  it("Keep Usage section copy consistent with the avatar menu usage stats entry", () => {
    expect(enUS["settings.usageTitle"]).toBe(enUS["sidebar.usage.plan.openStats"]);
    expect(enUS["settings.usage.sectionTitle"]).toBe(enUS["sidebar.usage.plan.openStats"]);
    expect(zhCN["settings.usageTitle"]).toBe(zhCN["sidebar.usage.plan.openStats"]);
  });

  it.each([
    ["macOS", { isMacDesktop: true }, true],
    ["Windows", { isWindowsDesktop: true }, true],
    ["Linux 桌面", { isDesktop: true }, true],
    ["Web", {}, false],
  ] as const)("%s PC control entry adheres to desktop platform boundaries", async (_name, options, expected) => {
    const { createSettingsPageConfig } = await loadSettingsPageConfig("test");
    const { settingsSections } = createSettingsPageConfig(options);

    expect(settingsSections.some((section) => section.id === "computerUse")).toBe(expected);
  });

  it("PC control on desktop platforms is placed after Browser in basic settings", async () => {
    const { createSettingsPageConfig } = await loadSettingsPageConfig("test");
    const { settingsSectionGroups } = createSettingsPageConfig({ isMacDesktop: true });
    const basics = settingsSectionGroups.find((group) => group.id === "basics");

    expect(basics?.sections.map((section) => section.id)).toEqual([
      "general",
      "appearance",
      "modelProvider",
      "browser",
      "remoteDevices",
      "computerUse",
      "shortcuts",
    ]);
    expect(
      settingsSectionGroups
        .find((group) => group.id === "agentCapabilities")
        ?.sections.some((section) => section.id === "computerUse"),
    ).toBe(false);
  });

  it("Hidden PC control landing target falls back to general", async () => {
    const { createSettingsPageConfig, resolveSettingsSectionForPlatform } =
      await loadSettingsPageConfig("test");
    const { settingsSections } = createSettingsPageConfig({});

    expect(resolveSettingsSectionForPlatform("computerUse", settingsSections, "general")).toBe(
      "general",
    );
  });
});
