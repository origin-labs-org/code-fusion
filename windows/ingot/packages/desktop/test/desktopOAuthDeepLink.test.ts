import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformChannels } from "@origin-ai/cf-shared";

const electronMocks = vi.hoisted(() => ({
  appShow: vi.fn(),
  showMessageBoxSync: vi.fn(() => 0),
  getFocusedWindow: vi.fn(),
  getAllWindows: vi.fn(),
  setAsDefaultProtocolClient: vi.fn(() => true),
}));
const fsMocks = vi.hoisted(() => ({
  statSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  fsMocks.statSync.mockImplementation(actual.statSync);
  return {
    ...actual,
    statSync: fsMocks.statSync,
  };
});

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp"),
    get isPackaged() {
      return false;
    },
    setAsDefaultProtocolClient: electronMocks.setAsDefaultProtocolClient,
    show: electronMocks.appShow,
  },
  BrowserWindow: {
    getFocusedWindow: electronMocks.getFocusedWindow,
    getAllWindows: electronMocks.getAllWindows,
  },
  dialog: {
    showMessageBoxSync: electronMocks.showMessageBoxSync,
  },
}));

const tempDirs: string[] = [];

beforeEach(() => {
  vi.resetModules();
  electronMocks.appShow.mockClear();
  electronMocks.showMessageBoxSync.mockReset();
  electronMocks.showMessageBoxSync.mockReturnValue(0);
  electronMocks.getFocusedWindow.mockReset();
  electronMocks.getAllWindows.mockReset();
  electronMocks.setAsDefaultProtocolClient.mockClear();
  fsMocks.statSync.mockClear();
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktopOAuthDeepLink workspace open routing", () => {
  it("Buffer workspace open requests targeting unready windows during cold start, and deliver after renderer is ready", async () => {
    const workspacePath = createTempWorkspace();
    const targetWindow = createMockWindow(7);
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(targetWindow);
    electronMocks.getAllWindows.mockReturnValue([targetWindow]);

    const { deliverPendingDeepLink, handleDeepLink } =
      await import("../src/main/desktopOAuthDeepLink.js");

    const handled = handleDeepLink(buildWorkspaceOpenUrl(workspacePath), logger);

    expect(handled).toBe(true);
    expect(targetWindow.webContents.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      "[deep-link] Workspace open request hit unready window; caching and waiting for renderer ready",
      { windowId: 7, path: workspacePath },
    );
    expect(electronMocks.showMessageBoxSync).toHaveBeenCalled();

    deliverPendingDeepLink(targetWindow.webContents);

    expect(targetWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.OpenWorkspacePath,
      workspacePath,
    );
  });

  it("Deliver workspace open requests immediately when received after renderer is ready", async () => {
    const workspacePath = createTempWorkspace();
    const targetWindow = createMockWindow(11);
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(targetWindow);
    electronMocks.getAllWindows.mockReturnValue([targetWindow]);

    const { deliverPendingDeepLink, handleDeepLink } =
      await import("../src/main/desktopOAuthDeepLink.js");

    deliverPendingDeepLink(targetWindow.webContents);
    targetWindow.webContents.send.mockClear();

    const handled = handleDeepLink(buildWorkspaceOpenUrl(workspacePath), logger);

    expect(handled).toBe(true);
    expect(targetWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.OpenWorkspacePath,
      workspacePath,
    );
    expect(electronMocks.showMessageBoxSync).toHaveBeenCalled();
  });

  it("Workspace open routing uses business window resolver and will not select CUA auxiliary overlay", async () => {
    const workspacePath = createTempWorkspace();
    const cuaIndicatorWindow = createMockWindow(12);
    const applicationWindow = createMockWindow(13);
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(null);
    electronMocks.getAllWindows.mockReturnValue([cuaIndicatorWindow, applicationWindow]);

    const { deliverPendingDeepLink, handleOpenWorkspacePath } =
      await import("../src/main/desktopOAuthDeepLink.js");
    deliverPendingDeepLink(applicationWindow.webContents);

    expect(
      handleOpenWorkspacePath(workspacePath, logger, {
        resolveApplicationWindow: () => applicationWindow,
      }),
    ).toBe(true);
    expect(applicationWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.OpenWorkspacePath,
      workspacePath,
    );
    expect(cuaIndicatorWindow.webContents.send).not.toHaveBeenCalled();
  });

  it("Workspace open confirmation dialog uses caller-injected locale text", async () => {
    const workspacePath = createTempWorkspace();
    const targetWindow = createMockWindow(21);
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(targetWindow);
    electronMocks.getAllWindows.mockReturnValue([targetWindow]);

    const { deliverPendingDeepLink, handleDeepLink, resolveExternalWorkspaceOpenDialogCopy } =
      await import("../src/main/desktopOAuthDeepLink.js");

    deliverPendingDeepLink(targetWindow.webContents);
    targetWindow.webContents.send.mockClear();

    const handled = handleDeepLink(buildWorkspaceOpenUrl(workspacePath), logger, {
      confirmationCopy: resolveExternalWorkspaceOpenDialogCopy("zh-CN"),
    });

    expect(handled).toBe(true);
    expect(electronMocks.showMessageBoxSync).toHaveBeenCalledWith(
      targetWindow,
      expect.objectContaining({
        buttons: ["打开文件夹", "取消"],
        title: "打开外部 CodeFusion 链接？",
      }),
    );
    expect(targetWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.OpenWorkspacePath,
      workspacePath,
    );
  });

  it("Workspace open confirmation dialog still blocks synchronously and buffers the request when there is no parent window", async () => {
    const workspacePath = createTempWorkspace();
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(null);
    electronMocks.getAllWindows.mockReturnValue([]);

    const { deliverPendingDeepLink, handleDeepLink } =
      await import("../src/main/desktopOAuthDeepLink.js");

    const handled = handleDeepLink(buildWorkspaceOpenUrl(workspacePath), logger);

    expect(handled).toBe(false);
    expect(electronMocks.showMessageBoxSync).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ["Open folder", "Cancel"],
        title: "Open external CodeFusion link?",
      }),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      "[deep-link] Workspace open request did not match any window yet; caching and waiting for renderer ready",
      { path: workspacePath },
    );

    const targetWindow = createMockWindow(22);
    deliverPendingDeepLink(targetWindow.webContents);
    expect(targetWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.OpenWorkspacePath,
      workspacePath,
    );
  });

  it("Do not buffer workspace open requests when there is no parent window and user cancels", async () => {
    const workspacePath = createTempWorkspace();
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.showMessageBoxSync.mockReturnValue(1);
    electronMocks.getFocusedWindow.mockReturnValue(null);
    electronMocks.getAllWindows.mockReturnValue([]);

    const { deliverPendingDeepLink, handleDeepLink } =
      await import("../src/main/desktopOAuthDeepLink.js");

    const handled = handleDeepLink(buildWorkspaceOpenUrl(workspacePath), logger);

    expect(handled).toBe(true);
    expect(electronMocks.showMessageBoxSync).toHaveBeenCalledWith(expect.any(Object));
    expect(logger.warn).toHaveBeenCalledWith("[deep-link] 用户取消打开外部链接工作区", {
      path: workspacePath,
    });

    const targetWindow = createMockWindow(23);
    deliverPendingDeepLink(targetWindow.webContents);
    expect(targetWindow.webContents.send).not.toHaveBeenCalled();
  });

  it("Do not deliver workspace open requests when user cancels deep link confirmation", async () => {
    const workspacePath = createTempWorkspace();
    const targetWindow = createMockWindow(12);
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.showMessageBoxSync.mockReturnValue(1);
    electronMocks.getFocusedWindow.mockReturnValue(targetWindow);
    electronMocks.getAllWindows.mockReturnValue([targetWindow]);

    const { deliverPendingDeepLink, handleDeepLink } =
      await import("../src/main/desktopOAuthDeepLink.js");

    deliverPendingDeepLink(targetWindow.webContents);
    targetWindow.webContents.send.mockClear();

    const handled = handleDeepLink(buildWorkspaceOpenUrl(workspacePath), logger);

    expect(handled).toBe(true);
    expect(targetWindow.webContents.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("[deep-link] 用户取消打开外部链接工作区", {
      path: workspacePath,
    });
  });

  it.each([
    ["标准 UNC", "\\\\attacker\\share"],
    ["Forward-slash UNC", "//attacker/share"],
    ["extended UNC", "\\\\?\\UNC\\attacker\\share"],
  ])("Reject %s workspace deep link without touching the filesystem before rejection", async (_label, workspacePath) => {
    const targetWindow = createMockWindow(14);
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(targetWindow);
    electronMocks.getAllWindows.mockReturnValue([targetWindow]);

    const { handleDeepLink } = await import("../src/main/desktopOAuthDeepLink.js");

    const handled = handleDeepLink(buildWorkspaceOpenUrl(workspacePath), logger);

    expect(handled).toBe(false);
    expect(fsMocks.statSync).not.toHaveBeenCalled();
    expect(electronMocks.showMessageBoxSync).not.toHaveBeenCalled();
    expect(targetWindow.webContents.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("[deep-link] 网络工作区路径Rejected", {
      path: workspacePath,
    });
  });

  it("Do not buffer workspace open requests by default when no ready window exists", async () => {
    const workspacePath = createTempWorkspace();
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(null);
    electronMocks.getAllWindows.mockReturnValue([]);

    const { deliverPendingDeepLink, handleOpenWorkspacePath } =
      await import("../src/main/desktopOAuthDeepLink.js");

    const handled = handleOpenWorkspacePath(workspacePath, logger);

    expect(handled).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith("[deep-link] Workspace open request did not match any window, ignored", {
      path: workspacePath,
    });

    const targetWindow = createMockWindow(13);
    deliverPendingDeepLink(targetWindow.webContents);
    expect(targetWindow.webContents.send).not.toHaveBeenCalled();
  });

  it("Neither buffer nor deliver when workspace open is blocked by gate", async () => {
    const workspacePath = createTempWorkspace();
    const targetWindow = createMockWindow(17);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const onWorkspaceOpenBlocked = vi.fn();
    electronMocks.getFocusedWindow.mockReturnValue(targetWindow);
    electronMocks.getAllWindows.mockReturnValue([targetWindow]);

    const { deliverPendingDeepLink, handleDeepLink } =
      await import("../src/main/desktopOAuthDeepLink.js");

    const handled = handleDeepLink(buildWorkspaceOpenUrl(workspacePath), logger, {
      canOpenWorkspace: () => false,
      onWorkspaceOpenBlocked,
    });

    expect(handled).toBe(true);
    expect(onWorkspaceOpenBlocked).toHaveBeenCalledWith(workspacePath);
    expect(targetWindow.webContents.send).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith("[deep-link] Workspace open request blocked by current startup gate", {
      path: workspacePath,
    });

    deliverPendingDeepLink(targetWindow.webContents);
    expect(targetWindow.webContents.send).not.toHaveBeenCalled();
  });
});

describe("desktopOAuthDeepLink OAuth routing", () => {
  it("Attribution-only callbacks do not consume OAuth state routing; only genuine authorization code callbacks consume it", async () => {
    vi.useFakeTimers();
    try {
      const targetWindow = createMockWindow(31);
      const logger = { info: vi.fn(), warn: vi.fn() };
      electronMocks.getAllWindows.mockReturnValue([targetWindow]);

      const { handleDeepLink, registerOAuthState } =
        await import("../src/main/desktopOAuthDeepLink.js");

      registerOAuthState(31, { state: "state-001", provider: "bigmodel" });

      expect(
        handleDeepLink("cf://oauth/callback?state=state-001&utm_source=google", logger),
      ).toBe(true);
      expect(targetWindow.webContents.send).toHaveBeenCalledWith(
        PlatformChannels.OAuthCallback,
        "cf://oauth/callback?state=state-001&utm_source=google",
      );

      targetWindow.webContents.send.mockClear();

      expect(
        handleDeepLink("cf://oauth/callback?authCode=auth-001&state=state-001", logger),
      ).toBe(true);
      expect(targetWindow.webContents.send).toHaveBeenCalledWith(
        PlatformChannels.OAuthCallback,
        "cf://oauth/callback?authCode=auth-001&state=state-001",
      );

      targetWindow.webContents.send.mockClear();

      expect(
        handleDeepLink("cf://oauth/callback?authCode=auth-002&state=state-001", logger),
      ).toBe(false);
      expect(targetWindow.webContents.send).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenLastCalledWith(
        "[deep-link] OAuth callback did not hit target window; caching and waiting for renderer ready",
        {
          state: "state-001",
          hasRouteTarget: false,
        },
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

function createTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "cf-workspace-open-"));
  tempDirs.push(dir);
  return dir;
}

function createMockWindow(webContentsId: number) {
  return {
    webContents: {
      id: webContentsId,
      send: vi.fn(),
    },
    focus: vi.fn(),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => true),
    restore: vi.fn(),
    show: vi.fn(),
  };
}

function buildWorkspaceOpenUrl(workspacePath: string): string {
  return `cf://workspace/open?path=${encodeURIComponent(workspacePath)}`;
}

function buildShareImportUrl(shareCode: string): string {
  return `cf://share/import?code=${encodeURIComponent(shareCode)}`;
}

describe("desktopOAuthDeepLink share import routing", () => {
  it("Share import routing uses business window resolver and will not select CUA auxiliary overlay", async () => {
    const cuaIndicatorWindow = createMockWindow(41);
    const applicationWindow = createMockWindow(42);
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(cuaIndicatorWindow);
    electronMocks.getAllWindows.mockReturnValue([cuaIndicatorWindow, applicationWindow]);

    const { deliverPendingDeepLink, handleDeepLink } =
      await import("../src/main/desktopOAuthDeepLink.js");
    deliverPendingDeepLink(applicationWindow.webContents);

    expect(
      handleDeepLink(buildShareImportUrl("share-code-1"), logger, {
        resolveApplicationWindow: () => applicationWindow,
      }),
    ).toBe(true);
    expect(applicationWindow.webContents.send).toHaveBeenCalledWith(PlatformChannels.ShareImport, {
      shareCode: "share-code-1",
    });
    expect(cuaIndicatorWindow.webContents.send).not.toHaveBeenCalled();
  });

  it("Pending share import is delivered only to target window, even if other windows ready first", async () => {
    const targetWindow = createMockWindow(51);
    const otherWindow = createMockWindow(52);
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(targetWindow);
    electronMocks.getAllWindows.mockReturnValue([targetWindow, otherWindow]);

    const { deliverPendingDeepLink, handleDeepLink } =
      await import("../src/main/desktopOAuthDeepLink.js");

    expect(handleDeepLink(buildShareImportUrl("share-code-2"), logger)).toBe(true);
    expect(targetWindow.webContents.send).not.toHaveBeenCalled();

    deliverPendingDeepLink(otherWindow.webContents);
    expect(otherWindow.webContents.send).not.toHaveBeenCalledWith(
      PlatformChannels.ShareImport,
      expect.anything(),
    );

    deliverPendingDeepLink(targetWindow.webContents);
    expect(targetWindow.webContents.send).toHaveBeenCalledWith(PlatformChannels.ShareImport, {
      shareCode: "share-code-2",
    });
  });

  it("Clean up pending share import when target window closes; do not deliver to windows that ready later", async () => {
    const targetWindow = createMockWindow(61);
    const laterWindow = createMockWindow(62);
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(targetWindow);
    electronMocks.getAllWindows.mockReturnValue([targetWindow]);

    const { clearOAuthRoutesForWindow, deliverPendingDeepLink, handleDeepLink } =
      await import("../src/main/desktopOAuthDeepLink.js");

    expect(handleDeepLink(buildShareImportUrl("share-code-3"), logger)).toBe(true);
    clearOAuthRoutesForWindow(61);

    deliverPendingDeepLink(laterWindow.webContents);
    expect(laterWindow.webContents.send).not.toHaveBeenCalledWith(
      PlatformChannels.ShareImport,
      expect.anything(),
    );
  });

  it("Buffer share import during cold start with no windows, and deliver to first ready window", async () => {
    const firstWindow = createMockWindow(71);
    const logger = { info: vi.fn(), warn: vi.fn() };
    electronMocks.getFocusedWindow.mockReturnValue(null);
    electronMocks.getAllWindows.mockReturnValue([]);

    const { deliverPendingDeepLink, handleDeepLink } =
      await import("../src/main/desktopOAuthDeepLink.js");

    expect(handleDeepLink(buildShareImportUrl("share-code-4"), logger)).toBe(false);
    deliverPendingDeepLink(firstWindow.webContents);
    expect(firstWindow.webContents.send).toHaveBeenCalledWith(PlatformChannels.ShareImport, {
      shareCode: "share-code-4",
    });
  });
});
