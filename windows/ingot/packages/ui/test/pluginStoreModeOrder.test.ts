import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { groupItemsByCategory, type StorePluginItem } from "../src/settings/pluginStoreListing.js";

function item(name: string, category?: string): StorePluginItem {
  return {
    id: `${name}@official`,
    name,
    marketplace: "official",
    installed: false,
    restorable: false,
    orphaned: false,
    listing: { category },
  };
}

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    locale: "en-US",
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));

describe("公开分类排序", () => {
  it("Detail page also displays legacy guide category as Utilities", async () => {
    const { PluginStoreDetailView } = await import("../src/settings/PluginStoreDetailView.js");
    const html = renderToStaticMarkup(
      createElement(PluginStoreDetailView, {
        item: item("cf-guide", "guides"),
        actions: {
          onOpenDetail() {},
          onInstall() {},
          onUninstall() {},
          onSetEnabled() {},
          onUpdate() {},
          activeOperations: [],
          togglingPluginId: null,
        },
        onRetryDescribe() {},
        onUsePrompt() {},
      }),
    );
    expect(html).toContain("settings.plugins.store.category.utilities");
  });
  it("Legacy guide category merges into Utilities without changing plugin identity; legal is hidden when empty", () => {
    const entries = [item("cf-guide", "guides"), item("skill-creator", "utilities")];
    const groups = groupItemsByCategory(entries, "zh-CN", {
      categoryOrder: ["legal", "guides", "utilities"],
    });
    expect(groups.map((group) => group.category)).toEqual(["utilities"]);
    expect(groups[0]?.items.map((entry) => entry.id).sort()).toEqual(
      entries.map((entry) => entry.id).sort(),
    );
    expect(entries[0]?.listing?.category).toBe("guides");
  });

  it("Future legal plugins can be displayed by server category and plugin order", () => {
    const groups = groupItemsByCategory(
      [item("contract", "legal"), item("research", "legal"), item("util", "utilities")],
      "en-US",
      {
        categoryOrder: ["legal", "utilities"],
        pluginOrder: { legal: ["research@official", "contract@official"] },
      },
    );
    expect(groups.map((group) => group.category)).toEqual(["legal", "utilities"]);
    expect(groups[0]?.items.map((entry) => entry.name)).toEqual(["research", "contract"]);
  });
  it("Unknown categories can still use default sorting if named after object prototype properties", () => {
    const entries = [item("b", "constructor"), item("a", "constructor")];
    expect(
      groupItemsByCategory(entries, "en-US", { pluginOrder: {} })[0]?.items.map(
        (entry) => entry.name,
      ),
    ).toEqual(["a", "b"]);
  });
  const items = [
    item("z", "productivity"),
    item("a", "productivity"),
    item("b", "developer-tools"),
    item("c"),
    item("d", "unknown"),
  ];

  it("Categories and plugins within categories are sorted independently; unconfigured items keep default, explicit other can be pinned", () => {
    const before = structuredClone(items);
    const groups = groupItemsByCategory(items, "en-US", {
      categoryOrder: ["missing", "other", "developer-tools", "other"],
      pluginOrder: { productivity: ["missing@official", "z@official", "z@official"] },
    });
    expect(groups.map((group) => group.category)).toEqual([
      "other",
      "developer-tools",
      "productivity",
      "unknown",
    ]);
    expect(groups[2]?.items.map((entry) => entry.name)).toEqual(["z", "a"]);
    expect(items).toEqual(before);
  });

  it.each(["zh-CN", "en-US"])("Keep original order without config %s", (locale) => {
    const groups = groupItemsByCategory(items, locale);
    expect(groups.map((group) => group.category)).toEqual([
      "productivity",
      "developer-tools",
      "unknown",
      "other",
    ]);
    expect(groups[0]?.items.map((entry) => entry.name)).toEqual(["a", "z"]);
  });

  it("ID must match completely; plugins cannot be moved across categories or added", () => {
    const groups = groupItemsByCategory(items, "en-US", {
      pluginOrder: { productivity: ["z", "z@personal", "b@official"] },
    });
    expect(groups[0]?.items.map((entry) => entry.name)).toEqual(["a", "z"]);
    expect(groups.flatMap((group) => group.items)).toHaveLength(items.length);
  });
});
