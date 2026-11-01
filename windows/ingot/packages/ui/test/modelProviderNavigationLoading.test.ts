import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip.js";
import {
  getSortableProviderId,
  ModelProviderSectionNavigation,
  resolveReorderedProviderIdsForGroup,
  shouldShowModelProviderGroupLoadingIndicator,
} from "@/settings/model-provider-section/Navigation.js";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));

function renderWithTooltipProvider(element: ReactElement) {
  return renderToStaticMarkup(createElement(TooltipProvider, null, element));
}

describe("model provider navigation loading indicator", () => {
  it("Do not render empty group when there are no personal providers", () => {
    const html = renderWithTooltipProvider(
      createElement(ModelProviderSectionNavigation, {
        navigationGroups: [
          { id: "preset", title: "Preset", items: [] },
          { id: "custom", title: "Custom Providers", items: [] },
        ],
        selectedNodeKey: null,
        presetLoading: false,
        customLoading: false,
        onSelectNavItem: vi.fn(),
      }),
    );

    expect(html).not.toContain("Custom Providers");
  });

  it("Only enable drag for allowed items in Settings View", () => {
    const item = {
      key: "custom:official-api",
      type: "custom" as const,
      label: "Official API",
      statusActive: true,
      provider: {
        providerId: "official-api",
        executable: true,
        enabled: true,
        hasPersonalConfig: true,
        personalConfig: { enabled: true },
        config: {
          label: "Official API",
          group: "standard-personal",
          templateId: "official-api",
          access: { type: "api-key", apiKey: "key" },
          api: { type: "anthropic-messages", baseUrl: "https://example.com" },
          builtinModelIds: [],
        },
        models: [],
      },
    };

    expect(getSortableProviderId(item, new Set(["personal-api"]))).toBeNull();
    expect(getSortableProviderId(item, new Set(["official-api"]))).toBe("official-api");
  });

  it("按分组返回对应 loading 状态", () => {
    expect(
      shouldShowModelProviderGroupLoadingIndicator({
        groupId: "preset",
        presetLoading: true,
        customLoading: false,
      }),
    ).toBe(true);

    expect(
      shouldShowModelProviderGroupLoadingIndicator({
        groupId: "custom",
        presetLoading: true,
        customLoading: false,
      }),
    ).toBe(false);
  });

  it("Only reorder current group provider IDs on drag end", () => {
    expect(
      resolveReorderedProviderIdsForGroup({
        activeProviderId: "provider-c",
        overProviderId: "provider-a",
        providerIds: ["provider-a", "provider-b", "provider-c"],
      }),
    ).toEqual(["provider-c", "provider-a", "provider-b"]);
  });

  it("Custom providers that allow reordering render accessible sortable rows", () => {
    const html = renderWithTooltipProvider(
      createElement(ModelProviderSectionNavigation, {
        navigationGroups: [
          {
            id: "custom",
            title: "Custom Providers",
            items: [
              {
                key: "custom:provider-a",
                type: "custom",
                label: "Provider A",
                provider: {
                  providerId: "provider-a",
                  executable: true,
                  enabled: true,
                  hasPersonalConfig: true,
                  personalConfig: {
                    group: "standard-personal",
                    personalModelIds: ["model-a"],
                  },
                  config: {
                    label: "Provider A",
                    group: "standard-personal",
                    access: { type: "api-key", apiKey: "token" },
                    api: { type: "anthropic-messages", baseUrl: "https://example.com" },
                    personalModelIds: ["model-a"],
                  },
                  models: [{ modelId: "model-a", config: {}, hasPersonalConfig: true }],
                },
                statusActive: true,
              },
            ],
          },
        ],
        selectedNodeKey: null,
        presetLoading: false,
        customLoading: false,
        onSelectNavItem: vi.fn(),
        reorderableProviderIds: new Set(["provider-a"]),
      }),
    );

    expect(html).toContain('aria-label="Provider A"');
    expect(html).toMatch(
      /data-testid="model-provider-nav-item-custom:provider-a"[^>]*aria-roledescription="sortable"[\s\S]*Provider A/,
    );
  });
});
