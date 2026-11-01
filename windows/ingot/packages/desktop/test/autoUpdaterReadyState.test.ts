import { EventEmitter } from "node:events";
import { PlatformChannels, desktopMenuMessageIds, formatDesktopMenuMessage } from "@origin-ai/cf-shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { loggerErrorMock, loggerInfoMock, loggerWarnMock, readFileMock, spawnMock } = vi.hoisted(
  () => {
    return {
      loggerErrorMock: vi.fn(),
      loggerInfoMock: vi.fn(),
      loggerWarnMock: vi.fn(),
      readFileMock: vi.fn(),
      spawnMock: vi.fn(),
    };
  },
);

const originalPlatform = process.platform;

const ONE_HOUR_MS = 60 * 60 * 1000;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const TWO_MINUTES_MS = 2 * 60 * 1000;

const TEST_LOCALE = "en-US" as const;

const menuItem = {
  label: "",
  enabled: true,
};

const browserWindows: Array<{
  isDestroyed: () => boolean;
  webContents: {
    id: number;
    send: ReturnType<typeof vi.fn>;
  };
}> = [];

const ipcMainOn = vi.fn();
const ipcMainHandle = vi.fn();
const dialogShowMessageBox = vi.fn(async () => ({ response: 1 }));
const settingServiceMock = {
  get: vi.fn(async () => ({ recentProjects: [], locale: "en-US" as const })),
  update: vi.fn(async () => {}),
};

const appListeners = new Map<string, Array<(...args: unknown[]) => void>>();
const appMock = {
  isPackaged: true,
  getVersion: vi.fn(() => "0.1.24"),
  getAppPath: vi.fn(() => "/tmp/cf-app"),
  relaunch: vi.fn(),
  exit: vi.fn(),
  on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    const listeners = appListeners.get(event) ?? [];
    listeners.push(listener);
    appListeners.set(event, listeners);
  }),
};

const autoUpdaterMock = new EventEmitter() as EventEmitter & {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: unknown;
  checkForUpdates: ReturnType<typeof vi.fn>;
  downloadUpdate: ReturnType<typeof vi.fn>;
  quitAndInstall: ReturnType<typeof vi.fn>;
  setFeedURL: ReturnType<typeof vi.fn>;
  forceDevUpdateConfig: boolean;
  currentVersion: { format(): string } | null;
  installerPath: string | null;
  autoRunAppAfterInstall: boolean;
  installDirectory: string | null;
  downloadedUpdateHelper: {
    downloadedFileInfo?: { isAdminRightsRequired?: boolean } | null;
    packageFile?: string | null;
  } | null;
};

autoUpdaterMock.autoDownload = false;
autoUpdaterMock.autoInstallOnAppQuit = false;
autoUpdaterMock.checkForUpdates = vi.fn(() => Promise.resolve());
autoUpdaterMock.downloadUpdate = vi.fn(() => Promise.resolve([]));
autoUpdaterMock.quitAndInstall = vi.fn();
autoUpdaterMock.setFeedURL = vi.fn();
autoUpdaterMock.forceDevUpdateConfig = false;
autoUpdaterMock.currentVersion = null;
autoUpdaterMock.installerPath =
  "C:\\Users\\demo\\AppData\\Local\\cf-updater\\pending\\CodeFusion-0.1.25-win-x64.exe";
autoUpdaterMock.autoRunAppAfterInstall = true;
autoUpdaterMock.installDirectory = null;
autoUpdaterMock.downloadedUpdateHelper = null;

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

vi.mock("electron", () => ({
  app: appMock,
  BrowserWindow: {
    getAllWindows: vi.fn(() => browserWindows),
  },
  ipcMain: {
    on: ipcMainOn,
    handle: ipcMainHandle,
  },
  dialog: {
    showMessageBox: dialogShowMessageBox,
  },
  Menu: {
    getApplicationMenu: vi.fn(() => ({
      getMenuItemById: vi.fn(() => menuItem),
    })),
  },
}));

vi.mock("electron-updater", () => {
  class CancellationTokenMock {
    cancelled = false;
    private cancelListeners: Array<() => void> = [];

    cancel() {
      this.cancelled = true;
      const listeners = this.cancelListeners;
      this.cancelListeners = [];
      for (const listener of listeners) {
        listener();
      }
    }

    once(event: string, listener: () => void) {
      if (event === "cancel") {
        this.cancelListeners.push(listener);
      }
      return this;
    }

    dispose() {
      this.cancelListeners = [];
    }
  }

  class ProviderMock {
    constructor() {}
    get isUseMultipleRangeRequest() {
      return false;
    }
    setRequestHeaders() {}
  }

  return {
    CancellationToken: CancellationTokenMock,
    Provider: ProviderMock,
    default: {
      autoUpdater: autoUpdaterMock,
    },
  };
});

vi.mock("node:fs/promises", () => ({
  readFile: readFileMock,
}));

vi.mock("../src/main/logger.js", () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
  },
}));

async function importAutoUpdaterWithLocale() {
  const module = await import("../src/main/autoUpdater.js");
  module.setAutoUpdaterMenuLocale(TEST_LOCALE);
  return module;
}

function mockProcessPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

function getExpectedDownloadingProgressLabel(progress: number) {
  return formatDesktopMenuMessage(
    TEST_LOCALE,
    desktopMenuMessageIds.helpDownloadingUpdateProgress,
    {
      progress,
    },
  );
}

describe("autoUpdater ready state sync", () => {
  beforeEach(() => {
    vi.resetModules();
    mockProcessPlatform(originalPlatform);
    browserWindows.length = 0;
    menuItem.label = "";
    menuItem.enabled = true;
    ipcMainOn.mockClear();
    ipcMainHandle.mockClear();
    spawnMock.mockClear();
    loggerInfoMock.mockClear();
    loggerWarnMock.mockClear();
    loggerErrorMock.mockClear();
    dialogShowMessageBox.mockClear();
    dialogShowMessageBox.mockResolvedValue({ response: 1 });
    appMock.getVersion.mockClear();
    appMock.relaunch.mockClear();
    appMock.exit.mockClear();
    autoUpdaterMock.removeAllListeners();
    autoUpdaterMock.autoDownload = false;
    autoUpdaterMock.autoInstallOnAppQuit = false;
    autoUpdaterMock.checkForUpdates.mockClear();
    autoUpdaterMock.downloadUpdate.mockClear();
    autoUpdaterMock.quitAndInstall.mockClear();
    autoUpdaterMock.setFeedURL.mockClear();
    autoUpdaterMock.forceDevUpdateConfig = false;
    autoUpdaterMock.currentVersion = null;
    autoUpdaterMock.installerPath =
      "C:\\Users\\demo\\AppData\\Local\\cf-updater\\pending\\CodeFusion-0.1.25-win-x64.exe";
    autoUpdaterMock.autoRunAppAfterInstall = true;
    autoUpdaterMock.installDirectory = null;
    autoUpdaterMock.downloadedUpdateHelper = null;
    settingServiceMock.get.mockClear();
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
    });
    settingServiceMock.update.mockClear();
    appListeners.clear();
    appMock.getVersion.mockImplementation(() => "0.1.24");
    appMock.getAppPath.mockClear();
    appMock.getAppPath.mockReturnValue("/tmp/cf-app");
    appMock.isPackaged = true;
    Object.defineProperty(process, "resourcesPath", {
      value: "/tmp/cf-resources",
      configurable: true,
    });
    delete process.env["TEST_UPDATER_ARCH"];
    delete process.env["CF_UPDATE_FEED_URL"];
    delete process.env["CF_AUTO_UPDATE_DEV"];
    delete process.env["CF_AUTO_UPDATE_DEV_VERSION"];
    readFileMock.mockReset();
    readFileMock.mockRejectedValue(new Error("missing update config"));
  });

  it("Do not register IPC, events, or startup checks when Preview disables updater", async () => {
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    await initAutoUpdater({ enabled: false });

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(ipcMainOn).not.toHaveBeenCalled();
    expect(autoUpdaterMock.listenerCount("checking-for-update")).toBe(0);
    expect(loggerInfoMock).toHaveBeenCalledWith(
      "[auto-update] disabled for this desktop product flavor",
    );
  });

  it("After Preview disables updater, unhandled manual check entries must not touch uninitialized updater", async () => {
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 9,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);

    const { initAutoUpdater, checkForUpdateMenuClick } = await import("../src/main/autoUpdater.js");

    await initAutoUpdater({ enabled: false });
    checkForUpdateMenuClick(win as never);
    await Promise.resolve();

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled();
    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateCheckResult, {
      kind: "dev-skipped",
    });
    expect(loggerInfoMock).toHaveBeenCalledWith(
      "[auto-update] skip manual check: updater disabled for this product flavor",
    );
  });

  it("Linux arm64 primary update check defaults to server manifest provider", async () => {
    mockProcessPlatform("linux");
    process.env["TEST_UPDATER_ARCH"] = "arm64";

    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");
    initAutoUpdater();

    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom",
        releasePlatform: "linux-aarch64",
      }),
    );
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("Do not initialize auto-updater by default in development mode", async () => {
    appMock.isPackaged = false;

    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");
    await initAutoUpdater();

    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalled();
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(autoUpdaterMock.forceDevUpdateConfig).toBe(false);
  });

  it("Explicitly enabling development auto-updater overrides local version and initiates check", async () => {
    appMock.isPackaged = false;
    appMock.getVersion.mockReturnValue("1.0.0");
    process.env["CF_AUTO_UPDATE_DEV"] = "1";
    process.env["CF_AUTO_UPDATE_DEV_VERSION"] = "3.3.1";

    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");
    await initAutoUpdater();

    expect(autoUpdaterMock.forceDevUpdateConfig).toBe(true);
    expect(autoUpdaterMock.currentVersion?.format()).toBe("3.3.1");
    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom",
      }),
    );
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(loggerInfoMock).toHaveBeenCalledWith("[auto-update] dev update enabled version=3.3.1");
  });

  it("服务端 manifest provider 会按设置选择 stable 或 preview 通道", async () => {
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      receivePreviewUpdates: true,
    });
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({
      settingService: settingServiceMock,
      deviceMid: "mid-1",
      resolveEndpointOrigin: () => "https://endpoint.example.test",
    });

    const options = autoUpdaterMock.setFeedURL.mock.calls[0]?.[0] as {
      deviceMid?: string;
      resolveEndpointOrigin?: () => string | Promise<string>;
      resolveReleaseChannel?: () => Promise<string>;
    };
    expect(options.deviceMid).toBe("mid-1");
    await expect(Promise.resolve(options.resolveEndpointOrigin?.())).resolves.toBe(
      "https://endpoint.example.test",
    );
    await expect(options.resolveReleaseChannel?.()).resolves.toBe("preview");
  });

  it("preview cold-start check does not misidentify valid preview updates as stale", async () => {
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      receivePreviewUpdates: true,
    });
    const { getAutoUpdaterState, initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({
      settingService: settingServiceMock,
      deviceMid: "mid-preview",
      resolveEndpointOrigin: () => "https://endpoint.example.test",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    autoUpdaterMock.emit("update-available", {
      version: "3.3.3",
      cfReleaseChannel: "preview",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "3.3.3",
      channel: "preview",
    });
  });

  it("Disabling preview updates rechecks stable manifest and updates available version status", async () => {
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 18,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      receivePreviewUpdates: true,
    });
    const { getAutoUpdaterState, initAutoUpdater, refreshAutoUpdaterReleaseChannel } =
      await import("../src/main/autoUpdater.js");

    initAutoUpdater({ settingService: settingServiceMock });
    const options = autoUpdaterMock.setFeedURL.mock.calls[0]?.[0] as {
      resolveReleaseChannel?: () => Promise<string>;
    };
    await expect(options.resolveReleaseChannel?.()).resolves.toBe("preview");
    await Promise.resolve();
    await Promise.resolve();

    autoUpdaterMock.emit("update-available", { version: "3.3.3" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "3.3.3",
      channel: "preview",
    });

    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      receivePreviewUpdates: false,
    });
    refreshAutoUpdaterReleaseChannel(false, "test preview setting changed");

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "checking",
      enabled: false,
    });

    await expect(options.resolveReleaseChannel?.()).resolves.toBe("stable");
    autoUpdaterMock.emit("update-available", { version: "3.3.2" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "3.3.2",
      channel: "stable",
    });
    expect(win.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.UpdateStateChanged,
      expect.objectContaining({
        kind: "update-available",
        version: "3.3.2",
        channel: "stable",
      }),
    );
  });

  it("Ignore late-arriving stable manifest results after switching to preview", async () => {
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 19,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      receivePreviewUpdates: false,
    });
    const { getAutoUpdaterState, initAutoUpdater, refreshAutoUpdaterReleaseChannel } =
      await import("../src/main/autoUpdater.js");

    initAutoUpdater({ settingService: settingServiceMock });
    autoUpdaterMock.emit("checking-for-update");
    autoUpdaterMock.emit("update-available", {
      version: "3.3.4",
      cfReleaseChannel: "stable",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "3.3.4",
      channel: "stable",
    });

    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      receivePreviewUpdates: true,
    });
    refreshAutoUpdaterReleaseChannel(true, "test preview setting changed");

    expect(getAutoUpdaterState()).toMatchObject({
      kind: "checking",
      enabled: false,
    });

    autoUpdaterMock.emit("update-available", {
      version: "3.3.4",
      cfReleaseChannel: "stable",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAutoUpdaterState()).toMatchObject({
      kind: "checking",
      enabled: false,
    });

    autoUpdaterMock.emit("update-available", {
      version: "3.3.5",
      cfReleaseChannel: "preview",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "3.3.5",
      channel: "preview",
    });
    expect(win.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.UpdateStateChanged,
      expect.objectContaining({
        kind: "update-available",
        version: "3.3.5",
        channel: "preview",
      }),
    );
  });

  it("Switching channels before update-available async processing completes is deferred until the current generation closes", async () => {
    let resolveSettings:
      | ((settings: Awaited<ReturnType<typeof settingServiceMock.get>>) => void)
      | undefined;
    const pendingSettings = new Promise<Awaited<ReturnType<typeof settingServiceMock.get>>>(
      (resolve) => {
        resolveSettings = resolve;
      },
    );
    settingServiceMock.get.mockReturnValue(pendingSettings);
    const { getAutoUpdaterState, initAutoUpdater, refreshAutoUpdaterReleaseChannel } =
      await import("../src/main/autoUpdater.js");

    initAutoUpdater({ settingService: settingServiceMock });
    autoUpdaterMock.emit("checking-for-update");
    autoUpdaterMock.emit("update-available", {
      version: "3.3.4",
      cfReleaseChannel: "stable",
    });
    await Promise.resolve();
    await Promise.resolve();

    refreshAutoUpdaterReleaseChannel(true, "test preview setting changed");

    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "checking",
      enabled: false,
    });

    resolveSettings?.({
      recentProjects: [],
      locale: "en-US",
      receivePreviewUpdates: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "checking",
      enabled: false,
    });
  });

  it("Same version manifest still re-downloads to rebuild macOS staging after cold-start restores pending install notes", async () => {
    mockProcessPlatform("darwin");
    appMock.getVersion.mockReturnValue("3.5.0");
    const pendingReleaseNotes = {
      version: "3.6.4",
      title: "Release v3.6.4",
      markdown: "## Fixes",
      releaseDate: "2026-07-30T16:56:00.356Z",
    };
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      autoDownloadAndInstallUpdates: true,
      pendingPostUpdateReleaseNotes: pendingReleaseNotes,
    });
    const { getAutoUpdaterState, hydratePendingPostUpdateReleaseNotes, initAutoUpdater } =
      await import("../src/main/autoUpdater.js");

    await hydratePendingPostUpdateReleaseNotes(settingServiceMock);
    await initAutoUpdater({ settingService: settingServiceMock });
    await Promise.resolve();

    autoUpdaterMock.emit("update-available", {
      version: "3.6.4",
      cfReleaseChannel: "stable",
      releaseName: "Release v3.6.4",
      releaseNotes: "## Fixes",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "3.6.4",
      channel: "stable",
    });
  });

  it("Clicking cold-start restored pending-install state does not run quit preparation, but restages instead", async () => {
    mockProcessPlatform("darwin");
    appMock.getVersion.mockReturnValue("3.5.0");
    const onBeforeQuitAndInstall = vi.fn();
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      autoDownloadAndInstallUpdates: true,
      pendingPostUpdateReleaseNotes: {
        version: "3.6.4",
        title: "Release v3.6.4",
        markdown: "## Fixes",
      },
    });
    const { getAutoUpdaterState, hydratePendingPostUpdateReleaseNotes, initAutoUpdater } =
      await import("../src/main/autoUpdater.js");

    await hydratePendingPostUpdateReleaseNotes(settingServiceMock);
    await initAutoUpdater({
      settingService: settingServiceMock,
      onBeforeQuitAndInstall,
    });

    const quitAndInstallHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.QuitAndInstallUpdate,
    )?.[1] as (() => Promise<void>) | undefined;
    await quitAndInstallHandler?.();

    expect(onBeforeQuitAndInstall).not.toHaveBeenCalled();
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "3.6.4",
      channel: "stable",
    });
  });

  it("Late-arriving results from previous channel do not end current channel's check generation", async () => {
    const { getAutoUpdaterState, initAutoUpdater, refreshAutoUpdaterReleaseChannel } =
      await import("../src/main/autoUpdater.js");

    initAutoUpdater({ settingService: settingServiceMock });
    autoUpdaterMock.emit("update-not-available", { version: "0.1.24" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const previewCheckPromise = new Promise<void>(() => {});
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(() => previewCheckPromise);
    refreshAutoUpdaterReleaseChannel(true, "test preview setting changed");

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "checking",
      enabled: false,
    });

    autoUpdaterMock.emit("update-available", {
      version: "3.3.4",
      cfReleaseChannel: "stable",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    refreshAutoUpdaterReleaseChannel(false, "test stable setting changed");

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "checking",
      enabled: false,
    });

    autoUpdaterMock.emit("update-available", {
      version: "3.3.5",
      cfReleaseChannel: "preview",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(3);
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "checking",
      enabled: false,
    });
  });

  it("启动参数中的 update feed URL 优先于环境变量", async () => {
    const { resolveUpdateFeedSourceFromStartupConfig } = await import("../src/main/autoUpdater.js");

    expect(
      resolveUpdateFeedSourceFromStartupConfig({
        argv: [
          "CodeFusion",
          "--cf-update-feed-url",
          "https://arg.example.test/api/v1/releases/electron/manifest",
        ],
        env: {
          CF_UPDATE_FEED_URL: "https://env.example.test/api/v1/releases/electron/manifest",
        },
      }),
    ).toEqual({
      url: "https://arg.example.test/api/v1/releases/electron/manifest",
    });
    expect(
      resolveUpdateFeedSourceFromStartupConfig({
        argv: [
          "CodeFusion",
          "--cf-update-feed-url=https://equals.example.test/api/v1/releases/electron/manifest",
        ],
        env: {},
      }),
    ).toEqual({
      url: "https://equals.example.test/api/v1/releases/electron/manifest",
    });
    expect(
      resolveUpdateFeedSourceFromStartupConfig({
        argv: ["CodeFusion"],
        env: {
          CF_UPDATE_FEED_URL: "https://env.example.test/api/v1/releases/electron/manifest",
        },
      }),
    ).toEqual({
      url: "https://env.example.test/api/v1/releases/electron/manifest",
    });
  });

  it("Server manifest API URL can be overridden at startup", async () => {
    mockProcessPlatform("darwin");
    process.env["TEST_UPDATER_ARCH"] = "arm64";
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({
      updateFeedSource: {
        url: "https://cf.z.ai/api/v1/releases/electron/manifest?platform=old&channel=1",
      },
    });

    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom",
        manifestUrl:
          "https://cf.z.ai/api/v1/releases/electron/manifest?platform=old&channel=1",
        releasePlatform: "darwin-aarch64",
      }),
    );
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("Manifest URL override does not switch to generic feed", async () => {
    mockProcessPlatform("darwin");
    process.env["TEST_UPDATER_ARCH"] = "arm64";
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");
    initAutoUpdater({
      updateFeedSource: {
        url: "https://runtime.example.test/api/v1/releases/electron/manifest",
      },
    });

    expect(autoUpdaterMock.setFeedURL).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "custom",
        manifestUrl: "https://runtime.example.test/api/v1/releases/electron/manifest",
      }),
    );
    expect(autoUpdaterMock.setFeedURL).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider: "generic" }),
    );
  });

  it("Caches version after download completes and dispatches to subsequent windows", async () => {
    const firstWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 1,
        send: vi.fn(),
      },
    };
    browserWindows.push(firstWindow);

    const { initAutoUpdater, syncReadyUpdateToWindow } = await import("../src/main/autoUpdater.js");

    initAutoUpdater();
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });

    expect(firstWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.UpdateReady,
      "0.1.25",
    );

    const laterWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 2,
        send: vi.fn(),
      },
    };

    syncReadyUpdateToWindow(laterWindow);

    expect(laterWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.UpdateReady,
      "0.1.25",
    );
  });

  it("Updater errors after download completion clear ready state", async () => {
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 5,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);

    const { initAutoUpdater, syncReadyUpdateToWindow } = await importAutoUpdaterWithLocale();

    initAutoUpdater();
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });

    expect(menuItem.label).toBe(
      formatDesktopMenuMessage(TEST_LOCALE, desktopMenuMessageIds.helpRestartToUpdate, {
        version: "0.1.25",
      }),
    );

    win.webContents.send.mockClear();
    autoUpdaterMock.emit(
      "error",
      new Error("Could not locate update bundle for com.github.Electron"),
    );
    await Promise.resolve();

    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
      kind: "idle",
      enabled: true,
    });
    expect(menuItem.label).toBe(
      formatDesktopMenuMessage(TEST_LOCALE, desktopMenuMessageIds.helpCheckForUpdates),
    );

    const laterWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 6,
        send: vi.fn(),
      },
    };

    syncReadyUpdateToWindow(laterWindow);

    expect(laterWindow.webContents.send).not.toHaveBeenCalledWith(
      PlatformChannels.UpdateReady,
      "0.1.25",
    );
  });

  it("Late Squirrel errors after dev cached package is ready do not dismiss pending-install state", async () => {
    mockProcessPlatform("darwin");
    appMock.isPackaged = false;
    process.env["CF_AUTO_UPDATE_DEV"] = "1";
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 7,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);

    const { initAutoUpdater, syncReadyUpdateToWindow } = await importAutoUpdaterWithLocale();

    initAutoUpdater();
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });

    expect(menuItem.label).toBe(
      formatDesktopMenuMessage(TEST_LOCALE, desktopMenuMessageIds.helpRestartToUpdate, {
        version: "0.1.25",
      }),
    );

    win.webContents.send.mockClear();
    autoUpdaterMock.emit("error", {
      code: 2,
      message: "Could not locate update bundle for com.github.Electron",
      domain: "SQRLUpdaterErrorDomain",
    });
    await Promise.resolve();

    expect(win.webContents.send).not.toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
      kind: "idle",
      enabled: true,
    });
    expect(menuItem.label).toBe(
      formatDesktopMenuMessage(TEST_LOCALE, desktopMenuMessageIds.helpRestartToUpdate, {
        version: "0.1.25",
      }),
    );
    expect(loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("[auto-update] ignore dev Squirrel ready error"),
    );

    const laterWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 8,
        send: vi.fn(),
      },
    };

    syncReadyUpdateToWindow(laterWindow);

    expect(laterWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.UpdateReady,
      "0.1.25",
    );
  });

  it("Do not mistakenly emit update-ready when no update is downloaded", async () => {
    const { syncReadyUpdateToWindow } = await import("../src/main/autoUpdater.js");

    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 3,
        send: vi.fn(),
      },
    };

    syncReadyUpdateToWindow(win);

    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it("Do not prematurely announce update-ready to renderer during download", async () => {
    const releaseNotes = {
      version: "0.1.25",
      releaseName: "Release v0.1.25",
      releaseNotes: "# Release v0.1.25\n\n- downloading notes",
      releaseDate: "2026-06-23T13:48:54.438Z",
    };
    const expectedReleaseNotes = {
      version: "0.1.25",
      title: "Release v0.1.25",
      markdown: "# Release v0.1.25\n\n- downloading notes",
      releaseDate: "2026-06-23T13:48:54.438Z",
    };
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 4,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);

    const { downloadAvailableUpdate, initAutoUpdater } = await importAutoUpdaterWithLocale();

    initAutoUpdater();

    autoUpdaterMock.emit("update-available", releaseNotes);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
    downloadAvailableUpdate("test");
    autoUpdaterMock.emit("download-progress", {
      percent: 42,
      bytesPerSecond: 1024,
      transferred: 1024,
      total: 2048,
    });

    expect(win.webContents.send).not.toHaveBeenCalledWith(
      PlatformChannels.UpdateReady,
      expect.anything(),
    );
    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
      kind: "update-available",
      enabled: true,
      version: "0.1.25",
      channel: "stable",
      releaseNotes: expectedReleaseNotes,
    });
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
      kind: "download-progress",
      enabled: false,
      progress: "42",
      version: "0.1.25",
      channel: "stable",
      releaseNotes: expectedReleaseNotes,
      transferredBytes: 1024,
      totalBytes: 2048,
    });
    expect(menuItem.label).toBe(getExpectedDownloadingProgressLabel(42));
    expect(menuItem.enabled).toBe(false);
  });

  it("Notify status listeners upon receiving actual download progress", async () => {
    const { downloadAvailableUpdate, initAutoUpdater, onAutoUpdaterStateChanged } =
      await importAutoUpdaterWithLocale();

    initAutoUpdater();
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const listener = vi.fn();
    const dispose = onAutoUpdaterStateChanged(listener);
    downloadAvailableUpdate("test");
    autoUpdaterMock.emit("download-progress", {
      percent: 7,
      bytesPerSecond: 1024,
      transferred: 1024,
      total: 2048,
    });
    dispose();

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "download-progress",
        enabled: false,
        progress: "7",
        version: "0.1.25",
      }),
    );
  });

  it("Directly enters downloaded state on cache hit without broadcasting 0% download state first", async () => {
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 42,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);
    const { downloadAvailableUpdate, getAutoUpdaterState, initAutoUpdater } =
      await importAutoUpdaterWithLocale();

    initAutoUpdater();
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    downloadAvailableUpdate("test");
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "0.1.25",
    });
    expect(win.webContents.send).not.toHaveBeenCalledWith(
      PlatformChannels.UpdateStateChanged,
      expect.objectContaining({
        kind: "download-progress",
        progress: "0",
      }),
    );

    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });

    await vi.waitFor(() =>
      expect(getAutoUpdaterState()).toMatchObject({ kind: "update-downloaded", version: "0.1.25" }),
    );
    expect(win.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.UpdateStateChanged,
      expect.objectContaining({
        kind: "update-downloaded",
        version: "0.1.25",
      }),
    );
  });

  it("Automatically starts downloading discovered updates when auto-download and install preference is enabled", async () => {
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      autoDownloadAndInstallUpdates: true,
    });
    const { getAutoUpdaterState, initAutoUpdater } = await importAutoUpdaterWithLocale();

    initAutoUpdater({ settingService: settingServiceMock });
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "0.1.25",
    });
  });

  it("Downloads start only upon renderer request after update is discovered", async () => {
    const { initAutoUpdater } = await importAutoUpdaterWithLocale();

    initAutoUpdater();
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();

    const downloadHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.DownloadUpdate,
    )?.[1] as (() => void) | undefined;

    expect(downloadHandler).toBeTypeOf("function");
    downloadHandler?.();

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
  });

  it("Canceling download aborts token and returns to current updatable version", async () => {
    const releaseNotes = {
      version: "0.1.25",
      releaseName: "Release v0.1.25",
      releaseNotes: "# Release v0.1.25\n\n- cancellable notes",
      releaseDate: "2026-06-23T13:48:54.438Z",
    };
    const expectedReleaseNotes = {
      version: "0.1.25",
      title: "Release v0.1.25",
      markdown: "# Release v0.1.25\n\n- cancellable notes",
      releaseDate: "2026-06-23T13:48:54.438Z",
    };
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 6,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);
    autoUpdaterMock.downloadUpdate.mockImplementationOnce(
      (token: EventEmitter) =>
        new Promise((_resolve, reject) => {
          token.once("cancel", () => reject(new Error("cancelled")));
        }),
    );
    const { getAutoUpdaterState, initAutoUpdater } = await importAutoUpdaterWithLocale();

    initAutoUpdater();
    autoUpdaterMock.emit("update-available", releaseNotes);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const downloadHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.DownloadUpdate,
    )?.[1] as (() => void) | undefined;
    const cancelHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.CancelUpdateDownload,
    )?.[1] as (() => void) | undefined;

    expect(downloadHandler).toBeTypeOf("function");
    expect(cancelHandler).toBeTypeOf("function");
    downloadHandler?.();

    const cancellationToken = autoUpdaterMock.downloadUpdate.mock.calls[0]?.[0] as
      | { cancelled?: boolean }
      | undefined;
    expect(cancellationToken?.cancelled).toBe(false);
    autoUpdaterMock.emit("download-progress", {
      percent: 1,
      bytesPerSecond: 1024,
      transferred: 1,
      total: 100,
    });
    expect(getAutoUpdaterState()).toEqual({
      kind: "download-progress",
      enabled: false,
      progress: "1",
      version: "0.1.25",
      channel: "stable",
      releaseNotes: expectedReleaseNotes,
      transferredBytes: 1,
      totalBytes: 100,
    });

    cancelHandler?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(cancellationToken?.cancelled).toBe(true);
    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(getAutoUpdaterState()).toEqual({
      kind: "update-available",
      enabled: true,
      version: "0.1.25",
      channel: "stable",
      releaseNotes: expectedReleaseNotes,
    });
    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
      kind: "update-available",
      enabled: true,
      version: "0.1.25",
      channel: "stable",
      releaseNotes: expectedReleaseNotes,
    });
    expect(menuItem.enabled).toBe(true);

    win.webContents.send.mockClear();
    autoUpdaterMock.emit("download-progress", {
      percent: 63,
      bytesPerSecond: 1024,
      transferred: 1024,
      total: 2048,
    });

    expect(getAutoUpdaterState()).toEqual({
      kind: "update-available",
      enabled: true,
      version: "0.1.25",
      channel: "stable",
      releaseNotes: expectedReleaseNotes,
    });
    expect(win.webContents.send).not.toHaveBeenCalledWith(
      PlatformChannels.UpdateStateChanged,
      expect.objectContaining({
        kind: "download-progress",
      }),
    );

    autoUpdaterMock.emit("error", new Error("cancelled"));

    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(getAutoUpdaterState()).toEqual({
      kind: "update-available",
      enabled: true,
      version: "0.1.25",
      channel: "stable",
      releaseNotes: expectedReleaseNotes,
    });
  });

  it("Retain current updatable version for user retry if download fails to start", async () => {
    const releaseNotes = {
      version: "0.1.25",
      releaseName: "Release v0.1.25",
      releaseNotes: "# Release v0.1.25\n\n- retryable notes",
      releaseDate: "2026-06-23T13:48:54.438Z",
    };
    const expectedReleaseNotes = {
      version: "0.1.25",
      title: "Release v0.1.25",
      markdown: "# Release v0.1.25\n\n- retryable notes",
      releaseDate: "2026-06-23T13:48:54.438Z",
    };
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 10,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);
    const { getAutoUpdaterState, initAutoUpdater } = await importAutoUpdaterWithLocale();

    initAutoUpdater();
    autoUpdaterMock.emit("update-available", releaseNotes);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const downloadHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.DownloadUpdate,
    )?.[1] as (() => void) | undefined;
    downloadHandler?.();
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "0.1.25",
    });

    autoUpdaterMock.emit("error", new Error("download failed before progress"));
    await Promise.resolve();

    expect(getAutoUpdaterState()).toEqual({
      kind: "update-available",
      enabled: true,
      version: "0.1.25",
      channel: "stable",
      releaseNotes: expectedReleaseNotes,
    });
    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
      kind: "update-available",
      enabled: true,
      version: "0.1.25",
      channel: "stable",
      releaseNotes: expectedReleaseNotes,
    });
    expect(menuItem.enabled).toBe(true);
    await Promise.resolve();
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("If download fails before check concludes, check again after conclusion", async () => {
    let releaseCheck: (() => void) | undefined;
    autoUpdaterMock.checkForUpdates.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCheck = () => resolve(undefined);
        }),
    );
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater();
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await Promise.resolve();

    const downloadHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.DownloadUpdate,
    )?.[1] as (() => void) | undefined;
    autoUpdaterMock.downloadUpdate.mockRejectedValueOnce(new Error("network down"));
    downloadHandler?.();
    await Promise.resolve();
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    releaseCheck?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("Skipping current version persists under stable channel and clears available state", async () => {
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 7,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);
    const { initAutoUpdater } = await importAutoUpdaterWithLocale();

    initAutoUpdater({ settingService: settingServiceMock });
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const skipHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.SkipUpdateVersion,
    )?.[1] as ((event: unknown, version: string) => Promise<void>) | undefined;

    expect(skipHandler).toBeTypeOf("function");
    await skipHandler?.({}, "0.1.25");

    expect(settingServiceMock.update).toHaveBeenCalledWith({
      skippedElectronUpdateVersions: {
        stable: "0.1.25",
      },
    });
    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
      kind: "idle",
      enabled: true,
    });
  });

  it("下载中跳过当前版本会取消下载并持久化 skipped 状态", async () => {
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 8,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);
    autoUpdaterMock.downloadUpdate.mockImplementationOnce(
      (token: EventEmitter) =>
        new Promise((_resolve, reject) => {
          token.once("cancel", () => reject(new Error("cancelled")));
        }),
    );
    const { getAutoUpdaterState, initAutoUpdater } = await importAutoUpdaterWithLocale();

    initAutoUpdater({ settingService: settingServiceMock });
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const downloadHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.DownloadUpdate,
    )?.[1] as (() => void) | undefined;
    const skipHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.SkipUpdateVersion,
    )?.[1] as ((event: unknown, version: string) => Promise<void>) | undefined;

    downloadHandler?.();
    const cancellationToken = autoUpdaterMock.downloadUpdate.mock.calls[0]?.[0] as
      | { cancelled?: boolean }
      | undefined;

    await skipHandler?.({}, "0.1.25");
    await Promise.resolve();
    await Promise.resolve();

    expect(cancellationToken?.cancelled).toBe(true);
    expect(loggerErrorMock).not.toHaveBeenCalled();
    expect(settingServiceMock.update).toHaveBeenCalledWith({
      skippedElectronUpdateVersions: {
        stable: "0.1.25",
      },
    });
    expect(getAutoUpdaterState()).toEqual({ kind: "idle", enabled: true });
    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
      kind: "idle",
      enabled: true,
    });
  });

  it("Manual update check clears current channel's skipped cache and redisplays the version", async () => {
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 9,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);
    let settingsState = {
      recentProjects: [],
      locale: "en-US" as const,
      skippedElectronUpdateVersions: {
        preview: "0.2.0",
      },
    };
    settingServiceMock.get.mockImplementation(async () => settingsState);
    settingServiceMock.update.mockImplementation(async (patch) => {
      settingsState = { ...settingsState, ...patch };
    });
    const { checkForUpdateMenuClick, getAutoUpdaterState, initAutoUpdater } =
      await importAutoUpdaterWithLocale();

    initAutoUpdater({ settingService: settingServiceMock });
    await Promise.resolve();
    await Promise.resolve();
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const skipHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.SkipUpdateVersion,
    )?.[1] as ((event: unknown, version: string) => Promise<void>) | undefined;

    await skipHandler?.({}, "0.1.25");
    expect(getAutoUpdaterState()).toEqual({ kind: "idle", enabled: true });
    expect(settingsState.skippedElectronUpdateVersions).toEqual({
      preview: "0.2.0",
      stable: "0.1.25",
    });
    win.webContents.send.mockClear();

    checkForUpdateMenuClick(win as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(settingsState.skippedElectronUpdateVersions).toEqual({
      preview: "0.2.0",
    });

    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getAutoUpdaterState()).toEqual({
      kind: "update-available",
      enabled: true,
      version: "0.1.25",
      channel: "stable",
    });
    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateCheckResult, {
      kind: "available",
      version: "0.1.25",
      channel: "stable",
    });
  });

  it("Persists release notes after download completes and syncs to only one window on startup", async () => {
    const firstWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 11,
        send: vi.fn(),
      },
    };
    const secondWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 12,
        send: vi.fn(),
      },
    };
    browserWindows.push(firstWindow, secondWindow);

    const { initAutoUpdater, syncPostUpdateReleaseNotesToWindow } =
      await import("../src/main/autoUpdater.js");

    initAutoUpdater({ settingService: settingServiceMock });

    autoUpdaterMock.emit("update-downloaded", {
      version: "0.1.25",
      releaseName: "Release v0.1.25",
      releaseNotes: "# Release v0.1.25\n\n- add popup",
      releaseDate: new Date("2026-06-23T13:48:54.438Z"),
      releaseNotesByLocale: {
        "zh-CN": {
          title: "CodeFusion v0.1.25",
          markdown: "# CodeFusion v0.1.25\n\n- ChineseDescription",
        },
        "en-US": {
          title: "CodeFusion v0.1.25",
          markdown: "# CodeFusion v0.1.25\n\n- English notes",
        },
      },
    });
    await Promise.resolve();

    expect(settingServiceMock.update).toHaveBeenCalledWith({
      pendingPostUpdateReleaseNotes: {
        version: "0.1.25",
        title: "Release v0.1.25",
        markdown: "# Release v0.1.25\n\n- add popup",
        releaseDate: "2026-06-23T13:48:54.438Z",
        releaseNotesByLocale: {
          "zh-CN": {
            title: "CodeFusion v0.1.25",
            markdown: "# CodeFusion v0.1.25\n\n- ChineseDescription",
          },
          "en-US": {
            title: "CodeFusion v0.1.25",
            markdown: "# CodeFusion v0.1.25\n\n- English notes",
          },
        },
      },
    });

    expect(firstWindow.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
      kind: "update-downloaded",
      enabled: true,
      version: "0.1.25",
      channel: "stable",
      releaseNotes: {
        version: "0.1.25",
        title: "Release v0.1.25",
        markdown: "# Release v0.1.25\n\n- add popup",
        releaseDate: "2026-06-23T13:48:54.438Z",
        releaseNotesByLocale: {
          "zh-CN": {
            title: "CodeFusion v0.1.25",
            markdown: "# CodeFusion v0.1.25\n\n- ChineseDescription",
          },
          "en-US": {
            title: "CodeFusion v0.1.25",
            markdown: "# CodeFusion v0.1.25\n\n- English notes",
          },
        },
      },
    });

    appMock.getVersion.mockImplementation(() => "0.1.25");
    syncPostUpdateReleaseNotesToWindow(firstWindow as never);
    syncPostUpdateReleaseNotesToWindow(secondWindow as never);

    expect(firstWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.PostUpdateReleaseNotes,
      {
        version: "0.1.25",
        title: "Release v0.1.25",
        markdown: "# Release v0.1.25\n\n- add popup",
        releaseDate: "2026-06-23T13:48:54.438Z",
        releaseNotesByLocale: {
          "zh-CN": {
            title: "CodeFusion v0.1.25",
            markdown: "# CodeFusion v0.1.25\n\n- ChineseDescription",
          },
          "en-US": {
            title: "CodeFusion v0.1.25",
            markdown: "# CodeFusion v0.1.25\n\n- English notes",
          },
        },
      },
    );
    expect(secondWindow.webContents.send).not.toHaveBeenCalledWith(
      PlatformChannels.PostUpdateReleaseNotes,
      expect.anything(),
    );
  });

  it("Do not write pending notes when releaseNotes is missing", async () => {
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({ settingService: settingServiceMock });

    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    await Promise.resolve();

    expect(settingServiceMock.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        pendingPostUpdateReleaseNotes: expect.anything(),
      }),
    );
  });

  it("Clear pending notes after renderer ack without resending", async () => {
    appMock.getVersion.mockImplementation(() => "0.1.25");
    const firstWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 21,
        send: vi.fn(),
      },
    };
    const laterWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 22,
        send: vi.fn(),
      },
    };
    browserWindows.push(firstWindow, laterWindow);
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      pendingPostUpdateReleaseNotes: {
        version: "0.1.25",
        title: "Release v0.1.25",
        markdown: "# Release v0.1.25\n\n- add popup",
      },
    });

    const {
      acknowledgePostUpdateReleaseNotes,
      hydratePendingPostUpdateReleaseNotes,
      syncPostUpdateReleaseNotesToWindow,
    } = await import("../src/main/autoUpdater.js");

    await hydratePendingPostUpdateReleaseNotes(settingServiceMock);
    syncPostUpdateReleaseNotesToWindow(firstWindow as never);

    expect(firstWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.PostUpdateReleaseNotes,
      {
        version: "0.1.25",
        title: "Release v0.1.25",
        markdown: "# Release v0.1.25\n\n- add popup",
      },
    );

    await acknowledgePostUpdateReleaseNotes("0.1.25", settingServiceMock);

    expect(settingServiceMock.update).toHaveBeenCalledWith({
      pendingPostUpdateReleaseNotes: undefined,
    });

    syncPostUpdateReleaseNotesToWindow(laterWindow as never);
    expect(laterWindow.webContents.send).not.toHaveBeenCalledWith(
      PlatformChannels.PostUpdateReleaseNotes,
      expect.anything(),
    );
  });

  it("Discard pending version during hydration if lower than installed app version, avoiding old release notes after manual multi-version upgrade", async () => {
    appMock.getVersion.mockImplementation(() => "0.1.26");
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      pendingPostUpdateReleaseNotes: {
        version: "0.1.25",
        title: "Release v0.1.25",
        markdown: "# Release v0.1.25\n\n- old",
      },
    });

    const { hydratePendingPostUpdateReleaseNotes, syncPostUpdateReleaseNotesToWindow } =
      await import("../src/main/autoUpdater.js");

    await hydratePendingPostUpdateReleaseNotes(settingServiceMock);

    expect(settingServiceMock.update).toHaveBeenCalledWith({
      pendingPostUpdateReleaseNotes: undefined,
    });

    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 99,
        send: vi.fn(),
      },
    };
    syncPostUpdateReleaseNotesToWindow(win as never);
    expect(win.webContents.send).not.toHaveBeenCalledWith(
      PlatformChannels.PostUpdateReleaseNotes,
      expect.anything(),
    );
  });

  it("Restore as pending update during hydration if pending version is higher than current app version", async () => {
    appMock.getVersion.mockImplementation(() => "0.1.24");
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      pendingPostUpdateReleaseNotes: {
        version: "0.1.25",
        title: "Release v0.1.25",
        markdown: "# Release v0.1.25\n\n- cached",
      },
    });

    const {
      getAutoUpdaterState,
      hydratePendingPostUpdateReleaseNotes,
      syncPostUpdateReleaseNotesToWindow,
      syncReadyUpdateToWindow,
    } = await importAutoUpdaterWithLocale();

    await hydratePendingPostUpdateReleaseNotes(settingServiceMock);

    expect(getAutoUpdaterState()).toEqual({
      kind: "update-downloaded",
      enabled: true,
      version: "0.1.25",
      releaseNotes: {
        version: "0.1.25",
        title: "Release v0.1.25",
        markdown: "# Release v0.1.25\n\n- cached",
      },
    });

    const readyWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 101,
        send: vi.fn(),
      },
    };
    syncReadyUpdateToWindow(readyWindow as never);
    expect(readyWindow.webContents.send).toHaveBeenCalledWith(
      PlatformChannels.UpdateReady,
      "0.1.25",
    );

    const notesWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 102,
        send: vi.fn(),
      },
    };
    syncPostUpdateReleaseNotesToWindow(notesWindow as never);
    expect(notesWindow.webContents.send).not.toHaveBeenCalledWith(
      PlatformChannels.PostUpdateReleaseNotes,
      expect.anything(),
    );
  });

  it("Run quit preparation hook before user confirms update installation", async () => {
    mockProcessPlatform("darwin");
    let resolveQuitPreparation: (() => void) | null = null;
    const onBeforeQuitAndInstall = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveQuitPreparation = resolve;
        }),
    );
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({ onBeforeQuitAndInstall });

    const quitHandler = ipcMainOn.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.QuitAndInstallUpdate,
    )?.[1] as (() => void) | undefined;

    expect(quitHandler).toBeTypeOf("function");

    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    await Promise.resolve();
    quitHandler?.();

    await vi.waitFor(() => expect(onBeforeQuitAndInstall).toHaveBeenCalledTimes(1));
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(0);

    resolveQuitPreparation?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("Do not launch installer if quit preparation fails before install; restart under control to recover service", async () => {
    mockProcessPlatform("win32");
    const prepareError = new Error("host process still locked resources");
    const onBeforeQuitAndInstall = vi.fn(async () => {
      throw prepareError;
    });
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({ onBeforeQuitAndInstall });

    const quitHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.QuitAndInstallUpdate,
    )?.[1] as (() => Promise<void>) | undefined;

    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    await Promise.resolve();
    expect(quitHandler).toBeTypeOf("function");
    await expect(quitHandler!()).rejects.toBe(prepareError);

    expect(onBeforeQuitAndInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
    expect(appMock.relaunch).toHaveBeenCalledOnce();
    expect(appMock.exit).toHaveBeenCalledWith(0);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      "[auto-update] prepare quit and install failed:",
      prepareError,
    );
  });

  it.each(["darwin", "linux"] as const)(
    "Allow native exit directly after %s install call returns; duplicate install commands do not re-enter",
    async (platform) => {
      mockProcessPlatform(platform);
      const onBeforeQuitAndInstall = vi.fn(async () => {});
      const { initAutoUpdater } = await importAutoUpdaterWithLocale();
      await initAutoUpdater({ onBeforeQuitAndInstall });
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
      const install = ipcMainHandle.mock.calls.find(
        ([channel]) => channel === PlatformChannels.QuitAndInstallUpdate,
      )![1] as () => Promise<void>;

      await install();
      const event = { preventDefault: vi.fn() };
      for (const listener of appListeners.get("before-quit") ?? []) {
        listener(event);
      }
      await install();

      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(onBeforeQuitAndInstall).toHaveBeenCalledOnce();
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce();
    },
  );

  it.each(["Synchronous error thrown", "异步错误事件"] as const)(
    "Controlled restart after installing %s; new process is ready again for retry",
    async (failureKind) => {
      mockProcessPlatform("darwin");
      const services = { hostAlive: true, remoteAlive: true };
      const onBeforeQuitAndInstall = vi.fn(() => {
        services.hostAlive = false;
        services.remoteAlive = false;
      });
      const module = await importAutoUpdaterWithLocale();
      await module.initAutoUpdater({ onBeforeQuitAndInstall });
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
      const install = ipcMainHandle.mock.calls.find(
        ([channel]) => channel === PlatformChannels.QuitAndInstallUpdate,
      )![1] as () => Promise<void>;
      const error = new Error("native installer failed");
      if (failureKind === "Synchronous error thrown") {
        autoUpdaterMock.quitAndInstall.mockImplementationOnce(() => {
          throw error;
        });
        await expect(install()).rejects.toBe(error);
      } else {
        await install();
        autoUpdaterMock.emit("error", error);
      }
      expect(services).toEqual({ hostAlive: false, remoteAlive: false });
      expect(appMock.relaunch).toHaveBeenCalledOnce();
      expect(appMock.exit).toHaveBeenCalledWith(0);
      autoUpdaterMock.emit("error", error);
      expect(appMock.relaunch).toHaveBeenCalledOnce();
      vi.resetModules();
      autoUpdaterMock.removeAllListeners();
      ipcMainHandle.mockClear();
      const restarted = await importAutoUpdaterWithLocale();
      await restarted.initAutoUpdater();
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
      await (
        ipcMainHandle.mock.calls.find(
          ([channel]) => channel === PlatformChannels.QuitAndInstallUpdate,
        )![1] as () => Promise<void>
      )();
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["darwin", "linux", "win32"] as const)(
    "Lock target after %s service cleanup; late new-version events and duplicate entries will not abort or re-enter installation",
    async (platform) => {
      mockProcessPlatform(platform);
      let finishPreparation!: () => void;
      const preparation = new Promise<void>((resolve) => {
        finishPreparation = resolve;
      });
      const services = { hostAlive: true, remoteAlive: true };
      const onBeforeQuitAndInstall = vi.fn(() => {
        services.hostAlive = false;
        services.remoteAlive = false;
        return preparation;
      });
      const module = await importAutoUpdaterWithLocale();
      await module.initAutoUpdater({ onBeforeQuitAndInstall });
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
      const install = ipcMainHandle.mock.calls.find(
        ([channel]) => channel === PlatformChannels.QuitAndInstallUpdate,
      )![1] as () => Promise<void>;
      const firstInstall = install();
      await vi.waitFor(() => expect(onBeforeQuitAndInstall).toHaveBeenCalledOnce());
      expect(services).toEqual({ hostAlive: false, remoteAlive: false });
      const checkCalls = autoUpdaterMock.checkForUpdates.mock.calls.length;
      autoUpdaterMock.emit("update-available", { version: "0.1.26" });
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.26" });
      module.downloadAvailableUpdate();
      module.refreshAutoUpdaterReleaseChannel(true);
      module.requestAutoUpdateCheckWithoutWindow();
      const event = { preventDefault: vi.fn() };
      for (const listener of appListeners.get("before-quit") ?? []) listener(event);
      await install();
      finishPreparation();
      await firstInstall;
      expect(module.getAutoUpdaterState()).toMatchObject({
        kind: "update-downloaded",
        version: "0.1.25",
      });
      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(checkCalls);
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce();
    },
  );

  it.each(["darwin", "linux", "win32"] as const)(
    "%s background check never completes nor blocks existing ready; late results do not replace install target",
    async (platform) => {
      mockProcessPlatform(platform);
      let finishCheck!: () => void;
      autoUpdaterMock.checkForUpdates.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishCheck = resolve;
        }),
      );
      const onBeforeQuitAndInstall = vi.fn();
      const module = await importAutoUpdaterWithLocale();
      await module.initAutoUpdater({ onBeforeQuitAndInstall });
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
      const install = ipcMainHandle.mock.calls.find(
        ([channel]) => channel === PlatformChannels.QuitAndInstallUpdate,
      )![1] as () => Promise<void>;
      let completed = false;
      const installation = install().then(() => {
        completed = true;
      });
      await vi.waitFor(() => expect(completed).toBe(true));
      expect(onBeforeQuitAndInstall).toHaveBeenCalledOnce();
      autoUpdaterMock.emit("update-available", { version: "0.1.26" });
      finishCheck();
      await installation;
      expect(module.getAutoUpdaterState()).toMatchObject({
        kind: "update-downloaded",
        version: "0.1.25",
      });
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce();
    },
  );

  it("Check result has entered async settings read; locked package cannot be overwritten even after install confirmation", async () => {
    let finishSettings!: (value: { recentProjects: never[]; locale: "en-US" }) => void;
    const settings = new Promise<{ recentProjects: never[]; locale: "en-US" }>((resolve) => {
      finishSettings = resolve;
    });
    const module = await importAutoUpdaterWithLocale();
    await module.initAutoUpdater({ settingService: settingServiceMock });
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    settingServiceMock.get.mockReturnValueOnce(settings);
    autoUpdaterMock.emit("update-available", { version: "0.1.26" });
    const install = ipcMainHandle.mock.calls.find(
      ([channel]) => channel === PlatformChannels.QuitAndInstallUpdate,
    )![1] as () => Promise<void>;
    await install();
    finishSettings({ recentProjects: [], locale: "en-US" });
    await Promise.resolve();
    await Promise.resolve();
    expect(module.getAutoUpdaterState()).toMatchObject({
      kind: "update-downloaded",
      version: "0.1.25",
    });
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("Do not prematurely publish installable state when download ready event arrives before download Promise resolves", async () => {
    let finishDownload!: () => void;
    autoUpdaterMock.downloadUpdate.mockReturnValueOnce(
      new Promise<string[]>((resolve) => {
        finishDownload = () => resolve([]);
      }),
    );
    const onBeforeQuitAndInstall = vi.fn();
    const module = await importAutoUpdaterWithLocale();
    await module.initAutoUpdater({ onBeforeQuitAndInstall });
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await vi.waitFor(() => expect(module.getAutoUpdaterState().kind).toBe("update-available"));
    module.downloadAvailableUpdate();
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    const install = ipcMainHandle.mock.calls.find(
      ([channel]) => channel === PlatformChannels.QuitAndInstallUpdate,
    )![1] as () => Promise<void>;
    await expect(install()).rejects.toThrow("Update is not ready to install");
    expect(onBeforeQuitAndInstall).not.toHaveBeenCalled();
    finishDownload();
    await vi.waitFor(() => expect(module.getAutoUpdaterState().kind).toBe("update-downloaded"));
    await install();
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce();
  });

  it.each(["失败", "取消"] as const)("Do not publish prematurely arrived ready after downloading %s", async (kind) => {
    let rejectDownload!: (error: Error) => void;
    autoUpdaterMock.downloadUpdate.mockReturnValueOnce(
      new Promise<string[]>((_resolve, reject) => {
        rejectDownload = reject;
      }),
    );
    const onBeforeQuitAndInstall = vi.fn();
    const module = await importAutoUpdaterWithLocale();
    await module.initAutoUpdater({ onBeforeQuitAndInstall });
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await vi.waitFor(() => expect(module.getAutoUpdaterState().kind).toBe("update-available"));
    module.downloadAvailableUpdate("test");
    autoUpdaterMock.emit("download-progress", {
      percent: 50,
      bytesPerSecond: 1,
      transferred: 1,
      total: 2,
    });
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    if (kind === "取消") module.cancelDownloadingUpdate("test");
    const error = new Error(kind === "取消" ? "cancelled" : "download failed after ready event");
    rejectDownload(error);
    await vi.waitFor(() => {
      if (kind === "取消")
        expect(loggerInfoMock).toHaveBeenCalledWith("[auto-update] test download cancelled");
      else
        expect(loggerErrorMock).toHaveBeenCalledWith(
          "[auto-update] download update failed:",
          error,
        );
    });
    await Promise.resolve();
    expect(module.getAutoUpdaterState().kind).not.toBe("update-downloaded");
    expect(onBeforeQuitAndInstall).not.toHaveBeenCalled();
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
  });

  it("Late errors from suspended checks do not trigger install recovery; real native errors still trigger controlled restart", async () => {
    let failCheck!: (error: Error) => void;
    autoUpdaterMock.checkForUpdates.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        failCheck = reject;
      }),
    );
    const module = await importAutoUpdaterWithLocale();
    await module.initAutoUpdater();
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    const install = ipcMainHandle.mock.calls.find(
      ([channel]) => channel === PlatformChannels.QuitAndInstallUpdate,
    )![1] as () => Promise<void>;
    await install();
    const checkError = new Error("background check failed");
    autoUpdaterMock.emit("error", checkError, "Cannot check for updates: background check failed");
    failCheck(checkError);
    await Promise.resolve();
    await Promise.resolve();
    expect(module.getAutoUpdaterState()).toMatchObject({
      kind: "update-downloaded",
      version: "0.1.25",
    });
    expect(appMock.relaunch).not.toHaveBeenCalled();
    autoUpdaterMock.emit("error", new Error("native staging failed"));
    expect(appMock.relaunch).toHaveBeenCalledOnce();
    expect(appMock.exit).toHaveBeenCalledWith(0);
  });

  it.each(["先可用后失败", "先失败后可用", "重复错误"] as const)(
    "Perform controlled restart once on native error of %s after handover, leaving no old window whose service was cleaned up",
    async (order) => {
      const services = { hostAlive: true, remoteAlive: true };
      const onBeforeQuitAndInstall = vi.fn(() => {
        services.hostAlive = false;
        services.remoteAlive = false;
      });
      const module = await importAutoUpdaterWithLocale();
      await module.initAutoUpdater({ onBeforeQuitAndInstall });
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
      const install = ipcMainHandle.mock.calls.find(
        ([channel]) => channel === PlatformChannels.QuitAndInstallUpdate,
      )![1] as () => Promise<void>;
      await install();
      const newer = () => {
        autoUpdaterMock.emit("update-available", { version: "0.1.26" });
        module.downloadAvailableUpdate();
      };
      const fail = () => autoUpdaterMock.emit("error", new Error("native installer failed"));
      if (order === "先可用后失败") {
        newer();
        fail();
      } else {
        fail();
        if (order === "重复错误") fail();
        else newer();
      }
      expect(services).toEqual({ hostAlive: false, remoteAlive: false });
      expect(appMock.relaunch).toHaveBeenCalledOnce();
      expect(appMock.exit).toHaveBeenCalledWith(0);
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.26" });
      await install();
      expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce();
      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
    },
  );

  it("Forced update cache sync ready still waits for download Promise completion before cleaning up services", async () => {
    let finishDownload!: () => void;
    const download = new Promise<string[]>((resolve) => {
      finishDownload = () => resolve([]);
    });
    autoUpdaterMock.downloadUpdate.mockImplementationOnce(() => {
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
      return download;
    });
    const onBeforeQuitAndInstall = vi.fn();
    const module = await importAutoUpdaterWithLocale();
    await module.initAutoUpdater({ onBeforeQuitAndInstall });
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await vi.waitFor(() => expect(module.getAutoUpdaterState().kind).toBe("update-available"));
    module.requestForceAutoUpdate(vi.fn());
    await Promise.resolve();
    expect(onBeforeQuitAndInstall).not.toHaveBeenCalled();
    finishDownload();
    await vi.waitFor(() => expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce());
    expect(onBeforeQuitAndInstall).toHaveBeenCalledOnce();
  });

  it("When native staging fails during preparation, restart and restore service after cleanup without leaving invalid windows", async () => {
    let finishPreparation!: () => void;
    const preparation = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    const onBeforeQuitAndInstall = vi.fn(() => preparation);
    const module = await importAutoUpdaterWithLocale();
    await module.initAutoUpdater({ onBeforeQuitAndInstall });
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    const install = ipcMainHandle.mock.calls.find(
      ([channel]) => channel === PlatformChannels.QuitAndInstallUpdate,
    )![1] as () => Promise<void>;
    const firstInstall = install();
    await vi.waitFor(() => expect(onBeforeQuitAndInstall).toHaveBeenCalledOnce());
    autoUpdaterMock.emit("error", new Error("native staging failed"));
    finishPreparation();
    await firstInstall;
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
    expect(appMock.relaunch).toHaveBeenCalledOnce();
    expect(appMock.exit).toHaveBeenCalledWith(0);
  });

  it("Install request does not execute exit preparation when no update has been downloaded", async () => {
    mockProcessPlatform("darwin");
    const onBeforeQuitAndInstall = vi.fn();
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({ onBeforeQuitAndInstall });

    const quitHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.QuitAndInstallUpdate,
    )?.[1] as (() => Promise<void>) | undefined;

    expect(quitHandler).toBeTypeOf("function");
    await expect(quitHandler!()).rejects.toThrow("Update is not ready to install: state=idle");

    expect(onBeforeQuitAndInstall).not.toHaveBeenCalled();
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
    expect(loggerWarnMock).toHaveBeenCalledWith(
      "[auto-update] ignore quitAndInstall request: state=idle",
    );
  });

  it("Windows update installation restores electron-updater native entry point without launching PowerShell launcher", async () => {
    mockProcessPlatform("win32");
    const onBeforeQuitAndInstall = vi.fn();
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({ onBeforeQuitAndInstall });

    const quitHandler = ipcMainOn.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.QuitAndInstallUpdate,
    )?.[1] as (() => void) | undefined;

    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    await Promise.resolve();
    quitHandler?.();
    await Promise.resolve();
    await Promise.resolve();

    await vi.waitFor(() => expect(onBeforeQuitAndInstall).toHaveBeenCalledTimes(1));
    expect(spawnMock).not.toHaveBeenCalled();
    expect(appMock.exit).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1));
  });

  it("Clicking menu after update is downloaded will directly restart and install", async () => {
    mockProcessPlatform("darwin");
    const onBeforeQuitAndInstall = vi.fn();
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 21,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);

    const { initAutoUpdater, checkForUpdateMenuClick } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({ onBeforeQuitAndInstall });
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    win.webContents.send.mockClear();

    checkForUpdateMenuClick(win as never);
    await Promise.resolve();
    await Promise.resolve();

    await vi.waitFor(() => expect(onBeforeQuitAndInstall).toHaveBeenCalledTimes(1));
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(win.webContents.send).not.toHaveBeenCalledWith(PlatformChannels.UpdateCheckResult, {
      kind: "ready",
      version: "0.1.25",
    });
  });
  it("Windows initialization disables auto-install on quit to prevent immediate shutdown after closing app from interrupting updates", async () => {
    mockProcessPlatform("win32");
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater();

    expect(autoUpdaterMock.autoDownload).toBe(false);
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false);
  });

  it("Non-Windows initialization keeps auto-install on quit to avoid affecting existing upgrade behavior", async () => {
    mockProcessPlatform("darwin");
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater();

    expect(autoUpdaterMock.autoDownload).toBe(false);
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false);
  });

  it("Windows startup does not block main UI and checks for updates in background", async () => {
    mockProcessPlatform("win32");
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    await expect(initAutoUpdater()).resolves.toBeUndefined();

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
  });

  it("Registers 15-minute polling after startup and checks for updates again when idle", async () => {
    vi.useFakeTimers();
    try {
      const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

      initAutoUpdater();
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES_MS);

      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("After update is discovered, 2-minute polling replaces it with higher version without entry point entering checking", async () => {
    vi.useFakeTimers();
    try {
      const { getAutoUpdaterState, initAutoUpdater } = await importAutoUpdaterWithLocale();

      initAutoUpdater();
      autoUpdaterMock.emit("update-available", { version: "0.1.25" });
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(TWO_MINUTES_MS);
      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
      autoUpdaterMock.emit("update-available", { version: "0.1.27" });
      await Promise.resolve();

      expect(getAutoUpdaterState()).toMatchObject({
        kind: "update-available",
        version: "0.1.27",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("Manual check after update is discovered re-requests and replaces version", async () => {
    const win = {
      isDestroyed: () => false,
      webContents: { id: 51, send: vi.fn() },
    };
    browserWindows.push(win);
    const { checkForUpdateMenuClick, getAutoUpdaterState, initAutoUpdater } =
      await import("../src/main/autoUpdater.js");

    initAutoUpdater();
    await Promise.resolve();
    await Promise.resolve();
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await Promise.resolve();

    checkForUpdateMenuClick(win as never);
    await Promise.resolve();
    autoUpdaterMock.emit("update-available", { version: "0.1.27" });
    await Promise.resolve();

    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "0.1.27",
    });
  });

  it("Recheck immediately after auto-download completes; higher versions will replace and re-download", async () => {
    settingServiceMock.get.mockResolvedValue({
      recentProjects: [],
      locale: "en-US",
      autoDownloadAndInstallUpdates: true,
    });
    const { getAutoUpdaterState, initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({ settingService: settingServiceMock });
    await new Promise((resolve) => setTimeout(resolve, 0));
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);

    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);

    autoUpdaterMock.emit("update-available", { version: "0.1.27" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(2);
    expect(getAutoUpdaterState()).toMatchObject({
      kind: "update-available",
      version: "0.1.27",
    });
  });

  it("Exit without installing on macOS when old ready package no longer matches target", async () => {
    mockProcessPlatform("darwin");
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater();
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    autoUpdaterMock.emit("update-available", { version: "0.1.27" });
    await Promise.resolve();

    const event = { preventDefault: vi.fn() };
    for (const listener of appListeners.get("before-quit") ?? []) {
      listener(event);
    }

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
  });

  it("Polling during download does not concurrently trigger new checks", async () => {
    vi.useFakeTimers();
    try {
      const { downloadAvailableUpdate, initAutoUpdater } = await importAutoUpdaterWithLocale();

      initAutoUpdater();
      await Promise.resolve();
      await Promise.resolve();
      autoUpdaterMock.emit("update-available", { version: "0.1.25" });
      await Promise.resolve();
      downloadAvailableUpdate("test");
      autoUpdaterMock.emit("download-progress", {
        percent: 10,
        bytesPerSecond: 1024,
        transferred: 1024,
        total: 10240,
      });

      await vi.advanceTimersByTimeAsync(FIFTEEN_MINUTES_MS);

      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("When polling finds higher version after update is downloaded, prompt first and replace ready version upon user confirmation", async () => {
    vi.useFakeTimers();
    try {
      const win = {
        isDestroyed: () => false,
        webContents: {
          id: 41,
          send: vi.fn(),
        },
      };
      browserWindows.push(win);
      const { downloadAvailableUpdate, initAutoUpdater } = await importAutoUpdaterWithLocale();

      initAutoUpdater();
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
      autoUpdaterMock.downloadUpdate.mockClear();
      win.webContents.send.mockClear();

      await vi.advanceTimersByTimeAsync(TWO_MINUTES_MS);

      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);

      autoUpdaterMock.emit("update-available", { version: "0.1.26" });
      await Promise.resolve();
      await Promise.resolve();

      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
      expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
        kind: "update-available",
        enabled: true,
        version: "0.1.26",
        channel: "stable",
      });

      downloadAvailableUpdate("test");
      expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1);
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.26" });

      await vi.waitFor(() =>
        expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateReady, "0.1.26"),
      );
      expect(menuItem.label).toBe(
        formatDesktopMenuMessage(TEST_LOCALE, desktopMenuMessageIds.helpRestartToUpdate, {
          version: "0.1.26",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("When polling finds same version after update is downloaded, it will not re-download", async () => {
    vi.useFakeTimers();
    try {
      const { initAutoUpdater } = await importAutoUpdaterWithLocale();

      initAutoUpdater();
      autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
      autoUpdaterMock.downloadUpdate.mockClear();

      await vi.advanceTimersByTimeAsync(TWO_MINUTES_MS);
      autoUpdaterMock.emit("update-available", { version: "0.1.25" });

      expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(2);
      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled();
      expect(menuItem.label).toBe(
        formatDesktopMenuMessage(TEST_LOCALE, desktopMenuMessageIds.helpRestartToUpdate, {
          version: "0.1.25",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("Repeated manual checks do not lose result of first check", async () => {
    const firstWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 31,
        send: vi.fn(),
      },
    };
    const secondWindow = {
      isDestroyed: () => false,
      webContents: {
        id: 32,
        send: vi.fn(),
      },
    };

    const { initAutoUpdater, checkForUpdateMenuClick } = await import("../src/main/autoUpdater.js");

    browserWindows.push(firstWindow, secondWindow);

    initAutoUpdater();
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();

    checkForUpdateMenuClick(firstWindow as never);
    checkForUpdateMenuClick(secondWindow as never);

    expect(secondWindow.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateCheckResult, {
      kind: "error",
      message: "Update check already in progress.",
    });

    autoUpdaterMock.emit("update-not-available", { version: "0.1.24" });

    expect(firstWindow.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateCheckResult, {
      kind: "up-to-date",
      currentVersion: "0.1.24",
    });
  });

  it("Force-upgrade auto-update directly installs downloaded version without secondary interception by minimum version", async () => {
    mockProcessPlatform("darwin");
    const { initAutoUpdater, requestForceAutoUpdate } = await import("../src/main/autoUpdater.js");
    const onStateChange = vi.fn();

    initAutoUpdater();
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    await Promise.resolve();
    await Promise.resolve();
    autoUpdaterMock.checkForUpdates.mockClear();
    autoUpdaterMock.quitAndInstall.mockClear();

    requestForceAutoUpdate(onStateChange, "force-update", "0.1.26");
    await Promise.resolve();

    expect(onStateChange).toHaveBeenCalledWith({ kind: "checking" });
    expect(onStateChange).toHaveBeenCalledWith({ kind: "installing" });
    await vi.waitFor(() => expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce());
    expect(autoUpdaterMock.checkForUpdates).not.toHaveBeenCalled();
  });

  it("Auto-update install request in dev mode restarts current dev app", async () => {
    mockProcessPlatform("darwin");
    appMock.isPackaged = false;
    process.env["CF_AUTO_UPDATE_DEV"] = "1";
    const onBeforeQuitAndInstall = vi.fn();
    const { initAutoUpdater } = await import("../src/main/autoUpdater.js");

    initAutoUpdater({ onBeforeQuitAndInstall });
    autoUpdaterMock.emit("update-downloaded", { version: "0.1.25" });
    await Promise.resolve();
    await Promise.resolve();
    autoUpdaterMock.quitAndInstall.mockClear();
    appMock.relaunch.mockClear();
    appMock.exit.mockClear();

    const quitAndInstallHandler = ipcMainHandle.mock.calls.find(
      ([channel]: [string, unknown]) => channel === PlatformChannels.QuitAndInstallUpdate,
    )?.[1] as (() => Promise<void>) | undefined;
    await quitAndInstallHandler?.();

    expect(onBeforeQuitAndInstall).toHaveBeenCalledTimes(1);
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
    expect(appMock.relaunch).toHaveBeenCalledTimes(1);
    expect(appMock.exit).toHaveBeenCalledWith(0);
    expect(loggerInfoMock).toHaveBeenCalledWith(
      "[auto-update] dev update install fallback: relaunch app",
    );
  });

  it("Restores menu and shows popup error when force-upgrade download fails", async () => {
    const downloadError = new Error("network down");
    autoUpdaterMock.downloadUpdate.mockRejectedValueOnce(downloadError);
    const win = {
      isDestroyed: () => false,
      webContents: {
        id: 41,
        send: vi.fn(),
      },
    };
    browserWindows.push(win);
    const { initAutoUpdater, requestForceAutoUpdate } = await import("../src/main/autoUpdater.js");
    const onStateChange = vi.fn();

    initAutoUpdater();
    requestForceAutoUpdate(onStateChange);
    autoUpdaterMock.emit("update-available", { version: "0.1.25" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onStateChange).toHaveBeenCalledWith({ kind: "checking" });
    expect(onStateChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "downloading",
        version: "0.1.25",
      }),
    );
    expect(onStateChange).toHaveBeenCalledWith({
      kind: "error",
      message: "network down",
    });
    expect(win.webContents.send).toHaveBeenCalledWith(PlatformChannels.UpdateStateChanged, {
      kind: "idle",
      enabled: true,
    });
  });

  it("Returns error state when no update is available during reused check in force-upgrade auto-update", async () => {
    const { initAutoUpdater, requestForceAutoUpdate } = await import("../src/main/autoUpdater.js");
    const onStateChange = vi.fn();

    initAutoUpdater();
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    requestForceAutoUpdate(onStateChange);

    expect(onStateChange).toHaveBeenCalledWith({ kind: "checking" });
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalledTimes(1);

    autoUpdaterMock.emit("update-not-available", { version: "0.1.24" });

    expect(onStateChange).toHaveBeenCalledWith({
      kind: "error",
      message: "未找到可安装更新，请使用手动升级。",
    });
  });

  it("Returns popup error state when reused check fails in force-upgrade auto-update", async () => {
    const checkError = new Error("feed offline");
    autoUpdaterMock.checkForUpdates.mockRejectedValueOnce(checkError);
    const { getAutoUpdaterState, initAutoUpdater, requestForceAutoUpdate } =
      await import("../src/main/autoUpdater.js");
    const onStateChange = vi.fn();

    initAutoUpdater();
    requestForceAutoUpdate(onStateChange);
    await Promise.resolve();
    await Promise.resolve();

    expect(onStateChange).toHaveBeenCalledWith({ kind: "checking" });
    expect(onStateChange).toHaveBeenCalledWith({
      kind: "error",
      message: "feed offline",
    });
    expect(getAutoUpdaterState()).toEqual({ kind: "idle", enabled: true });
  });

  it("Returns error message in English locale when no update is available during force-upgrade auto-update", async () => {
    const { initAutoUpdater, requestForceAutoUpdate } = await importAutoUpdaterWithLocale();
    const onStateChange = vi.fn();

    initAutoUpdater();
    requestForceAutoUpdate(onStateChange);
    autoUpdaterMock.emit("update-not-available", { version: "0.1.24" });

    expect(onStateChange).toHaveBeenCalledWith({
      kind: "error",
      message: "No installable update was found. Use manual update instead.",
    });
  });
});
