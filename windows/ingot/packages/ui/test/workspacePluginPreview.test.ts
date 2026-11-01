import { describe, expect, it } from "vitest";
import type { CfPluginReferenceCatalogEntry } from "@origin-ai/cf-shared";
import {
  buildWorkspacePluginMention,
  isWorkspacePluginReferenceable,
} from "../src/workspace-plugin-preview/index.js";

function entry(
  overrides: Partial<CfPluginReferenceCatalogEntry> = {},
): CfPluginReferenceCatalogEntry {
  return {
    pluginId: "pdf@cf-plugins-official",
    name: "pdf",
    marketplace: "cf-plugins-official",
    icon: "https://cdn.example.com/pdf.png",
    enabled: true,
    conflictingPluginIds: [],
    skillQualifiedNames: ["pdf:read"],
    mcpServerNames: [],
    subagentNames: [],
    ...overrides,
  };
}

describe("workspace plugin preview", () => {
  it("只Allow已Enable且无冲突的 workspace catalog Plugins被引用", () => {
    expect(isWorkspacePluginReferenceable(entry())).toBe(true);
    expect(isWorkspacePluginReferenceable(entry({ enabled: false }))).toBe(false);
    expect(
      isWorkspacePluginReferenceable(entry({ conflictingPluginIds: ["pdf@personal-marketplace"] })),
    ).toBe(false);
  });

  it("构造与 Composer @ Picker E同的 canonical Plugin Reference", () => {
    expect(buildWorkspacePluginMention(entry())).toEqual({
      id: "plugin:pdf@cf-plugins-official",
      category: "plugins",
      label: "pdf",
      value: "pdf@cf-plugins-official",
      markdown: "[@pdf](plugin://pdf@cf-plugins-official)",
      data: {
        pluginId: "pdf@cf-plugins-official",
        icon: "https://cdn.example.com/pdf.png",
      },
    });
  });
});
