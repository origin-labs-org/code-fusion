import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { StorePluginItem } from "../src/settings/pluginStoreListing.js";
import type { PluginStoreActions } from "../src/settings/PluginStoreCard.js";

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children, title }: { children: ReactNode; title: string }) =>
    createElement("span", { "data-tooltip-title": title }, children),
}));

function makeItem(requiresPaidPlan: boolean | undefined): StorePluginItem {
  return {
    id: "pro-plugin@cf-plugins-official",
    name: "pro-plugin",
    marketplace: "cf-plugins-official",
    installed: false,
    restorable: false,
    orphaned: false,
    listing: {
      displayName: "Pro Plugin",
      ...(requiresPaidPlan === undefined ? {} : { requiresPaidPlan }),
    },
  };
}

const actions: PluginStoreActions = {
  onOpenDetail: () => {},
  onInstall: () => {},
  onUninstall: () => {},
  onSetEnabled: () => {},
  onUpdate: () => {},
  activeOperations: [],
  togglingPluginId: null,
};

async function renderCard(item: StorePluginItem): Promise<string> {
  const { PluginStoreCard } = await import("../src/settings/PluginStoreCard.js");
  const { CfIntlProvider } = await import("@/i18n/IntlProvider.js");
  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: "en-US" },
      createElement(PluginStoreCard, { item, actions, locale: "en-US" }),
    ),
  );
}

async function renderDetail(item: StorePluginItem): Promise<string> {
  const { PluginStoreDetailView } = await import("../src/settings/PluginStoreDetailView.js");
  const { CfIntlProvider } = await import("@/i18n/IntlProvider.js");
  return renderToStaticMarkup(
    createElement(
      CfIntlProvider,
      { initialLocale: "en-US" },
      createElement(PluginStoreDetailView, {
        item,
        actions,
        onRetryDescribe: () => {},
        onUsePrompt: () => {},
      }),
    ),
  );
}

describe("plugin store paid plan badge", () => {
  it("marks a plugin that needs a paid plan on the store card title", async () => {
    const html = await renderCard(makeItem(true));
    expect(html).toContain('data-testid="plugin-store-paid-plan-badge"');
    expect(html).toContain("Coding Plan");
    expect(html).toContain('data-tooltip-title="This plugin works better with a Coding Plan"');
  });

  it("marks a plugin that needs a paid plan on the detail title", async () => {
    const html = await renderDetail(makeItem(true));
    expect(html).toContain('data-testid="plugin-store-paid-plan-badge"');
    expect(html).toContain("Coding Plan");
    expect(html).toContain('data-tooltip-title="This plugin works better with a Coding Plan"');
  });

  it("omits the badge when the plan is not required and when the field is absent", async () => {
    for (const requiresPaidPlan of [false, undefined] as const) {
      expect(await renderCard(makeItem(requiresPaidPlan))).not.toContain(
        "plugin-store-paid-plan-badge",
      );
      expect(await renderDetail(makeItem(requiresPaidPlan))).not.toContain(
        "plugin-store-paid-plan-badge",
      );
    }
  });
});
