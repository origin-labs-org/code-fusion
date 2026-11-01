import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StorePluginItem } from "../src/settings/pluginStoreListing.js";
import type { PluginStoreActions } from "../src/settings/PluginStoreCard.js";

vi.mock("@/components/ui/dropdown-menu.js", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => children,
  DropdownMenuContent: ({ children }: { children: ReactNode }) =>
    createElement("div", { role: "menu" }, children),
  DropdownMenuItem: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) =>
    createElement("div", { role: "menuitem", "data-testid": props["data-testid"] }, children),
  DropdownMenuSeparator: () => createElement("hr", { "data-slot": "dropdown-menu-separator" }),
}));

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    locale: "zh-CN",
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));

function storeItem(overrides: Partial<StorePluginItem> = {}): StorePluginItem {
  return {
    id: "skill-creator@cf-plugins-official",
    name: "skill-creator",
    marketplace: "cf-plugins-official",
    installed: true,
    restorable: false,
    orphaned: false,
    ...overrides,
  };
}

function makeActions(overrides: Partial<PluginStoreActions> = {}): PluginStoreActions {
  return {
    onOpenDetail: () => {},
    onInstall: () => {},
    onUninstall: () => {},
    onUpdate: () => {},
    activeOperations: [],
    togglingPluginId: null,
    ...overrides,
  };
}

async function renderMenu(item: StorePluginItem, actions: PluginStoreActions): Promise<string> {
  const { PluginStoreItemMenu } = await import("../src/settings/PluginStoreCard.js");
  return renderToStaticMarkup(createElement(PluginStoreItemMenu, { item, actions }));
}

describe("PluginStoreItemMenu separator", () => {
  it("Do not render divider when menu has only uninstall item", async () => {
    const html = await renderMenu(storeItem(), makeActions());

    expect(html).toContain('data-testid="plugin-store-menu-uninstall"');
    expect(html).not.toContain('data-slot="dropdown-menu-separator"');
  });

  it("更新移到行内后，只有卸载的菜单不留分隔线", async () => {
    const html = await renderMenu(
      storeItem({
        installedMeta: {
          id: "skill-creator@cf-plugins-official",
          name: "skill-creator",
          marketplace: "cf-plugins-official",
          enabled: true,
          scope: "user",
          updateStatus: "update-available",
        },
      }),
      makeActions(),
    );

    expect(html).not.toContain('data-testid="plugin-store-menu-update"');
    expect(html).not.toContain('data-slot="dropdown-menu-separator"');
  });

  it("Keep divider when other action items exist before uninstall", async () => {
    const html = await renderMenu(
      storeItem({ info: { enabled: true } as StorePluginItem["info"] }),
      makeActions({ onSetEnabled: () => {} }),
    );

    expect(html).toContain('data-testid="plugin-store-menu-enabled"');
    expect(html).toContain('data-slot="dropdown-menu-separator"');
  });
});
