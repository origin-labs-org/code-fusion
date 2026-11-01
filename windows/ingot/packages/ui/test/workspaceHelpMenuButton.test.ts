import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DesktopCommandIds } from "@origin-ai/cf-shared";
import { TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER } from "@origin-ai/cf-shared/test-ids";

vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
    locale: "zh-CN",
  }),
}));

const captured = vi.hoisted(() => ({
  zsrcUrl: null as string | null,
  loading: false,
  openExternal: vi.fn(),
  exportLogs: vi.fn(async () => ({ success: true })),
  toast: vi.fn(() => 7),
  dismissToast: vi.fn(),
  menuItems: [] as Array<{
    label: string;
    testId?: string;
    disabled?: boolean;
    onSelect: (() => void | Promise<void>) | undefined;
  }>,
  updateMenu: {
    visible: true,
    disabled: false,
    labelId: "titleBar.menu.help.checkForUpdates",
    labelValues: undefined,
  },
  executeDesktopCommand: vi.fn(async () => undefined),
}));

vi.mock("@/components/ui/dropdown-menu.js", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => createElement("div", null, children),
  DropdownMenuContent: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
    "data-testid": testId,
  }: {
    children: ReactNode;
    onSelect?: () => void | Promise<void>;
    disabled?: boolean;
    "data-testid"?: string;
  }) => {
    const label = Array.isArray(children)
      ? children.filter((child) => typeof child === "string").join("")
      : typeof children === "string"
        ? children
        : "";
    captured.menuItems.push({ label, testId, onSelect, disabled });
    return createElement("div", { "data-testid": testId }, children);
  },
  DropdownMenuSeparator: () => createElement("hr"),
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("@/ControlHintTooltip.js", () => ({
  ControlHintTooltip: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: captured.toast,
  dismissToast: captured.dismissToast,
}));

vi.mock("@/feedback/feedbackStore.js", () => ({
  useFeedbackStore: (
    selector: (state: {
      openSubmit: (draft?: unknown) => void;
      openFeatureRequest: () => void;
    }) => unknown,
  ) => selector({ openSubmit: vi.fn(), openFeatureRequest: vi.fn() }),
}));

vi.mock("@/hooks/useDesktopUpdateMenu.js", () => ({
  useDesktopUpdateMenu: (isDesktop: boolean) => ({
    ...captured.updateMenu,
    visible: isDesktop && captured.updateMenu.visible,
    checkForUpdates: () => captured.executeDesktopCommand(DesktopCommandIds.CheckForUpdates),
  }),
}));

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    captureWindowScreenshot: vi.fn(async () => null),
    executeDesktopCommand: captured.executeDesktopCommand,
    exportLogs: captured.exportLogs,
    openCommunity: vi.fn(async () => undefined),
    openExternal: captured.openExternal,
  }),
}));

vi.mock("@/hooks/useVulnerabilityReportUrl.js", () => ({
  useVulnerabilityReportUrl: () => ({ url: captured.zsrcUrl, loading: captured.loading }),
}));

describe("WorkspaceHelpMenuButton", () => {
  async function render(isDesktop: boolean | undefined) {
    captured.menuItems = [];
    captured.executeDesktopCommand.mockClear();
    captured.exportLogs.mockClear();
    captured.toast.mockClear();
    captured.dismissToast.mockClear();
    const { WorkspaceHelpMenuButton } = await import("@/WorkspaceHelpMenuButton.js");
    return renderToStaticMarkup(createElement(WorkspaceHelpMenuButton, { isDesktop }));
  }

  it("Desktopand Web 的漏洞入口紧跟Report an Issue，打开Configuration地址；缺失时Hide", async () => {
    for (const desktop of [true, false]) {
      captured.zsrcUrl = "https://security.example.test/report";
      captured.openExternal.mockClear();
      try {
        await render(desktop);
        const index = captured.menuItems.findIndex(
          (item) => item.label === "workspaceHeader.help.reportVulnerability",
        );
        expect(index).toBeGreaterThan(0);
        expect(captured.menuItems[index - 1]?.label).toBe("workspaceHeader.help.issueReport");
        await captured.menuItems[index]?.onSelect?.();
        expect(captured.openExternal).toHaveBeenCalledExactlyOnceWith(captured.zsrcUrl);
      } finally {
        captured.zsrcUrl = null;
      }
      expect(await render(desktop)).not.toContain("workspaceHeader.help.reportVulnerability");
    }
  });

  it("冷Cache加载项不可触发outer链，有效Configuration到达时Retain原Location与Copy", async () => {
    captured.loading = true;
    captured.openExternal.mockClear();
    try {
      await render(true);
      const before = captured.menuItems.map((item) => item.label);
      const item = captured.menuItems.find(
        (item) => item.label === "workspaceHeader.help.reportVulnerability",
      );
      expect(item).toMatchObject({ disabled: true, onSelect: undefined });
      captured.loading = false;
      captured.zsrcUrl = "https://security.example.test/report";
      await render(true);
      expect(captured.menuItems.map((item) => item.label)).toEqual(before);
      expect(
        captured.menuItems.find((item) => item.label === "workspaceHeader.help.reportVulnerability")
          ?.disabled,
      ).toBe(false);
      expect(captured.openExternal).not.toHaveBeenCalled();
    } finally {
      captured.loading = false;
      captured.zsrcUrl = null;
    }
  });

  it("Desktop端渲染Resource Manager项，点击走 OpenResourceManager Command", async () => {
    const html = await render(true);

    expect(html).toContain("titleBar.menu.help.resourceManager");
    const item = captured.menuItems.find(
      (entry) => entry.testId === TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER,
    );
    expect(item).toBeDefined();
    await item!.onSelect?.();
    expect(captured.executeDesktopCommand).toHaveBeenCalledWith(
      DesktopCommandIds.OpenResourceManager,
    );
  });

  it("Web 端（isDesktop 缺省 / false）不渲染Resource Manager项", async () => {
    for (const isDesktop of [undefined, false]) {
      const html = await render(isDesktop);
      expect(html).not.toContain("titleBar.menu.help.resourceManager");
      expect(
        captured.menuItems.some(
          (entry) => entry.testId === TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER,
        ),
      ).toBe(false);
    }
  });

  it("Desktop端关于项位于最后，点击复用 ShowAbout", async () => {
    await render(true);
    const index = captured.menuItems.findIndex(
      (entry) => entry.label === "titleBar.menu.help.about",
    );
    expect(index).toBeGreaterThan(0);
    expect(index).toBe(captured.menuItems.length - 1);
    await captured.menuItems[index]?.onSelect?.();
    expect(captured.executeDesktopCommand).toHaveBeenCalledExactlyOnceWith(
      DesktopCommandIds.ShowAbout,
    );
  });

  it("Web andMobile Remote Control不ShowDesktop关于入口", async () => {
    for (const isDesktop of [undefined, false]) {
      expect(await render(isDesktop)).not.toContain("titleBar.menu.help.about");
    }
  });

  it("Resource Manager之后ShowCheck for Updates，点击execute已有Command", async () => {
    await render(true);
    const index = captured.menuItems.findIndex(
      (entry) => entry.label === "titleBar.menu.help.checkForUpdates",
    );
    expect(index).toBeGreaterThan(0);
    expect(captured.menuItems[index - 1]?.testId).toBe(TID_WORKSPACE_HELP_MENU_RESOURCE_MANAGER);
    await captured.menuItems[index]?.onSelect?.();
    expect(captured.executeDesktopCommand).toHaveBeenCalledExactlyOnceWith(
      DesktopCommandIds.CheckForUpdates,
    );
  });

  it("Web 与 Preview 不ShowCheck for Updates", async () => {
    expect(await render(false)).not.toContain("titleBar.menu.help.checkForUpdates");
    captured.updateMenu.visible = false;
    try {
      expect(await render(true)).not.toContain("titleBar.menu.help.checkForUpdates");
    } finally {
      captured.updateMenu.visible = true;
    }
  });

  it("DesktopExport logs复用平台导出及SharedNotice", async () => {
    await render(true);
    const item = captured.menuItems.find(
      (entry) => entry.label === "titleBar.menu.help.exportLogs",
    );
    expect(item).toBeDefined();
    await item!.onSelect?.();
    expect(captured.exportLogs).toHaveBeenCalledExactlyOnceWith();
    expect(captured.toast).toHaveBeenCalledWith("sidebar.exportLogs.pending", {
      durationMs: Number.POSITIVE_INFINITY,
    });
    expect(captured.dismissToast).toHaveBeenCalledWith(7);
  });

  it("Web andMobile Remote Control不ShowLocalExport logs入口", async () => {
    for (const isDesktop of [undefined, false]) {
      expect(await render(isDesktop)).not.toContain("titleBar.menu.help.exportLogs");
      expect(captured.exportLogs).not.toHaveBeenCalled();
    }
  });

  it("Desktop两组One条分隔线，Export logs位于Desktop组首项，Web 仅Help组", async () => {
    for (const desktop of [true, false]) {
      const html = await render(desktop);
      expect(captured.menuItems.map((item) => item.label)).toEqual([
        "workspaceHeader.help.docs",
        "workspaceHeader.help.community",
        "workspaceHeader.help.issueReport",
        "workspaceHeader.help.productRequest",
        ...(desktop
          ? [
              "titleBar.menu.help.exportLogs",
              "titleBar.menu.help.resourceManager",
              "titleBar.menu.help.checkForUpdates",
              "titleBar.menu.help.about",
            ]
          : []),
      ]);
      expect((html.match(/<hr/g) ?? []).length).toBe(desktop ? 1 : 0);
    }
  });

  it("Desktop端与 Web 端都Retain原有Help项", async () => {
    for (const isDesktop of [true, false]) {
      const html = await render(isDesktop);
      for (const id of [
        "workspaceHeader.help.issueReport",
        "workspaceHeader.help.productRequest",
        "workspaceHeader.help.community",
        "workspaceHeader.help.docs",
      ]) {
        expect(html).toContain(id);
      }
    }
  });
});
