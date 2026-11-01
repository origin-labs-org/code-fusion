import { describe, expect, it, vi } from "vitest";
import { DesktopBrowserScreenshotActivityController } from "../src/main/browserView/browserScreenshotActivityController.js";

function createHarness() {
  const ownerCaptureResolvers: Array<() => void> = [];
  const guestCaptureResolvers: Array<() => void> = [];
  const ownerCapturePage = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        ownerCaptureResolvers.push(resolve);
      }),
  );
  const guestCapturePage = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        guestCaptureResolvers.push(resolve);
      }),
  );
  const ownerWebContents = {
    id: 700,
    isDestroyed: vi.fn(() => false),
    capturePage: ownerCapturePage,
  };
  const guestWebContents = {
    id: 70,
    hostWebContents: ownerWebContents as { id: number },
    isDestroyed: vi.fn(() => false),
    capturePage: guestCapturePage,
  };
  const win = {
    isDestroyed: vi.fn(() => false),
    webContents: ownerWebContents,
  };
  const fromId = vi.fn(() => win);
  const fromWebContentsId = vi.fn(() => guestWebContents);
  const log = vi.fn();
  const controller = new DesktopBrowserScreenshotActivityController({
    fromId,
    fromWebContentsId,
    log,
  });

  return {
    controller,
    fromId,
    fromWebContentsId,
    guestCapturePage,
    guestCaptureResolvers,
    guestWebContents,
    log,
    ownerCapturePage,
    ownerCaptureResolvers,
    ownerWebContents,
    win,
  };
}

async function settleCaptures(harness: ReturnType<typeof createHarness>): Promise<void> {
  for (const resolve of harness.ownerCaptureResolvers.splice(0)) resolve();
  for (const resolve of harness.guestCaptureResolvers.splice(0)) resolve();
  await Promise.resolve();
  for (const resolve of harness.ownerCaptureResolvers.splice(0)) resolve();
  for (const resolve of harness.guestCaptureResolvers.splice(0)) resolve();
  await Promise.resolve();
}

describe("DesktopBrowserScreenshotActivityController", () => {
  function createTransparentBootstrapHarness(options?: {
    allowTransparentWindowBootstrap?: boolean;
    hideTaskbarDuringTransparentWindowBootstrap?: boolean;
    initiallyMinimized?: boolean;
    initiallyVisible?: boolean;
  }) {
    let opacity = 0.72;
    let visible = options?.initiallyVisible ?? false;
    let focused = false;
    let focusListener: (() => void) | undefined;
    const calls: string[] = [];
    const ownerWebContents = {
      id: 700,
      isDestroyed: () => false,
      capturePage: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const win = {
      isDestroyed: vi.fn(() => false),
      isVisible: vi.fn(() => visible),
      isMinimized: vi.fn(() => options?.initiallyMinimized ?? false),
      isFocused: vi.fn(() => focused),
      getOpacity: vi.fn(() => opacity),
      setOpacity: vi.fn((nextOpacity: number) => {
        calls.push(`opacity:${nextOpacity}`);
        opacity = nextOpacity;
      }),
      setSkipTaskbar: vi.fn((skip: boolean) => {
        calls.push(`skipTaskbar:${skip}`);
      }),
      showInactive: vi.fn(() => {
        calls.push("showInactive");
        visible = true;
      }),
      hide: vi.fn(() => {
        calls.push("hide");
        visible = false;
      }),
      on: vi.fn((event: "focus", listener: () => void) => {
        if (event === "focus") focusListener = listener;
      }),
      removeListener: vi.fn((event: "focus", listener: () => void) => {
        if (event === "focus" && focusListener === listener) focusListener = undefined;
      }),
      webContents: ownerWebContents,
    };
    const guest = {
      id: 70,
      hostWebContents: ownerWebContents,
      isDestroyed: () => false,
      capturePage: vi.fn(() => new Promise<never>(() => undefined)),
    };
    const controller = new DesktopBrowserScreenshotActivityController({
      fromId: () => win,
      fromWebContentsId: () => guest,
      allowTransparentWindowBootstrap: options?.allowTransparentWindowBootstrap ?? true,
      hideTaskbarDuringTransparentWindowBootstrap:
        options?.hideTaskbarDuringTransparentWindowBootstrap,
    });

    return {
      calls,
      controller,
      focus: () => {
        focused = true;
        focusListener?.();
      },
      guest,
      win,
    };
  }

  it("Hidden owner transparent showInactive waits for presentation grace before starting pump and restoring window", () => {
    vi.useFakeTimers();
    const harness = createTransparentBootstrapHarness();
    const lease = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-hidden-born",
      reason: "browser-screenshot",
    });

    expect(lease).toBeDefined();
    expect(harness.calls.slice(0, 2)).toEqual(["opacity:0", "showInactive"]);
    expect(harness.win.isFocused()).toBe(false);
    expect(harness.win.isVisible()).toBe(true);
    expect(harness.win.webContents.capturePage).not.toHaveBeenCalled();
    expect(harness.guest.capturePage).not.toHaveBeenCalled();

    lease?.markPrepared?.();
    vi.advanceTimersByTime(99);
    expect(harness.win.isVisible()).toBe(true);
    expect(harness.guest.capturePage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(harness.calls).toEqual(["opacity:0", "showInactive", "hide", "opacity:0.72"]);
    expect(harness.win.isVisible()).toBe(false);
    expect(harness.win.getOpacity()).toBe(0.72);
    expect(harness.win.webContents.capturePage).not.toHaveBeenCalled();
    expect(harness.guest.capturePage).toHaveBeenCalledTimes(1);
    lease?.release();
    vi.useRealTimers();
  });

  it("Hidden owner not Ready only starts overlapping preparing pump after presentation grace", async () => {
    vi.useFakeTimers();
    const harness = createTransparentBootstrapHarness();
    const lease = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-hidden-preparing",
      reason: "browser-screenshot",
    });

    vi.advanceTimersByTime(99);
    expect(harness.win.webContents.capturePage).not.toHaveBeenCalled();
    expect(harness.guest.capturePage).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(harness.win.webContents.capturePage).toHaveBeenCalledTimes(2);
    expect(harness.guest.capturePage).toHaveBeenCalledTimes(2);
    expect(harness.win.isVisible()).toBe(true);

    lease?.release();
    await Promise.resolve();
    expect(harness.win.isVisible()).toBe(false);
    vi.useRealTimers();
  });

  it("Windows hidden owner hides taskbar before showInactive and restores taskbar when returning to hidden", () => {
    vi.useFakeTimers();
    const harness = createTransparentBootstrapHarness({
      hideTaskbarDuringTransparentWindowBootstrap: true,
    });
    const lease = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-windows-tray",
      reason: "browser-screenshot",
    });

    expect(harness.calls).toEqual(["skipTaskbar:true", "opacity:0", "showInactive"]);
    lease?.markPrepared?.();
    vi.advanceTimersByTime(100);

    expect(harness.calls).toEqual([
      "skipTaskbar:true",
      "opacity:0",
      "showInactive",
      "hide",
      "opacity:0.72",
      "skipTaskbar:false",
    ]);
    expect(harness.win.isVisible()).toBe(false);
    lease?.release();
    vi.useRealTimers();
  });

  it("User focus during Windows transparent bootstrap restores taskbar and no longer hides it", async () => {
    const harness = createTransparentBootstrapHarness({
      hideTaskbarDuringTransparentWindowBootstrap: true,
    });
    const lease = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-windows-user-focus",
      reason: "browser-screenshot",
    });

    harness.focus();
    expect(harness.calls).toEqual([
      "skipTaskbar:true",
      "opacity:0",
      "showInactive",
      "opacity:0.72",
      "skipTaskbar:false",
    ]);
    lease?.markPrepared?.();
    lease?.release();
    await Promise.resolve();

    expect(harness.win.hide).not.toHaveBeenCalled();
    expect(harness.win.isVisible()).toBe(true);
  });

  it("User focus during transparent bootstrap immediately restores opacity, and subsequent Ready/release no longer hides", async () => {
    const harness = createTransparentBootstrapHarness();
    const lease = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-user-focus",
      reason: "browser-screenshot",
    });

    harness.focus();
    expect(harness.calls).toEqual(["opacity:0", "showInactive", "opacity:0.72"]);
    lease?.markPrepared?.();
    lease?.release();
    await Promise.resolve();

    expect(harness.win.hide).not.toHaveBeenCalled();
    expect(harness.win.isVisible()).toBe(true);
    expect(harness.win.getOpacity()).toBe(0.72);
  });

  it("Do not start transparent bootstrap if owner is originally visible", () => {
    const harness = createTransparentBootstrapHarness({ initiallyVisible: true });
    const lease = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-visible",
      reason: "browser-screenshot",
    });

    expect(lease).toBeDefined();
    expect(harness.win.setOpacity).not.toHaveBeenCalled();
    expect(harness.win.showInactive).not.toHaveBeenCalled();
    lease?.release();
  });

  it("Do not start transparent bootstrap if owner is originally minimized to avoid restoring window state to hidden", () => {
    const harness = createTransparentBootstrapHarness({ initiallyMinimized: true });
    const lease = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-minimized",
      reason: "browser-screenshot",
    });

    expect(lease).toBeDefined();
    expect(harness.win.setOpacity).not.toHaveBeenCalled();
    expect(harness.win.showInactive).not.toHaveBeenCalled();
    lease?.release();
  });

  it("Hidden owner still uses original capture activity when platform capability is not enabled", () => {
    const harness = createTransparentBootstrapHarness({
      allowTransparentWindowBootstrap: false,
    });
    const lease = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-platform-disabled",
      reason: "browser-screenshot",
    });

    expect(lease).toBeDefined();
    expect(harness.win.setOpacity).not.toHaveBeenCalled();
    expect(harness.win.showInactive).not.toHaveBeenCalled();
    expect(harness.win.webContents.capturePage).toHaveBeenCalledTimes(2);
    expect(harness.guest.capturePage).toHaveBeenCalledTimes(2);
    lease?.release();
  });

  it("Immediately completed preparing capture yields macrotask first, avoiding locking up main process with microtask spin", async () => {
    const neverSettles = new Promise<void>(() => undefined);
    const createImmediatelySettlingCapture = () => {
      let immediateCaptures = 32;
      return vi.fn(() => {
        if (immediateCaptures > 0) {
          immediateCaptures -= 1;
          return Promise.resolve();
        }
        return neverSettles;
      });
    };
    const ownerCapturePage = createImmediatelySettlingCapture();
    const guestCapturePage = createImmediatelySettlingCapture();
    const ownerWebContents = {
      id: 700,
      isDestroyed: () => false,
      capturePage: ownerCapturePage,
    };
    const controller = new DesktopBrowserScreenshotActivityController({
      fromId: () => ({
        isDestroyed: () => false,
        webContents: ownerWebContents,
      }),
      fromWebContentsId: () => ({
        id: 70,
        hostWebContents: ownerWebContents,
        isDestroyed: () => false,
        capturePage: guestCapturePage,
      }),
    });
    const firstMacrotask = new Promise<void>((resolve) => setTimeout(resolve, 0));

    const lease = controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-immediate",
      reason: "browser-screenshot",
    });
    await firstMacrotask;

    expect(ownerCapturePage).toHaveBeenCalledTimes(2);
    expect(guestCapturePage).toHaveBeenCalledTimes(2);
    lease?.release();
  });

  it("First lease starts two overlapping 1×1 captures for owner/guest each; final release stops pumping", async () => {
    const harness = createHarness();
    const first = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-1",
      reason: "browser-screenshot",
    });
    const second = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-2",
      reason: "browser-screenshot",
    });

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(harness.ownerCapturePage).toHaveBeenCalledTimes(2);
    expect(harness.guestCapturePage).toHaveBeenCalledTimes(2);
    expect(harness.ownerCapturePage).toHaveBeenNthCalledWith(1, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    });

    first?.release();
    first?.release();
    await Promise.resolve();
    expect(harness.ownerCapturePage).toHaveBeenCalledTimes(2);
    expect(harness.guestCapturePage).toHaveBeenCalledTimes(2);

    second?.release();
    await Promise.resolve();
    await settleCaptures(harness);
    expect(harness.ownerCapturePage).toHaveBeenCalledTimes(2);
    expect(harness.guestCapturePage).toHaveBeenCalledTimes(2);
  });

  it("New acquire before microtask pump stop reuses activity, preventing capturer count from dropping to zero", async () => {
    const harness = createHarness();
    const first = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-1",
      reason: "browser-screenshot",
    });
    first?.release();

    const second = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-2",
      reason: "browser-screenshot",
    });
    await Promise.resolve();
    harness.ownerCaptureResolvers.shift()?.();
    harness.guestCaptureResolvers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(harness.ownerCapturePage).toHaveBeenCalledTimes(3);
    expect(harness.guestCapturePage).toHaveBeenCalledTimes(3);

    second?.release();
    await Promise.resolve();
    await settleCaptures(harness);
  });

  it("Owner stops pumping after surface Ready, and guest switches to 200ms single in-flight pulse", async () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const lease = harness.controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-paced",
      reason: "browser-screenshot",
    });

    expect(harness.ownerCapturePage).toHaveBeenCalledTimes(2);
    expect(harness.guestCapturePage).toHaveBeenCalledTimes(2);
    lease?.markPrepared?.();
    for (const resolve of harness.ownerCaptureResolvers.splice(0)) resolve();
    for (const resolve of harness.guestCaptureResolvers.splice(0)) resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.ownerCapturePage).toHaveBeenCalledTimes(2);
    expect(harness.guestCapturePage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(199);
    expect(harness.guestCapturePage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.guestCapturePage).toHaveBeenCalledTimes(3);
    expect(harness.guestCaptureResolvers).toHaveLength(1);

    lease?.release();
    harness.guestCaptureResolvers.shift()?.();
    await Promise.resolve();
    await vi.runAllTimersAsync();
    expect(harness.ownerCapturePage).toHaveBeenCalledTimes(2);
    expect(harness.guestCapturePage).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("capture 失败会停止 pump 并使已交付 lease 立即失效", async () => {
    const capturePage = vi.fn(() => Promise.reject(new Error("surface unavailable")));
    const log = vi.fn();
    const controller = new DesktopBrowserScreenshotActivityController({
      fromId: () => ({
        isDestroyed: () => false,
        webContents: {
          id: 700,
          isDestroyed: () => false,
          capturePage,
        },
      }),
      fromWebContentsId: () => ({
        id: 70,
        hostWebContents: { id: 700 },
        isDestroyed: () => false,
        capturePage,
      }),
      log,
    });

    const lease = controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-failed",
      reason: "browser-screenshot",
    });
    expect(lease).toBeDefined();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(capturePage).toHaveBeenCalledTimes(4);
    expect(lease?.invalidated?.aborted).toBe(true);
    expect(lease?.invalidated?.reason).toEqual(
      expect.objectContaining({ message: expect.stringContaining("capture failed") }),
    );
    expect(log).toHaveBeenCalledWith(expect.stringContaining("capture failed"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("error=surface unavailable"));
  });

  it("Guest UnknownVizError during preparing phase undergoes serial backoff retries; lease is not invalidated after self-healing", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const ownerCapturePage = vi.fn(() => new Promise<never>(() => undefined));
    const guestAttempts: Array<{
      resolve: () => void;
      reject: (error: Error) => void;
    }> = [];
    const guestCapturePage = vi.fn(
      () =>
        new Promise<void>((resolve, reject) => {
          guestAttempts.push({ resolve, reject });
        }),
    );
    const controller = new DesktopBrowserScreenshotActivityController({
      fromId: () => ({
        isDestroyed: () => false,
        webContents: { id: 700, isDestroyed: () => false, capturePage: ownerCapturePage },
      }),
      fromWebContentsId: () => ({
        id: 70,
        hostWebContents: { id: 700 },
        isDestroyed: () => false,
        capturePage: guestCapturePage,
      }),
      log,
    });

    const lease = controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-transient",
      reason: "browser-screenshot",
    });
    expect(lease).toBeDefined();
    expect(guestCapturePage).toHaveBeenCalledTimes(2);

    for (const attempt of guestAttempts.splice(0)) attempt.reject(new Error("UnknownVizError"));
    for (let index = 0; index < 6; index += 1) await Promise.resolve();

    expect(lease?.invalidated?.aborted).toBe(false);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("transient capture retry scheduled"));
    expect(guestCapturePage).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(99);
    expect(guestCapturePage).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(guestCapturePage).toHaveBeenCalledTimes(4);
    expect(lease?.invalidated?.aborted).toBe(false);

    for (const attempt of guestAttempts.splice(0)) attempt.resolve();
    await vi.advanceTimersByTimeAsync(10);
    const recoveredCalls = guestCapturePage.mock.calls.length;
    expect(recoveredCalls).toBeGreaterThan(4);
    expect(lease?.invalidated?.aborted).toBe(false);

    lease?.release();
    for (const attempt of guestAttempts.splice(0)) attempt.resolve();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
  });

  it("Fall back to fast-fail invalidate after UnknownVizError persistently exceeds retry budget", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const ownerCapturePage = vi.fn(() => new Promise<never>(() => undefined));
    const guestCapturePage = vi.fn(() => Promise.reject(new Error("UnknownVizError")));
    const controller = new DesktopBrowserScreenshotActivityController({
      fromId: () => ({
        isDestroyed: () => false,
        webContents: { id: 700, isDestroyed: () => false, capturePage: ownerCapturePage },
      }),
      fromWebContentsId: () => ({
        id: 70,
        hostWebContents: { id: 700 },
        isDestroyed: () => false,
        capturePage: guestCapturePage,
      }),
      log,
    });

    const lease = controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-transient-dead",
      reason: "browser-screenshot",
    });
    expect(lease).toBeDefined();

    await vi.advanceTimersByTimeAsync(3_000);

    expect(lease?.invalidated?.aborted).toBe(true);
    expect(lease?.invalidated?.reason).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("browser screenshot activity capture failed for guest"),
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("transient capture retry budget exhausted"),
    );

    const finalCalls = guestCapturePage.mock.calls.length;
    await vi.advanceTimersByTimeAsync(500);
    expect(guestCapturePage).toHaveBeenCalledTimes(finalCalls);
    vi.useRealTimers();
  });

  it("First fatal failure in preparing phase invalidates immediately to keep fast fail without waiting for concurrent pending probes", async () => {
    const log = vi.fn();
    const ownerCapturePage = vi.fn(() => new Promise<never>(() => undefined));
    const guestAttempts: Array<{ reject: (error: Error) => void }> = [];
    const guestCapturePage = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          guestAttempts.push({ reject });
        }),
    );
    const controller = new DesktopBrowserScreenshotActivityController({
      fromId: () => ({
        isDestroyed: () => false,
        webContents: { id: 700, isDestroyed: () => false, capturePage: ownerCapturePage },
      }),
      fromWebContentsId: () => ({
        id: 70,
        hostWebContents: { id: 700 },
        isDestroyed: () => false,
        capturePage: guestCapturePage,
      }),
      log,
    });

    const lease = controller.acquire({
      windowId: 7,
      webContentsId: 70,
      requestId: "shot-fatal-fast",
      reason: "browser-screenshot",
    });
    expect(lease).toBeDefined();
    expect(guestCapturePage).toHaveBeenCalledTimes(2);

    guestAttempts[0]?.reject(new Error("webContents destroyed"));
    for (let index = 0; index < 4; index += 1) await Promise.resolve();

    expect(lease?.invalidated?.aborted).toBe(true);
    expect(lease?.invalidated?.reason).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("browser screenshot activity capture failed for guest"),
      }),
    );
    expect(guestCapturePage).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("transient capture retry"));
    lease?.release();
  });

  it("Controlled acquire failure when window is destroyed", () => {
    const harness = createHarness();
    harness.win.isDestroyed.mockReturnValue(true);
    expect(
      harness.controller.acquire({
        windowId: 7,
        webContentsId: 70,
        requestId: "shot-destroyed",
        reason: "browser-screenshot",
      }),
    ).toBeUndefined();
    expect(harness.ownerCapturePage).not.toHaveBeenCalled();
    expect(harness.guestCapturePage).not.toHaveBeenCalled();
  });

  it("Reject activity when guest does not belong to target owner window to avoid accidental cross-window wakeup", () => {
    const harness = createHarness();
    harness.guestWebContents.hostWebContents = { id: 999 };

    expect(
      harness.controller.acquire({
        windowId: 7,
        webContentsId: 70,
        requestId: "shot-wrong-owner",
        reason: "browser-screenshot",
      }),
    ).toBeUndefined();
    expect(harness.ownerCapturePage).not.toHaveBeenCalled();
    expect(harness.guestCapturePage).not.toHaveBeenCalled();
  });
});
