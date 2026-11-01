import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CfPluginDiagnostic,
  CfPluginInfo,
  CfPluginUserConfigOption,
} from "@origin-ai/cf-shared";
import { CfIntlProvider } from "@/i18n/IntlProvider.js";
import { InstalledPluginDetailPanel } from "../src/settings/InstalledPluginManagement.js";

describe("InstalledPluginDetailPanel", () => {
  it("renders authoritative skill component names for both enabled and disabled plugins", () => {
    const skillItems = Array.from({ length: 14 }, (_, index) => ({
      name: `superpowers-skill-${index + 1}`,
      ...(index === 0 ? { description: "Brainstorming ideas into designs" } : {}),
    }));

    for (const enabled of [true, false]) {
      const plugin: CfPluginInfo = {
        id: "superpowers@cf-plugins-official",
        name: "superpowers",
        version: "5.1.0",
        enabled,
        source: "official",
        marketplace: "cf-plugins-official",
        skillCount: enabled ? 14 : 0,
        skillRootCount: enabled ? 1 : 0,
        commandRootCount: 0,
        declaredMcpServerNames: [],
        mcpServerNames: [],
        hookDetails: [],
        rootPath: "/cache/superpowers",
        components: [{ kind: "skill", items: skillItems }],
      };

      const html = renderToStaticMarkup(
        createElement(
          CfIntlProvider,
          { initialLocale: "zh-CN" },
          createElement(InstalledPluginDetailPanel, {
            getPluginOptionValue: (
              _plugin: CfPluginInfo,
              _key: string,
              option: CfPluginUserConfigOption,
            ) => option.default ?? "",
            onSavePluginOptions: () => {},
            activeOperations: [],
            plugin,
            renderPluginSource: (target: CfPluginInfo) => target.marketplace,
            setPluginOptionDraft: () => {},
          }),
        ),
      );

      expect(html).toContain("14");
      expect(html).toContain("superpowers-skill-1");
      expect(html).toContain("superpowers-skill-14");
      expect(html).toContain("Brainstorming ideas into designs");
      expect(html).not.toContain("启用插件后查看其组件。");
    }
  });

  it("renders warning diagnostics scoped to the plugin and hides them when none match", () => {
    const plugin: CfPluginInfo = {
      id: "mattpocock-skills@claude-plugins-official",
      name: "mattpocock-skills",
      enabled: true,
      source: "cache",
      marketplace: "claude-plugins-official",
      skillCount: 0,
      skillRootCount: 25,
      commandRootCount: 0,
      declaredMcpServerNames: [],
      mcpServerNames: [],
      hookDetails: [],
      rootPath: "/cache/mattpocock-skills",
      components: [],
    };

    const renderPanel = (diagnostics: CfPluginDiagnostic[]) =>
      renderToStaticMarkup(
        createElement(
          CfIntlProvider,
          { initialLocale: "zh-CN" },
          createElement(InstalledPluginDetailPanel, {
            diagnostics,
            getPluginOptionValue: (
              _plugin: CfPluginInfo,
              _key: string,
              option: CfPluginUserConfigOption,
            ) => option.default ?? "",
            onSavePluginOptions: () => {},
            activeOperations: [],
            plugin,
            renderPluginSource: (target: CfPluginInfo) => target.marketplace,
            setPluginOptionDraft: () => {},
          }),
        ),
      );

    const withWarnings = renderPanel([
      {
        code: "plugin_skill_root_empty",
        message: "Plugin skills path does not contain any skills: ./skills/engineering/tdd",
        pluginId: "mattpocock-skills@claude-plugins-official",
        severity: "warning",
      },
      {
        code: "plugin_skill_root_empty",
        message: "Plugin skills path does not contain any skills: ./other",
        pluginId: "other-plugin@claude-plugins-official",
        severity: "warning",
      },
      {
        code: "plugin_manifest_invalid",
        message: "boom",
        pluginId: "mattpocock-skills@claude-plugins-official",
        severity: "error",
      },
    ]);
    expect(withWarnings).toContain("警告");
    expect(withWarnings).toContain("./skills/engineering/tdd");
    expect(withWarnings).not.toContain("./other");
    expect(withWarnings).not.toContain("boom");

    expect(renderPanel([])).not.toContain("警告");
  });

  it("renders a details empty state for a plugin that declares no components", () => {
    const plugin: CfPluginInfo = {
      id: "empty-plugin@cf-plugins-official",
      name: "empty-plugin",
      version: "0.1.0",
      enabled: false,
      source: "cache",
      marketplace: "cf-plugins-official",
      skillCount: 0,
      skillRootCount: 0,
      commandRootCount: 0,
      declaredMcpServerNames: [],
      mcpServerNames: [],
      hookDetails: [],
      rootPath: "/cache/empty-plugin",
      components: [],
    };

    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "zh-CN" },
        createElement(InstalledPluginDetailPanel, {
          getPluginOptionValue: (
            _plugin: CfPluginInfo,
            _key: string,
            option: CfPluginUserConfigOption,
          ) => option.default ?? "",
          onSavePluginOptions: () => {},
          activeOperations: [],
          plugin,
          renderPluginSource: (target: CfPluginInfo) => target.marketplace,
          setPluginOptionDraft: () => {},
        }),
      ),
    );

    expect(html).toContain("详情");
    expect(html).toContain("无组件");
  });
});
