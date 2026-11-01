// @vitest-environment jsdom
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => {
  const importChromeBrowserData = vi.fn(async () => ({
    success: true,
    cookies: { imported: 3, skipped: 1, failed: 0 },
    localStorage: {
      originsImported: 1,
      entriesImported: 2,
      originsSkipped: 0,
      originsFailed: 0,
    },
  }));
  const clearEmbeddedBrowserData = vi.fn(async () => ({ success: true }));
  const initialize = vi.fn(async () => {});
  const setEnabled = vi.fn(async (_pluginId: string, enabled: boolean) => {
    pluginState.plugins[0].enabled = enabled;
  });
  const pluginState = {
    plugins: [
      {
        id: "browser-use@cf-plugins-official",
        name: "browser-use",
        enabled: true,
      },
    ],
    loading: false,
    error: null as string | null,
    togglingPluginId: null as string | null,
    initialize,
    setEnabled,
  };
  return {
    clearEmbeddedBrowserData,
    importChromeBrowserData,
    initialize,
    pluginState,
    setEnabled,
  };
});

vi.mock("@/hooks/usePlatform.js", () => ({
  usePlatform: () => ({
    importChromeBrowserData: h.importChromeBrowserData,
    clearEmbeddedBrowserData: h.clearEmbeddedBrowserData,
  }),
}));
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({
    pluginManagementService: {},
    skillsService: {},
  }),
}));
vi.mock("@/hooks/useCfSessionService.js", () => ({
  useCfSessionService: () => ({}),
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useCfIntl: () => ({
    intl: {
      formatMessage: ({ id }: { id: string }) => id,
    },
  }),
}));
vi.mock("@/lib/cfDraftSkillInvalidation.js", () => ({
  invalidateDeferredDraftSessionForSkillChange: vi.fn(async () => {}),
}));
vi.mock("@/store/pluginManagementStore.js", () => ({
  usePluginManagementStore: Object.assign(
    (selector: (state: typeof h.pluginState) => unknown) => selector(h.pluginState),
    { getState: () => h.pluginState },
  ),
}));
vi.mock("@/store/skillStore.js", () => ({
  useSkillStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      refresh: vi.fn(async () => {}),
      workspacePath: null,
      workspaceIdentity: null,
    }),
}));
vi.mock("@/components/ui/toast.js", () => ({ toast: vi.fn() }));

import { BrowserSettingsSection } from "@/settings/BrowserSettingsSection.js";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.pluginState.plugins[0].enabled = true;
  h.pluginState.loading = false;
  h.pluginState.error = null;
  h.pluginState.togglingPluginId = null;
});

function renderSection(
  isDesktop = true,
  isWindowsDesktop = false,
  overrides: Record<string, unknown> = {},
) {
  return render(
    createElement(BrowserSettingsSection, {
      isDesktop,
      isWindowsDesktop,
      workspacePath: "/workspace",
      workspaceIdentity: "workspace-id",
      ...overrides,
    }),
  );
}

describe("BrowserSettingsSection", () => {
  it("Show ignore certificate validation toggle; disabled by default and persist user selection", () => {
    const onChange = vi.fn(async () => {});
    renderSection(true, false, {
      embeddedBrowserAllowInsecureCertificates: false,
      onEmbeddedBrowserAllowInsecureCertificatesChange: onChange,
    });

    const toggle = screen.getByRole("switch", {
      name: "settings.embeddedBrowserAllowInsecureCertificates",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("Reflect selected state when toggle is enabled", () => {
    renderSection(true, false, {
      embeddedBrowserAllowInsecureCertificates: true,
      onEmbeddedBrowserAllowInsecureCertificatesChange: vi.fn(async () => {}),
    });

    expect(
      screen
        .getByRole("switch", { name: "settings.embeddedBrowserAllowInsecureCertificates" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("Do not show ignore certificate validation toggle on non-desktop platforms", () => {
    renderSection(false, false, {
      embeddedBrowserAllowInsecureCertificates: false,
      onEmbeddedBrowserAllowInsecureCertificatesChange: vi.fn(async () => {}),
    });

    expect(
      screen.queryByRole("switch", {
        name: "settings.embeddedBrowserAllowInsecureCertificates",
      }),
    ).toBeNull();
  });

  it("复用官方 browser-use plugin 开关并初始化当前 workspace", async () => {
    renderSection();

    expect(h.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        workspacePath: "/workspace",
        workspaceIdentity: "workspace-id",
      }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "settings.browser.control.title" }));

    await waitFor(() => {
      expect(h.setEnabled).toHaveBeenCalledWith(
        "browser-use@cf-plugins-official",
        false,
        expect.anything(),
      );
    });
  });

  it("One-click import of Chrome\'s current Profile Cookies and LocalStorage on desktop", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "settings.browser.import.action" }));

    await waitFor(() => {
      expect(h.importChromeBrowserData).toHaveBeenCalledOnce();
    });
    expect(await screen.findByText("settings.browser.import.success")).toBeTruthy();
  });

  it("Windows 暂时隐藏导入入口但保留浏览器数据清理", () => {
    renderSection(true, true);

    expect(screen.queryByRole("button", { name: "settings.browser.import.action" })).toBeNull();
    expect(screen.getByRole("button", { name: "settings.browser.clearCache.action" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "settings.browser.clearAll.action" })).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: "settings.browser.import.adminConsent" }),
    ).toBeNull();
    expect(h.importChromeBrowserData).not.toHaveBeenCalled();
  });

  it("未安装 Chrome 时展示 Chrome 未找到提示", async () => {
    h.importChromeBrowserData.mockResolvedValueOnce({
      success: false,
      cookies: { imported: 0, skipped: 0, failed: 0 },
      localStorage: {
        originsImported: 0,
        entriesImported: 0,
        originsSkipped: 0,
        originsFailed: 0,
      },
      error: "chrome_executable_not_found",
    });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "settings.browser.import.action" }));

    expect(await screen.findByText("settings.browser.import.executableNotFound")).toBeTruthy();
  });

  it("Show actionable error when Profile cannot be automatically disambiguated", async () => {
    h.importChromeBrowserData.mockResolvedValueOnce({
      success: false,
      cookies: { imported: 0, skipped: 0, failed: 0 },
      localStorage: {
        originsImported: 0,
        entriesImported: 0,
        originsSkipped: 0,
        originsFailed: 0,
      },
      error: "chrome_profile_ambiguous",
    });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "settings.browser.import.action" }));

    expect(await screen.findByText("settings.browser.import.ambiguous")).toBeTruthy();
  });

  it("macOS 钥匙串授权被拒绝时提示导入已取消", async () => {
    h.importChromeBrowserData.mockResolvedValueOnce({
      success: false,
      cookies: { imported: 0, skipped: 0, failed: 0 },
      localStorage: {
        originsImported: 0,
        entriesImported: 0,
        originsSkipped: 0,
        originsFailed: 0,
      },
      error: "chrome_cookie_access_denied",
    });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "settings.browser.import.action" }));

    expect(await screen.findByText("settings.browser.import.accessDenied")).toBeTruthy();
  });

  it("Show only the actual imported count when some cookies fail to import", async () => {
    h.importChromeBrowserData.mockResolvedValueOnce({
      success: true,
      cookies: { imported: 2, skipped: 4, failed: 0 },
      localStorage: {
        originsImported: 1,
        entriesImported: 3,
        originsSkipped: 0,
        originsFailed: 0,
      },
      issues: ["chrome_cookie_protection_unsupported"],
    });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "settings.browser.import.action" }));

    expect(await screen.findByText("settings.browser.import.success")).toBeTruthy();
    expect(screen.queryByText("settings.browser.import.partialCookieProtected")).toBeNull();
    expect(screen.queryByText("settings.browser.import.successWithSkipped")).toBeNull();
  });

  it("Disable local browser data operations on web/mobile and display desktop prompt", () => {
    renderSection(false);

    expect(screen.getByText("settings.browser.desktopOnly")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "settings.browser.import.action",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "settings.browser.clearCache.action",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
