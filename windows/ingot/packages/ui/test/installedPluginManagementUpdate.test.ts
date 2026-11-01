import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CfPluginInfo, CfPluginUserConfigOption } from "@origin-ai/cf-shared";

const { buttonProps } = vi.hoisted(() => ({
  buttonProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/components/ui/button.js", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => {
    buttonProps.push(props);
    return createElement("button", props as Record<string, unknown>, children);
  },
}));

function basePlugin(overrides: Partial<CfPluginInfo> = {}): CfPluginInfo {
  return {
    id: "skill-creator@cf-plugins-official",
    name: "skill-creator",
    version: "1.0.0",
    enabled: true,
    source: "official",
    marketplace: "cf-plugins-official",
    skillCount: 0,
    skillRootCount: 0,
    commandRootCount: 0,
    declaredMcpServerNames: [],
    mcpServerNames: [],
    hookDetails: [],
    rootPath: "/cache/skill-creator",
    components: [],
    ...overrides,
  };
}

const sharedPanelProps = {
  getPluginOptionValue: (
    _plugin: CfPluginInfo,
    _key: string,
    option: CfPluginUserConfigOption,
  ) => option.default ?? "",
  onSavePluginOptions: () => {},
  setPluginOptionDraft: () => {},
  renderPluginSource: (target: CfPluginInfo) => target.marketplace,
} as const;

function createMinimalElement(ownerDocument: Document, tagName = "div") {
  const element = {
    addEventListener: () => {},
    appendChild: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    childNodes: [] as unknown[],
    getAttribute: () => null,
    insertBefore: (child: { parentNode?: unknown }) => {
      child.parentNode = element;
      return child;
    },
    nodeName: tagName.toUpperCase(),
    nodeType: 1,
    ownerDocument,
    parentNode: null as unknown,
    removeAttribute: () => {},
    removeChild: (child: { parentNode?: unknown }) => {
      child.parentNode = null;
      return child;
    },
    removeEventListener: () => {},
    setAttribute: () => {},
    style: {},
    tagName: tagName.toUpperCase(),
  };
  return element as unknown as Element;
}

function installMinimalDom() {
  const documentMock = {
    addEventListener: () => {},
    createElement: (tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createElementNS: (_namespace: string, tagName: string) =>
      createMinimalElement(documentMock as unknown as Document, tagName),
    createTextNode: (nodeValue: string) => ({
      nodeType: 3,
      nodeValue,
      ownerDocument: documentMock,
      parentNode: null,
    }),
    nodeType: 9,
    removeEventListener: () => {},
  } as unknown as Document;
  const windowMock = {
    addEventListener: () => {},
    document: documentMock,
    HTMLIFrameElement: function HTMLIFrameElement() {},
    HTMLElement: function HTMLElement() {},
    Node: function Node() {},
    removeEventListener: () => {},
  };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: documentMock,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowMock,
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  return createMinimalElement(documentMock);
}

describe("InstalledPluginDetailPanel update badge", () => {
  afterEach(() => {
    buttonProps.length = 0;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: unknown }).IS_REACT_ACT_ENVIRONMENT;
  });

  it("renders the update button, target version, and new-sessions note when update-available", async () => {
    const { InstalledPluginDetailPanel } =
      await import("../src/settings/InstalledPluginManagement.js");
    const { CfIntlProvider } = await import("@/i18n/IntlProvider.js");

    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(InstalledPluginDetailPanel, {
          ...sharedPanelProps,
          activeOperations: [],
          plugin: basePlugin(),
          updateStatus: "update-available",
          latestVersion: "2.0.0",
          uninstallable: true,
          onRequestUninstall: () => {},
          onRequestUpdate: () => {},
        }),
      ),
    );

    expect(html).toContain("Update available → v2.0.0");
    expect(html).toContain("Takes effect in new sessions");
  });

  it("omits the update block when there is no update", async () => {
    const { InstalledPluginDetailPanel } =
      await import("../src/settings/InstalledPluginManagement.js");
    const { CfIntlProvider } = await import("@/i18n/IntlProvider.js");

    const html = renderToStaticMarkup(
      createElement(
        CfIntlProvider,
        { initialLocale: "en-US" },
        createElement(InstalledPluginDetailPanel, {
          ...sharedPanelProps,
          activeOperations: [],
          plugin: basePlugin(),
          updateStatus: "none",
          uninstallable: true,
          onRequestUninstall: () => {},
          onRequestUpdate: () => {},
        }),
      ),
    );

    expect(html).not.toContain("Takes effect in new sessions");
  });

  it("invokes onRequestUpdate with the plugin id when the update button is clicked", async () => {
    const { InstalledPluginDetailPanel } =
      await import("../src/settings/InstalledPluginManagement.js");
    const { CfIntlProvider } = await import("@/i18n/IntlProvider.js");
    const onRequestUpdate = vi.fn();
    const root: Root = createRoot(installMinimalDom());

    act(() => {
      root.render(
        createElement(
          CfIntlProvider,
          { initialLocale: "en-US" },
          createElement(InstalledPluginDetailPanel, {
            ...sharedPanelProps,
            activeOperations: [],
            plugin: basePlugin(),
            updateStatus: "update-available",
            latestVersion: "2.0.0",
            uninstallable: true,
            onRequestUninstall: () => {},
            onRequestUpdate,
          }),
        ),
      );
    });

    const clickHandlers = buttonProps
      .map((props) => props.onClick)
      .filter((onClick): onClick is () => void => typeof onClick === "function");
    expect(clickHandlers.length).toBeGreaterThan(0);
    for (const onClick of clickHandlers) {
      onClick();
    }

    expect(onRequestUpdate).toHaveBeenCalledWith("skill-creator@cf-plugins-official");
    expect(onRequestUpdate).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });
  });
});
