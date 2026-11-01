import type { CfPluginReferenceCatalogEntry } from "@origin-ai/cf-shared";
import { describe, expect, it, vi } from "vitest";
import { buildDraftSuggestedPromptPrefill } from "@/v4/draftSuggestedPromptPrefill.js";

const DOCUMENT_SKILLS_PLUGIN = {
  stableId: "document-skills@cf-plugins-official",
  label: "文档技能",
};

function catalogEntry(
  overrides: Partial<CfPluginReferenceCatalogEntry> = {},
): CfPluginReferenceCatalogEntry {
  return {
    pluginId: DOCUMENT_SKILLS_PLUGIN.stableId,
    name: "document-skills",
    marketplace: "cf-plugins-official",
    enabled: true,
    conflictingPluginIds: [],
    skillQualifiedNames: ["document-skills:pdf"],
    mcpServerNames: [],
    subagentNames: [],
    icon: "https://cdn.example.com/document-skills.png",
    ...overrides,
  };
}

describe("buildDraftSuggestedPromptPrefill", () => {
  it("returns a plain replacement prompt without querying the catalog when no Plugin is configured", async () => {
    const loadPluginCatalog = vi.fn();

    await expect(
      buildDraftSuggestedPromptPrefill({
        prompt: "Check Git commits in the current workspace from the last 7 days",
        loadPluginCatalog,
      }),
    ).resolves.toEqual({ text: "Check Git commits in the current workspace from the last 7 days" });
    expect(loadPluginCatalog).not.toHaveBeenCalled();
  });

  it("builds canonical text and a structured mention for an enabled conflict-free Plugin", async () => {
    await expect(
      buildDraftSuggestedPromptPrefill({
        prompt: "根据当前工作区内容制作一份 PDF 文档",
        plugin: DOCUMENT_SKILLS_PLUGIN,
        loadPluginCatalog: async () => [catalogEntry()],
      }),
    ).resolves.toEqual({
      text: "[@文档技能](plugin://document-skills@cf-plugins-official) 根据当前工作区内容制作一份 PDF 文档",
      mention: {
        id: "plugin:document-skills@cf-plugins-official",
        category: "plugins",
        label: "文档技能",
        value: "document-skills@cf-plugins-official",
        markdown:
          "[@文档技能](plugin://document-skills@cf-plugins-official)",
        data: {
          pluginId: "document-skills@cf-plugins-official",
          icon: "https://cdn.example.com/document-skills.png",
        },
      },
    });
  });

  it.each([
    ["missing", []],
    ["disabled", [catalogEntry({ enabled: false })]],
  ])(
    "marks the Plugin unavailable while degrading to the plain prompt when it is %s",
    async (_state, entries) => {
      await expect(
        buildDraftSuggestedPromptPrefill({
          prompt: "制作一份 PDF",
          plugin: DOCUMENT_SKILLS_PLUGIN,
          loadPluginCatalog: async () => entries,
        }),
      ).resolves.toEqual({
        text: "制作一份 PDF",
        pluginUnavailable: true,
      });
    },
  );

  it("degrades a conflicted Plugin without marking it missing or disabled", async () => {
    await expect(
      buildDraftSuggestedPromptPrefill({
        prompt: "制作一份 PDF",
        plugin: DOCUMENT_SKILLS_PLUGIN,
        loadPluginCatalog: async () => [
          catalogEntry({
            conflictingPluginIds: ["document-skills@another-market"],
          }),
        ],
      }),
    ).resolves.toEqual({ text: "制作一份 PDF" });
  });

  it("degrades to the plain prompt when catalog lookup fails", async () => {
    await expect(
      buildDraftSuggestedPromptPrefill({
        prompt: "制作一份 PDF",
        plugin: DOCUMENT_SKILLS_PLUGIN,
        loadPluginCatalog: async () =>
          Promise.reject(new Error("remote disconnected")),
      }),
    ).resolves.toEqual({ text: "制作一份 PDF" });
  });
});
