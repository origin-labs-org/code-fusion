import { describe, expect, it, vi } from "vitest";
import { DesktopBrowserScreenshotSurfaceCoordinator } from "../src/main/browserView/browserScreenshotSurfaceCoordinator.js";

const input = {
  requestId: "shot-1",
  windowId: 7,
  workspaceKey: "remote:ssh:dev:/repo",
  sessionId: "sess-1",
  browserId: "browser-1",
  browserGeneration: 4,
  tabId: "tab-1",
  webContentsId: 42,
  viewport: { width: 1274, height: 720 },
  surfaceScale: 1,
};

describe("DesktopBrowserScreenshotSurfaceCoordinator", () => {
  it("Only accept ready matching window/sender/request/guest with viewport error within 1px", async () => {
    const sendPrepare = vi.fn(() => true);
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare,
      sendRelease,
      timeoutMs: 100,
    });
    const pending = coordinator.prepare({ ...input, signal: new AbortController().signal });
    coordinator.handleReady({
      windowId: 7,
      senderWebContentsId: 700,
      payload: {
        ...input,
        surfaceScale: 0.625,
        viewport: { width: 1275, height: 719 },
      },
    });

    const lease = await pending;
    expect(lease).toMatchObject({
      surfaceScale: 0.625,
      webContentsId: 42,
      viewport: { width: 1275, height: 719 },
    });
    lease.release();
    lease.release();
    expect(sendRelease).toHaveBeenCalledTimes(1);
  });

  it("Natural and emulated viewports for the same guest do not share leases, and reject ready with wrong mode", async () => {
    const sendPrepare = vi.fn(() => true);
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare,
      sendRelease,
    });
    const natural = { ...input, viewportMode: "natural" as const };
    const emulated = { ...input, requestId: "emulated-shot", viewportMode: "emulated" as const };
    const pending = coordinator.prepare({ ...natural, signal: new AbortController().signal });
    const next = coordinator.prepare({ ...emulated, signal: new AbortController().signal });
    expect(sendPrepare).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ viewportMode: "natural" }),
    );
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    await Promise.resolve();
    expect(settled).toBe(false);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: natural });
    const lease = await pending;
    expect(sendPrepare).toHaveBeenCalledTimes(1);
    lease.release();
    expect(sendRelease.mock.calls[0]?.[1]).not.toHaveProperty("viewportMode");
    expect(sendPrepare).toHaveBeenCalledTimes(2);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: emulated });
    (await next).release();
    coordinator.dispose();
  });

  it("Default 3000ms timeout triggers release; late ready cannot revive the request", async () => {
    vi.useFakeTimers();
    const sendPrepare = vi.fn(() => true);
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare,
      sendRelease,
    });
    const pending = coordinator.prepare({ ...input, signal: new AbortController().signal });
    expect(sendPrepare).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ requestId: "shot-1", timeoutMs: 3000 }),
    );
    let rejection: unknown;
    void pending.catch((error: unknown) => {
      rejection = error;
    });

    await vi.advanceTimersByTimeAsync(2999);
    expect(rejection).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(rejection).toEqual(
      new Error("browser screenshot surface preparation timed out after 3000ms"),
    );
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    expect(sendRelease).toHaveBeenCalledTimes(1);
    expect(sendRelease.mock.calls[0]?.[1]).not.toHaveProperty("timeoutMs");
    vi.useRealTimers();
  });

  it("Ignore ready from wrong sender and window", async () => {
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare: () => true,
      sendRelease: vi.fn(),
    });
    const pending = coordinator.prepare({ ...input, signal: new AbortController().signal });
    coordinator.handleReady({ windowId: 8, senderWebContentsId: 700, payload: input });
    coordinator.handleReady({
      windowId: 7,
      senderWebContentsId: 700,
      payload: { ...input, viewport: { width: 1277, height: 720 } },
    });
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 701, payload: input });

    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    const lease = await pending;
    lease.release();
  });

  it("Continue waiting for next ready from the same trusted renderer if surfaceScale is invalid", async () => {
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare: () => true,
      sendRelease: vi.fn(),
    });
    const pending = coordinator.prepare({ ...input, signal: new AbortController().signal });
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    for (const surfaceScale of [0, Number.NaN, Number.POSITIVE_INFINITY]) {
      coordinator.handleReady({
        windowId: 7,
        senderWebContentsId: 700,
        payload: { ...input, surfaceScale },
      });
    }
    await Promise.resolve();
    expect(settled).toBe(false);

    coordinator.handleReady({
      windowId: 7,
      senderWebContentsId: 700,
      payload: { ...input, surfaceScale: 1 },
    });
    const lease = await pending;
    expect(lease.surfaceScale).toBe(1);
    lease.release();
  });

  it("BVR09: unscaled request only accepts 100% surface and removes transient scale mode upon release", async () => {
    const sendPrepare = vi.fn(() => true);
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare,
      sendRelease,
    });
    const unscaledInput = {
      ...input,
      surfaceScaleMode: "unscaled" as const,
      signal: new AbortController().signal,
    };
    const pending = coordinator.prepare(unscaledInput);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    expect(sendPrepare).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ surfaceScaleMode: "unscaled" }),
    );
    coordinator.handleReady({
      windowId: 7,
      senderWebContentsId: 700,
      payload: { ...unscaledInput, surfaceScale: 0.625 },
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    coordinator.handleReady({
      windowId: 7,
      senderWebContentsId: 700,
      payload: { ...unscaledInput, surfaceScale: 1 },
    });
    const lease = await pending;
    expect(lease.surfaceScale).toBe(1);
    lease.release();
    expect(sendRelease.mock.calls[0]?.[1]).not.toHaveProperty("surfaceScaleMode");
  });

  it("Concurrent requests for the same guest reuse a single prepare, releasing only after all leases are released", async () => {
    const sendPrepare = vi.fn(() => true);
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare,
      sendRelease,
    });
    const first = coordinator.prepare({ ...input, signal: new AbortController().signal });
    const second = coordinator.prepare({
      ...input,
      requestId: "shot-2",
      signal: new AbortController().signal,
    });

    expect(sendPrepare).toHaveBeenCalledTimes(1);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    const [firstLease, secondLease] = await Promise.all([first, second]);
    firstLease.release();
    expect(sendRelease).not.toHaveBeenCalled();
    secondLease.release();
    expect(sendRelease).toHaveBeenCalledTimes(1);
  });

  it("active group 在 prepare 前持有一份 screenshot activity lease，全部释放后归还", async () => {
    const events: string[] = [];
    const activityRelease = vi.fn(() => events.push("activity-release"));
    const markPrepared = vi.fn(() => events.push("activity-prepared"));
    const acquireActivity = vi.fn(() => {
      events.push("activity-acquire");
      return { markPrepared, release: activityRelease };
    });
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      acquireActivity,
      sendPrepare: () => {
        events.push("prepare");
        return true;
      },
      sendRelease: () => events.push("surface-release"),
    });
    const first = coordinator.prepare({ ...input, signal: new AbortController().signal });
    const second = coordinator.prepare({
      ...input,
      requestId: "shot-2",
      signal: new AbortController().signal,
    });

    expect(events).toEqual(["activity-acquire", "prepare"]);
    expect(acquireActivity).toHaveBeenCalledTimes(1);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    const [firstLease, secondLease] = await Promise.all([first, second]);
    expect(markPrepared).toHaveBeenCalledOnce();
    firstLease.release();
    expect(activityRelease).not.toHaveBeenCalled();
    secondLease.release();
    expect(events).toEqual([
      "activity-acquire",
      "prepare",
      "activity-prepared",
      "surface-release",
      "activity-release",
    ]);
  });

  it("activity capture 失败时立即拒绝 prepare，不等待 renderer timeout", async () => {
    vi.useFakeTimers();
    const activityController = new AbortController();
    const activityRelease = vi.fn();
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      acquireActivity: () => ({
        invalidated: activityController.signal,
        release: activityRelease,
      }),
      sendPrepare: () => true,
      sendRelease,
      timeoutMs: 1500,
    });
    const pending = coordinator.prepare({ ...input, signal: new AbortController().signal });
    const rejected = expect(pending).rejects.toThrow("capture failed");

    activityController.abort(new Error("browser screenshot activity capture failed"));
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(sendRelease).toHaveBeenCalledOnce();
    expect(activityRelease).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("Ready 后 activity 失败会使已交付 surface lease 失效", async () => {
    const activityController = new AbortController();
    const activityRelease = vi.fn();
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      acquireActivity: () => ({
        invalidated: activityController.signal,
        markPrepared: vi.fn(),
        release: activityRelease,
      }),
      sendPrepare: () => true,
      sendRelease,
    });
    const pending = coordinator.prepare({ ...input, signal: new AbortController().signal });
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    const lease = await pending;

    expect(lease.invalidated?.aborted).toBe(false);
    activityController.abort(new Error("browser screenshot activity capture failed"));
    expect(lease.invalidated?.aborted).toBe(true);
    expect(sendRelease).toHaveBeenCalledOnce();
    expect(activityRelease).toHaveBeenCalledOnce();
    lease.release();
  });

  it("Queued groups do not hold activity leases in advance, smoothly taking over without throttle jitter after previous group releases", async () => {
    const acquireActivity = vi.fn(() => ({ release: vi.fn() }));
    const sendPrepare = vi.fn(() => true);
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      acquireActivity,
      sendPrepare,
      sendRelease: vi.fn(),
    });
    const first = coordinator.prepare({ ...input, signal: new AbortController().signal });
    const secondInput = { ...input, requestId: "shot-2", webContentsId: 43, tabId: "tab-2" };
    const second = coordinator.prepare({
      ...secondInput,
      signal: new AbortController().signal,
    });

    expect(acquireActivity).toHaveBeenCalledTimes(1);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    (await first).release();
    expect(acquireActivity).toHaveBeenCalledTimes(2);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: secondInput });
    (await second).release();
  });

  it("ready 后 signal abort 自动释放 surface/activity，不等待 backend finally", async () => {
    const controller = new AbortController();
    const activityRelease = vi.fn();
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      acquireActivity: () => ({ release: activityRelease }),
      sendPrepare: () => true,
      sendRelease,
    });
    const pending = coordinator.prepare({ ...input, signal: controller.signal });
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    const lease = await pending;

    controller.abort();
    expect(sendRelease).toHaveBeenCalledTimes(1);
    expect(activityRelease).toHaveBeenCalledTimes(1);
    lease.release();
    expect(sendRelease).toHaveBeenCalledTimes(1);
    expect(activityRelease).toHaveBeenCalledTimes(1);
  });

  it("Activity watchdog forcibly releases groups hanging after ready; late lease release remains idempotent", async () => {
    vi.useFakeTimers();
    const activityRelease = vi.fn();
    const sendRelease = vi.fn();
    const warn = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      acquireActivity: () => ({ release: activityRelease }),
      sendPrepare: () => true,
      sendRelease,
      activityTimeoutMs: 35_000,
      warn,
    });
    const pending = coordinator.prepare({ ...input, signal: new AbortController().signal });
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    const lease = await pending;

    await vi.advanceTimersByTimeAsync(35_000);
    expect(sendRelease).toHaveBeenCalledTimes(1);
    expect(activityRelease).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("watchdog"));
    lease.release();
    expect(activityRelease).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("Recording can request a longer yet still bounded activity watchdog for the current surface lease", async () => {
    vi.useFakeTimers();
    const activityRelease = vi.fn();
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      acquireActivity: () => ({ release: activityRelease }),
      sendPrepare: () => true,
      sendRelease,
      activityTimeoutMs: 35_000,
    });
    const pending = coordinator.prepare({
      ...input,
      signal: new AbortController().signal,
      activityTimeoutMs: 80_000,
    });
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    const lease = await pending;

    await vi.advanceTimersByTimeAsync(35_000);
    expect(sendRelease).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(45_000);
    expect(sendRelease).toHaveBeenCalledTimes(1);
    expect(activityRelease).toHaveBeenCalledTimes(1);
    lease.release();
    vi.useRealTimers();
  });

  it("Return activity lease and continue scheduling next group even if release transport throws", async () => {
    const activityRelease = vi.fn();
    const sendPrepare = vi.fn(() => true);
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      acquireActivity: () => ({ release: activityRelease }),
      sendPrepare,
      sendRelease: () => {
        throw new Error("window closing");
      },
      log: vi.fn(),
    });
    const first = coordinator.prepare({ ...input, signal: new AbortController().signal });
    const secondInput = { ...input, requestId: "shot-2", webContentsId: 43, tabId: "tab-2" };
    const second = coordinator.prepare({
      ...secondInput,
      signal: new AbortController().signal,
    });
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });

    const firstLease = await first;
    expect(() => firstLease.release()).not.toThrow();
    expect(activityRelease).toHaveBeenCalledTimes(1);
    expect(sendPrepare).toHaveBeenCalledTimes(2);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: secondInput });
    const secondLease = await second;
    expect(() => secondLease.release()).not.toThrow();
  });

  it("Reject cancelled same-guest reuse after ready without blocking next guest", async () => {
    const sendPrepare = vi.fn(() => true);
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare,
      sendRelease,
    });
    const first = coordinator.prepare({ ...input, signal: new AbortController().signal });
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    const firstLease = await first;

    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      coordinator.prepare({ ...input, requestId: "shot-2", signal: cancelled.signal }),
    ).rejects.toThrow("cancelled");
    expect(sendRelease).not.toHaveBeenCalled();

    const nextInput = { ...input, requestId: "shot-3", webContentsId: 43, tabId: "tab-2" };
    const next = coordinator.prepare({ ...nextInput, signal: new AbortController().signal });
    expect(sendPrepare).toHaveBeenCalledTimes(1);
    firstLease.release();
    expect(sendPrepare).toHaveBeenCalledTimes(2);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: nextInput });
    (await next).release();
  });

  it("sendPrepare throwing after synchronous ready will not prematurely release valid lease", async () => {
    const sendRelease = vi.fn();
    let coordinator!: DesktopBrowserScreenshotSurfaceCoordinator;
    let calls = 0;
    const sendPrepare = vi.fn((windowId: number, payload: typeof input) => {
      calls += 1;
      if (calls === 1) {
        coordinator.handleReady({
          windowId,
          senderWebContentsId: 700,
          payload: { ...payload, surfaceScale: 1 },
        });
        throw new Error("sender observed a late transport error");
      }
      return true;
    });
    coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({ sendPrepare, sendRelease });

    const first = coordinator.prepare({ ...input, signal: new AbortController().signal });
    const firstLease = await first;
    const nextInput = { ...input, requestId: "shot-2", webContentsId: 43, tabId: "tab-2" };
    const next = coordinator.prepare({ ...nextInput, signal: new AbortController().signal });

    expect(sendRelease).not.toHaveBeenCalled();
    expect(sendPrepare).toHaveBeenCalledTimes(1);
    firstLease.release();
    expect(sendRelease).toHaveBeenCalledTimes(1);
    expect(sendPrepare).toHaveBeenCalledTimes(2);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: nextInput });
    (await next).release();
  });

  it("不同 guest 的 prepare 串行，前一个 release 后才发送下一个", async () => {
    const sendPrepare = vi.fn(() => true);
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare,
      sendRelease: vi.fn(),
    });
    const first = coordinator.prepare({ ...input, signal: new AbortController().signal });
    const secondInput = { ...input, requestId: "shot-2", webContentsId: 43, tabId: "tab-2" };
    const second = coordinator.prepare({ ...secondInput, signal: new AbortController().signal });

    expect(sendPrepare).toHaveBeenCalledTimes(1);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: input });
    const firstLease = await first;
    firstLease.release();
    expect(sendPrepare).toHaveBeenCalledTimes(2);
    coordinator.handleReady({ windowId: 7, senderWebContentsId: 700, payload: secondInput });
    const secondLease = await second;
    secondLease.release();
  });

  it("window destroyed 和 dispose 都拒绝 pending 并只 release 一次", async () => {
    const sendRelease = vi.fn();
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare: () => true,
      sendRelease,
    });
    const first = coordinator.prepare({ ...input, signal: new AbortController().signal });
    coordinator.handleWindowDestroyed(7);
    await expect(first).rejects.toThrow("window destroyed");
    coordinator.dispose();
    expect(sendRelease).toHaveBeenCalledTimes(1);

    const secondCoordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare: () => true,
      sendRelease,
    });
    const second = secondCoordinator.prepare({ ...input, signal: new AbortController().signal });
    secondCoordinator.dispose();
    await expect(second).rejects.toThrow("disposed");
    expect(sendRelease).toHaveBeenCalledTimes(2);
  });

  it("Clear the same-window queue before destroying the window, then schedule other windows", async () => {
    const sendPrepare = vi.fn(() => true);
    const coordinator = new DesktopBrowserScreenshotSurfaceCoordinator({
      sendPrepare,
      sendRelease: vi.fn(),
    });
    const active = coordinator.prepare({ ...input, signal: new AbortController().signal });
    const queued = coordinator.prepare({
      ...input,
      requestId: "shot-2",
      webContentsId: 43,
      tabId: "tab-2",
      signal: new AbortController().signal,
    });
    const activeRejected = expect(active).rejects.toThrow("window destroyed");
    const queuedRejected = expect(queued).rejects.toThrow("window destroyed");

    expect(sendPrepare).toHaveBeenCalledTimes(1);
    coordinator.handleWindowDestroyed(7);
    await Promise.all([activeRejected, queuedRejected]);
    expect(sendPrepare).toHaveBeenCalledTimes(1);

    const otherInput = {
      ...input,
      requestId: "shot-3",
      windowId: 8,
      webContentsId: 44,
      tabId: "tab-3",
    };
    const other = coordinator.prepare({ ...otherInput, signal: new AbortController().signal });
    expect(sendPrepare).toHaveBeenCalledTimes(2);
    coordinator.handleReady({ windowId: 8, senderWebContentsId: 800, payload: otherInput });
    (await other).release();
  });
});
