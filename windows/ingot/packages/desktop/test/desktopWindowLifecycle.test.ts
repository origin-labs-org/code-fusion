import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/main/databaseStartupRelay.js", () => ({
  getDatabaseStartupPortPayload: () => ({ databaseStartupId: "window-host-test" }),
}));

vi.mock("electron", () => ({
  app: {
    setBadgeCount: vi.fn(),
    dock: undefined,
  },
  BrowserWindow: {
    fromId: vi.fn(),
  },
  Menu: {
    buildFromTemplate: vi.fn(() => ({ setMenu: vi.fn() })),
  },
  MessageChannelMain: class MessageChannelMain {
    readonly port1 = { id: "port-1" };
    readonly port2 = { id: "port-2" };
  },
}));

vi.mock("../src/main/desktopWindowChrome.js", () => ({
  createBrowserWindow: vi.fn(),
}));

vi.mock("../src/main/armsBrowserPerfLoadNudge.js", () => ({
  scheduleArmsBrowserPerfLoadNudge: vi.fn(),
}));

import { handleDarwinWindowCloseRequest } from "../src/main/desktopDarwinCloseBehavior.js";
import { createBrowserWindow } from "../src/main/desktopWindowChrome.js";
import {
  createWindow,
  handleDesktopWindowCloseRequest,
} from "../src/main/desktopWindowLifecycle.js";

describe("desktopWindowLifecycle createWindow", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Local Host always carries conversation backing cwd as a fallback for historical workspace spawning", () => {
    let handleDomReady: (() => void) | undefined;
    const webContents = {
      id: 42,
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "dom-ready") handleDomReady = listener;
      }),
    };
    const win = {
      id: 7,
      webContents,
      on: vi.fn(),
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
    };
    vi.mocked(createBrowserWindow).mockReturnValue(win as never);
    const child = { pid: 1234 };
    const spawnHostProcess = vi.fn(() => child as never);
    const fallbackCwd = "/Users/demo/.cf/workspace/default";

    createWindow({
      iconPath: "/tmp/icon.png",
      preloadPath: "/tmp/preload.js",
      logger: { info: vi.fn(), warn: vi.fn() },
      forceQuitRef: { current: false },
      windowHostProcessMap: new Map(),
      spawnHostProcess,
      disposeHostProcess: vi.fn(),
      syncAutoUpdaterStateToWindow: vi.fn(),
      syncReadyUpdateToWindow: vi.fn(),
      syncPostUpdateReleaseNotesToWindow: vi.fn(),
      webRemoteControlManager: { disposeWindow: vi.fn(async () => undefined) },
      disposeRemoteWorkspaceSessionsForWindow: vi.fn(),
      reattachRemoteWorkspaceSessionsForWindow: vi.fn(),
      agentWarmupTargets: [
        { workspacePath: "/Users/demo/active-project" },
        { workspacePath: "/Users/demo/recent-a" },
        { workspacePath: "/Users/demo/recent-b" },
      ],
      agentSpawnFallbackCwd: fallbackCwd,
      deviceMid: "device-mid",
      runtimeProcessEnvFallbackPatch: {},
    });

    expect(handleDomReady).toBeTypeOf("function");
    handleDomReady?.();
    expect(spawnHostProcess).toHaveBeenCalledWith(
      win,
      "local-42",
      expect.objectContaining({
        type: "init-local",
        workspacePath: "/Users/demo/active-project",
        agentWarmupTargets: [
          { workspacePath: "/Users/demo/active-project" },
          { workspacePath: "/Users/demo/recent-a" },
          { workspacePath: "/Users/demo/recent-b" },
        ],
        agentSpawnFallbackCwd: fallbackCwd,
        runtimeProcessEnvPatch: {},
      }),
    );
  });

  it("InitLocal carries the real-time UI language of Main at the moment of spawn", () => {
    let handleDomReady: (() => void) | undefined;
    const webContents = {
      id: 43,
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "dom-ready") handleDomReady = listener;
      }),
    };
    const win = {
      id: 8,
      webContents,
      on: vi.fn(),
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
    };
    vi.mocked(createBrowserWindow).mockReturnValue(win as never);
    const spawnHostProcess = vi.fn(() => ({ pid: 1238 }) as never);
    let locale: "zh-CN" | "en-US" = "en-US";

    createWindow({
      iconPath: "/tmp/icon.png",
      preloadPath: "/tmp/preload.js",
      logger: { info: vi.fn(), warn: vi.fn() },
      forceQuitRef: { current: false },
      windowHostProcessMap: new Map(),
      spawnHostProcess,
      disposeHostProcess: vi.fn(),
      syncAutoUpdaterStateToWindow: vi.fn(),
      syncReadyUpdateToWindow: vi.fn(),
      syncPostUpdateReleaseNotesToWindow: vi.fn(),
      webRemoteControlManager: { disposeWindow: vi.fn(async () => undefined) },
      disposeRemoteWorkspaceSessionsForWindow: vi.fn(),
      reattachRemoteWorkspaceSessionsForWindow: vi.fn(),
      agentSpawnFallbackCwd: "/Users/dev/.cf/workspace/default",
      deviceMid: "device-mid",
      runtimeProcessEnvFallbackPatch: {},
      currentApplicationLocale: () => locale,
    });

    locale = "zh-CN";
    handleDomReady?.();
    expect(spawnHostProcess).toHaveBeenCalledWith(
      win,
      "local-43",
      expect.objectContaining({ type: "init-local", locale: "zh-CN" }),
    );
  });

  it("Wait for pre-collected runtime env to finish before creating Local Host", async () => {
    let handleDomReady: (() => void) | undefined;
    let resolveRuntimeEnv: ((patch: Record<string, string>) => void) | undefined;
    const runtimeProcessEnvPatchPromise = new Promise<Record<string, string>>((resolve) => {
      resolveRuntimeEnv = resolve;
    });
    const webContents = {
      id: 43,
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "dom-ready") handleDomReady = listener;
      }),
    };
    const win = {
      id: 8,
      webContents,
      on: vi.fn(),
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
    };
    vi.mocked(createBrowserWindow).mockReturnValue(win as never);
    const spawnHostProcess = vi.fn(() => ({ pid: 1235 }) as never);

    createWindow({
      iconPath: "/tmp/icon.png",
      preloadPath: "/tmp/preload.js",
      logger: { info: vi.fn(), warn: vi.fn() },
      forceQuitRef: { current: false },
      windowHostProcessMap: new Map(),
      spawnHostProcess,
      disposeHostProcess: vi.fn(),
      syncAutoUpdaterStateToWindow: vi.fn(),
      syncReadyUpdateToWindow: vi.fn(),
      syncPostUpdateReleaseNotesToWindow: vi.fn(),
      webRemoteControlManager: { disposeWindow: vi.fn(async () => undefined) },
      disposeRemoteWorkspaceSessionsForWindow: vi.fn(),
      reattachRemoteWorkspaceSessionsForWindow: vi.fn(),
      agentSpawnFallbackCwd: "/Users/demo/.cf/workspace/default",
      deviceMid: "device-mid",
      runtimeProcessEnvPatchPromise,
      runtimeProcessEnvFallbackPatch: {},
    });

    handleDomReady?.();
    expect(spawnHostProcess).not.toHaveBeenCalled();

    resolveRuntimeEnv?.({ PATH: "/Users/demo/.local/bin:/usr/bin:/bin" });
    await runtimeProcessEnvPatchPromise;
    await Promise.resolve();

    expect(spawnHostProcess).toHaveBeenCalledWith(
      win,
      "local-43",
      expect.objectContaining({
        type: "init-local",
        runtimeProcessEnvPatch: {
          PATH: "/Users/demo/.local/bin:/usr/bin:/bin",
        },
      }),
    );
  });

  it("Do not wait for runtime env prewarm when reusing an existing Host for renderer reload", () => {
    let handleDomReady: (() => void) | undefined;
    const webContents = {
      id: 44,
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "dom-ready") handleDomReady = listener;
      }),
      postMessage: vi.fn(),
    };
    const win = {
      id: 9,
      webContents,
      on: vi.fn(),
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
    };
    vi.mocked(createBrowserWindow).mockReturnValue(win as never);
    const existingChild = { pid: 1236, postMessage: vi.fn() };
    const spawnHostProcess = vi.fn();
    const syncAutoUpdaterStateToWindow = vi.fn();
    const reattachRemoteWorkspaceSessionsForWindow = vi.fn();

    createWindow({
      iconPath: "/tmp/icon.png",
      preloadPath: "/tmp/preload.js",
      logger: { info: vi.fn(), warn: vi.fn() },
      forceQuitRef: { current: false },
      windowHostProcessMap: new Map([[44, existingChild as never]]),
      spawnHostProcess,
      disposeHostProcess: vi.fn(),
      syncAutoUpdaterStateToWindow,
      syncReadyUpdateToWindow: vi.fn(),
      syncPostUpdateReleaseNotesToWindow: vi.fn(),
      webRemoteControlManager: { disposeWindow: vi.fn(async () => undefined) },
      disposeRemoteWorkspaceSessionsForWindow: vi.fn(),
      reattachRemoteWorkspaceSessionsForWindow,
      agentSpawnFallbackCwd: "/Users/demo/.cf/workspace/default",
      deviceMid: "device-mid",
      runtimeProcessEnvPatchPromise: new Promise(() => {}),
      runtimeProcessEnvFallbackPatch: {},
    });

    handleDomReady?.();

    expect(existingChild.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "attach-service-port" }),
      [expect.objectContaining({ id: "port-2" })],
    );
    expect(webContents.postMessage).toHaveBeenCalledWith(
      "cf:service-port",
      { databaseStartupId: "window-host-test" },
      [expect.objectContaining({ id: "port-1" })],
    );
    expect(spawnHostProcess).not.toHaveBeenCalled();
    expect(syncAutoUpdaterStateToWindow).toHaveBeenCalledWith(win);
    expect(reattachRemoteWorkspaceSessionsForWindow).toHaveBeenCalledWith(
      win,
      "local-44:renderer-reload",
    );
  });

  it("Use fallback based on deadline if runtime env never completes; do not recreate Host for late results", async () => {
    vi.useFakeTimers();
    let handleDomReady: (() => void) | undefined;
    let resolveRuntimeEnv: ((patch: Record<string, string>) => void) | undefined;
    const runtimeProcessEnvPatchPromise = new Promise<Record<string, string>>((resolve) => {
      resolveRuntimeEnv = resolve;
    });
    const webContents = {
      id: 45,
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "dom-ready") handleDomReady = listener;
      }),
    };
    const win = {
      id: 10,
      webContents,
      on: vi.fn(),
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
    };
    vi.mocked(createBrowserWindow).mockReturnValue(win as never);
    const spawnHostProcess = vi.fn(() => ({ pid: 1237 }) as never);
    const fallbackPatch = { PATH: "/usr/local/bin:/usr/bin:/bin" };

    createWindow({
      iconPath: "/tmp/icon.png",
      preloadPath: "/tmp/preload.js",
      logger: { info: vi.fn(), warn: vi.fn() },
      forceQuitRef: { current: false },
      windowHostProcessMap: new Map(),
      spawnHostProcess,
      disposeHostProcess: vi.fn(),
      syncAutoUpdaterStateToWindow: vi.fn(),
      syncReadyUpdateToWindow: vi.fn(),
      syncPostUpdateReleaseNotesToWindow: vi.fn(),
      webRemoteControlManager: { disposeWindow: vi.fn(async () => undefined) },
      disposeRemoteWorkspaceSessionsForWindow: vi.fn(),
      reattachRemoteWorkspaceSessionsForWindow: vi.fn(),
      agentSpawnFallbackCwd: "/Users/demo/.cf/workspace/default",
      deviceMid: "device-mid",
      runtimeProcessEnvPatchPromise,
      runtimeProcessEnvFallbackPatch: fallbackPatch,
      runtimeProcessEnvWaitTimeoutMs: 50,
    });

    handleDomReady?.();
    await vi.advanceTimersByTimeAsync(49);
    expect(spawnHostProcess).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(spawnHostProcess).toHaveBeenCalledTimes(1);
    expect(spawnHostProcess).toHaveBeenCalledWith(
      win,
      "local-45",
      expect.objectContaining({ runtimeProcessEnvPatch: fallbackPatch }),
    );

    resolveRuntimeEnv?.({ PATH: "/Users/demo/.local/bin:/usr/bin:/bin" });
    await Promise.resolve();
    expect(spawnHostProcess).toHaveBeenCalledTimes(1);
  });

  it("Pass full fallback when runtime env prewarm rejects; do not trigger synchronous Host collection", async () => {
    let handleDomReady: (() => void) | undefined;
    const webContents = {
      id: 46,
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "dom-ready") handleDomReady = listener;
      }),
    };
    const win = {
      id: 11,
      webContents,
      on: vi.fn(),
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
    };
    vi.mocked(createBrowserWindow).mockReturnValue(win as never);
    const spawnHostProcess = vi.fn(() => ({ pid: 1238 }) as never);
    const fallbackPatch = { PATH: "/usr/local/bin:/usr/bin:/bin" };

    createWindow({
      iconPath: "/tmp/icon.png",
      preloadPath: "/tmp/preload.js",
      logger: { info: vi.fn(), warn: vi.fn() },
      forceQuitRef: { current: false },
      windowHostProcessMap: new Map(),
      spawnHostProcess,
      disposeHostProcess: vi.fn(),
      syncAutoUpdaterStateToWindow: vi.fn(),
      syncReadyUpdateToWindow: vi.fn(),
      syncPostUpdateReleaseNotesToWindow: vi.fn(),
      webRemoteControlManager: { disposeWindow: vi.fn(async () => undefined) },
      disposeRemoteWorkspaceSessionsForWindow: vi.fn(),
      reattachRemoteWorkspaceSessionsForWindow: vi.fn(),
      agentSpawnFallbackCwd: "/Users/demo/.cf/workspace/default",
      deviceMid: "device-mid",
      runtimeProcessEnvPatchPromise: Promise.reject(new Error("profile failed")),
      runtimeProcessEnvFallbackPatch: fallbackPatch,
      runtimeProcessEnvWaitTimeoutMs: 50,
    });

    handleDomReady?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(spawnHostProcess).toHaveBeenCalledWith(
      win,
      "local-46",
      expect.objectContaining({ runtimeProcessEnvPatch: fallbackPatch }),
    );
  });

  it("Wait for the canary gate before creating the first Local Host; only spawn after resolution", async () => {
    let handleDomReady: (() => void) | undefined;
    let resolveGate!: () => void;
    const gatePromise = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const awaitFirstHostSpawnDecision = vi.fn(() => gatePromise);
    const webContents = {
      id: 47,
      on: vi.fn((event: string, listener: () => void) => {
        if (event === "dom-ready") handleDomReady = listener;
      }),
    };
    const win = {
      id: 12,
      webContents,
      on: vi.fn(),
      isDestroyed: vi.fn(() => false),
      show: vi.fn(),
      focus: vi.fn(),
    };
    vi.mocked(createBrowserWindow).mockReturnValue(win as never);
    const spawnHostProcess = vi.fn(() => ({ pid: 1239 }) as never);

    createWindow({
      iconPath: "/tmp/icon.png",
      preloadPath: "/tmp/preload.js",
      logger: { info: vi.fn(), warn: vi.fn() },
      forceQuitRef: { current: false },
      windowHostProcessMap: new Map(),
      spawnHostProcess,
      disposeHostProcess: vi.fn(),
      syncAutoUpdaterStateToWindow: vi.fn(),
      syncReadyUpdateToWindow: vi.fn(),
      syncPostUpdateReleaseNotesToWindow: vi.fn(),
      webRemoteControlManager: { disposeWindow: vi.fn(async () => undefined) },
      disposeRemoteWorkspaceSessionsForWindow: vi.fn(),
      reattachRemoteWorkspaceSessionsForWindow: vi.fn(),
      agentSpawnFallbackCwd: "/Users/demo/.cf/workspace/default",
      deviceMid: "device-mid",
      runtimeProcessEnvFallbackPatch: {},
      awaitFirstHostSpawnDecision,
    });

    handleDomReady?.();
    expect(awaitFirstHostSpawnDecision).toHaveBeenCalledOnce();
    expect(spawnHostProcess).not.toHaveBeenCalled();

    resolveGate();
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(spawnHostProcess).toHaveBeenCalledWith(
      win,
      "local-47",
      expect.objectContaining({ type: "init-local" }),
    );
  });
});

describe("desktopWindowLifecycle handleDarwinWindowCloseRequest", () => {
  it("Closing while in full-screen should only exit full-screen mode", () => {
    const logger = {
      info: vi.fn(),
    };
    const win = {
      isFullScreen: vi.fn(() => true),
      setFullScreen: vi.fn(),
      hide: vi.fn(),
    };

    const prevented = handleDarwinWindowCloseRequest({
      win,
      forceQuit: false,
      label: "local-1",
      logger,
    });

    expect(prevented).toBe(true);
    expect(win.setFullScreen).toHaveBeenCalledTimes(1);
    expect(win.setFullScreen).toHaveBeenCalledWith(false);
    expect(win.hide).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "[createWindow] fullscreen close converted to leave-full-screen (local-1)",
    );
  });

  it("Closing while not in full-screen should still hide the window", () => {
    const logger = {
      info: vi.fn(),
    };
    const win = {
      isFullScreen: vi.fn(() => false),
      setFullScreen: vi.fn(),
      hide: vi.fn(),
    };

    const prevented = handleDarwinWindowCloseRequest({
      win,
      forceQuit: false,
      label: "local-2",
      logger,
    });

    expect(prevented).toBe(true);
    expect(win.hide).toHaveBeenCalledTimes(1);
    expect(win.setFullScreen).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "[createWindow] window hidden instead of closed (local-2)",
    );
  });

  it("Do not intercept close when the app initiates exit", () => {
    const logger = {
      info: vi.fn(),
    };
    const win = {
      isFullScreen: vi.fn(() => true),
      setFullScreen: vi.fn(),
      hide: vi.fn(),
    };

    const prevented = handleDarwinWindowCloseRequest({
      win,
      forceQuit: true,
      label: "local-3",
      logger,
    });

    expect(prevented).toBe(false);
    expect(win.hide).not.toHaveBeenCalled();
    expect(win.setFullScreen).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("desktopWindowLifecycle handleDesktopWindowCloseRequest", () => {
  it("prevents closing when the last Windows window cancel is chosen", () => {
    const logger = {
      info: vi.fn(),
    };
    const confirmQuit = vi.fn(() => false);
    const requestQuit = vi.fn();

    const prevented = handleDesktopWindowCloseRequest({
      platform: "win32",
      forceQuit: false,
      closeToTraySupported: true,
      isLastWindow: true,
      label: "local-4",
      logger,
      confirmQuit,
      requestQuit,
    });

    expect(prevented).toBe(true);
    expect(confirmQuit).toHaveBeenCalledTimes(1);
    expect(requestQuit).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      "[createWindow] last window close canceled by user (local-4)",
    );
  });

  it("requests app quit when the last Windows window close is confirmed", () => {
    const logger = {
      info: vi.fn(),
    };
    const confirmQuit = vi.fn(() => true);
    const requestQuit = vi.fn();

    const prevented = handleDesktopWindowCloseRequest({
      platform: "win32",
      forceQuit: false,
      closeToTraySupported: true,
      isLastWindow: true,
      label: "local-5",
      logger,
      confirmQuit,
      requestQuit,
    });

    expect(prevented).toBe(true);
    expect(confirmQuit).toHaveBeenCalledTimes(1);
    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "[createWindow] last window close confirmed, quitting app (local-5)",
    );
  });

  it("skips quit confirmation when confirmation is disabled", () => {
    const logger = {
      info: vi.fn(),
    };
    const confirmQuit = vi.fn(() => false);
    const requestQuit = vi.fn();

    const prevented = handleDesktopWindowCloseRequest({
      platform: "win32",
      forceQuit: false,
      closeToTraySupported: true,
      isLastWindow: true,
      label: "local-7",
      logger,
      shouldConfirmQuit: false,
      confirmQuit,
      requestQuit,
    });

    expect(prevented).toBe(true);
    expect(confirmQuit).not.toHaveBeenCalled();
    expect(requestQuit).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "[createWindow] last window close skipped confirmation, quitting app (local-7)",
    );
  });

  it("does not confirm quit when another window remains open", () => {
    const logger = {
      info: vi.fn(),
    };
    const confirmQuit = vi.fn(() => true);
    const requestQuit = vi.fn();

    const prevented = handleDesktopWindowCloseRequest({
      platform: "win32",
      forceQuit: false,
      closeToTraySupported: true,
      isLastWindow: false,
      label: "local-6",
      logger,
      confirmQuit,
      requestQuit,
    });

    expect(prevented).toBe(false);
    expect(confirmQuit).not.toHaveBeenCalled();
    expect(requestQuit).not.toHaveBeenCalled();
  });

  it("hides linux window to tray when tray is supported and close-to-tray enabled", () => {
    const logger = { info: vi.fn() };
    const hideWindow = vi.fn();
    const confirmQuit = vi.fn(() => true);
    const requestQuit = vi.fn();

    const prevented = handleDesktopWindowCloseRequest({
      platform: "linux",
      forceQuit: false,
      closeToTray: true,
      closeToTraySupported: true,
      isLastWindow: true,
      label: "local-linux-tray",
      logger,
      confirmQuit,
      requestQuit,
      hideWindow,
    });

    expect(prevented).toBe(true);
    expect(hideWindow).toHaveBeenCalledTimes(1);
    expect(confirmQuit).not.toHaveBeenCalled();
    expect(requestQuit).not.toHaveBeenCalled();
  });

  it("treats missing linux tray capability as unsupported and falls back to quit confirmation", () => {
    const logger = { info: vi.fn() };
    const hideWindow = vi.fn();
    const confirmQuit = vi.fn(() => true);
    const requestQuit = vi.fn();

    for (const closeToTraySupported of [undefined, false] as const) {
      hideWindow.mockClear();
      confirmQuit.mockClear();
      requestQuit.mockClear();
      const prevented = handleDesktopWindowCloseRequest({
        platform: "linux",
        forceQuit: false,
        closeToTray: true,
        closeToTraySupported,
        isLastWindow: true,
        label: "local-linux-no-tray",
        logger,
        confirmQuit,
        requestQuit,
        hideWindow,
      });

      expect(prevented).toBe(true);
      expect(hideWindow).not.toHaveBeenCalled();
      expect(confirmQuit).toHaveBeenCalledTimes(1);
      expect(requestQuit).toHaveBeenCalledTimes(1);
    }
  });

  it("hides windows window to tray on the happy path when tray instance is ready", () => {
    const logger = { info: vi.fn() };
    const hideWindow = vi.fn();
    const confirmQuit = vi.fn(() => true);
    const requestQuit = vi.fn();

    const prevented = handleDesktopWindowCloseRequest({
      platform: "win32",
      forceQuit: false,
      closeToTray: true,
      closeToTraySupported: true,
      isLastWindow: true,
      label: "local-win32-tray",
      logger,
      confirmQuit,
      requestQuit,
      hideWindow,
    });

    expect(prevented).toBe(true);
    expect(hideWindow).toHaveBeenCalledTimes(1);
    expect(confirmQuit).not.toHaveBeenCalled();
    expect(requestQuit).not.toHaveBeenCalled();
  });

  it("does not hide windows window when tray instance failed to create", () => {
    const logger = { info: vi.fn() };
    const hideWindow = vi.fn();
    const confirmQuit = vi.fn(() => true);
    const requestQuit = vi.fn();

    const prevented = handleDesktopWindowCloseRequest({
      platform: "win32",
      forceQuit: false,
      closeToTray: true,
      closeToTraySupported: false,
      isLastWindow: true,
      label: "local-win32-no-tray",
      logger,
      confirmQuit,
      requestQuit,
      hideWindow,
    });

    expect(prevented).toBe(true);
    expect(hideWindow).not.toHaveBeenCalled();
    expect(confirmQuit).toHaveBeenCalledTimes(1);
    expect(requestQuit).toHaveBeenCalledTimes(1);
  });

  it("falls back to quit confirmation on linux when close-to-tray setting is off", () => {
    const logger = { info: vi.fn() };
    const hideWindow = vi.fn();
    const confirmQuit = vi.fn(() => false);
    const requestQuit = vi.fn();

    const prevented = handleDesktopWindowCloseRequest({
      platform: "linux",
      forceQuit: false,
      closeToTray: false,
      closeToTraySupported: true,
      isLastWindow: true,
      label: "local-linux-off",
      logger,
      confirmQuit,
      requestQuit,
      hideWindow,
    });

    expect(prevented).toBe(true);
    expect(hideWindow).not.toHaveBeenCalled();
    expect(confirmQuit).toHaveBeenCalledTimes(1);
  });
});
