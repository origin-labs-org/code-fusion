import { describe, expect, it, vi } from "vitest";
import { PlatformChannels } from "@origin-ai/cf-shared";
import { createDesktopBrowserScreenshotSurfaceCoordinator } from "../src/main/browserView/browserScreenshotSurfaceCoordinatorWiring.js";

function prepareInput(requestId: string) {
  return {
    requestId,
    windowId: 7,
    workspaceKey: "workspace-7",
    sessionId: "session-7",
    browserId: "browser-7",
    browserGeneration: 2,
    tabId: "tab-7",
    webContentsId: 70,
    viewport: { width: 800, height: 600 },
    signal: new AbortController().signal,
  };
}

function readyPayload(requestId: string) {
  return { ...prepareInput(requestId), signal: undefined, surfaceScale: 1 };
}

function withBackgroundActivity<
  T extends { isDestroyed(): boolean; send(...args: unknown[]): unknown },
>(webContents: T) {
  return {
    ...webContents,
    id: 700,
    capturePage: vi.fn(() => new Promise<never>(() => undefined)),
  };
}

function guestFor(ownerWebContents: { id: number }) {
  return {
    id: 70,
    hostWebContents: ownerWebContents,
    isDestroyed: () => false,
    capturePage: vi.fn(() => new Promise<never>(() => undefined)),
  };
}

describe("createDesktopBrowserScreenshotSurfaceCoordinator", () => {
  it("Target prepare/release only to the owner BrowserWindow, and reject destroyed windows", async () => {
    const send = vi.fn();
    const destroyed = vi.fn(() => false);
    const webContentsDestroyed = vi.fn(() => false);
    const webContents = withBackgroundActivity({
      isDestroyed: webContentsDestroyed,
      send,
    });
    const fromId = vi.fn((windowId: number) =>
      windowId === 7 ? { isDestroyed: destroyed, webContents } : null,
    );
    const guest = guestFor(webContents);
    const coordinator = createDesktopBrowserScreenshotSurfaceCoordinator({
      fromId,
      fromWebContentsId: () => guest,
      log: vi.fn(),
    });
    const pending = coordinator.prepare(prepareInput("request-7"));

    expect(send).toHaveBeenCalledWith(
      PlatformChannels.BrowserViewScreenshotSurfacePrepare,
      expect.objectContaining({ requestId: "request-7", tabId: "tab-7" }),
    );
    coordinator.handleReady({
      windowId: 7,
      senderWebContentsId: 700,
      payload: readyPayload("request-7"),
    });
    const lease = await pending;
    lease.release();
    await Promise.resolve();
    expect(send).toHaveBeenCalledWith(
      PlatformChannels.BrowserViewScreenshotSurfaceRelease,
      expect.objectContaining({ requestId: "request-7", tabId: "tab-7" }),
    );
    expect(webContents.capturePage).toHaveBeenCalledTimes(2);
    expect(guest.capturePage).toHaveBeenCalledTimes(2);

    destroyed.mockReturnValue(true);
    await expect(coordinator.prepare(prepareInput("request-destroyed"))).rejects.toThrow(
      "activity could not be acquired",
    );
    expect(fromId).toHaveBeenCalledWith(7);
  });

  it("Fail prepare and skip calling send when webContents is destroyed", async () => {
    const send = vi.fn();
    const log = vi.fn();
    const ownerWebContents = withBackgroundActivity({ isDestroyed: () => true, send });
    const coordinator = createDesktopBrowserScreenshotSurfaceCoordinator({
      fromId: () => ({
        isDestroyed: () => false,
        webContents: ownerWebContents,
      }),
      fromWebContentsId: () => guestFor(ownerWebContents),
      log,
    });

    await expect(coordinator.prepare(prepareInput("webcontents-destroyed"))).rejects.toThrow(
      "activity could not be acquired",
    );
    expect(send).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalled();
  });

  it("Convert errors thrown by prepare send to preparation failure", async () => {
    const log = vi.fn();
    const ownerWebContents = withBackgroundActivity({
      isDestroyed: () => false,
      send: () => {
        throw new Error("renderer gone");
      },
    });
    const coordinator = createDesktopBrowserScreenshotSurfaceCoordinator({
      fromId: () => ({
        isDestroyed: () => false,
        webContents: ownerWebContents,
      }),
      fromWebContentsId: () => guestFor(ownerWebContents),
      log,
    });

    await expect(coordinator.prepare(prepareInput("prepare-send-throw"))).rejects.toThrow(
      "could not be sent",
    );
    expect(log).toHaveBeenCalled();
  });

  it("Errors thrown by release send after ready are not rethrown from lease.release", async () => {
    const log = vi.fn();
    const send = vi.fn(() => {
      if (send.mock.calls.length > 1) {
        throw new Error("window closing");
      }
    });
    const ownerWebContents = withBackgroundActivity({ isDestroyed: () => false, send });
    const coordinator = createDesktopBrowserScreenshotSurfaceCoordinator({
      fromId: () => ({
        isDestroyed: () => false,
        webContents: ownerWebContents,
      }),
      fromWebContentsId: () => guestFor(ownerWebContents),
      log,
    });
    const pending = coordinator.prepare(prepareInput("release-send-throw"));
    coordinator.handleReady({
      windowId: 7,
      senderWebContentsId: 700,
      payload: readyPayload("release-send-throw"),
    });

    const lease = await pending;
    expect(() => lease.release()).not.toThrow();
    expect(log).toHaveBeenCalled();
  });

  it("Errors thrown by send during timeout cleanup release do not produce unhandled exceptions", async () => {
    const log = vi.fn();
    const send = vi.fn(() => {
      if (send.mock.calls.length > 1) {
        throw new Error("window closing");
      }
    });
    const ownerWebContents = withBackgroundActivity({ isDestroyed: () => false, send });
    const coordinator = createDesktopBrowserScreenshotSurfaceCoordinator({
      fromId: () => ({
        isDestroyed: () => false,
        webContents: ownerWebContents,
      }),
      fromWebContentsId: () => guestFor(ownerWebContents),
      log,
      timeoutMs: 1,
    });

    await expect(coordinator.prepare(prepareInput("timeout-release-throw"))).rejects.toThrow(
      "timed out",
    );
    expect(log).toHaveBeenCalled();
  });
});
