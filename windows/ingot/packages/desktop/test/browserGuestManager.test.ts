import { describe, expect, it, vi, beforeEach } from "vitest";
import type { BrowserScreenshotSurfaceCoordinator } from "../src/main/browserView/browserScreenshotSurfaceCoordinator.js";
import type { BrowserGuestExecutionContext } from "../src/main/browserView/browserGuestManager.js";
import type { BrowserWebmRecorderFactory } from "../src/main/browserView/browserVideoRecorder.js";
import type {
  BrowserTabPageStateRecord,
  BrowserTabShellRecord,
} from "../src/main/browserView/browserTabRecoveryStore.js";

type ScreenshotSurfacePrepareInput = Parameters<BrowserScreenshotSurfaceCoordinator["prepare"]>[0];

interface GuestSpy {
  zoomFactor: number;
  destroyed: boolean;
  attached: boolean;
  url: string;
  title: string;
  loadedUrl: string | null;
  loadUrlError: Error | null;
  reloaded: boolean;
  lastScript: string | null;
  cdpCalls: Array<{ method: string; params?: unknown }>;
  capturePageCalls: number;
  capturePageData: Buffer;
  detachCalls: number;
  closeCalls: number;
  stopCalls: number;
  audible: boolean;
  beingCaptured: boolean;
  historyEntries: Array<{ url: string; title?: string; pageState?: string }>;
  historyActiveIndex: number;
  historyRestoreCalls: Array<{
    entries: Array<{ url: string; title?: string; pageState?: string }>;
    index: number;
  }>;
  historyRestoreErrorBeforeApply: Error | null;
  historyRestoreErrorAfterApply: Error | null;
  sessionRemoveAfterDestroyCalls: number;
  throwOnSessionRemove: boolean;
  
  throwOnDebuggerDetach: Error | null;
  
  debuggerRemoveAfterDestroyCalls: number;
  
  throwOnDebuggerRemove: boolean;
  viewport: { width: number; height: number };
}

const SNAPSHOT_RESULT = {
  url: "https://x",
  title: "X",
  truncated: false,
  elements: [
    {
      ref: "e1",
      tag: "button",
      selector: "button",
      xpath: "/button",
      rect: { x: 0, y: 0, width: 10, height: 10 },
      inViewport: true,
    },
  ],
};

function pngHeaderBase64(width: number, height: number): string {
  const header = Buffer.alloc(24);
  header.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "ascii");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header.toString("base64");
}

function makeGuest(id: number, spy: GuestSpy) {
  const destroyedListeners: Array<() => void> = [];
  const webContentsListeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const messageListeners: Array<(event: unknown, method: string, params: unknown) => void> = [];
  const downloadListeners: Array<(event: unknown, item: unknown, contents: unknown) => void> = [];
  const guest = {
    id,
    getZoomFactor: () => spy.zoomFactor,
    setZoomFactor: (factor: number) => {
      spy.zoomFactor = factor;
    },
    getType: () => "webview",
    isDestroyed: () => spy.destroyed,
    loadURL: async (url: string) => {
      spy.loadedUrl = url;
      if (spy.loadUrlError) throw spy.loadUrlError;
    },
    getURL: () => spy.url,
    getTitle: () => spy.title,
    reload: () => {
      spy.reloaded = true;
    },
    stop: () => {
      spy.stopCalls += 1;
    },
    executeJavaScript: async (script: string) => {
      spy.lastScript = script;
      if (script === "({ width: window.innerWidth, height: window.innerHeight })") {
        return { ...spy.viewport };
      }
      return SNAPSHOT_RESULT;
    },
    capturePage: async () => {
      spy.capturePageCalls += 1;
      return {
        toPNG: () => spy.capturePageData,
      };
    },
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: () => {},
      goForward: () => {},
      getAllEntries: () => spy.historyEntries.map((entry) => ({ ...entry })),
      getActiveIndex: () => spy.historyActiveIndex,
      restore: async (input: {
        entries: Array<{ url: string; title?: string; pageState?: string }>;
        index: number;
      }) => {
        if (spy.historyRestoreErrorBeforeApply) throw spy.historyRestoreErrorBeforeApply;
        spy.historyRestoreCalls.push({
          entries: input.entries.map((entry) => ({ ...entry })),
          index: input.index,
        });
        spy.historyEntries = input.entries.map((entry) => ({ ...entry }));
        spy.historyActiveIndex = input.index;
        spy.url = input.entries[input.index]?.url ?? spy.url;
        if (spy.historyRestoreErrorAfterApply) throw spy.historyRestoreErrorAfterApply;
      },
    },
    isCurrentlyAudible: () => spy.audible,
    isBeingCaptured: () => spy.beingCaptured,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      const listeners = webContentsListeners.get(event) ?? [];
      listeners.push(listener);
      webContentsListeners.set(event, listeners);
    },
    removeListener: (event: string, listener: (...args: unknown[]) => void) => {
      const listeners = webContentsListeners.get(event);
      if (!listeners) return;
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    close: () => {
      spy.closeCalls += 1;
      spy.destroyed = true;
      for (const listener of destroyedListeners) listener();
    },
    debugger: {
      isAttached: () => spy.attached,
      attach: () => {
        spy.attached = true;
      },
      detach: () => {
        spy.detachCalls += 1;
        if (spy.throwOnDebuggerDetach) throw spy.throwOnDebuggerDetach;
        spy.attached = false;
      },
      sendCommand: async (method: string, params?: unknown) => {
        if (!spy.attached) throw new Error("This method must be called after debugger is attached");
        spy.cdpCalls.push({ method, params });
        if (method === "Emulation.setDeviceMetricsOverride") {
          const metrics = params as { width: number; height: number };
          spy.viewport = { width: metrics.width, height: metrics.height };
        } else if (method === "Emulation.clearDeviceMetricsOverride") {
          spy.viewport = { width: 800, height: 600 };
        } else if (method === "Page.getLayoutMetrics") {
          return {
            visualViewport: {
              pageX: 0,
              pageY: 0,
              clientWidth: spy.viewport.width * 2,
              clientHeight: spy.viewport.height * 2,
            },
            cssVisualViewport: {
              pageX: 0,
              pageY: 0,
              clientWidth: spy.viewport.width,
              clientHeight: spy.viewport.height,
            },
          };
        }
        return { data: "PNGDATA" };
      },
      on: (_event: string, listener: (event: unknown, method: string, params: unknown) => void) => {
        messageListeners.push(listener);
      },
      removeListener: (
        _event: string,
        listener: (event: unknown, method: string, params: unknown) => void,
      ) => {
        if (spy.destroyed) spy.debuggerRemoveAfterDestroyCalls += 1;
        if (spy.throwOnDebuggerRemove) throw new TypeError("Object has been destroyed");
        const index = messageListeners.indexOf(listener);
        if (index >= 0) messageListeners.splice(index, 1);
      },
    },
    session: {
      on: (
        _event: string,
        listener: (event: unknown, item: unknown, contents: unknown) => void,
      ) => {
        downloadListeners.push(listener);
      },
      removeListener: (
        _event: string,
        listener: (event: unknown, item: unknown, contents: unknown) => void,
      ) => {
        if (spy.destroyed) {
          spy.sessionRemoveAfterDestroyCalls += 1;
          throw new TypeError("Object has been destroyed");
        }
        if (spy.throwOnSessionRemove) throw new TypeError("Object has been destroyed");
        const index = downloadListeners.indexOf(listener);
        if (index >= 0) downloadListeners.splice(index, 1);
      },
    },
    once: (_event: string, listener: () => void) => {
      destroyedListeners.push(listener);
    },
    
    __emitDestroyed: () => {
      spy.destroyed = true;
      for (const l of destroyedListeners) l();
    },
    
    __emitCdpMessage: (method: string, params: unknown) => {
      for (const l of messageListeners) l({}, method, params);
    },
    
    __cdpMessageListenerCount: () => messageListeners.length,
    __emitDownload: (path: string, state = "completed") => {
      const doneListeners: Array<(event: unknown, state: string) => void> = [];
      const item = {
        getSavePath: () => path,
        once: (_event: string, listener: (event: unknown, state: string) => void) => {
          doneListeners.push(listener);
        },
      };
      for (const listener of downloadListeners) listener({}, item, guest);
      for (const listener of doneListeners) listener({}, state);
    },
    __emitWebContentsEvent: (event: string, ...args: unknown[]) => {
      for (const listener of webContentsListeners.get(event) ?? []) listener(...args);
    },
    
    __webContentsListenerCount: (event: string) => webContentsListeners.get(event)?.length ?? 0,
  };
  return guest;
}

const guestRegistry = new Map<number, ReturnType<typeof makeGuest>>();

function registerGuest(id: number): {
  guest: ReturnType<typeof makeGuest>;
  spy: GuestSpy;
} {
  const spy: GuestSpy = {
    zoomFactor: 1,
    destroyed: false,
    attached: false,
    url: "about:blank",
    title: "",
    loadedUrl: null,
    loadUrlError: null,
    reloaded: false,
    lastScript: null,
    cdpCalls: [],
    capturePageCalls: 0,
    capturePageData: Buffer.from("SURFACE"),
    detachCalls: 0,
    closeCalls: 0,
    stopCalls: 0,
    audible: false,
    beingCaptured: false,
    historyEntries: [],
    historyActiveIndex: 0,
    historyRestoreCalls: [],
    historyRestoreErrorBeforeApply: null,
    historyRestoreErrorAfterApply: null,
    sessionRemoveAfterDestroyCalls: 0,
    throwOnSessionRemove: false,
    throwOnDebuggerDetach: null,
    debuggerRemoveAfterDestroyCalls: 0,
    throwOnDebuggerRemove: false,
    viewport: { width: 800, height: 600 },
  };
  const guest = makeGuest(id, spy);
  guestRegistry.set(id, guest);
  return { guest, spy };
}

function createDeferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function restoredShellRecord(
  tabId: string,
  restoreUrl: string | null = `https://example.com/${tabId}`,
): BrowserTabShellRecord {
  return {
    schemaVersion: 1,
    tabId,
    windowBindingId: null,
    workspaceKey: "/repo",
    sessionId: "session-a",
    browserId: "unclaimed-iab",
    browserGeneration: 0,
    origin: "user",
    lifecycle: "active",
    restoreUrl,
    title: tabId,
    faviconUrl: null,
    viewport: null,
    openedAt: 1,
    lastSelectedAt: null,
    updatedAt: 1,
  };
}

function restoredPageState(tabId: string): BrowserTabPageStateRecord {
  return {
    schemaVersion: 1,
    tabId,
    entries: [
      { url: `https://example.com/${tabId}/first`, pageState: "first-state" },
      { url: `https://example.com/${tabId}`, pageState: "active-state" },
    ],
    activeIndex: 1,
    updatedAt: 1,
  };
}

vi.mock("electron", () => ({
  webContents: {
    fromId: (id: number) => guestRegistry.get(id),
  },
}));

const { BrowserGuestManager, sanitizeBrowserMetaUrl } =
  await import("../src/main/browserView/browserGuestManager.js");

type BrowserGuestManagerInstance = InstanceType<typeof BrowserGuestManager>;

beforeEach(() => {
  guestRegistry.clear();
});

function createReadyScreenshotSurfaceCoordinator() {
  const releases: Array<ReturnType<typeof vi.fn>> = [];
  const coordinator = {
    prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => {
      const release = vi.fn();
      releases.push(release);
      return {
        surfaceScale: 1,
        webContentsId: input.webContentsId,
        viewport: input.viewport,
        release,
      };
    }),
  } satisfies BrowserScreenshotSurfaceCoordinator;
  return { coordinator, releases };
}

describe("BrowserGuestManager", () => {
  it("response meta URL removes credentials, query, and hash", () => {
    expect(sanitizeBrowserMetaUrl("https://user:secret@example.com/private?q=token#fragment")).toBe(
      "https://example.com/private",
    );
    expect(sanitizeBrowserMetaUrl("https://example.com/?q=token#fragment")).toBe(
      "https://example.com",
    );
    expect(sanitizeBrowserMetaUrl("not a URL")).toBeUndefined();
  });

  it("attachGuest 后 execute getState → ok:true state.url 来自 stub guest", async () => {
    const { spy } = registerGuest(1);
    spy.url = "https://example.com";
    spy.title = "Example";
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("k1", 1);
    const r = await mgr.execute("k1", { method: "getState" });
    expect(r.ok).toBe(true);
    expect(r.state?.url).toBe("https://example.com");
    expect(r.state?.title).toBe("Example");
    expect(spy.attached).toBe(true);
  });

  it("BVR01: Asynchronously record actions on the same WebView and return WebM metadata in status", async () => {
    registerGuest(401);
    const { coordinator, releases } = createReadyScreenshotSurfaceCoordinator();
    const onViewportChanged = vi.fn();
    const createRecorder = vi.fn(async ({ outputPath }) => ({
      stop: vi.fn(async () => {
        await import("node:fs/promises").then(({ writeFile }) => writeFile(outputPath, "webm"));
      }),
      cancel: vi.fn(async () => undefined),
    }));
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      onViewportChanged,
      undefined,
      coordinator,
      { recording: { createRecorder } },
    );
    mgr.attachGuest("recording-tab", 401, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    const context = {
      requestId: "recording-start",
      browserId: "unclaimed-iab",
      browserGeneration: 0,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
      clientMode: "desktop-continuous" as const,
    };

    const started = await mgr.execute(context, {
      method: "recordingStart",
      options: {
        viewport: { width: 800, height: 600 },
        settleMs: 100,
        maxDurationMs: 5_000,
        showCursor: false,
        actions: [{ type: "move", x: 200, y: 160, durationMs: 0 }],
      },
      tabId: "recording-tab",
    });
    expect(started.recording).toMatchObject({ status: "running", phase: "preparing" });
    const recordingId = started.recording!.id;

    await vi.waitFor(() => {
      expect(createRecorder).toHaveBeenCalledOnce();
    });
    expect(onViewportChanged).toHaveBeenCalledWith(
      { width: 800, height: 600 },
      expect.objectContaining({ sessionId: "session-a" }),
      "recording-tab",
    );
    expect(coordinator.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        surfaceScaleMode: "unscaled",
        viewport: { width: 800, height: 600 },
      }),
    );

    await vi.waitFor(async () => {
      const status = await mgr.execute(
        { ...context, requestId: "recording-status" },
        { method: "recordingStatus", recordingId, tabId: "recording-tab" },
      );
      expect(status.recording).toMatchObject({
        id: recordingId,
        status: "completed",
        phase: "completed",
        artifact: { mimeType: "video/webm", width: 800, height: 600 },
      });
    });
    expect(createRecorder).toHaveBeenCalledOnce();
    expect(releases[0]).toHaveBeenCalled();
  });

  describe("录制作业的 scope 隔离与生命周期", () => {
    const RECORDING_CONTEXT: BrowserGuestExecutionContext = {
      requestId: "recording-start",
      browserId: "unclaimed-iab",
      browserGeneration: 0,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
      clientMode: "desktop-continuous",
    };

    
    function createRecordingHarness(
      guestId: number,
      options: {
        createRecorder?: BrowserWebmRecorderFactory;
        surface?: { invalidated?: AbortSignal; webContentsIdOffset?: number };
      } = {},
    ) {
      registerGuest(guestId);
      const releases: Array<ReturnType<typeof vi.fn>> = [];
      const coordinator = {
        prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => {
          const release = vi.fn();
          releases.push(release);
          return {
            surfaceScale: 1,
            webContentsId: input.webContentsId + (options.surface?.webContentsIdOffset ?? 0),
            viewport: input.viewport,
            ...(options.surface?.invalidated ? { invalidated: options.surface.invalidated } : {}),
            release,
          };
        }),
      } satisfies BrowserScreenshotSurfaceCoordinator;
      const cancels: Array<ReturnType<typeof vi.fn>> = [];
      const createRecorder = vi.fn(
        options.createRecorder ??
          (async () => {
            const cancel = vi.fn(async () => undefined);
            cancels.push(cancel);
            return {
              stop: vi.fn(() => new Promise<void>(() => undefined)),
              cancel,
            };
          }),
      );
      const mgr = new BrowserGuestManager(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        coordinator,
        { recording: { createRecorder } },
      );
      mgr.attachGuest("record-tab", guestId, {
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
      });
      return { mgr, createRecorder, coordinator, releases, cancels };
    }

    function startRecording(
      mgr: BrowserGuestManagerInstance,
      context: Partial<BrowserGuestExecutionContext> = {},
    ) {
      return mgr.execute(
        { ...RECORDING_CONTEXT, ...context },
        {
          method: "recordingStart",
          options: { settleMs: 30_000, maxDurationMs: 60_000, showCursor: false },
          tabId: "record-tab",
        },
      );
    }

    function readStatus(
      mgr: BrowserGuestManagerInstance,
      recordingId: string,
      context: Partial<BrowserGuestExecutionContext> = {},
      tabId: string | undefined = "record-tab",
    ) {
      return mgr.execute(
        { ...RECORDING_CONTEXT, requestId: `status:${recordingId}`, ...context },
        { method: "recordingStatus", recordingId, ...(tabId ? { tabId } : {}) },
      );
    }

    it("BVR03: Other sessions cannot query another's recording status or retrieve artifacts", async () => {
      const { mgr } = createRecordingHarness(430);
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;

      const foreign = await readStatus(mgr, recordingId, {
        sessionId: "session-b",
      });

      expect(foreign.ok).toBe(false);
      expect(foreign.error).toMatchObject({
        code: "backend_unavailable",
        sideEffect: "none",
      });
      expect(foreign.recording).toBeUndefined();
    });

    it("BVR03: Other sessions cannot cancel another's recording; original job continues running", async () => {
      const { mgr } = createRecordingHarness(431);
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;

      const foreignCancel = await mgr.execute(
        { ...RECORDING_CONTEXT, requestId: "foreign-cancel", sessionId: "session-b" },
        { method: "recordingCancel", recordingId, tabId: "record-tab" },
      );

      expect(foreignCancel.ok).toBe(false);
      expect(foreignCancel.recording).toBeUndefined();
      const owner = await readStatus(mgr, recordingId);
      expect(owner.recording).toMatchObject({ id: recordingId, status: "running" });
    });

    it("BVR03: Same session querying with wrong tabId also fails closed", async () => {
      const { mgr } = createRecordingHarness(432);
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;

      const wrongTab = await readStatus(mgr, recordingId, {}, "other-tab");

      expect(wrongTab.ok).toBe(false);
      expect(wrongTab.error?.message).toContain("does not belong to tab 'other-tab'");
      expect(wrongTab.recording).toBeUndefined();
    });

    it("BVR05: Repeated start on the same tab returns execution_error; first job is unaffected", async () => {
      const { mgr, createRecorder } = createRecordingHarness(433);
      const first = await startRecording(mgr);
      const firstId = first.recording!.id;
      await vi.waitFor(() => {
        expect(createRecorder).toHaveBeenCalledOnce();
      });

      const second = await startRecording(mgr, { requestId: "recording-start-2" });

      expect(second.ok).toBe(false);
      expect(second.error).toMatchObject({ code: "execution_error", sideEffect: "none" });
      expect(second.error?.message).toContain(firstId);
      expect(second.recording).toBeUndefined();
      expect(createRecorder).toHaveBeenCalledOnce();
      const owner = await readStatus(mgr, firstId);
      expect(owner.recording).toMatchObject({ id: firstId, status: "running" });
    });

    it("BVR04: Turn end cancels in-progress recording and releases surface lease", async () => {
      const { mgr, createRecorder, releases, cancels } = createRecordingHarness(434);
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;
      await vi.waitFor(() => {
        expect(createRecorder).toHaveBeenCalledOnce();
      });

      mgr.endTurn(RECORDING_CONTEXT);

      const status = await readStatus(mgr, recordingId);
      expect(status.recording).toMatchObject({
        id: recordingId,
        status: "cancelled",
        phase: "cancelled",
      });
      expect(status.recording?.artifact).toBeUndefined();
      await vi.waitFor(() => {
        expect(cancels[0]).toHaveBeenCalled();
        expect(releases[0]).toHaveBeenCalled();
      });
    });

    it("BVR04: Session close cancels in-progress recording", async () => {
      const { mgr, createRecorder, releases } = createRecordingHarness(435);
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;
      await vi.waitFor(() => {
        expect(createRecorder).toHaveBeenCalledOnce();
      });

      mgr.closeSession(RECORDING_CONTEXT);

      const status = await readStatus(mgr, recordingId);
      expect(status.recording).toMatchObject({ status: "cancelled" });
      await vi.waitFor(() => {
        expect(releases[0]).toHaveBeenCalled();
      });
    });

    it("BVR04: Window close cancels recording under that window", async () => {
      const { mgr, createRecorder, releases } = createRecordingHarness(436);
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;
      await vi.waitFor(() => {
        expect(createRecorder).toHaveBeenCalledOnce();
      });

      mgr.closeWindow(1);

      const status = await readStatus(mgr, recordingId);
      expect(status.recording).toMatchObject({ status: "cancelled" });
      await vi.waitFor(() => {
        expect(releases[0]).toHaveBeenCalled();
      });
    });

    it("BVR07: When recorder is unavailable, job transitions to failed with reason without forging artifacts", async () => {
      const { mgr, releases } = createRecordingHarness(437, {
        createRecorder: async () => {
          throw new Error("Electron WebM recorder failed: Chromium does not support VP8 WebM");
        },
      });
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;

      await vi.waitFor(async () => {
        const status = await readStatus(mgr, recordingId);
        expect(status.recording).toMatchObject({ status: "failed", phase: "failed" });
      });
      const status = await readStatus(mgr, recordingId);
      expect(status.recording?.error).toContain("Chromium does not support VP8 WebM");
      expect(status.recording?.artifact).toBeUndefined();
      await vi.waitFor(() => {
        expect(releases[0]).toHaveBeenCalled();
      });
    });

    it("BVR09: 录制结束后把 tab viewport 恢复成录制前的值", async () => {
      registerGuest(438);
      const { coordinator } = createReadyScreenshotSurfaceCoordinator();
      const onViewportChanged = vi.fn();
      const createRecorder = vi.fn(async ({ outputPath }) => ({
        stop: vi.fn(async () => {
          await import("node:fs/promises").then(({ writeFile }) => writeFile(outputPath, "webm"));
        }),
        cancel: vi.fn(async () => undefined),
      }));
      const mgr = new BrowserGuestManager(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        onViewportChanged,
        undefined,
        coordinator,
        { recording: { createRecorder } },
      );
      mgr.attachGuest("record-tab", 438, {
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
      });
      await mgr.execute(
        { ...RECORDING_CONTEXT, requestId: "viewport-set" },
        { method: "browserViewportSet", width: 1280, height: 720, tabId: "record-tab" },
      );
      onViewportChanged.mockClear();

      const started = await mgr.execute(
        { ...RECORDING_CONTEXT, requestId: "recording-start" },
        {
          method: "recordingStart",
          options: { viewport: { width: 800, height: 600 }, settleMs: 0, showCursor: false },
          tabId: "record-tab",
        },
      );
      const recordingId = started.recording!.id;
      await vi.waitFor(async () => {
        const status = await readStatus(mgr, recordingId);
        expect(status.recording).toMatchObject({ status: "completed" });
      });

      expect(onViewportChanged).toHaveBeenLastCalledWith(
        { width: 1280, height: 720 },
        expect.objectContaining({ sessionId: "session-a" }),
        "record-tab",
      );
    });

    it("BVR02: Surface is invalidated when prepare returns; recording directly fails without starting recorder", async () => {
      const { mgr, createRecorder, releases } = createRecordingHarness(439, {
        surface: { invalidated: AbortSignal.abort(new Error("browser side pane was hidden")) },
      });
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;

      await vi.waitFor(async () => {
        const status = await readStatus(mgr, recordingId);
        expect(status.recording).toMatchObject({ status: "failed" });
      });
      const status = await readStatus(mgr, recordingId);
      expect(status.recording?.error).toContain("browser side pane was hidden");
      expect(status.recording?.artifact).toBeUndefined();
      expect(createRecorder).not.toHaveBeenCalled();
      expect(releases[0]).toHaveBeenCalled();
    });

    it("BVR02: Abort job and release lease when surface is invalidated during recording", async () => {
      const surfaceInvalidation = new AbortController();
      const { mgr, createRecorder, releases, cancels } = createRecordingHarness(440, {
        surface: { invalidated: surfaceInvalidation.signal },
      });
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;
      await vi.waitFor(() => {
        expect(createRecorder).toHaveBeenCalledOnce();
      });

      surfaceInvalidation.abort(new Error("browser side pane was hidden"));

      await vi.waitFor(async () => {
        const status = await readStatus(mgr, recordingId);
        expect(status.recording).toMatchObject({ status: "cancelled" });
      });
      await vi.waitFor(() => {
        expect(cancels[0]).toHaveBeenCalled();
        expect(releases[0]).toHaveBeenCalled();
      });
    });

    it("BVR02: Reject recording when surface points to another webContents, avoiding capturing frames from wrong guest", async () => {
      const { mgr, createRecorder, releases } = createRecordingHarness(441, {
        surface: { webContentsIdOffset: 1 },
      });
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;

      await vi.waitFor(async () => {
        const status = await readStatus(mgr, recordingId);
        expect(status.recording).toMatchObject({ status: "failed" });
      });
      const status = await readStatus(mgr, recordingId);
      expect(status.recording?.error).toContain(
        "browser guest changed while preparing recording surface",
      );
      expect(createRecorder).not.toHaveBeenCalled();
      expect(releases[0]).toHaveBeenCalled();
    });

    it("BVR08: clientMode 也是录制作业的隔离维度，web 远程客户端查不到桌面会话的作业", async () => {
      const { mgr, createRecorder } = createRecordingHarness(442);
      const started = await startRecording(mgr);
      const recordingId = started.recording!.id;
      await vi.waitFor(() => {
        expect(createRecorder).toHaveBeenCalledOnce();
      });

      const remote = await readStatus(mgr, recordingId, {
        clientMode: "web-remote-replayable",
      });

      expect(remote.ok).toBe(false);
      expect(remote.recording).toBeUndefined();
      const owner = await readStatus(mgr, recordingId);
      expect(owner.recording).toMatchObject({ id: recordingId, status: "running" });
    });
  });

  it("attachGuest rejects main renderer WebContents to prevent browser input from writing to composer", async () => {
    const { guest, spy } = registerGuest(206);
    vi.spyOn(guest, "getType").mockReturnValue("window");
    const logs: string[] = [];
    const mgr = new BrowserGuestManager((message) => logs.push(message));

    mgr.attachGuest("renderer-id", 206);
    const result = await mgr.execute("renderer-id", { method: "getState" });

    expect(spy.attached).toBe(false);
    expect(result.ok).toBe(false);
    expect(logs).toContainEqual(expect.stringContaining("reason=not-webview type=window"));
  });

  it("execute navigate 调 guest.loadURL；snapshot 调 guest.executeJavaScript", async () => {
    const { spy } = registerGuest(2);
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("k2", 2);

    const nav = await mgr.execute("k2", {
      method: "navigate",
      url: "https://foo.com",
    });
    expect(nav.ok).toBe(true);
    expect(spy.loadedUrl).toBe("https://foo.com");

    const snap = await mgr.execute("k2", { method: "snapshot" });
    expect(snap.ok).toBe(true);
    expect(spy.lastScript).toContain("__cfRefs");
    expect(snap.snapshot?.elements[0]?.ref).toBe("e1");
  });

  it("Under any Desktop zoom, metrics have no scale, and mouse coordinates are dispatched as-is in CSS px", async () => {
    const { guest, spy } = registerGuest(601);
    const other = registerGuest(602);
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("zoom-tab", 601);
    mgr.attachGuest("other-tab", 602);
    for (const zoom of [1, 1.1, 1.61, 1, 0.826446]) {
      spy.zoomFactor = zoom;
      spy.cdpCalls.length = 0;
      await mgr.updateViewportFromRenderer("zoom-tab", { width: 1280, height: 720 }, 0);
      expect(guest.getZoomFactor()).toBe(1);
      expect(
        spy.cdpCalls.find(({ method }) => method === "Emulation.setDeviceMetricsOverride")?.params,
      ).toEqual({
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
        dontSetVisibleSize: true,
      });
      spy.cdpCalls.length = 0;
      const result = await mgr.execute("zoom-tab", {
        method: "click",
        tabId: "zoom-tab",
        x: 600,
        y: 400,
      });
      expect(result.ok).toBe(true);
      const scale = 1;
      expect(spy.cdpCalls.filter(({ method }) => method === "Input.dispatchMouseEvent")).toEqual([
        {
          method: "Input.dispatchMouseEvent",
          params: { type: "mouseMoved", x: 600 * scale, y: 400 * scale },
        },
        {
          method: "Input.dispatchMouseEvent",
          params: {
            type: "mousePressed",
            x: 600 * scale,
            y: 400 * scale,
            button: "left",
            clickCount: 1,
          },
        },
        {
          method: "Input.dispatchMouseEvent",
          params: {
            type: "mouseReleased",
            x: 600 * scale,
            y: 400 * scale,
            button: "left",
            clickCount: 1,
          },
        },
      ]);
      spy.cdpCalls.length = 0;
      await mgr.execute("zoom-tab", {
        method: "cuaScroll",
        tabId: "zoom-tab",
        x: 600,
        y: 400,
        scrollX: 30,
        scrollY: -80,
        modifiers: ["Shift"],
      });
      expect(spy.cdpCalls).toContainEqual({
        method: "Input.dispatchMouseEvent",
        params: {
          type: "mouseWheel",
          x: 600 * scale,
          y: 400 * scale,
          deltaX: 30 * scale,
          deltaY: -80 * scale,
          modifiers: 8,
        },
      });
      spy.cdpCalls.length = 0;
      const path = [
        { x: 100, y: 100 },
        { x: 160, y: 230 },
        { x: 300, y: 200 },
      ];
      await mgr.execute("zoom-tab", { method: "cuaDrag", tabId: "zoom-tab", path });
      const dragMoves = spy.cdpCalls.filter(
        ({ method, params }) =>
          method === "Input.dispatchMouseEvent" &&
          (params as { type: string }).type === "mouseMoved",
      );
      expect(
        dragMoves.map(({ params }) => {
          const event = params as { x: number; y: number };
          return [event.x, event.y];
        }),
      ).toEqual(path.map(({ x, y }) => [x * scale, y * scale]));
    }
    await mgr.execute("other-tab", { method: "click", tabId: "other-tab", x: 600, y: 400 });
    expect(other.spy.cdpCalls).toContainEqual({
      method: "Input.dispatchMouseEvent",
      params: { type: "mouseMoved", x: 600, y: 400 },
    });
    mgr.closeWindow(0);
  });

  it("First screenshot after idle restores metrics and guest zoom within viewport critical section before reading image dimensions", async () => {
    const { guest, spy } = registerGuest(603);
    const { coordinator } = createReadyScreenshotSurfaceCoordinator();
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("zoom-shot", 603);
    await mgr.updateViewportFromRenderer("zoom-shot", { width: 1280, height: 720 }, 0);
    guest.debugger.detach();
    spy.viewport = { width: 1408, height: 792 };
    spy.zoomFactor = 1.1;
    spy.cdpCalls.length = 0;
    const result = await mgr.execute("zoom-shot", { method: "screenshot" });
    expect(result.ok).toBe(true);
    expect(guest.getZoomFactor()).toBe(1);
    const methods = spy.cdpCalls.map(({ method }) => method);
    expect(methods.indexOf("Emulation.setDeviceMetricsOverride")).toBeGreaterThan(-1);
    expect(methods.indexOf("Page.getLayoutMetrics")).toBeGreaterThan(
      methods.indexOf("Emulation.setDeviceMetricsOverride"),
    );
    expect(spy.cdpCalls).toContainEqual({
      method: "Page.captureScreenshot",
      params: {
        format: "png",
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 1280, height: 720, scale: 1 },
      },
    });
    mgr.closeWindow(0);
  });

  it.each([0.5, 1])(
    "Native screenshot with surfaceScale=%s on desktop zoom restores metrics first to avoid CDP tiling downscaled raster",
    async (surfaceScale) => {
      const { guest, spy } = registerGuest(604);
      const { coordinator } = createReadyScreenshotSurfaceCoordinator();
      coordinator.prepare.mockImplementation(async (input) => {
        return {
          surfaceScale,
          webContentsId: input.webContentsId,
          viewport: input.viewport,
          release: vi.fn(),
        };
      });
      const mgr = new BrowserGuestManager(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        () => "FIT_PNG",
        coordinator,
      );
      Object.defineProperty(guest, "hostWebContents", { value: { getZoomFactor: () => 1.1 } });
      mgr.attachGuest("fit-shot", 604);
      await mgr.updateViewportFromRenderer("fit-shot", { width: 1280, height: 720 }, 0);
      guest.debugger.detach();
      spy.viewport = { width: 1408, height: 792 };
      spy.zoomFactor = 1.1;
      spy.cdpCalls.length = 0;
      const capture = guest.capturePage;
      guest.capturePage = async () => {
        expect(spy.viewport).toEqual({ width: 1280, height: 720 });
        return capture();
      };
      const result = await mgr.execute("fit-shot", { method: "screenshot" });
      expect(result).toMatchObject({ ok: true, image: { base64: "FIT_PNG" } });
      expect(
        spy.cdpCalls.some(({ method }) => method === "Emulation.setDeviceMetricsOverride"),
      ).toBe(true);
      expect(spy.cdpCalls.some(({ method }) => method === "Page.captureScreenshot")).toBe(false);
      mgr.closeWindow(0);
    },
  );

  it("Natural screenshot does not install metrics and distinguishes between natural and explicit viewport for renderer", async () => {
    const { guest, spy } = registerGuest(606);
    const { coordinator } = createReadyScreenshotSurfaceCoordinator();
    const prepare = vi.spyOn(coordinator, "prepare");
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("natural-shot", guest.id);
    await expect(mgr.execute("natural-shot", { method: "screenshot" })).resolves.toMatchObject({
      ok: true,
    });
    expect(prepare).toHaveBeenLastCalledWith(expect.objectContaining({ viewportMode: "natural" }));
    expect(spy.cdpCalls.some(({ method }) => method === "Emulation.setDeviceMetricsOverride")).toBe(
      false,
    );
    await mgr.updateViewportFromRenderer("natural-shot", { width: 1280, height: 720 }, 0);
    await expect(mgr.execute("natural-shot", { method: "screenshot" })).resolves.toMatchObject({
      ok: true,
    });
    expect(prepare).toHaveBeenLastCalledWith(expect.objectContaining({ viewportMode: "emulated" }));
    mgr.closeWindow(0);
  });

  it.each(["replacement", "destroyed"] as const)(
    "Natural guest does not inherit old fallback metrics scale after %s",
    async (mode) => {
      const old = registerGuest(607);
      const next = registerGuest(608);
      Object.defineProperty(old.guest, "hostWebContents", {
        value: { getZoomFactor: () => 1.1 },
      });
      const { coordinator } = createReadyScreenshotSurfaceCoordinator();
      const mgr = new BrowserGuestManager(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        () => "FALLBACK_PNG",
        coordinator,
      );
      try {
        old.spy.viewport = { width: 0, height: 0 };
        mgr.attachGuest("replacement-scale", old.guest.id, { active: false });
        await expect(
          mgr.execute("replacement-scale", { method: "screenshot" }),
        ).resolves.toMatchObject({ ok: true });
        const fallbackMetrics = old.spy.cdpCalls.find(
          ({ method }) => method === "Emulation.setDeviceMetricsOverride",
        );
        expect(fallbackMetrics).toBeDefined();
        expect(fallbackMetrics?.params).not.toHaveProperty("scale");
        if (mode === "destroyed") old.guest.__emitDestroyed();
        expect(mgr.attachGuest("replacement-scale", next.guest.id, { active: true }).ok).toBe(true);
        next.guest.debugger.detach();
        await expect(
          mgr.execute("replacement-scale", { method: "click", x: 300, y: 200 }),
        ).resolves.toMatchObject({ ok: true });
        expect(next.spy.cdpCalls.filter(({ method }) => method.startsWith("Emulation."))).toEqual(
          [],
        );
        expect(
          next.spy.cdpCalls.find(({ method }) => method === "Input.dispatchMouseEvent")?.params,
        ).toEqual({ type: "mouseMoved", x: 300, y: 200 });
      } finally {
        mgr.closeWindow(0);
      }
    },
  );

  it("Standard fallback metrics omit scale after zoom, warm screenshot, and idle reconnect; inputs are not scaled", async () => {
    const { guest, spy } = registerGuest(605);
    let desktopZoom = 1.1;
    Object.defineProperty(guest, "hostWebContents", {
      value: { getZoomFactor: () => desktopZoom },
    });
    const { coordinator } = createReadyScreenshotSurfaceCoordinator();
    const prepare = vi.spyOn(coordinator, "prepare");
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => "FALLBACK_PNG",
      coordinator,
    );
    spy.viewport = { width: 1280, height: 720 };
    mgr.attachGuest("fallback-zoom", guest.id, { active: false });
    await expect(mgr.execute("fallback-zoom", { method: "screenshot" })).resolves.toMatchObject({
      ok: true,
    });
    spy.viewport = { width: 0, height: 0 };
    for (const phase of ["initial", "hot", "reattach", "reset", "shrink"] as const) {
      if (phase === "hot") desktopZoom = 1.21;
      if (phase === "reattach") guest.debugger.detach();
      if (phase === "reset") desktopZoom = 1;
      if (phase === "shrink") desktopZoom = 1 / 1.21;
      const nativeCapture = desktopZoom > 1;
      spy.zoomFactor = desktopZoom;
      spy.cdpCalls.length = 0;
      const result = await mgr.execute("fallback-zoom", { method: "screenshot" });
      expect(result).toMatchObject({
        ok: true,
        image: { base64: nativeCapture ? "FALLBACK_PNG" : "PNGDATA" },
      });
      expect(prepare).toHaveBeenLastCalledWith(
        expect.objectContaining({ viewportMode: "emulated" }),
      );
      const metricsCalls = spy.cdpCalls.filter(
        ({ method }) => method === "Emulation.setDeviceMetricsOverride",
      );
      if (phase === "initial" || phase === "reattach") {
        expect(metricsCalls.at(-1)?.params).toMatchObject({ width: 1280, height: 720 });
      }
      for (const { params } of metricsCalls) expect(params).not.toHaveProperty("scale");
      expect(spy.zoomFactor).toBe(1);
      expect(spy.cdpCalls.some(({ method }) => method === "Page.captureScreenshot")).toBe(
        !nativeCapture,
      );
      await expect(
        mgr.execute("fallback-zoom", { method: "click", x: 1000, y: 600 }),
      ).resolves.toMatchObject({ ok: true });
      expect(spy.cdpCalls).toContainEqual({
        method: "Input.dispatchMouseEvent",
        params: { type: "mouseMoved", x: 1000, y: 600 },
      });
    }
    mgr.closeWindow(0);
  });

  it("Explicit screenshot returns image only without generating tool panel preview meta", async () => {
    registerGuest(205);
    const { coordinator } = createReadyScreenshotSurfaceCoordinator();
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("screenshot-tab", 205);
    const result = await mgr.execute("screenshot-tab", {
      method: "screenshot",
    });
    expect(result.image?.base64).toBe("PNGDATA");
    expect(result.meta).not.toHaveProperty("previewImage");
  });

  it("Background screenshot enters CDP only after prepare is ready, and releases after settling", async () => {
    const { guest } = registerGuest(209);
    const order: string[] = [];
    const release = vi.fn(() => order.push("release"));
    const coordinator = {
      prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => {
        order.push("prepare");
        expect(input).toEqual(
          expect.objectContaining({
            requestId: expect.stringMatching(/^legacy:/),
            windowId: 0,
            tabId: "tab-209",
            webContentsId: 209,
            viewport: { width: 800, height: 600 },
            signal: expect.any(AbortSignal),
          }),
        );
        return {
          surfaceScale: 1,
          webContentsId: 209,
          viewport: { width: 800, height: 600 },
          release,
        };
      }),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const sendCommand = guest.debugger.sendCommand;
    guest.debugger.sendCommand = async (method, params) => {
      if (method === "Page.captureScreenshot") order.push("capture");
      return sendCommand(method, params);
    };
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("tab-209", 209);

    await expect(mgr.execute("tab-209", { method: "screenshot" })).resolves.toMatchObject({
      ok: true,
      image: { base64: "PNGDATA" },
    });
    expect(order).toEqual(["prepare", "capture", "release"]);
  });

  it("Fit surface 截图使用 main guest capturePage，并按逻辑 viewport 归一化", async () => {
    const { spy } = registerGuest(218);
    const order: string[] = [];
    const release = vi.fn(() => order.push("release"));
    const resizeScreenshotToCssPixels = vi.fn(() => {
      order.push("resize");
      return "SURFACE_RESIZED";
    });
    const coordinator = {
      prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => {
        order.push("prepare");
        return {
          surfaceScale: 0.625,
          webContentsId: input.webContentsId,
          viewport: input.viewport,
          release,
        };
      }),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resizeScreenshotToCssPixels,
      coordinator,
    );
    mgr.attachGuest("tab-218", 218);
    await mgr.updateViewportFromRenderer("tab-218", { width: 1280, height: 720 }, 0);
    spy.cdpCalls.length = 0;

    await expect(mgr.execute("tab-218", { method: "screenshot" })).resolves.toMatchObject({
      ok: true,
      image: { base64: "SURFACE_RESIZED" },
    });
    expect(spy.capturePageCalls).toBe(1);
    expect(resizeScreenshotToCssPixels).toHaveBeenCalledWith(
      Buffer.from("SURFACE").toString("base64"),
      { width: 1280, height: 720 },
    );
    expect(spy.cdpCalls.some(({ method }) => method === "Page.captureScreenshot")).toBe(false);
    expect(spy.cdpCalls.some(({ method }) => method === "Emulation.setDeviceMetricsOverride")).toBe(
      false,
    );
    expect(order).toEqual(["prepare", "resize", "release"]);
  });

  it("Surface lease is still released when main capturePage fails on fit surface", async () => {
    const { guest } = registerGuest(219);
    const release = vi.fn();
    const coordinator = {
      prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => ({
        surfaceScale: 0.625,
        webContentsId: input.webContentsId,
        viewport: input.viewport,
        release,
      })),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      vi.fn(() => "UNUSED"),
      coordinator,
    );
    mgr.attachGuest("tab-219", 219);
    await mgr.updateViewportFromRenderer("tab-219", { width: 1280, height: 720 }, 0);

    guest.capturePage = async () => {
      throw new Error("capturePage failed");
    };

    await expect(mgr.execute("tab-219", { method: "screenshot" })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "execution_error",
        message: expect.stringContaining("capturePage failed"),
      },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("CSS 像素修正完成前保留 lease，完成后才 release", async () => {
    const { guest } = registerGuest(216);
    const release = vi.fn();
    let resolveResize!: (data: string) => void;
    const resizeScreenshotToCssPixels = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveResize = resolve;
        }),
    );
    const coordinator = {
      prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => ({
        surfaceScale: 1,
        webContentsId: input.webContentsId,
        viewport: input.viewport,
        release,
      })),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resizeScreenshotToCssPixels,
      coordinator,
    );
    mgr.attachGuest("tab-216", 216);
    await expect(
      mgr.execute("tab-216", {
        method: "browserViewportSet",
        tabId: "tab-216",
        width: 800,
        height: 600,
      }),
    ).resolves.toMatchObject({ ok: true });

    const sendCommand = guest.debugger.sendCommand;
    guest.debugger.sendCommand = async (method, params) => {
      if (method === "Page.captureScreenshot") return { data: pngHeaderBase64(1600, 1200) };
      return sendCommand(method, params);
    };
    const pending = mgr.execute("tab-216", {
      method: "screenshot",
      tabId: "tab-216",
    });
    await vi.waitFor(() => expect(resizeScreenshotToCssPixels).toHaveBeenCalledOnce());
    expect(release).not.toHaveBeenCalled();

    resolveResize(pngHeaderBase64(800, 600));
    await expect(pending).resolves.toMatchObject({
      ok: true,
      image: { base64: pngHeaderBase64(800, 600) },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("Fall back to original screenshot when CSS pixel correction rejects, and release after settling", async () => {
    const { guest } = registerGuest(217);
    const release = vi.fn();
    let rejectResize!: (error: Error) => void;
    const resizeScreenshotToCssPixels = vi.fn(
      () =>
        new Promise<string>((_resolve, reject) => {
          rejectResize = reject;
        }),
    );
    const coordinator = {
      prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => ({
        surfaceScale: 1,
        webContentsId: input.webContentsId,
        viewport: input.viewport,
        release,
      })),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resizeScreenshotToCssPixels,
      coordinator,
    );
    mgr.attachGuest("tab-217", 217);
    await expect(
      mgr.execute("tab-217", {
        method: "browserViewportSet",
        tabId: "tab-217",
        width: 800,
        height: 600,
      }),
    ).resolves.toMatchObject({ ok: true });

    const originalScreenshot = pngHeaderBase64(1600, 1200);
    const sendCommand = guest.debugger.sendCommand;
    guest.debugger.sendCommand = async (method, params) => {
      if (method === "Page.captureScreenshot") return { data: originalScreenshot };
      return sendCommand(method, params);
    };
    const pending = mgr.execute("tab-217", {
      method: "screenshot",
      tabId: "tab-217",
    });
    await vi.waitFor(() => expect(resizeScreenshotToCssPixels).toHaveBeenCalledOnce());
    expect(release).not.toHaveBeenCalled();

    rejectResize(new Error("resize failed"));
    await expect(pending).resolves.toMatchObject({
      ok: true,
      image: { base64: originalScreenshot },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("Prepared surface is still released after CDP screenshot error", async () => {
    const { guest } = registerGuest(215);
    const release = vi.fn();
    const resizeScreenshotToCssPixels = vi.fn();
    guest.debugger.sendCommand = async (method: string, params?: unknown) => {
      if (method === "Page.captureScreenshot") throw new Error("capture failed");
      return { data: "PNGDATA", params };
    };
    const coordinator = {
      prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => ({
        surfaceScale: 1,
        webContentsId: input.webContentsId,
        viewport: input.viewport,
        release,
      })),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      resizeScreenshotToCssPixels,
      coordinator,
    );
    mgr.attachGuest("tab-215", 215);

    await expect(mgr.execute("tab-215", { method: "screenshot" })).resolves.toMatchObject({
      ok: false,
      error: { code: "execution_error" },
    });
    expect(release).toHaveBeenCalledOnce();
    expect(resizeScreenshotToCssPixels).not.toHaveBeenCalled();
  });

  function createHiddenOwnerWindowHarness(): {
    calls: string[];
    win: {
      isDestroyed(): boolean;
      isVisible(): boolean;
      isMinimized(): boolean;
      isFocused(): boolean;
      getOpacity(): number;
      setOpacity(opacity: number): void;
      setSkipTaskbar(skip: boolean): void;
      showInactive(): void;
      hide(): void;
      on(event: "focus", listener: () => void): void;
      removeListener(event: "focus", listener: () => void): void;
    };
  } {
    let opacity = 0.72;
    let visible = false;
    const calls: string[] = [];
    const focusListeners: Array<() => void> = [];
    return {
      calls,
      win: {
        isDestroyed: () => false,
        isVisible: () => visible,
        isMinimized: () => false,
        isFocused: () => false,
        getOpacity: () => opacity,
        setOpacity: (next: number) => {
          calls.push(`opacity:${next}`);
          opacity = next;
        },
        setSkipTaskbar: (skip: boolean) => {
          calls.push(`skipTaskbar:${skip}`);
        },
        showInactive: () => {
          calls.push("showInactive");
          visible = true;
        },
        hide: () => {
          calls.push("hide");
          visible = false;
        },
        on: (event: "focus", listener: () => void) => {
          if (event === "focus") focusListeners.push(listener);
        },
        removeListener: (event: "focus", listener: () => void) => {
          if (event !== "focus") return;
          const index = focusListeners.indexOf(listener);
          if (index >= 0) focusListeners.splice(index, 1);
        },
      },
    };
  }

  function createHiddenWindowScreenshotManager(
    tabWebContentsId: number,
    owner: ReturnType<typeof createHiddenOwnerWindowHarness>,
    guest?: ReturnType<typeof makeGuest>,
  ) {
    const release = vi.fn();
    const coordinator = {
      prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => ({
        surfaceScale: 1,
        webContentsId: input.webContentsId,
        viewport: input.viewport,
        release,
      })),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
      undefined,
      () => owner.win,
    );
    mgr.attachGuest(`tab-${tabWebContentsId}`, tabWebContentsId);
    return { mgr, release, guest };
  }

  it("Hold transparent presentation during hidden window screenshot, restore hidden state after capture settles", async () => {
    registerGuest(230);
    const owner = createHiddenOwnerWindowHarness();
    const { mgr } = createHiddenWindowScreenshotManager(230, owner);

    await expect(mgr.execute("tab-230", { method: "screenshot" })).resolves.toMatchObject({
      ok: true,
    });

    const calls = owner.calls.filter((call) => !call.startsWith("skipTaskbar"));
    expect(calls[0]).toBe("opacity:0");
    expect(calls[1]).toBe("showInactive");
    expect(calls[calls.length - 2]).toBe("hide");
    expect(calls[calls.length - 1]).toBe("opacity:0.72");
    expect(owner.win.isVisible()).toBe(false);
  });

  it("Full-frame capture under transparent presentation fails fast and restores window if deadline exceeded", async () => {
    vi.useFakeTimers();
    const { guest } = registerGuest(231);
    const owner = createHiddenOwnerWindowHarness();
    const originalSendCommand = guest.debugger.sendCommand;
    guest.debugger.sendCommand = ((method: string, params?: unknown) => {
      if (method === "Page.captureScreenshot") {
        return new Promise<never>(() => undefined);
      }
      return originalSendCommand(method, params);
    }) as typeof guest.debugger.sendCommand;
    const { mgr } = createHiddenWindowScreenshotManager(231, owner, guest);

    const pending = mgr.execute("tab-231", { method: "screenshot" });
    await vi.advanceTimersByTimeAsync(6_000);
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: {
        code: "timeout",
        message: expect.stringContaining("window was hidden"),
      },
    });

    const calls = owner.calls.filter((call) => !call.startsWith("skipTaskbar"));
    expect(calls).toEqual(["opacity:0", "showInactive", "hide", "opacity:0.72"]);
    expect(owner.win.isVisible()).toBe(false);
    vi.useRealTimers();
  });

  it("透明 presentation 后先等 compositor grace 再发起 capture", async () => {
    vi.useFakeTimers();
    const { spy } = registerGuest(233);
    const owner = createHiddenOwnerWindowHarness();
    const { mgr } = createHiddenWindowScreenshotManager(233, owner);

    const pending = mgr.execute("tab-233", { method: "screenshot" });
    for (let index = 0; index < 99 && !owner.calls.includes("showInactive"); index += 1) {
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(owner.calls).toContain("showInactive");
    expect(spy.cdpCalls.some((call) => call.method === "Page.captureScreenshot")).toBe(false);

    await vi.advanceTimersByTimeAsync(120);
    expect(spy.cdpCalls.some((call) => call.method === "Page.captureScreenshot")).toBe(true);
    await expect(pending).resolves.toMatchObject({ ok: true });
    vi.useRealTimers();
  });

  it("Aborting hung capture lets mutation settle, preventing subsequent screenshots from being poisoned by in-flight/queue", async () => {
    const { guest, spy } = registerGuest(232);
    const release = vi.fn();
    const coordinator = {
      prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => ({
        surfaceScale: 1,
        webContentsId: input.webContentsId,
        viewport: input.viewport,
        release,
      })),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("tab-232", 232);
    const originalSendCommand = guest.debugger.sendCommand;
    let captureDispatched = false;
    guest.debugger.sendCommand = ((method: string, params?: unknown) => {
      if (method === "Page.captureScreenshot") {
        captureDispatched = true;
        return new Promise<never>(() => undefined);
      }
      return originalSendCommand(method, params);
    }) as typeof guest.debugger.sendCommand;

    const controller = new AbortController();
    const first = mgr.execute("tab-232", { method: "screenshot" }, controller.signal);
    await vi.waitFor(() => expect(captureDispatched).toBe(true));
    controller.abort();
    await expect(first).resolves.toMatchObject({ ok: false });
    expect(release).toHaveBeenCalledOnce();

    guest.debugger.sendCommand = originalSendCommand;
    await expect(mgr.execute("tab-232", { method: "screenshot" })).resolves.toMatchObject({
      ok: true,
    });
    expect(release).toHaveBeenCalledTimes(2);
    expect(spy.capturePageCalls).toBe(0);
  });

  it("Consecutive hung captures fast-reject upon reaching hard limit, auto-recovering once old capture settles", async () => {
    const registered = registerGuest(234);
    const logs: string[] = [];
    const lateCaptures: Array<(data: string) => void> = [];
    let captureMode: "hang" | "ok" = "hang";
    let screenshotDispatches = 0;
    registered.guest.debugger.sendCommand = (async (method: string, params?: unknown) => {
      registered.spy.cdpCalls.push({ method, params });
      if (method !== "Page.captureScreenshot") return { data: "PNGDATA" };
      screenshotDispatches += 1;
      if (captureMode === "ok") return { data: "RECOVERED" };
      return new Promise<{ data: string }>((resolve) => {
        lateCaptures.push(resolve);
      });
    }) as typeof registered.guest.debugger.sendCommand;
    const { coordinator } = createReadyScreenshotSurfaceCoordinator();
    const mgr = new BrowserGuestManager(
      (message) => logs.push(message),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("tab-234", 234);

    for (let index = 0; index < 3; index += 1) {
      const controller = new AbortController();
      const pending = mgr.execute("tab-234", { method: "screenshot" }, controller.signal);
      await vi.waitFor(() => expect(screenshotDispatches).toBe(index + 1));
      controller.abort();
      await expect(pending).resolves.toMatchObject({ ok: false });
    }

    await expect(mgr.execute("tab-234", { method: "screenshot" })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "timeout",
        message: expect.stringContaining("Reopen the tab"),
      },
    });
    expect(screenshotDispatches).toBe(3);
    expect(logs).toContainEqual(expect.stringContaining("abandonedCaptures=3"));

    captureMode = "ok";
    for (const resolveLateCapture of lateCaptures.splice(0)) resolveLateCapture("LATE");
    await vi.waitFor(() =>
      expect(mgr.execute("tab-234", { method: "screenshot" })).resolves.toMatchObject({
        ok: true,
      }),
    );
    expect(screenshotDispatches).toBeGreaterThan(3);
  });

  it("closeWindow 清理 per-tab 截图状态，复用 tabId 的新 tab 不继承 abandoned 计数", async () => {
    const registered = registerGuest(235);
    const lateCaptures: Array<() => void> = [];
    registered.guest.debugger.sendCommand = (async (method: string, params?: unknown) => {
      registered.spy.cdpCalls.push({ method, params });
      if (method !== "Page.captureScreenshot") return { data: "PNGDATA" };
      return new Promise<never>((_resolve, _reject) => {
        lateCaptures.push(() => {});
      });
    }) as typeof registered.guest.debugger.sendCommand;
    const { coordinator } = createReadyScreenshotSurfaceCoordinator();
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("tab-235", 235);

    for (let index = 0; index < 3; index += 1) {
      const controller = new AbortController();
      const pending = mgr.execute("tab-235", { method: "screenshot" }, controller.signal);
      await vi.waitFor(() => expect(lateCaptures.length).toBe(index + 1));
      controller.abort();
      await expect(pending).resolves.toMatchObject({ ok: false });
    }

    mgr.closeWindow(0);

    const reused = registerGuest(236);
    mgr.attachGuest("tab-235", 236);
    reused.guest.debugger.sendCommand = (async (method: string, params?: unknown) => {
      reused.spy.cdpCalls.push({ method, params });
      return { data: "PNGDATA" };
    }) as typeof reused.guest.debugger.sendCommand;
    await expect(mgr.execute("tab-235", { method: "screenshot" })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("Return backend_unavailable and do not call Page.captureScreenshot if prepare fails", async () => {
    const { spy } = registerGuest(210);
    const coordinator = {
      prepare: vi.fn(async () => {
        throw new Error("surface unavailable");
      }),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("tab-210", 210);

    await expect(mgr.execute("tab-210", { method: "screenshot" })).resolves.toMatchObject({
      ok: false,
      error: { code: "backend_unavailable", sideEffect: "none" },
    });
    expect(spy.cdpCalls.some((call) => call.method === "Page.captureScreenshot")).toBe(false);
  });

  it("Screenshot surface prepare acquires activity only after existing viewport mutation completes", async () => {
    const { guest } = registerGuest(220);
    let resolveViewportMutation!: () => void;
    const originalSendCommand = guest.debugger.sendCommand;
    guest.debugger.sendCommand = async (method, params) => {
      if (method === "Emulation.setDeviceMetricsOverride") {
        await new Promise<void>((resolve) => {
          resolveViewportMutation = resolve;
        });
      }
      return originalSendCommand(method, params);
    };
    const { coordinator } = createReadyScreenshotSurfaceCoordinator();
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("tab-220", 220);
    const viewportMutation = mgr.updateViewportFromRenderer(
      "tab-220",
      { width: 1280, height: 720 },
      0,
    );
    await vi.waitFor(() => expect(resolveViewportMutation).toBeDefined());

    const screenshot = mgr.execute("tab-220", { method: "screenshot" });
    await Promise.resolve();
    await Promise.resolve();
    expect(coordinator.prepare).not.toHaveBeenCalled();

    resolveViewportMutation();
    await viewportMutation;
    await expect(screenshot).resolves.toMatchObject({ ok: true });
    expect(coordinator.prepare).toHaveBeenCalledOnce();
  });

  it("Do not return late successful screenshot if activity is invalidated after Ready", async () => {
    const { guest } = registerGuest(221);
    let resolveScreenshot!: () => void;
    const originalSendCommand = guest.debugger.sendCommand;
    guest.debugger.sendCommand = async (method, params) => {
      if (method === "Page.captureScreenshot") {
        await new Promise<void>((resolve) => {
          resolveScreenshot = resolve;
        });
        return { data: "LATE_PNG" };
      }
      return originalSendCommand(method, params);
    };
    const activityController = new AbortController();
    const release = vi.fn();
    const coordinator = {
      prepare: vi.fn(async (input: ScreenshotSurfacePrepareInput) => ({
        invalidated: activityController.signal,
        surfaceScale: 1,
        webContentsId: input.webContentsId,
        viewport: input.viewport,
        release,
      })),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("tab-221", 221);
    const pending = mgr.execute("tab-221", { method: "screenshot" });
    await vi.waitFor(() => expect(resolveScreenshot).toBeDefined());

    activityController.abort(new Error("browser screenshot activity capture failed"));
    resolveScreenshot();
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: {
        code: "backend_unavailable",
        message: expect.stringContaining("activity capture failed"),
        sideEffect: "none",
      },
    });
    expect(release).toHaveBeenCalledOnce();
  });

  it("Abort during prepare returns cancelled, coordinator receives the same signal", async () => {
    registerGuest(211);
    let observedSignal: AbortSignal | undefined;
    const coordinator = {
      prepare: vi.fn(
        ({ signal }: ScreenshotSurfacePrepareInput) =>
          new Promise<never>((_resolve, reject) => {
            observedSignal = signal;
            signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
          }),
      ),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("tab-211", 211);
    const controller = new AbortController();
    const pending = mgr.execute("tab-211", { method: "screenshot" }, controller.signal);
    await vi.waitFor(() => expect(observedSignal).toBeDefined());
    controller.abort();

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled", sideEffect: "none" },
    });
    expect(observedSignal?.aborted).toBe(true);
  });

  it("guest replacement during prepare releases old lease and captures neither guest", async () => {
    const first = registerGuest(213);
    const second = registerGuest(214);
    let resolvePrepare!: (lease: {
      surfaceScale: number;
      webContentsId: number;
      viewport: { width: number; height: number };
      release(): void;
    }) => void;
    const release = vi.fn();
    const coordinator = {
      prepare: vi.fn(
        () =>
          new Promise<{
            surfaceScale: number;
            webContentsId: number;
            viewport: { width: number; height: number };
            release(): void;
          }>((resolve) => {
            resolvePrepare = resolve;
          }),
      ),
    } satisfies BrowserScreenshotSurfaceCoordinator;
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("tab-213", 213);
    const pending = mgr.execute("tab-213", { method: "screenshot" });
    await vi.waitFor(() => expect(coordinator.prepare).toHaveBeenCalledOnce());
    mgr.attachGuest("tab-213", 214);
    resolvePrepare({
      surfaceScale: 1,
      webContentsId: 213,
      viewport: { width: 800, height: 600 },
      release,
    });

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "backend_unavailable", sideEffect: "none" },
    });
    expect(release).toHaveBeenCalledOnce();
    expect(first.spy.cdpCalls.some((call) => call.method === "Page.captureScreenshot")).toBe(false);
    expect(second.spy.cdpCalls.some((call) => call.method === "Page.captureScreenshot")).toBe(
      false,
    );
  });

  it("Immediately release surface and in-flight after screenshot abort; same-tab re-entry is no longer poisoned", async () => {
    const registered = registerGuest(207);
    const logs: string[] = [];
    let resolveFirstScreenshot!: () => void;
    let screenshotDispatches = 0;
    registered.guest.debugger.sendCommand = async (method: string, params?: unknown) => {
      registered.spy.cdpCalls.push({ method, params });
      if (method !== "Page.captureScreenshot") return { data: "PNGDATA" };
      screenshotDispatches += 1;
      if (screenshotDispatches === 1) {
        await new Promise<void>((resolve) => {
          resolveFirstScreenshot = resolve;
        });
        return { data: "FIRST" };
      }
      return { data: "RECOVERED" };
    };
    const { coordinator, releases } = createReadyScreenshotSurfaceCoordinator();
    const mgr = new BrowserGuestManager(
      (message) => logs.push(message),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      coordinator,
    );
    mgr.attachGuest("screenshot-backpressure", 207);

    const controller = new AbortController();
    const first = mgr.execute(
      "screenshot-backpressure",
      { method: "screenshot" },
      controller.signal,
    );
    await vi.waitFor(() => expect(screenshotDispatches).toBe(1));
    controller.abort();
    await expect(first).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled", sideEffect: "none" },
    });
    await vi.waitFor(() => expect(releases[0]).toHaveBeenCalledOnce());

    await expect(
      mgr.execute("screenshot-backpressure", { method: "screenshot" }),
    ).resolves.toMatchObject({ ok: true, image: { base64: "RECOVERED" } });
    expect(screenshotDispatches).toBe(2);

    resolveFirstScreenshot();
    await expect(
      mgr.execute("screenshot-backpressure", { method: "screenshot" }),
    ).resolves.toMatchObject({ ok: true });
    expect(screenshotDispatches).toBe(3);
  });

  it("Playwright download event/path 绑定当前 tab，并在完成后返回保存路径", async () => {
    const { guest } = registerGuest(202);
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("download-tab", 202);
    const pending = mgr.execute("download-tab", {
      method: "playwright",
      action: { name: "waitForEvent", event: "download", timeoutMs: 1000 },
    });
    await Promise.resolve();
    guest.__emitDownload("/tmp/report.pdf");
    const event = await pending;
    expect(event).toMatchObject({
      ok: true,
      value: { id: expect.stringContaining("iab-download:") },
    });
    const downloadId = (event.value as { id: string }).id;
    await expect(
      mgr.execute("download-tab", {
        method: "playwright",
        action: { name: "downloadPath", downloadId, timeoutMs: 1000 },
      }),
    ).resolves.toMatchObject({ ok: true, value: "/tmp/report.pdf" });
  });

  it("cancelled download does not return a stale save path", async () => {
    const { guest } = registerGuest(204);
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("cancelled-download", 204);
    const pending = mgr.execute("cancelled-download", {
      method: "playwright",
      action: { name: "waitForEvent", event: "download", timeoutMs: 1000 },
    });
    await Promise.resolve();
    guest.__emitDownload("/tmp/partial.pdf", "cancelled");
    const event = await pending;
    const downloadId = (event.value as { id: string }).id;
    await expect(
      mgr.execute("cancelled-download", {
        method: "playwright",
        action: { name: "downloadPath", downloadId, timeoutMs: 1000 },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "execution_error", message: "download cancelled" },
    });
  });

  it("IAB 明确拒绝 Playwright filechooser", async () => {
    registerGuest(203);
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("upload-tab", 203);
    await expect(
      mgr.execute("upload-tab", {
        method: "playwright",
        action: { name: "waitForEvent", event: "filechooser", timeoutMs: 100 },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "capability_unsupported" },
    });
  });

  it("Handshake: execute first (unattached) does not resolve immediately; subsequent attachGuest resolves it with ok:true", async () => {
    const { spy } = registerGuest(3);
    spy.url = "https://handshake.com";
    const mgr = new BrowserGuestManager(undefined, 5_000);

    let settled = false;
    const pending = mgr.execute("k3", { method: "getState" }).then((r) => {
      settled = true;
      return r;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    mgr.attachGuest("k3", 3);
    const r = await pending;
    expect(r.ok).toBe(true);
    expect(r.state?.url).toBe("https://handshake.com");
  });

  it("Timeout: not attached and remains unattached → returns backend_unavailable on short timeout", async () => {
    const mgr = new BrowserGuestManager(undefined, 50);
    const r = await mgr.execute("nope", { method: "getState" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("backend_unavailable");
  });

  it("list: attach two keys → execute(any, list) returns two tab summaries", async () => {
    const a = registerGuest(10);
    a.spy.url = "https://a.com";
    a.spy.title = "A";
    const b = registerGuest(11);
    b.spy.url = "https://b.com";
    b.spy.title = "B";
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("ka", 10);
    mgr.attachGuest("kb", 11);
    mgr.attachGuest("ka", 10, { active: true });

    const r = await mgr.execute("whatever", { method: "list" });
    expect(r.ok).toBe(true);
    expect(r.tabs).toEqual([
      {
        tabId: "ka",
        url: "https://a.com",
        title: "A",
        active: true,
        viewport: { width: 800, height: 600 },
      },
      {
        tabId: "kb",
        url: "https://b.com",
        title: "B",
        viewport: { width: 800, height: 600 },
      },
    ]);
  });

  it("Commands without tabId route preferentially to active guest to read user\'s currently visible page", async () => {
    const session = registerGuest(60);
    session.spy.url = "https://session-default.example";
    const active = registerGuest(61);
    active.spy.url = "https://manual-current.example";
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("session-key", 60);
    mgr.attachGuest("browser:manual", 61, { active: true });

    const r = await mgr.execute("session-key", { method: "getState" });
    expect(r.ok).toBe(true);
    expect(r.state?.url).toBe("https://manual-current.example");

    const explicit = await mgr.execute("session-key", {
      method: "getState",
      tabId: "session-key",
    });
    expect(explicit.state?.url).toBe("https://session-default.example");
  });

  it("execute after detach → enters handshake pending (guest gone), returns backend_unavailable on short timeout", async () => {
    registerGuest(4);
    const mgr = new BrowserGuestManager(undefined, 50);
    mgr.attachGuest("k4", 4);
    expect(mgr.hasGuest("k4")).toBe(true);

    mgr.detach("k4");
    expect(mgr.hasGuest("k4")).toBe(false);

    const r = await mgr.execute("k4", { method: "getState" });
    expect(r.ok).toBe(false);
    expect(r.error?.code).toBe("backend_unavailable");
  });

  it("attachGuest logs and returns for non-existent id without throwing error or creating table", () => {
    const logs: string[] = [];
    const mgr = new BrowserGuestManager((m) => logs.push(m));
    mgr.attachGuest("ghost", 999);
    expect(mgr.hasGuest("ghost")).toBe(false);
    expect(logs.some((l) => l.includes("attachGuest skip"))).toBe(true);
  });

  it("scope mismatch 返回结构化结果、清理被拒绝 guest，并请求按 owner scope 重绑", () => {
    registerGuest(230);
    const rejected = registerGuest(231);
    const rebinds: string[] = [];
    const mgr = new BrowserGuestManager(undefined, 50, undefined, (tabId) => {
      rebinds.push(tabId);
    });

    expect(
      mgr.attachGuest("scope-tab", 230, {
        windowId: 1,
        workspaceKey: "/workspace-a",
        sessionId: "session-a",
      }),
    ).toMatchObject({ ok: true });

    expect(
      mgr.attachGuest("scope-tab", 231, {
        windowId: 1,
        workspaceKey: "/workspace-b",
        sessionId: "session-a",
      }),
    ).toMatchObject({
      ok: false,
      reason: "workspace-mismatch",
    });
    expect(rejected.spy.closeCalls).toBe(1);
    expect(rebinds).toEqual(["scope-tab"]);
  });

  it("newTab 在首次 guest scope 绑定失败后自动重放 Ready 并自愈", async () => {
    const wrongGuest = registerGuest(232);
    const recoveredGuest = registerGuest(233);
    let manager!: BrowserGuestManager;
    let readyCount = 0;
    manager = new BrowserGuestManager(undefined, 50, undefined, (tabId, owner) => {
      readyCount += 1;
      manager.attachGuest(tabId, readyCount === 1 ? wrongGuest.guest.id : recoveredGuest.guest.id, {
        windowId: owner.windowId,
        workspaceKey: readyCount === 1 ? "/wrong-workspace" : owner.workspaceKey,
        sessionId: owner.sessionId,
      });
    });

    const result = await manager.execute(
      {
        requestId: "scope-recovery-new-tab",
        browserId: "iab-1",
        browserGeneration: 1,
        windowId: 1,
        workspaceKey: "/workspace-a",
        sessionId: "session-a",
        clientMode: "desktop-continuous",
      },
      { method: "newTab" },
    );

    expect(result).toMatchObject({ ok: true });
    expect(readyCount).toBe(2);
    expect(wrongGuest.spy.closeCalls).toBe(1);
    expect(manager.hasGuest(result.tab?.tabId ?? "")).toBe(true);
  });

  it("Replace guest with same key: detach old first, then attach new", () => {
    const old = registerGuest(20);
    const fresh = registerGuest(21);
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("kswap", 20);
    expect(old.spy.attached).toBe(true);
    mgr.attachGuest("kswap", 21);
    expect(old.spy.detachCalls).toBe(1);
    expect(fresh.spy.attached).toBe(true);
    expect(mgr.hasGuest("kswap")).toBe(true);
  });

  it("Replacement guest can still be bound if download listener cleanup fails after old guest crash", () => {
    const old = registerGuest(208);
    const fresh = registerGuest(209);
    const logs: string[] = [];
    const mgr = new BrowserGuestManager((message) => logs.push(message));
    mgr.attachGuest("browser:recover-after-crash", 208);
    old.spy.throwOnSessionRemove = true;

    expect(() => mgr.attachGuest("browser:recover-after-crash", 209)).not.toThrow();
    expect(fresh.spy.attached).toBe(true);
    expect(mgr.hasGuest("browser:recover-after-crash")).toBe(true);
    expect(logs).toContainEqual(expect.stringContaining("download cleanup failed"));
  });

  it("guest destroyed 事件触发自动 detach（从表删除）", () => {
    const g = registerGuest(30);
    const logs: string[] = [];
    const mgr = new BrowserGuestManager((message) => logs.push(message));
    mgr.attachGuest("kdie", 30);
    expect(mgr.hasGuest("kdie")).toBe(true);
    g.guest.__emitDestroyed();
    expect(mgr.hasGuest("kdie")).toBe(false);
    expect(logs).not.toContainEqual(expect.stringContaining("download cleanup failed"));
  });

  it("Restore logical URL after guest destroyed rebind, avoiding replacement guest stuck permanently on about:blank", async () => {
    const old = registerGuest(31);
    const replacement = registerGuest(32);
    const restoreUrl = "https://example.com/payment";
    old.spy.url = restoreUrl;
    let mgr!: InstanceType<typeof BrowserGuestManager>;
    let rebindRequests = 0;
    mgr = new BrowserGuestManager(undefined, 50, undefined, (tabId, owner) => {
      rebindRequests += 1;
      queueMicrotask(() =>
        mgr.attachGuest(tabId, replacement.guest.id, {
          windowId: owner.windowId,
          workspaceKey: owner.workspaceKey,
          sessionId: owner.sessionId,
        }),
      );
    });
    mgr.attachGuest("browser:rebind-restore", old.guest.id, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    await mgr.reportResidency({
      tabId: "browser:rebind-restore",
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
      selected: true,
      visible: true,
      currentTask: true,
      loading: false,
      restoreUrl,
      title: "Payment",
    });

    old.guest.__emitDestroyed();

    await vi.waitFor(() => expect(replacement.spy.loadedUrl).toBe(restoreUrl));
    expect(rebindRequests).toBe(1);
    expect(mgr.hasGuest("browser:rebind-restore")).toBe(true);
  });

  it("tabs.list does not pollute cachedUrl with about:blank during guest rebind recovery", async () => {
    const old = registerGuest(33);
    const replacement = registerGuest(34);
    const restoreUrl = "https://example.com/rebind-list";
    const load = createDeferred<void>();
    old.spy.url = restoreUrl;
    replacement.guest.loadURL = async (url: string) => {
      replacement.spy.loadedUrl = url;
      await load.promise;
      replacement.spy.url = url;
    };

    let mgr!: InstanceType<typeof BrowserGuestManager>;
    mgr = new BrowserGuestManager(undefined, 50, undefined, (tabId) => {
      queueMicrotask(() => mgr.attachGuest(tabId, replacement.guest.id));
    });
    mgr.attachGuest("browser:rebind-list", old.guest.id);

    old.guest.__emitDestroyed();

    await vi.waitFor(() => expect(replacement.spy.loadedUrl).toBe(restoreUrl));
    replacement.guest.__emitWebContentsEvent("did-stop-loading");
    await expect(mgr.execute("browser:rebind-list", { method: "list" })).resolves.toMatchObject({
      ok: true,
      tabs: [{ tabId: "browser:rebind-list", url: restoreUrl }],
    });

    load.resolve();
    await vi.waitFor(() => expect(replacement.spy.url).toBe(restoreUrl));
  });

  describe("后台 fallback viewport 的前台恢复", () => {
    const VIEWPORT_TAB = "tab-viewport-restore";

    function createManagerForViewportRestore() {
      const registered = registerGuest(230);
      const { coordinator } = createReadyScreenshotSurfaceCoordinator();
      const mgr = new BrowserGuestManager(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        coordinator,
      );
      mgr.attachGuest(VIEWPORT_TAB, registered.guest.id);
      return { guest: registered.guest, spy: registered.spy, mgr };
    }

    
    async function seedNaturalViewportThenBackgroundFallback(
      spy: ReturnType<typeof registerGuest>["spy"],
      mgr: InstanceType<typeof BrowserGuestManager>,
    ): Promise<void> {
      spy.viewport = { width: 1280, height: 720 };
      await expect(mgr.execute(VIEWPORT_TAB, { method: "screenshot" })).resolves.toMatchObject({
        ok: true,
      });
      spy.viewport = { width: 0, height: 0 };
      await expect(mgr.execute(VIEWPORT_TAB, { method: "screenshot" })).resolves.toMatchObject({
        ok: true,
      });
      expect(
        spy.cdpCalls.some(
          (call) =>
            call.method === "Emulation.setDeviceMetricsOverride" &&
            (call.params as { width: number }).width === 1280 &&
            (call.params as { height: number }).height === 720,
        ),
      ).toBe(true);
    }

    it("reportResidency(selected=true) 后清除后台 fallback viewport", async () => {
      const { spy, mgr } = createManagerForViewportRestore();
      await seedNaturalViewportThenBackgroundFallback(spy, mgr);

      await mgr.reportResidency({
        tabId: VIEWPORT_TAB,
        workspaceKey: VIEWPORT_TAB,
        sessionId: VIEWPORT_TAB,
        windowId: 0,
        selected: true,
        visible: true,
        currentTask: false,
        loading: false,
      });

      await vi.waitFor(() => {
        expect(
          spy.cdpCalls.some((call) => call.method === "Emulation.clearDeviceMetricsOverride"),
        ).toBe(true);
      });
    });

    it("readTabViewport 在前台 tab 命中 fallback 时主动恢复自然视口", async () => {
      const registered = registerGuest(231);
      const { coordinator } = createReadyScreenshotSurfaceCoordinator();
      const mgr = new BrowserGuestManager(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        coordinator,
      );
      mgr.attachGuest(VIEWPORT_TAB, registered.guest.id, { active: true });

      registered.spy.viewport = { width: 1280, height: 720 };
      await expect(mgr.execute(VIEWPORT_TAB, { method: "screenshot" })).resolves.toMatchObject({
        ok: true,
      });
      registered.spy.viewport = { width: 0, height: 0 };
      await expect(mgr.execute(VIEWPORT_TAB, { method: "screenshot" })).resolves.toMatchObject({
        ok: true,
      });
      await expect(mgr.execute(VIEWPORT_TAB, { method: "screenshot" })).resolves.toMatchObject({
        ok: true,
      });

      await vi.waitFor(() => {
        expect(
          registered.spy.cdpCalls.some(
            (call) => call.method === "Emulation.clearDeviceMetricsOverride",
          ),
        ).toBe(true);
      });
    });
  });

  describe("detachGuest CDP channel teardown", () => {
    it("detach while guest is alive: remove debugger message listener and proactively detach", () => {
      const g = registerGuest(300);
      const mgr = new BrowserGuestManager();
      mgr.attachGuest("kcdp-alive", 300);
      expect(g.guest.__cdpMessageListenerCount()).toBe(1);

      mgr.detach("kcdp-alive");

      expect(g.guest.__cdpMessageListenerCount()).toBe(0);
      expect(g.spy.detachCalls).toBe(1);
      expect(g.spy.attached).toBe(false);
    });

    it("detach when guest is destroyed: do not call detach() but still remove listener, and log CDP not disconnected", () => {
      const g = registerGuest(301);
      const logs: string[] = [];
      const mgr = new BrowserGuestManager((message) => logs.push(message));
      mgr.attachGuest("kcdp-dead", 301);
      expect(g.guest.__cdpMessageListenerCount()).toBe(1);

      g.guest.__emitDestroyed();

      expect(g.spy.detachCalls).toBe(0);
      expect(g.guest.__cdpMessageListenerCount()).toBe(0);
      expect(g.spy.debuggerRemoveAfterDestroyCalls).toBe(1);
      expect(logs).toContainEqual(
        expect.stringContaining("cdp still attached on destroyed guest tabId=kcdp-dead"),
      );
    });

    it("Failure to remove listener does not block teardown; error is logged and replacement guest can still bind", () => {
      const old = registerGuest(302);
      const fresh = registerGuest(303);
      const logs: string[] = [];
      const mgr = new BrowserGuestManager((message) => logs.push(message));
      mgr.attachGuest("kcdp-removefail", 302);
      old.spy.throwOnDebuggerRemove = true;

      expect(() => mgr.attachGuest("kcdp-removefail", 303)).not.toThrow();
      expect(logs).toContainEqual(expect.stringContaining("cdp message cleanup failed"));
      expect(fresh.spy.attached).toBe(true);
      expect(mgr.hasGuest("kcdp-removefail")).toBe(true);
    });

    it("detach() errors are no longer silently swallowed: log warning and proceed with state teardown", () => {
      const old = registerGuest(304);
      const fresh = registerGuest(305);
      const logs: string[] = [];
      const mgr = new BrowserGuestManager((message) => logs.push(message));
      mgr.attachGuest("kcdp-detachfail", 304);
      old.spy.throwOnDebuggerDetach = new Error("debugger detach rejected");

      expect(() => mgr.attachGuest("kcdp-detachfail", 305)).not.toThrow();
      expect(logs).toContainEqual(
        expect.stringContaining("cdp detach failed tabId=kcdp-detachfail"),
      );
      expect(logs).toContainEqual(expect.stringContaining("debugger detach rejected"));
      expect(old.guest.__cdpMessageListenerCount()).toBe(0);
      expect(fresh.spy.attached).toBe(true);
    });

    it("Subsequent CDP dialog events from old guest after detach do not pollute pendingDialog", async () => {
      const g = registerGuest(306);
      const mgr = new BrowserGuestManager();
      mgr.attachGuest("kcdp-stale", 306);
      mgr.detach("kcdp-stale");

      g.guest.__emitCdpMessage("Page.javascriptDialogOpening", {
        type: "alert",
        message: "Ghost dialog",
      });

      const fresh = registerGuest(307);
      mgr.attachGuest("kcdp-stale", 307);
      const r = await mgr.execute("kcdp-stale", { method: "getDialog" });
      expect(r.ok).toBe(true);
      expect(r.dialog).toBeNull();
      expect(fresh.spy.attached).toBe(true);
    });

    it("guest teardown awaits in-flight CDP completion and fails closed on new commands", async () => {
      const g = registerGuest(315);
      const mgr = new BrowserGuestManager();
      mgr.attachGuest("kcdp-lease", 315);

      const pendingEvaluate = createDeferred<void>();
      const originalSendCommand = g.guest.debugger.sendCommand;
      g.guest.debugger.sendCommand = async (method: string, params?: unknown) => {
        if (method === "Runtime.evaluate") {
          g.spy.cdpCalls.push({ method, params });
          await pendingEvaluate.promise;
          return { data: "EVALUATED" };
        }
        return originalSendCommand(method, params);
      };

      const running = mgr.execute("kcdp-lease", {
        method: "playwright",
        tabId: "kcdp-lease",
        action: {
          name: "evaluate",
          expression: "1",
          expressionKind: "string",
          timeoutMs: 5_000,
        },
      });
      await Promise.resolve();
      await vi.waitFor(() => {
        expect(g.spy.cdpCalls.some((call) => call.method === "Runtime.evaluate")).toBe(true);
      });

      const firstTeardown = mgr.detachGuestBeforeReplacement("kcdp-lease", 315, 0);
      const secondTeardown = mgr.detachGuestBeforeReplacement("kcdp-lease", 315, 0);

      expect(g.spy.detachCalls).toBe(0);
      const rejected = await mgr.execute("kcdp-lease", {
        method: "playwright",
        tabId: "kcdp-lease",
        action: {
          name: "evaluate",
          expression: "2",
          expressionKind: "string",
          timeoutMs: 5_000,
        },
      });
      expect(rejected.ok).toBe(false);
      expect(rejected.error?.message).toContain("detaching");

      pendingEvaluate.resolve(undefined);
      await expect(Promise.all([firstTeardown, secondTeardown])).resolves.toEqual([true, true]);
      await running;
      expect(g.spy.detachCalls).toBe(1);
      expect(g.spy.attached).toBe(false);
      expect(mgr.hasGuest("kcdp-lease")).toBe(false);
    });
  });

  describe("Proactively disconnect CDP when guest renderer crashes", () => {
    it("Release only same-window same-generation guest and confirm CDP is disconnected before renderer rebuild", async () => {
      const g = registerGuest(309);
      const mgr = new BrowserGuestManager();
      mgr.attachGuest("kcrash-replace", 309, { windowId: 17 });

      await expect(mgr.detachGuestBeforeReplacement("kcrash-replace", 309, 18)).resolves.toBe(
        false,
      );
      await expect(mgr.detachGuestBeforeReplacement("kcrash-replace", 999, 17)).resolves.toBe(
        false,
      );
      expect(g.spy.detachCalls).toBe(0);
      expect(mgr.hasGuest("kcrash-replace")).toBe(true);

      await expect(mgr.detachGuestBeforeReplacement("kcrash-replace", 309, 17)).resolves.toBe(true);
      expect(g.spy.detachCalls).toBe(1);
      expect(g.spy.attached).toBe(false);
      expect(mgr.hasGuest("kcrash-replace")).toBe(false);
    });

    it("Fail closed and keep old guest if CDP detach fails before renderer rebuild", async () => {
      const g = registerGuest(308);
      const logs: string[] = [];
      const mgr = new BrowserGuestManager((message) => logs.push(message));
      mgr.attachGuest("kcrash-replace-failed", 308, { windowId: 17 });
      g.spy.throwOnDebuggerDetach = new Error("native detach failed");

      await expect(
        mgr.detachGuestBeforeReplacement("kcrash-replace-failed", 308, 17),
      ).resolves.toBe(false);
      expect(mgr.hasGuest("kcrash-replace-failed")).toBe(true);
      expect(logs).toContainEqual(
        expect.stringContaining("replacement cdp detach failed tabId=kcrash-replace-failed"),
      );
    });

    it("render-process-gone 时立即 detach，不等 destroyed", () => {
      const g = registerGuest(310);
      const logs: string[] = [];
      const mgr = new BrowserGuestManager((message) => logs.push(message));
      mgr.attachGuest("kcrash-detach", 310);
      expect(g.spy.attached).toBe(true);

      g.guest.__emitWebContentsEvent("render-process-gone", {}, { reason: "oom" });

      expect(g.spy.detachCalls).toBe(1);
      expect(g.spy.attached).toBe(false);
      expect(logs).toContainEqual(
        expect.stringContaining("cdp detached on render-process-gone tabId=kcrash-detach"),
      );
    });

    it("When detached after crash, subsequent destroyed event no longer reports \"CDP not disconnected\"", () => {
      const g = registerGuest(311);
      const logs: string[] = [];
      const mgr = new BrowserGuestManager((message) => logs.push(message));
      mgr.attachGuest("kcrash-then-destroy", 311);

      g.guest.__emitWebContentsEvent("render-process-gone", {}, { reason: "crashed" });
      g.guest.__emitDestroyed();

      expect(g.spy.detachCalls).toBe(1);
      expect(logs).not.toContainEqual(
        expect.stringContaining("cdp still attached on destroyed guest"),
      );
    });

    it("detachGuest removes render-process-gone listener to avoid accumulation across guest generations", () => {
      const old = registerGuest(312);
      const fresh = registerGuest(313);
      const mgr = new BrowserGuestManager();
      mgr.attachGuest("kcrash-gen", 312);
      expect(old.guest.__webContentsListenerCount("render-process-gone")).toBe(1);

      mgr.attachGuest("kcrash-gen", 313);

      expect(old.guest.__webContentsListenerCount("render-process-gone")).toBe(0);
      expect(fresh.guest.__webContentsListenerCount("render-process-gone")).toBe(1);
    });

    it("detach() errors in crashed window do not block teardown; failure is logged", () => {
      const g = registerGuest(314);
      const logs: string[] = [];
      const mgr = new BrowserGuestManager((message) => logs.push(message));
      mgr.attachGuest("kcrash-detachfail", 314);
      g.spy.throwOnDebuggerDetach = new Error("detach rejected during crash");

      expect(() =>
        g.guest.__emitWebContentsEvent("render-process-gone", {}, { reason: "oom" }),
      ).not.toThrow();
      expect(logs).toContainEqual(
        expect.stringContaining("cdp detach on render-process-gone failed"),
      );
      expect(logs).toContainEqual(expect.stringContaining("detach rejected during crash"));
    });
  });

  it("command.tabId addressing: execute(key, {tabId}) routes to guest of tabId", async () => {
    const t = registerGuest(40);
    t.spy.url = "https://tab.com";
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("realTab", 40);
    const r = await mgr.execute("sessionKey", {
      method: "getState",
      tabId: "realTab",
    });
    expect(r.ok).toBe(true);
    expect(r.state?.url).toBe("https://tab.com");
  });

  it("getDialog: returns dialog:null when none pending; returns dialog info once opened", async () => {
    const g = registerGuest(50);
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("kdlg", 50);

    const empty = await mgr.execute("kdlg", { method: "getDialog" });
    expect(empty.ok).toBe(true);
    expect(empty.dialog).toBeNull();

    expect(g.spy.cdpCalls.some((c) => c.method === "Page.enable")).toBe(true);

    g.guest.__emitCdpMessage("Page.javascriptDialogOpening", {
      type: "prompt",
      message: "输入名字",
      defaultPrompt: "默认值",
    });
    const opened = await mgr.execute("kdlg", { method: "getDialog" });
    expect(opened.ok).toBe(true);
    expect(opened.dialog).toEqual({
      type: "prompt",
      message: "输入名字",
      defaultPrompt: "默认值",
    });

    g.guest.__emitCdpMessage("Page.javascriptDialogClosed", { result: true });
    const closed = await mgr.execute("kdlg", { method: "getDialog" });
    expect(closed.dialog).toBeNull();
  });

  it("handleDialog: call Page.handleJavaScriptDialog and clear pending", async () => {
    const g = registerGuest(51);
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("khandle", 51);
    g.guest.__emitCdpMessage("Page.javascriptDialogOpening", {
      type: "confirm",
      message: "确认？",
    });

    const r = await mgr.execute("khandle", {
      method: "handleDialog",
      accept: true,
      promptText: "yes",
    });
    expect(r.ok).toBe(true);
    const call = g.spy.cdpCalls.find((c) => c.method === "Page.handleJavaScriptDialog");
    expect(call).toBeDefined();
    expect(call?.params).toEqual({ accept: true, promptText: "yes" });

    const after = await mgr.execute("khandle", { method: "getDialog" });
    expect(after.dialog).toBeNull();
  });

  it("close: detach guest and trigger onCloseTabRequested callback", async () => {
    const g = registerGuest(52);
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(undefined, undefined, (key) => closed.push(key));
    mgr.attachGuest("kclose", 52);
    expect(mgr.hasGuest("kclose")).toBe(true);

    const r = await mgr.execute("kclose", { method: "close" });
    expect(r.ok).toBe(true);
    expect(mgr.hasGuest("kclose")).toBe(false);
    expect(g.spy.detachCalls).toBe(1);
    expect(closed).toEqual(["kclose"]);
  });

  it("close: detach and callback target effectiveKey (tabId) during tabId addressing", async () => {
    registerGuest(53);
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(undefined, undefined, (key) => closed.push(key));
    mgr.attachGuest("realClose", 53);

    const r = await mgr.execute("sessionKey", {
      method: "close",
      tabId: "realClose",
    });
    expect(r.ok).toBe(true);
    expect(mgr.hasGuest("realClose")).toBe(false);
    expect(closed).toEqual(["realClose"]);
  });

  it("按 window/workspace/session scope 隔离 list、active 与显式 tabId", async () => {
    const opened: Array<{ tabId: string; windowId: number }> = [];
    const mgr = new BrowserGuestManager(undefined, 5_000, undefined, (tabId, owner) =>
      opened.push({ tabId, windowId: owner.windowId }),
    );
    const context = (windowId: number, requestId: string) => ({
      requestId,
      browserId: "iab-1",
      browserGeneration: 7,
      windowId,
      workspaceKey: `/workspace-${windowId}`,
      sessionId: "same-session",
      clientMode: "desktop-continuous" as const,
    });

    const firstPending = mgr.execute(context(1, "req-1"), { method: "newTab" });
    await Promise.resolve();
    const firstTabId = opened.find((entry) => entry.windowId === 1)!.tabId;
    const first = registerGuest(71);
    first.spy.url = "https://one.example";
    mgr.attachGuest(firstTabId, 71, { active: true, windowId: 1 });
    await expect(firstPending).resolves.toMatchObject({
      ok: true,
      tab: { tabId: firstTabId },
    });

    const secondPending = mgr.execute(context(2, "req-2"), {
      method: "newTab",
    });
    await Promise.resolve();
    const secondTabId = opened.find((entry) => entry.windowId === 2)!.tabId;
    const second = registerGuest(72);
    second.spy.url = "https://two.example";
    mgr.attachGuest(secondTabId, 72, { active: true, windowId: 2 });
    await secondPending;

    const firstList = await mgr.execute(context(1, "req-list-1"), {
      method: "list",
    });
    expect(firstList.tabs?.map((tab) => tab.tabId)).toEqual([firstTabId]);
    expect(firstList.meta).toMatchObject({
      browserId: "iab-1",
      browserGeneration: 7,
      openTabIds: [firstTabId],
    });
    const crossScope = await mgr.execute(context(1, "req-cross"), {
      method: "getState",
      tabId: secondTabId,
    });
    expect(crossScope).toMatchObject({
      ok: false,
      error: {
        code: "backend_unavailable",
        message: expect.stringContaining("browser.tabs.get(info.id)"),
      },
    });
    expect(crossScope.error?.message).toContain("browser.user.claimTab(info)");
  });

  it("Background-mounted scope still exposes single addressable active tab in list, matching destination of commands without tabId", async () => {
    const opened: string[] = [];
    const mgr = new BrowserGuestManager(undefined, 5_000, undefined, (tabId) => opened.push(tabId));
    const context = {
      requestId: "bg-1",
      browserId: "iab-1",
      browserGeneration: 7,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-bg",
      clientMode: "desktop-continuous" as const,
    };
    const newBackgroundTab = async (requestId: string, webContentsId: number, url: string) => {
      const pending = mgr.execute({ ...context, requestId }, { method: "newTab" });
      await Promise.resolve();
      const tabId = opened.at(-1)!;
      const { spy } = registerGuest(webContentsId);
      spy.url = url;
      mgr.attachGuest(tabId, webContentsId, { active: false, windowId: 1 });
      await pending;
      return tabId;
    };

    const firstTabId = await newBackgroundTab("bg-new-1", 95, "https://bg-one.example");
    const list = await mgr.execute({ ...context, requestId: "bg-list" }, { method: "list" });
    expect(list.tabs?.filter((tab) => tab.active).map((tab) => tab.tabId)).toEqual([firstTabId]);

    const routed = await mgr.execute(
      { ...context, requestId: "bg-getstate" },
      { method: "getState" },
    );
    expect(routed).toMatchObject({ ok: true, meta: { tabId: firstTabId } });

    const secondTabId = await newBackgroundTab("bg-new-2", 96, "https://bg-two.example");
    const multi = await mgr.execute({ ...context, requestId: "bg-list-2" }, { method: "list" });
    expect(multi.tabs?.map((tab) => tab.tabId)).toEqual([firstTabId, secondTabId]);
    expect(multi.tabs?.filter((tab) => tab.active).map((tab) => tab.tabId)).toEqual([secondTabId]);
    await expect(
      mgr.execute({ ...context, requestId: "bg-getstate-2" }, { method: "getState" }),
    ).resolves.toMatchObject({ ok: true, meta: { tabId: secondTabId } });

    const settled = await mgr.execute({ ...context, requestId: "bg-list-3" }, { method: "list" });
    expect(settled.tabs?.map((tab) => tab.tabId)).toEqual([firstTabId, secondTabId]);
  });

  it("activateTab activates target tab only, clears old active in same scope, and notifies origin renderer", async () => {
    const opened: string[] = [];
    const visibility: Array<{
      visible: boolean;
      sessionId: string;
      tabId?: string;
    }> = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      undefined,
      (tabId) => opened.push(tabId),
      (visible, owner, tabId) =>
        visibility.push({
          visible,
          sessionId: owner.sessionId,
          ...(tabId ? { tabId } : {}),
        }),
    );
    const context = {
      requestId: "activate-tab",
      browserId: "iab-1",
      browserGeneration: 7,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      clientMode: "desktop-continuous" as const,
    };
    const newAttachedTab = async (requestId: string, webContentsId: number) => {
      const pending = mgr.execute({ ...context, requestId }, { method: "newTab" });
      await Promise.resolve();
      const tabId = opened.at(-1)!;
      registerGuest(webContentsId);
      mgr.attachGuest(tabId, webContentsId, { active: true, windowId: 1 });
      await pending;
      return tabId;
    };

    const firstTabId = await newAttachedTab("new-first", 90);
    const secondTabId = await newAttachedTab("new-second", 91);
    const before = await mgr.execute({ ...context, requestId: "list-before" }, { method: "list" });
    expect(before.tabs?.filter((tab) => tab.active).map((tab) => tab.tabId)).toEqual([secondTabId]);

    const activated = await mgr.execute(
      { ...context, requestId: "activate-first" },
      { method: "activateTab", tabId: firstTabId },
    );
    expect(activated).toMatchObject({
      ok: true,
      tab: { tabId: firstTabId, active: true },
      meta: { tabId: firstTabId },
    });
    expect(visibility).toEqual([{ visible: true, sessionId: "session-1", tabId: firstTabId }]);
    await expect(
      mgr.execute(
        { ...context, requestId: "visibility-after" },
        { method: "browserVisibilityGet" },
      ),
    ).resolves.toMatchObject({ ok: true, value: true });
    const after = await mgr.execute({ ...context, requestId: "list-after" }, { method: "list" });
    expect(after.tabs?.filter((tab) => tab.active).map((tab) => tab.tabId)).toEqual([firstTabId]);

    const crossScope = await mgr.execute(
      { ...context, requestId: "activate-cross", sessionId: "session-2" },
      { method: "activateTab", tabId: firstTabId },
    );
    expect(crossScope).toMatchObject({ ok: false, error: { code: "backend_unavailable" } });
    expect(crossScope.error?.message).toContain(
      "This is pre-action stale-binding recovery, not post-action popup observation.",
    );
    expect(visibility).toHaveLength(1);
  });

  it("visibility takes effect by scope; viewport modifies target tab only and returns actual dimensions", async () => {
    const opened: string[] = [];
    const { coordinator } = createReadyScreenshotSurfaceCoordinator();
    const visibility: Array<{ visible: boolean; tabId?: string }> = [];
    const viewportChanges: Array<{
      tabId: string;
      viewport: { width: number; height: number } | null;
    }> = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      undefined,
      (tabId) => opened.push(tabId),
      (visible, _owner, tabId) => visibility.push({ visible, ...(tabId ? { tabId } : {}) }),
      (viewport, _owner, tabId) => viewportChanges.push({ tabId, viewport }),
      undefined,
      coordinator,
    );
    const context = {
      requestId: "visibility-set",
      browserId: "iab-1",
      browserGeneration: 7,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      clientMode: "desktop-continuous" as const,
    };

    await expect(
      mgr.execute(context, { method: "browserVisibilitySet", visible: true }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      mgr.execute({ ...context, requestId: "visibility-get" }, { method: "browserVisibilityGet" }),
    ).resolves.toMatchObject({ ok: true, value: true });
    expect(visibility).toEqual([{ visible: true }]);

    const pending = mgr.execute({ ...context, requestId: "new-visible-tab" }, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened[0]!;
    const guest = registerGuest(86);
    mgr.attachGuest(tabId, 86, { windowId: 1, workspaceKey: "/repo" });
    await pending;

    const secondPending = mgr.execute(
      { ...context, requestId: "new-second-tab" },
      { method: "newTab" },
    );
    await Promise.resolve();
    const secondTabId = opened[1]!;
    const secondGuest = registerGuest(87);
    mgr.attachGuest(secondTabId, 87, { windowId: 1, workspaceKey: "/repo" });
    await secondPending;

    expect(visibility.at(-1)).toEqual({ visible: true, tabId: secondTabId });
    visibility.length = 0;
    mgr.attachGuest(tabId, 86, {
      active: false,
      windowId: 1,
      workspaceKey: "/repo",
    });
    expect(visibility).toEqual([]);
    const secondViewportCallCount = secondGuest.spy.cdpCalls.filter(
      (call) => call.method === "Emulation.setDeviceMetricsOverride",
    ).length;
    expect(secondViewportCallCount).toBe(1);
    await mgr.execute(
      { ...context, requestId: "viewport-set" },
      { method: "browserViewportSet", tabId, width: 1440, height: 900 },
    );
    expect(guest.spy.cdpCalls).toContainEqual({
      method: "Emulation.setDeviceMetricsOverride",
      params: {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
        dontSetVisibleSize: true,
      },
    });
    expect(
      secondGuest.spy.cdpCalls.filter(
        (call) => call.method === "Emulation.setDeviceMetricsOverride",
      ),
    ).toHaveLength(secondViewportCallCount);
    await mgr.execute(
      { ...context, requestId: "viewport-screenshot" },
      { method: "screenshot", tabId },
    );
    expect(guest.spy.cdpCalls).toContainEqual({
      method: "Page.captureScreenshot",
      params: {
        format: "png",
        captureBeyondViewport: false,
        clip: { x: 0, y: 0, width: 1440, height: 900, scale: 1 },
      },
    });
    expect(viewportChanges.at(-1)).toEqual({
      tabId,
      viewport: { width: 1440, height: 900 },
    });
    await expect(
      mgr.execute({ ...context, requestId: "viewport-list" }, { method: "list" }),
    ).resolves.toMatchObject({
      ok: true,
      tabs: [
        { tabId, viewport: { width: 1440, height: 900 }, active: true },
        { tabId: secondTabId, viewport: { width: 1280, height: 720 } },
      ],
    });
    await mgr.execute(
      { ...context, requestId: "viewport-reset" },
      { method: "browserViewportReset", tabId },
    );
    expect(guest.spy.cdpCalls).toContainEqual({
      method: "Emulation.clearDeviceMetricsOverride",
      params: undefined,
    });
    expect(viewportChanges.at(-1)).toEqual({ tabId, viewport: null });
    await mgr.updateViewportFromRenderer(tabId, { width: 400, height: 700 }, 1);
    expect(guest.spy.cdpCalls.at(-1)).toEqual({
      method: "Emulation.setDeviceMetricsOverride",
      params: {
        width: 400,
        height: 700,
        deviceScaleFactor: 1,
        mobile: false,
        dontSetVisibleSize: true,
      },
    });
    await expect(
      mgr.execute({ ...context, requestId: "manual-viewport-list" }, { method: "list" }),
    ).resolves.toMatchObject({
      tabs: [
        { tabId, viewport: { width: 400, height: 700 } },
        { tabId: secondTabId, viewport: { width: 1280, height: 720 } },
      ],
    });
    await expect(
      mgr.updateViewportFromRenderer(tabId, { width: 400, height: 700 }, 2),
    ).rejects.toThrow("unavailable for viewport update");
    await mgr.updateViewportFromRenderer(tabId, null, 1);
    await expect(
      mgr.execute({ ...context, requestId: "natural-viewport-list" }, { method: "list" }),
    ).resolves.toMatchObject({
      tabs: [
        { tabId, viewport: { width: 800, height: 600 } },
        { tabId: secondTabId, viewport: { width: 1280, height: 720 } },
      ],
    });
    await mgr.execute(
      { ...context, requestId: "visibility-hide" },
      { method: "browserVisibilitySet", visible: false },
    );
    expect(visibility.at(-1)).toEqual({ visible: false, tabId });
  });

  it("Normal-sized background session 0×0 guest uses temporary viewport, restoring natural size once visible in foreground", async () => {
    const opened: Array<{ tabId: string; sessionId: string }> = [];
    const mgr = new BrowserGuestManager(undefined, 5_000, undefined, (tabId, owner) =>
      opened.push({ tabId, sessionId: owner.sessionId }),
    );
    const context = (sessionId: string, requestId: string) => ({
      requestId,
      browserId: "iab-1",
      browserGeneration: 7,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId,
      clientMode: "desktop-continuous" as const,
    });

    const foregroundPending = mgr.execute(context("session-b", "foreground-new"), {
      method: "newTab",
    });
    await Promise.resolve();
    const foregroundTabId = opened.find((entry) => entry.sessionId === "session-b")!.tabId;
    const foreground = registerGuest(186);
    foreground.spy.viewport = { width: 1024, height: 768 };
    mgr.attachGuest(foregroundTabId, 186, {
      active: true,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-b",
    });
    await expect(foregroundPending).resolves.toMatchObject({
      ok: true,
      tab: { viewport: { width: 1280, height: 720 } },
    });
    await mgr.execute(context("session-b", "foreground-reset"), {
      method: "browserViewportReset",
      tabId: foregroundTabId,
    });
    foreground.spy.viewport = { width: 1024, height: 768 };
    await mgr.execute(context("session-b", "foreground-natural-list"), {
      method: "list",
    });

    const backgroundPending = mgr.execute(context("session-a", "background-new"), {
      method: "newTab",
    });
    await Promise.resolve();
    const backgroundTabId = opened.find((entry) => entry.sessionId === "session-a")!.tabId;
    const background = registerGuest(187);
    background.spy.viewport = { width: 0, height: 0 };
    mgr.attachGuest(backgroundTabId, 187, {
      active: false,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });

    await expect(backgroundPending).resolves.toMatchObject({
      ok: true,
      tab: { viewport: { width: 1280, height: 720 } },
    });
    await mgr.execute(context("session-a", "background-reset"), {
      method: "browserViewportReset",
      tabId: backgroundTabId,
    });
    background.spy.viewport = { width: 0, height: 0 };
    await expect(
      mgr.execute(context("session-a", "background-list"), { method: "list" }),
    ).resolves.toMatchObject({
      tabs: [{ tabId: backgroundTabId, viewport: { width: 1024, height: 768 } }],
    });
    expect(background.spy.cdpCalls).toContainEqual({
      method: "Emulation.setDeviceMetricsOverride",
      params: {
        width: 1024,
        height: 768,
        deviceScaleFactor: 1,
        mobile: false,
        dontSetVisibleSize: true,
      },
    });
    await expect(
      mgr.execute(context("session-b", "foreground-list"), { method: "list" }),
    ).resolves.toMatchObject({
      tabs: [{ tabId: foregroundTabId, viewport: { width: 1024, height: 768 } }],
    });

    const clearCallCountBeforeRestore = background.spy.cdpCalls.filter(
      (call) => call.method === "Emulation.clearDeviceMetricsOverride",
    ).length;
    mgr.attachGuest(backgroundTabId, 187, {
      active: true,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    await vi.waitFor(() => {
      expect(
        background.spy.cdpCalls.filter(
          (call) => call.method === "Emulation.clearDeviceMetricsOverride",
        ).length,
      ).toBeGreaterThan(clearCallCountBeforeRestore);
    });
    await expect(
      mgr.execute(context("session-a", "restored-list"), { method: "list" }),
    ).resolves.toMatchObject({
      tabs: [
        {
          tabId: backgroundTabId,
          viewport: { width: 800, height: 600 },
          active: true,
        },
      ],
    });
  });

  it("Explicit size wins race between background viewport restore and explicit setting", async () => {
    const opened: string[] = [];
    const mgr = new BrowserGuestManager(undefined, 5_000, undefined, (tabId) => opened.push(tabId));
    const context = {
      requestId: "background-default-new",
      browserId: "iab-1",
      browserGeneration: 7,
      windowId: 9,
      workspaceKey: "/repo",
      sessionId: "session-a",
      clientMode: "desktop-continuous" as const,
    };

    const pending = mgr.execute(context, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened[0]!;
    const background = registerGuest(188);
    background.spy.viewport = { width: 0, height: 0 };
    mgr.attachGuest(tabId, 188, {
      active: false,
      windowId: 9,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    await expect(pending).resolves.toMatchObject({
      ok: true,
      tab: { viewport: { width: 1280, height: 720 } },
    });
    await mgr.execute(
      { ...context, requestId: "background-reset" },
      {
        method: "browserViewportReset",
        tabId,
      },
    );
    background.spy.viewport = { width: 0, height: 0 };
    await expect(
      mgr.execute({ ...context, requestId: "background-fallback-list" }, { method: "list" }),
    ).resolves.toMatchObject({
      tabs: [{ tabId, viewport: { width: 800, height: 600 } }],
    });

    const originalSendCommand = background.guest.debugger.sendCommand;
    let signalClearStarted!: () => void;
    let releaseClear!: () => void;
    const clearStarted = new Promise<void>((resolve) => {
      signalClearStarted = resolve;
    });
    const clearGate = new Promise<void>((resolve) => {
      releaseClear = resolve;
    });
    background.guest.debugger.sendCommand = async (method, params) => {
      if (method === "Emulation.clearDeviceMetricsOverride") {
        signalClearStarted();
        await clearGate;
      }
      return await originalSendCommand(method, params);
    };

    mgr.attachGuest(tabId, 188, {
      active: true,
      windowId: 9,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    await clearStarted;
    const explicit = mgr.execute(
      { ...context, requestId: "explicit-after-visible" },
      { method: "browserViewportSet", tabId, width: 1280, height: 720 },
    );
    releaseClear();
    await expect(explicit).resolves.toMatchObject({ ok: true });
    await expect(
      mgr.execute({ ...context, requestId: "explicit-list" }, { method: "list" }),
    ).resolves.toMatchObject({
      tabs: [{ tabId, viewport: { width: 1280, height: 720 }, active: true }],
    });
    expect(background.spy.cdpCalls.at(-1)).toEqual({
      method: "Emulation.setDeviceMetricsOverride",
      params: {
        width: 1280,
        height: 720,
        deviceScaleFactor: 1,
        mobile: false,
        dontSetVisibleSize: true,
      },
    });
  });

  it("Human tab in same window/workspace is discovered and claimed explicitly only via BrowserUser", async () => {
    const human = registerGuest(75);
    human.spy.url = "https://human-current.example";
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("browser:human", 75, {
      active: true,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
    });
    const context = (sessionId: string, requestId: string, workspaceKey = "/repo") => ({
      requestId,
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey,
      sessionId,
      clientMode: "desktop-continuous" as const,
    });

    const ownedBeforeClaim = await mgr.execute(context("session-1", "list-owned"), {
      method: "list",
    });
    expect(ownedBeforeClaim.tabs).toEqual([]);
    const visible = await mgr.execute(context("session-1", "list-human"), {
      method: "listUserTabs",
    });
    expect(visible.userTabs).toEqual([
      expect.objectContaining({
        id: "browser:human",
        url: "https://human-current.example",
      }),
    ]);
    const crossSessionGuest = registerGuest(76);
    crossSessionGuest.spy.url = "https://cross-session.example";
    mgr.attachGuest("browser:human", 76, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-2",
    });
    await expect(
      mgr.execute(context("session-1", "list-after-cross-attach"), {
        method: "listUserTabs",
      }),
    ).resolves.toMatchObject({
      userTabs: [expect.objectContaining({ url: "https://human-current.example" })],
    });
    const claimed = await mgr.execute(context("session-1", "claim-human"), {
      method: "claimTab",
      tabId: "browser:human",
    });
    expect(claimed.tab).toEqual(expect.objectContaining({ tabId: "browser:human", active: true }));
    const state = await mgr.execute(context("session-1", "read-human"), {
      method: "getState",
      tabId: "browser:human",
    });
    expect(state.state?.url).toBe("https://human-current.example");
    await mgr.execute(context("session-1", "mark-human-handoff"), {
      method: "markHandoff",
      tabId: "browser:human",
    });
    await mgr.execute(context("session-1", "end-human-turn"), {
      method: "turnEnded",
    });
    await expect(
      mgr.execute(context("session-1", "list-human-handoff"), {
        method: "list",
      }),
    ).resolves.toMatchObject({
      tabs: [
        expect.objectContaining({
          tabId: "browser:human",
          lifecycle: "handoff",
        }),
      ],
    });

    const otherSession = await mgr.execute(context("session-2", "list-other"), {
      method: "list",
    });
    expect(otherSession.tabs).toEqual([]);
    const otherWorkspace = await mgr.execute(
      context("session-3", "list-other-workspace", "/other"),
      { method: "list" },
    );
    expect(otherWorkspace.tabs).toEqual([]);

    const finalized = await mgr.execute(context("session-1", "finalize-human"), {
      method: "finalizeTabs",
      keep: [{ tabId: "browser:human", status: "deliverable" }],
    });
    expect(finalized.meta?.openTabIds).toEqual([]);
    const released = await mgr.execute(context("session-2", "list-released"), {
      method: "listUserTabs",
    });
    expect(released.userTabs).toEqual([]);
    await expect(
      mgr.execute(context("session-1", "list-owner-released"), {
        method: "listUserTabs",
      }),
    ).resolves.toMatchObject({
      userTabs: [expect.objectContaining({ id: "browser:human" })],
    });
  });

  it("Claiming inactive human tab automatically activates it and notifies renderer to expand view", async () => {
    const human = registerGuest(77);
    human.spy.url = "https://human-inactive.example";
    const visibilityNotifications: Array<{ visible: boolean; tabId?: string }> = [];
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      (visible, _owner, tabId) => {
        visibilityNotifications.push({ visible, tabId });
      },
    );
    mgr.attachGuest("browser:human-inactive", 77, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
    });
    const context = {
      requestId: "claim-inactive",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      clientMode: "desktop-continuous" as const,
    };

    const claimed = await mgr.execute(context, {
      method: "claimTab",
      tabId: "browser:human-inactive",
    });
    expect(claimed.tab).toEqual(
      expect.objectContaining({ tabId: "browser:human-inactive", active: true }),
    );
    expect(visibilityNotifications).toContainEqual({
      visible: true,
      tabId: "browser:human-inactive",
    });
  });

  it("Model-created tabs (explicit or implicit) default to free size 1280×720; subsequent navigations keep current size", async () => {
    const opened: string[] = [];
    const viewportChanges: Array<{
      tabId: string;
      viewport: { width: number; height: number } | null;
    }> = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      undefined,
      (tabId) => opened.push(tabId),
      undefined,
      (viewport, _owner, tabId) => viewportChanges.push({ tabId, viewport }),
    );
    const context = (requestId: string) => ({
      requestId,
      browserId: "iab-default-size",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: requestId.startsWith("implicit") ? "implicit-session" : "explicit-session",
      clientMode: "desktop-continuous" as const,
    });

    const explicitPending = mgr.execute(context("explicit-new"), {
      method: "newTab",
    });
    await Promise.resolve();
    const explicitTabId = opened[0]!;
    const explicitGuest = registerGuest(208);
    mgr.attachGuest(explicitTabId, 208, {
      active: true,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "explicit-session",
    });
    await expect(explicitPending).resolves.toMatchObject({
      tab: { tabId: explicitTabId, viewport: { width: 1280, height: 720 } },
    });

    const implicitPending = mgr.execute(context("implicit-navigate"), {
      method: "navigate",
      url: "https://implicit.example/first",
    });
    await Promise.resolve();
    const implicitTabId = opened[1]!;
    const implicitGuest = registerGuest(209);
    mgr.attachGuest(implicitTabId, 209, {
      active: true,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "implicit-session",
    });
    await expect(implicitPending).resolves.toMatchObject({ ok: true });
    expect(implicitGuest.spy.loadedUrl).toBe("https://implicit.example/first");

    for (const { tabId, spy } of [
      { tabId: explicitTabId, spy: explicitGuest.spy },
      { tabId: implicitTabId, spy: implicitGuest.spy },
    ]) {
      expect(spy.cdpCalls).toContainEqual({
        method: "Emulation.setDeviceMetricsOverride",
        params: {
          width: 1280,
          height: 720,
          deviceScaleFactor: 1,
          mobile: false,
          dontSetVisibleSize: true,
        },
      });
      expect(viewportChanges).toContainEqual({
        tabId,
        viewport: { width: 1280, height: 720 },
      });
    }

    const metricsCallCount = explicitGuest.spy.cdpCalls.filter(
      (call) => call.method === "Emulation.setDeviceMetricsOverride",
    ).length;
    await mgr.execute(context("explicit-navigate-existing"), {
      method: "navigate",
      tabId: explicitTabId,
      url: "https://explicit.example/next",
    });
    expect(
      explicitGuest.spy.cdpCalls.filter(
        (call) => call.method === "Emulation.setDeviceMetricsOverride",
      ),
    ).toHaveLength(metricsCallCount);
    await expect(mgr.execute(context("explicit-list"), { method: "list" })).resolves.toMatchObject({
      tabs: [expect.objectContaining({ viewport: { width: 1280, height: 720 } })],
    });
  });

  it("User-created regular-sized tabs are not resized when claimed or navigated by model", async () => {
    const viewportChanges: Array<{ width: number; height: number } | null> = [];
    const user = registerGuest(210);
    user.spy.url = "https://user.example/first";
    user.spy.viewport = { width: 930, height: 640 };
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      undefined,
      undefined,
      undefined,
      (viewport) => viewportChanges.push(viewport),
    );
    mgr.attachGuest("browser:user-size", 210, {
      active: true,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-user",
    });
    const context = (requestId: string) => ({
      requestId,
      browserId: "iab-user-size",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-user",
      clientMode: "desktop-continuous" as const,
    });

    await expect(
      mgr.execute(context("claim-user-size"), {
        method: "claimTab",
        tabId: "browser:user-size",
      }),
    ).resolves.toMatchObject({
      tab: { viewport: { width: 930, height: 640 } },
    });
    expect(viewportChanges).toEqual([]);
    expect(
      user.spy.cdpCalls.filter((call) => call.method === "Emulation.setDeviceMetricsOverride"),
    ).toHaveLength(0);

    await mgr.execute(context("navigate-user-normal"), {
      method: "navigate",
      tabId: "browser:user-size",
      url: "https://user.example/second",
    });
    await expect(
      mgr.execute(context("list-user-normal"), { method: "list" }),
    ).resolves.toMatchObject({
      tabs: [{ tabId: "browser:user-size", viewport: { width: 930, height: 640 } }],
    });

    await mgr.updateViewportFromRenderer("browser:user-size", { width: 393, height: 852 }, 1);
    const metricsCallCount = user.spy.cdpCalls.filter(
      (call) => call.method === "Emulation.setDeviceMetricsOverride",
    ).length;
    await mgr.execute(context("navigate-user-responsive"), {
      method: "navigate",
      tabId: "browser:user-size",
      url: "https://user.example/third",
    });
    expect(
      user.spy.cdpCalls.filter((call) => call.method === "Emulation.setDeviceMetricsOverride"),
    ).toHaveLength(metricsCallCount);
    await expect(
      mgr.execute(context("list-user-responsive"), { method: "list" }),
    ).resolves.toMatchObject({
      tabs: [{ tabId: "browser:user-size", viewport: { width: 393, height: 852 } }],
    });
  });

  it("human tabs 按 session 隔离，并从 openTabs 过滤空 URL 与 about:blank", async () => {
    const blank = registerGuest(90);
    blank.spy.url = "about:blank";
    const unloaded = registerGuest(91);
    unloaded.spy.url = "";
    const ready = registerGuest(92);
    ready.spy.url = "https://owner.example/page";
    const mgr = new BrowserGuestManager();
    for (const [tabId, webContentsId] of [
      ["browser:blank", 90],
      ["browser:unloaded", 91],
      ["browser:ready", 92],
    ] as const) {
      mgr.attachGuest(tabId, webContentsId, {
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-owner",
      });
    }
    const context = (sessionId: string, requestId: string) => ({
      requestId,
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId,
      clientMode: "desktop-continuous" as const,
    });

    await expect(
      mgr.execute(context("session-owner", "list-owner"), {
        method: "listUserTabs",
      }),
    ).resolves.toMatchObject({
      userTabs: [expect.objectContaining({ id: "browser:ready" })],
    });
    await expect(
      mgr.execute(context("session-other", "list-other"), {
        method: "listUserTabs",
      }),
    ).resolves.toMatchObject({ userTabs: [] });

    const legacyReady = registerGuest(93);
    legacyReady.spy.url = "https://legacy.example";
    mgr.attachGuest("browser:legacy-unscoped", 93, {
      windowId: 1,
      workspaceKey: "/repo",
    });
    await expect(
      mgr.execute(context("session-owner", "list-after-legacy"), {
        method: "listUserTabs",
      }),
    ).resolves.toMatchObject({
      userTabs: [expect.objectContaining({ id: "browser:ready" })],
    });
  });

  it("finalize keep subset marks listed tabs only; unlisted tabs remain open", async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      (tabId) => closed.push(tabId),
      (tabId) => opened.push(tabId),
    );
    const context = {
      requestId: "finalize-subset",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };
    const newAttachedTab = async (requestId: string, webContentsId: number) => {
      const pending = mgr.execute({ ...context, requestId }, { method: "newTab" });
      await Promise.resolve();
      const tabId = opened.at(-1)!;
      const guest = registerGuest(webContentsId);
      guest.spy.url = `https://session-one.example/${requestId}`;
      mgr.attachGuest(tabId, webContentsId, { windowId: 1 });
      await pending;
      return tabId;
    };

    const handoffTabId = await newAttachedTab("new-handoff", 87);
    const unlistedTabId = await newAttachedTab("new-unlisted", 88);
    const deliverableTabId = await newAttachedTab("new-deliverable", 89);

    await mgr.execute(
      { ...context, requestId: "finalize" },
      {
        method: "finalizeTabs",
        keep: [
          { tabId: handoffTabId, status: "handoff" },
          { tabId: deliverableTabId, status: "deliverable" },
        ],
      },
    );

    expect(closed).toEqual([]);
    await expect(
      mgr.execute({ ...context, requestId: "list-controlled" }, { method: "list" }),
    ).resolves.toMatchObject({
      tabs: expect.arrayContaining([
        expect.objectContaining({ tabId: handoffTabId, lifecycle: "handoff" }),
        expect.objectContaining({ tabId: unlistedTabId }),
      ]),
    });
    await expect(
      mgr.execute(
        {
          ...context,
          requestId: "list-released-other",
          sessionId: "session-2",
        },
        { method: "listUserTabs" },
      ),
    ).resolves.toMatchObject({ userTabs: [] });
    await expect(
      mgr.execute({ ...context, requestId: "list-released-owner" }, { method: "listUserTabs" }),
    ).resolves.toMatchObject({
      userTabs: [expect.objectContaining({ id: deliverableTabId })],
    });
  });

  it("turnEnded preserves all agent tabs if model misses finalize", async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      (tabId) => closed.push(tabId),
      (tabId) => opened.push(tabId),
    );
    const context = {
      requestId: "turn-fallback",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };

    const firstPending = mgr.execute({ ...context, requestId: "new-first" }, { method: "newTab" });
    await Promise.resolve();
    const firstTabId = opened.at(-1)!;
    registerGuest(76);
    mgr.attachGuest(firstTabId, 76, { active: false, windowId: 1 });
    await firstPending;

    const finalPending = mgr.execute({ ...context, requestId: "new-final" }, { method: "newTab" });
    await Promise.resolve();
    const finalTabId = opened.at(-1)!;
    registerGuest(77);
    mgr.attachGuest(finalTabId, 77, { active: true, windowId: 1 });
    await finalPending;

    await mgr.execute(
      { ...context, requestId: "turn-ended" },
      { method: "turnEnded", turnId: "turn-1" },
    );

    expect(closed).toEqual([]);
    await expect(
      mgr.execute({ ...context, requestId: "list-controlled" }, { method: "list" }),
    ).resolves.toMatchObject({
      tabs: expect.arrayContaining([
        expect.objectContaining({ tabId: firstTabId }),
        expect.objectContaining({ tabId: finalTabId }),
      ]),
    });
    await expect(
      mgr.execute(
        { ...context, requestId: "list-visible", sessionId: "session-2" },
        { method: "listUserTabs" },
      ),
    ).resolves.toMatchObject({ userTabs: [] });
    await expect(
      mgr.execute(
        { ...context, requestId: "continue-next-turn", turnId: "turn-2" },
        { method: "getState", tabId: finalTabId },
      ),
    ).resolves.toMatchObject({
      ok: true,
      meta: { tabId: finalTabId, lifecycle: "active" },
    });
    await expect(
      mgr.execute(
        { ...context, requestId: "continue-first-tab", turnId: "turn-2" },
        { method: "getState", tabId: firstTabId },
      ),
    ).resolves.toMatchObject({
      ok: true,
      meta: { tabId: firstTabId, lifecycle: "active" },
    });
  });

  it("turnEnded releases guest CDP; subsequent guest destruction no longer opens main process UAF window", async () => {
    const opened: string[] = [];
    const logs: string[] = [];
    const mgr = new BrowserGuestManager(
      (msg) => logs.push(msg),
      5_000,
      () => {},
      (tabId) => opened.push(tabId),
    );
    const context = {
      requestId: "turn-cdp-release",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };

    const pending = mgr.execute({ ...context, requestId: "new-tab" }, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened.at(-1)!;
    const { guest, spy } = registerGuest(90);
    mgr.attachGuest(tabId, 90, { active: true, windowId: 1 });
    await pending;
    expect(spy.attached).toBe(true);

    await mgr.execute(
      { ...context, requestId: "turn-ended" },
      { method: "turnEnded", turnId: "turn-1" },
    );

    expect(spy.detachCalls).toBe(1);
    expect(spy.attached).toBe(false);

    guest.close();
    await Promise.resolve();
    expect(logs.some((msg) => msg.includes("still attached on destroyed guest"))).toBe(false);
  });

  it("turnEnded 后的下一条 CDP 命令 lazy re-attach 并执行成功", async () => {
    const opened: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      () => {},
      (tabId) => opened.push(tabId),
    );
    const context = {
      requestId: "turn-cdp-relatch",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };

    const pending = mgr.execute({ ...context, requestId: "new-tab" }, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened.at(-1)!;
    const { spy } = registerGuest(91);
    mgr.attachGuest(tabId, 91, { active: true, windowId: 1 });
    await pending;

    await mgr.execute(
      { ...context, requestId: "turn-ended" },
      { method: "turnEnded", turnId: "turn-1" },
    );
    expect(spy.attached).toBe(false);

    await expect(
      mgr.execute(
        { ...context, requestId: "viewport-next-turn", turnId: "turn-2" },
        { method: "browserViewportSet", tabId, width: 1024, height: 768 },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(spy.attached).toBe(true);
    expect(spy.cdpCalls.some(({ method }) => method === "Emulation.setDeviceMetricsOverride")).toBe(
      true,
    );
  });

  it("closeSession 释放 guest CDP", async () => {
    const opened: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      () => {},
      (tabId) => opened.push(tabId),
    );
    const context = {
      requestId: "session-cdp-release",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };

    const pending = mgr.execute({ ...context, requestId: "new-tab" }, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened.at(-1)!;
    const { spy } = registerGuest(92);
    mgr.attachGuest(tabId, 92, { active: true, windowId: 1 });
    await pending;

    await mgr.execute({ ...context, requestId: "close-session" }, { method: "closeSession" });

    expect(spy.detachCalls).toBe(1);
    expect(spy.attached).toBe(false);
  });

  it("turnEnded waits for in-flight CDP command to finish before releasing without interrupting it", async () => {
    const opened: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      () => {},
      (tabId) => opened.push(tabId),
    );
    const context = {
      requestId: "turn-cdp-inflight",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };

    const pending = mgr.execute({ ...context, requestId: "new-tab" }, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened.at(-1)!;
    const { guest, spy } = registerGuest(93);
    mgr.attachGuest(tabId, 93, { active: true, windowId: 1 });
    await pending;

    const inflight = createDeferred<void>();
    const originalSend = guest.debugger.sendCommand;
    guest.debugger.sendCommand = async (method: string, params?: unknown) => {
      if (method === "Emulation.setDeviceMetricsOverride") await inflight.promise;
      return originalSend(method, params);
    };

    const commandPending = mgr.execute(
      { ...context, requestId: "viewport-inflight" },
      { method: "browserViewportSet", tabId, width: 1024, height: 768 },
    );
    await Promise.resolve();
    await Promise.resolve();

    await mgr.execute(
      { ...context, requestId: "turn-ended" },
      { method: "turnEnded", turnId: "turn-1" },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(spy.detachCalls).toBe(0);

    inflight.resolve();
    await commandPending;
    await new Promise<void>((resolve) => setTimeout(resolve, 30));
    expect(spy.detachCalls).toBe(1);
    expect(spy.attached).toBe(false);
  });

  it("CDP command stream auto-releases when idle, eliminating UAF exposure window between commands within turn", async () => {
    const opened: string[] = [];
    const logs: string[] = [];
    const mgr = new BrowserGuestManager(
      (msg) => logs.push(msg),
      5_000,
      () => {},
      (tabId) => opened.push(tabId),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      50,
    );
    const context = {
      requestId: "cdp-idle-release",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };

    const pending = mgr.execute({ ...context, requestId: "new-tab" }, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened.at(-1)!;
    const { guest, spy } = registerGuest(94);
    mgr.attachGuest(tabId, 94, { active: true, windowId: 1 });
    await pending;

    await mgr.execute(
      { ...context, requestId: "viewport-1" },
      { method: "browserViewportSet", tabId, width: 1024, height: 768 },
    );
    expect(spy.attached).toBe(true);

    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(spy.attached).toBe(false);
    expect(logs.some((msg) => msg.includes("cdp released after cdp idle"))).toBe(true);

    await expect(
      mgr.execute(
        { ...context, requestId: "viewport-2" },
        { method: "browserViewportSet", tabId, width: 800, height: 600 },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(spy.attached).toBe(true);

    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    guest.close();
    await Promise.resolve();
    expect(logs.some((msg) => msg.includes("still attached on destroyed guest"))).toBe(false);
  });

  it("re-attach after idle release replays Page.enable and viewport override (restores per-session state)", async () => {
    const opened: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      () => {},
      (tabId) => opened.push(tabId),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      50, // cdpIdleReleaseMs
    );
    const context = {
      requestId: "replay-session-state",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };

    const pending = mgr.execute({ ...context, requestId: "new-tab" }, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened.at(-1)!;
    const { spy } = registerGuest(95);
    mgr.attachGuest(tabId, 95, { active: true, windowId: 1 });
    await pending;
    await mgr.execute(
      { ...context, requestId: "viewport-set" },
      { method: "browserViewportSet", tabId, width: 1024, height: 768 },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(spy.attached).toBe(false);
    spy.cdpCalls.length = 0;

    await expect(
      mgr.execute(
        { ...context, requestId: "next-command" },
        { method: "browserViewportSet", tabId, width: 1024, height: 768 },
      ),
    ).resolves.toMatchObject({ ok: true });

    const methods = spy.cdpCalls.map(({ method }) => method);
    const pageEnableIndex = methods.indexOf("Page.enable");
    const overrideIndex = methods.indexOf("Emulation.setDeviceMetricsOverride");
    expect(pageEnableIndex).toBeGreaterThanOrEqual(0);
    expect(overrideIndex).toBeGreaterThan(pageEnableIndex);
    expect(
      spy.cdpCalls.some(
        ({ method, params }) =>
          method === "Emulation.setDeviceMetricsOverride" &&
          (params as { width: number }).width === 1024,
      ),
    ).toBe(true);
  });

  it("Do not dispatch caller commands before re-attach Page.enable completes (explicit serialization barrier)", async () => {
    const opened: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      () => {},
      (tabId) => opened.push(tabId),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      50, // cdpIdleReleaseMs
    );
    const context = {
      requestId: "replay-barrier",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };

    const pending = mgr.execute({ ...context, requestId: "new-tab" }, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened.at(-1)!;
    const { guest, spy } = registerGuest(96);
    mgr.attachGuest(tabId, 96, { active: true, windowId: 1 });
    await pending;

    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(spy.attached).toBe(false);

    const arrivals: string[] = [];
    const pageEnableGate = createDeferred<void>();
    const originalSend = guest.debugger.sendCommand;
    guest.debugger.sendCommand = async (method: string, params?: unknown) => {
      arrivals.push(method);
      if (method === "Page.enable") await pageEnableGate.promise;
      return originalSend(method, params);
    };
    spy.cdpCalls.length = 0;

    const commandPending = mgr.execute(
      { ...context, requestId: "blocked-until-restored" },
      { method: "browserViewportSet", tabId, width: 1024, height: 768 },
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    expect(arrivals).toEqual(["Page.enable"]);

    pageEnableGate.resolve();
    await commandPending;
    const methods = spy.cdpCalls.map(({ method }) => method);
    expect(methods.indexOf("Emulation.setDeviceMetricsOverride")).toBeGreaterThan(
      methods.indexOf("Page.enable"),
    );
  });

  it("Session recovery failure must reject business commands; the next command rebuilds recovery flight", async () => {
    const opened: string[] = [];
    const logs: string[] = [];
    const mgr = new BrowserGuestManager(
      (msg) => logs.push(msg),
      5_000,
      () => {},
      (tabId) => opened.push(tabId),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      50, // cdpIdleReleaseMs
    );
    const context = {
      requestId: "restore-failure",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };

    const pending = mgr.execute({ ...context, requestId: "new-tab" }, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened.at(-1)!;
    const { spy } = registerGuest(97);
    mgr.attachGuest(tabId, 97, { active: true, windowId: 1 });
    await pending;
    await mgr.execute(
      { ...context, requestId: "viewport-prep" },
      { method: "browserViewportSet", tabId, width: 1024, height: 768 },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    expect(spy.attached).toBe(false);

    spy.cdpCalls.length = 0;
    let failPageEnable = true;
    const guest98 = guestRegistry.get(97)!;
    const realSend = guest98.debugger.sendCommand;
    guest98.debugger.sendCommand = async (method: string, params?: unknown) => {
      if (method === "Page.enable" && failPageEnable) throw new Error("renderer gone");
      return realSend(method, params);
    };

    await expect(
      mgr.execute(
        { ...context, requestId: "command-during-broken-restore" },
        { method: "browserViewportSet", tabId, width: 800, height: 600 },
      ),
    ).rejects.toThrow("renderer gone");
    expect(spy.cdpCalls.some(({ method }) => method === "Emulation.setDeviceMetricsOverride")).toBe(
      false,
    );
    expect(logs.some((msg) => msg.includes("Page.enable replay failed"))).toBe(true);

    failPageEnable = false;
    await expect(
      mgr.execute(
        { ...context, requestId: "command-after-recovery" },
        { method: "browserViewportSet", tabId, width: 800, height: 600 },
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(logs.some((msg) => msg.includes("cdp session state replayed"))).toBe(true);
  });

  it("Retain subsequently created active tabs even when turnEnded already has a handoff", async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      (tabId) => closed.push(tabId),
      (tabId) => opened.push(tabId),
    );
    const context = {
      requestId: "turn-handoff",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };

    const handoffPending = mgr.execute(
      { ...context, requestId: "new-handoff" },
      { method: "newTab" },
    );
    await Promise.resolve();
    const handoffTabId = opened.at(-1)!;
    registerGuest(78);
    mgr.attachGuest(handoffTabId, 78, { active: false, windowId: 1 });
    await handoffPending;
    await mgr.execute(
      { ...context, requestId: "mark-handoff" },
      { method: "markHandoff", tabId: handoffTabId },
    );

    const temporaryPending = mgr.execute(
      { ...context, requestId: "new-temporary" },
      { method: "newTab" },
    );
    await Promise.resolve();
    const temporaryTabId = opened.at(-1)!;
    registerGuest(79);
    mgr.attachGuest(temporaryTabId, 79, { active: true, windowId: 1 });
    await temporaryPending;

    await mgr.execute(
      { ...context, requestId: "turn-ended" },
      { method: "turnEnded", turnId: "turn-1" },
    );

    expect(closed).toEqual([]);
    await expect(
      mgr.execute({ ...context, requestId: "list-handoff" }, { method: "list" }),
    ).resolves.toMatchObject({
      tabs: expect.arrayContaining([
        expect.objectContaining({ tabId: handoffTabId, lifecycle: "handoff" }),
        expect.objectContaining({ tabId: temporaryTabId }),
      ]),
    });
  });

  it("显式 close 后拒绝迟到 attach", async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      (tabId) => closed.push(tabId),
      (tabId) => opened.push(tabId),
    );
    const context = {
      requestId: "req-new",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      clientMode: "desktop-continuous" as const,
    };
    const pending = mgr.execute(context, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened[0]!;
    registerGuest(73);
    mgr.attachGuest(tabId, 73, { windowId: 1 });
    await pending;

    const close = await mgr.execute(
      { ...context, requestId: "req-close" },
      {
        method: "close",
        tabId,
      },
    );
    expect(close.meta).toMatchObject({
      tabId,
      lifecycle: "closed",
      openTabIds: [],
    });
    expect(closed).toEqual([tabId]);

    registerGuest(74);
    mgr.attachGuest(tabId, 74, { windowId: 1 });
    expect(mgr.hasGuest(tabId)).toBe(false);
    const list = await mgr.execute({ ...context, requestId: "req-list" }, { method: "list" });
    expect(list.tabs).toEqual([]);
  });

  it("cancelRequest can interrupt ready waiters and distinguish non-dispatched side effects", async () => {
    const opened: string[] = [];
    const mgr = new BrowserGuestManager(undefined, 5_000, undefined, (tabId) => opened.push(tabId));
    const context = {
      requestId: "req-waiting",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };
    const pending = mgr.execute(context, { method: "getState" });
    await Promise.resolve();
    expect(opened).toHaveLength(1);
    const crossScopeCancel = await mgr.execute(
      {
        ...context,
        requestId: "req-cross-scope-cancel",
        sessionId: "session-2",
      },
      { method: "cancelRequest", requestId: context.requestId },
    );
    expect(crossScopeCancel.value).toEqual({ cancelled: false });
    const cancel = await mgr.execute(
      { ...context, requestId: "req-cancel" },
      { method: "cancelRequest", requestId: context.requestId },
    );
    expect(cancel.value).toEqual({ cancelled: true });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled", sideEffect: "none" },
    });
  });

  it("Concurrent duplicate requestId in the same scope fails immediately without overwriting the original request", async () => {
    const opened: string[] = [];
    const mgr = new BrowserGuestManager(undefined, 5_000, undefined, (tabId) => opened.push(tabId));
    const context = {
      requestId: "duplicate-running",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };
    const original = mgr.execute(context, { method: "getState" });
    await Promise.resolve();

    await expect(mgr.execute(context, { method: "snapshot" })).resolves.toMatchObject({
      ok: false,
      error: { code: "duplicate_request_id", sideEffect: "none" },
    });
    expect(opened).toHaveLength(1);

    const cancel = await mgr.execute(
      { ...context, requestId: "cancel-original" },
      { method: "cancelRequest", requestId: context.requestId },
    );
    expect(cancel.value).toEqual({ cancelled: true });
    await expect(original).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled", sideEffect: "none" },
    });
  });

  it("Cross-scope concurrent duplicate requestId fails immediately, and the original scope can still be cancelled", async () => {
    const opened: string[] = [];
    const mgr = new BrowserGuestManager(undefined, 5_000, undefined, (tabId) => opened.push(tabId));
    const context = {
      requestId: "cross-scope-duplicate-running",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      turnId: "turn-1",
      clientMode: "desktop-continuous" as const,
    };
    const original = mgr.execute(context, { method: "getState" });
    await Promise.resolve();

    await expect(
      mgr.execute({ ...context, sessionId: "session-2" }, { method: "snapshot" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "duplicate_request_id", sideEffect: "none" },
    });
    expect(opened).toHaveLength(1);

    const crossScopeCancel = await mgr.execute(
      {
        ...context,
        requestId: "cancel-from-other-scope",
        sessionId: "session-2",
      },
      { method: "cancelRequest", requestId: context.requestId },
    );
    expect(crossScopeCancel.value).toEqual({ cancelled: false });
    const ownerCancel = await mgr.execute(
      { ...context, requestId: "cancel-from-owner" },
      { method: "cancelRequest", requestId: context.requestId },
    );
    expect(ownerCancel.value).toEqual({ cancelled: true });
    await expect(original).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled", sideEffect: "none" },
    });
  });

  it("tabs.new 在 ready 前取消会关闭 provisional tab 并拒绝迟到 attach", async () => {
    const opened: string[] = [];
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      (tabId) => closed.push(tabId),
      (tabId) => opened.push(tabId),
    );
    const context = {
      requestId: "req-new-cancelled",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      clientMode: "desktop-continuous" as const,
    };
    const pending = mgr.execute(context, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened[0]!;
    await mgr.execute(
      { ...context, requestId: "req-cancel-new" },
      { method: "cancelRequest", requestId: context.requestId },
    );

    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled", sideEffect: "none" },
      meta: { tabId, lifecycle: "closed", openTabIds: [] },
    });
    expect(closed).toEqual([tabId]);
    registerGuest(76);
    mgr.attachGuest(tabId, 76, { windowId: 1, workspaceKey: "/repo" });
    expect(mgr.hasGuest(tabId)).toBe(false);
  });

  it("动作下发后的 cancel 标记 uncertain side effect", async () => {
    const registered = registerGuest(83);
    const opened: string[] = [];
    let finishNavigation!: () => void;
    registered.guest.loadURL = async (url: string) => {
      registered.spy.loadedUrl = url;
      await new Promise<void>((resolve) => {
        finishNavigation = resolve;
      });
    };
    const mgr = new BrowserGuestManager(undefined, 5_000, undefined, (tabId) => opened.push(tabId));
    const context = {
      requestId: "create-side-effect-tab",
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-1",
      clientMode: "desktop-continuous" as const,
    };
    const createPending = mgr.execute(context, { method: "newTab" });
    await Promise.resolve();
    const tabId = opened[0]!;
    mgr.attachGuest(tabId, 83, { windowId: 1 });
    await createPending;

    const requestId = "navigate-side-effect";
    const pending = mgr.execute(
      { ...context, requestId },
      { method: "navigate", url: "https://side-effect.example", tabId },
    );
    await vi.waitFor(() => expect(registered.spy.loadedUrl).toBe("https://side-effect.example"));
    const cancel = await mgr.execute(
      { ...context, requestId: "cancel-side-effect" },
      { method: "cancelRequest", requestId },
    );
    expect(cancel.value).toEqual({ cancelled: true });
    await expect(pending).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled", sideEffect: "uncertain" },
    });
    finishNavigation();
  });

  it("finalize marks tab as deliverable and keeps it in the current scope", async () => {
    registerGuest(84);
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("deliverable", 84, { active: true });
    const finalized = await mgr.execute("deliverable", { method: "finalize" });
    expect(finalized.meta).toMatchObject({
      tabId: "deliverable",
      lifecycle: "deliverable",
    });
    const listed = await mgr.execute("deliverable", { method: "list" });
    expect(listed.tabs).toEqual([
      expect.objectContaining({
        tabId: "deliverable",
        lifecycle: "deliverable",
      }),
    ]);
  });

  it("playwrightWaitForTimeout 校验 tab、按时完成且可由 AbortSignal 取消", async () => {
    registerGuest(85);
    const mgr = new BrowserGuestManager();
    mgr.attachGuest("wait-tab", 85, { active: true });

    const startedAt = Date.now();
    const completed = await mgr.execute("wait-tab", {
      method: "playwrightWaitForTimeout",
      timeoutMs: 20,
      tabId: "wait-tab",
    });
    expect(completed).toMatchObject({
      ok: true,
      meta: { tabId: "wait-tab", lifecycle: "active" },
    });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);

    const controller = new AbortController();
    const cancelled = mgr.execute(
      "wait-tab",
      {
        method: "playwrightWaitForTimeout",
        timeoutMs: 5_000,
        tabId: "wait-tab",
      },
      controller.signal,
    );
    controller.abort();
    await expect(cancelled).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled", sideEffect: "none" },
    });
  });

  it("closeSession({ closeTabs }) 关闭该 session 名下全部 tab（含已释放的），Other session 不动", async () => {
    const opened: Array<{ tabId: string; sessionId: string }> = [];
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      (tabId) => closed.push(tabId),
      (tabId, owner) => opened.push({ tabId, sessionId: owner.sessionId }),
    );
    const context = (sessionId: string, requestId: string) => ({
      requestId,
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId,
      clientMode: "desktop-continuous" as const,
    });
    const openTab = async (sessionId: string, guestId: number, url: string) => {
      const before = opened.length;
      const pending = mgr.execute(context(sessionId, `new-${guestId}`), { method: "newTab" });
      await vi.waitFor(() => expect(opened.length).toBe(before + 1));
      const tabId = opened.at(-1)!.tabId;
      const registered = registerGuest(guestId);
      registered.spy.url = url;
      mgr.attachGuest(tabId, guestId, { windowId: 1 });
      await pending;
      return tabId;
    };
    const actor = "sess_dwf-dwfrun-1-actor_1_1";
    const controlledTabId = await openTab(actor, 91, "https://controlled.example");
    const deliveredTabId = await openTab(actor, 92, "https://delivered.example");
    const otherTabId = await openTab("s2", 93, "https://other.example");
    await mgr.execute(context(actor, "finalize"), {
      method: "finalizeTabs",
      keep: [{ tabId: deliveredTabId, status: "deliverable" }],
    });
    await expect(
      mgr.execute(context(actor, "list-before"), { method: "list" }),
    ).resolves.toMatchObject({ tabs: [expect.objectContaining({ tabId: controlledTabId })] });

    await expect(
      mgr.execute(context(actor, "close-session"), { method: "closeSession", closeTabs: true }),
    ).resolves.toMatchObject({ ok: true });

    expect([...closed].sort()).toEqual([controlledTabId, deliveredTabId].sort());
    await expect(
      mgr.execute(context(actor, "list-after"), { method: "list" }),
    ).resolves.toMatchObject({ tabs: [] });
    await expect(
      mgr.execute(context(actor, "user-after"), { method: "listUserTabs" }),
    ).resolves.toMatchObject({ userTabs: [] });
    await expect(
      mgr.execute(context("s2", "list-other"), { method: "list" }),
    ).resolves.toMatchObject({
      tabs: [expect.objectContaining({ tabId: otherTabId })],
    });
  });

  it("closeSession 只释放目标 scope 的 tabs 且不关闭 view", async () => {
    const opened: Array<{ tabId: string; sessionId: string }> = [];
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      (tabId) => closed.push(tabId),
      (tabId, owner) => opened.push({ tabId, sessionId: owner.sessionId }),
    );
    const context = (sessionId: string, requestId: string) => ({
      requestId,
      browserId: "iab-1",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId,
      clientMode: "desktop-continuous" as const,
    });
    const firstPending = mgr.execute(context("s1", "new-1"), {
      method: "newTab",
    });
    await Promise.resolve();
    const firstTabId = opened.find((entry) => entry.sessionId === "s1")!.tabId;
    const first = registerGuest(81);
    first.spy.url = "https://first.example";
    mgr.attachGuest(firstTabId, 81, { windowId: 1 });
    await firstPending;

    const secondPending = mgr.execute(context("s2", "new-2"), {
      method: "newTab",
    });
    await Promise.resolve();
    const secondTabId = opened.find((entry) => entry.sessionId === "s2")!.tabId;
    const second = registerGuest(82);
    second.spy.url = "https://second.example";
    mgr.attachGuest(secondTabId, 82, { windowId: 1 });
    await secondPending;

    const claimed = registerGuest(83);
    claimed.spy.url = "https://claimed.example";
    mgr.attachGuest("browser:claimed-on-close", 83, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "s1",
    });
    await mgr.execute(context("s1", "claim-user-tab"), {
      method: "claimTab",
      tabId: "browser:claimed-on-close",
    });

    await mgr.execute(context("s1", "close-session"), {
      method: "closeSession",
    });
    expect(closed).toEqual([]);
    await expect(mgr.execute(context("s1", "list-1"), { method: "list" })).resolves.toMatchObject({
      tabs: [],
    });
    await expect(mgr.execute(context("s2", "list-2"), { method: "list" })).resolves.toMatchObject({
      tabs: [expect.objectContaining({ tabId: secondTabId })],
    });
    await expect(
      mgr.execute(context("s2", "list-released"), { method: "listUserTabs" }),
    ).resolves.toMatchObject({ userTabs: [] });
    await expect(
      mgr.execute(context("s1", "list-owner-released"), {
        method: "listUserTabs",
      }),
    ).resolves.toMatchObject({
      userTabs: expect.arrayContaining([
        expect.objectContaining({ id: firstTabId }),
        expect.objectContaining({ id: "browser:claimed-on-close" }),
      ]),
    });
  });

  it("BTL04: Permanently close the oldest tab after the 33rd logical tab appears and notify renderer to remove tab shell", async () => {
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => null),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => []),
    };
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      5_000,
      (tabId) => closed.push(tabId),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        tabLimit: 2,
        recoveryStore,
      },
    );

    let oldestGuestSpy: GuestSpy | undefined;
    for (const [index, tabId] of ["browser:a", "browser:b", "browser:c"].entries()) {
      const registered = registerGuest(300 + index);
      if (index === 0) oldestGuestSpy = registered.spy;
      registered.spy.url = `https://example.com/${tabId}`;
      registered.spy.title = tabId;
      mgr.attachGuest(tabId, 300 + index, {
        active: false,
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
      });
      await mgr.reportResidency({
        tabId,
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
        selected: false,
        visible: false,
        currentTask: false,
        loading: false,
        restoreUrl: registered.spy.url,
        title: registered.spy.title,
      });
    }

    await vi.waitFor(() => expect(closed).toEqual(["browser:a"]));
    await vi.waitFor(() => expect(mgr.hasGuest("browser:a")).toBe(false));
    expect(guestRegistry.get(300)?.isDestroyed()).toBe(true);
    expect(oldestGuestSpy?.sessionRemoveAfterDestroyCalls).toBe(0);
    expect(recoveryStore.remove).toHaveBeenCalledWith("browser:a");

    const context = {
      requestId: "logical-list",
      browserId: "unclaimed-iab",
      browserGeneration: 0,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
      clientMode: "desktop-continuous" as const,
    };
    const userTabs = await mgr.execute(context, { method: "listUserTabs" });
    expect(userTabs.userTabs?.map((tab) => tab.id)).toEqual(["browser:b", "browser:c"]);

    await expect(
      mgr.ensureResidentFromRenderer({
        tabId: "browser:a",
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
      }),
    ).rejects.toThrow("unavailable for renderer scope");
  });

  it("Guests currently being captured by Electron will not become eviction victims", async () => {
    const closed: string[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      (tabId) => closed.push(tabId),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        tabLimit: 1,
      },
    );
    const captured = registerGuest(320);
    captured.spy.beingCaptured = true;
    registerGuest(321);
    for (const [tabId, guestId] of [
      ["browser:captured", 320],
      ["browser:eligible", 321],
    ] as const) {
      mgr.attachGuest(tabId, guestId, {
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
      });
      await mgr.reportResidency({
        tabId,
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
        selected: false,
        visible: false,
        currentTask: false,
        loading: false,
      });
    }

    await vi.waitFor(() => expect(closed).toEqual(["browser:eligible"]));
    expect(mgr.hasGuest("browser:captured")).toBe(true);
    expect(mgr.hasGuest("browser:eligible")).toBe(false);
  });

  it("BTL14: attach timeout rolls back to retryable suspended and rejects late guests from older generations", async () => {
    const tabId = "browser:restore-timeout-retry";
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => restoredPageState(tabId)),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => [restoredShellRecord(tabId)]),
    };
    const restoreRequests: Array<{ generation: number }> = [];
    let mgr: InstanceType<typeof BrowserGuestManager>;
    mgr = new BrowserGuestManager(
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        recoveryStore,
        onRestoreTabRequested: (payload) => {
          restoreRequests.push({ generation: payload.generation });
          if (restoreRequests.length !== 2) return;
          registerGuest(334);
          queueMicrotask(() =>
            mgr.attachGuest(payload.tabId, 334, {
              windowId: 1,
              workspaceKey: "/repo",
              sessionId: "session-a",
              residencyGeneration: payload.generation,
            }),
          );
        },
      },
    );
    await mgr.restoreTabs({
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    const request = {
      tabId,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    };

    await expect(mgr.ensureResidentFromRenderer(request)).rejects.toThrow("restore failed");
    expect(restoreRequests).toHaveLength(1);

    const late = registerGuest(333);
    mgr.attachGuest(tabId, 333, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
      residencyGeneration: restoreRequests[0]?.generation,
    });
    expect(mgr.hasGuest(tabId)).toBe(false);
    expect(late.spy.closeCalls).toBe(1);

    await expect(mgr.ensureResidentFromRenderer(request)).resolves.toBeUndefined();
    expect(restoreRequests).toHaveLength(2);
    expect(mgr.hasGuest(tabId)).toBe(true);
  });

  it("BTL14: 单个 caller 取消只结束自身等待，不中止 tab 级共享恢复", async () => {
    const tabId = "browser:restore-caller-cancel";
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => restoredPageState(tabId)),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => [restoredShellRecord(tabId)]),
    };
    let restorePayload: { generation: number } | undefined;
    const mgr = new BrowserGuestManager(
      undefined,
      100,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        recoveryStore,
        onRestoreTabRequested: (payload) => {
          restorePayload = { generation: payload.generation };
        },
      },
    );
    await mgr.restoreTabs({
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    const context = {
      requestId: "cancel-first-restore-caller",
      browserId: "unclaimed-iab",
      browserGeneration: 0,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
      clientMode: "desktop-continuous" as const,
    };
    const controller = new AbortController();
    const first = mgr.execute(context, { method: "getState", tabId }, controller.signal);
    await vi.waitFor(() => expect(restorePayload).toBeDefined());
    controller.abort();

    const second = mgr.ensureResidentFromRenderer({
      tabId,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    registerGuest(335);
    mgr.attachGuest(tabId, 335, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
      residencyGeneration: restorePayload?.generation,
    });

    await expect(second).resolves.toBeUndefined();
    await expect(first).resolves.toMatchObject({
      ok: false,
      error: { code: "cancelled" },
    });
    expect(mgr.hasGuest(tabId)).toBe(true);
  });

  it("BTL15: Retain logical tab and do not notify renderer when persistent deletion on eviction fails", async () => {
    const closed: string[] = [];
    const warnings: string[] = [];
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => null),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => {
        throw new Error("disk unavailable");
      }),
      listShells: vi.fn(async () => []),
    };
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      (tabId) => closed.push(tabId),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        tabLimit: 1,
        recoveryStore,
        warn: (message) => warnings.push(message),
      },
    );
    registerGuest(336);
    mgr.attachGuest("browser:oldest", 336, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    registerGuest(337);
    mgr.attachGuest("browser:newest", 337, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });

    await mgr.reportResidency({
      tabId: "browser:newest",
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
      selected: false,
      visible: false,
      currentTask: false,
      loading: false,
    });

    expect(closed).toEqual([]);
    expect(mgr.hasGuest("browser:oldest")).toBe(true);
    expect(mgr.hasGuest("browser:newest")).toBe(true);
    expect(warnings.some((message) => message.includes("disk unavailable"))).toBe(true);
  });

  it("BTL07/12: Shell stays suspended across restarts; two callers single-flight recover the same guest", async () => {
    const tabId = "browser:restart-single-flight";
    const pageState = restoredPageState(tabId);
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => pageState),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => [restoredShellRecord(tabId)]),
    };
    let restoreRequests = 0;
    let replacementSpy: GuestSpy | undefined;
    let mgr: InstanceType<typeof BrowserGuestManager>;
    mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        recoveryStore,
        onRestoreTabRequested: (payload) => {
          restoreRequests += 1;
          const replacement = registerGuest(330);
          replacementSpy = replacement.spy;
          queueMicrotask(() =>
            mgr.attachGuest(payload.tabId, 330, {
              windowId: 1,
              workspaceKey: "/repo",
              sessionId: "session-a",
              residencyGeneration: payload.generation,
            }),
          );
        },
      },
    );

    const shells = await mgr.restoreTabs({
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    expect(shells).toHaveLength(1);
    expect(shells[0]).toMatchObject({ tabId });
    expect(mgr.hasGuest(tabId)).toBe(false);

    const request = {
      tabId,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    };
    await Promise.all([
      mgr.ensureResidentFromRenderer(request),
      mgr.ensureResidentFromRenderer(request),
    ]);

    expect(restoreRequests).toBe(1);
    expect(replacementSpy?.historyRestoreCalls).toHaveLength(1);
    expect(mgr.hasGuest(tabId)).toBe(true);
  });

  it("BTL17/18: Cold recovery returns real identity and sends terminal live for the same generation upon success", async () => {
    const tabId = "browser:restore-terminal";
    const record = restoredShellRecord(tabId);
    record.origin = "agent";
    record.browserId = "browser-real";
    record.browserGeneration = 11;
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => restoredPageState(tabId)),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => [record]),
    };
    const restoreEvents: Array<{ generation: number; residency: string }> = [];
    let mgr: InstanceType<typeof BrowserGuestManager>;
    mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        recoveryStore,
        onRestoreTabRequested: (payload) => {
          restoreEvents.push({ generation: payload.generation, residency: payload.residency });
          registerGuest(345);
          queueMicrotask(() =>
            mgr.attachGuest(payload.tabId, 345, {
              windowId: 1,
              workspaceKey: "/repo",
              sessionId: "session-a",
              residencyGeneration: payload.generation,
            }),
          );
        },
        onResidencyChanged: (payload) => {
          restoreEvents.push({ generation: payload.generation, residency: payload.residency });
        },
      },
    );

    const shells = await mgr.restoreTabs({
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    expect(shells[0]).toMatchObject({
      browserId: "browser-real",
      browserGeneration: 11,
    });
    await mgr.ensureResidentFromRenderer({
      tabId,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });

    expect(restoreEvents).toHaveLength(2);
    expect(restoreEvents.map((event) => event.residency)).toEqual(["restoring", "live-background"]);
    expect(restoreEvents[1]?.generation).toBe(restoreEvents[0]?.generation);
  });

  it("BTL17: Destroy bootstrap guest and roll back to suspended when both pageState and restoreUrl fail to load", async () => {
    const tabId = "browser:restore-double-failure";
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => restoredPageState(tabId)),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => [restoredShellRecord(tabId)]),
    };
    const residencyEvents: string[] = [];
    let replacementSpy: GuestSpy | undefined;
    let mgr: InstanceType<typeof BrowserGuestManager>;
    mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        recoveryStore,
        onSuspendTabRequested: (payload) => residencyEvents.push(payload.residency),
        onRestoreTabRequested: (payload) => {
          residencyEvents.push(payload.residency);
          if (payload.residency !== "restoring") return;
          const replacement = registerGuest(346);
          replacementSpy = replacement.spy;
          replacement.spy.historyRestoreErrorBeforeApply = new Error("corrupt page state");
          replacement.spy.loadUrlError = new Error("ERR_NAME_NOT_RESOLVED");
          queueMicrotask(() =>
            mgr.attachGuest(payload.tabId, 346, {
              windowId: 1,
              workspaceKey: "/repo",
              sessionId: "session-a",
              residencyGeneration: payload.generation,
            }),
          );
        },
      },
    );
    await mgr.restoreTabs({ windowId: 1, workspaceKey: "/repo", sessionId: "session-a" });

    await expect(
      mgr.ensureResidentFromRenderer({
        tabId,
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
      }),
    ).rejects.toThrow("restore failed");

    expect(residencyEvents).toEqual(["restoring", "suspended"]);
    expect(replacementSpy?.closeCalls).toBe(1);
    expect(mgr.hasGuest(tabId)).toBe(false);
  });

  it("BTL08: Degrade to restoreUrl after deleting corrupted pageState; logical tab continues to exist", async () => {
    const tabId = "browser:corrupt-page-state";
    const restoreUrl = "https://example.com/url-fallback";
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => restoredPageState(tabId)),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => [restoredShellRecord(tabId, restoreUrl)]),
    };
    let replacementSpy: GuestSpy | undefined;
    let mgr: InstanceType<typeof BrowserGuestManager>;
    mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        recoveryStore,
        onRestoreTabRequested: (payload) => {
          const replacement = registerGuest(331);
          replacementSpy = replacement.spy;
          replacement.spy.historyRestoreErrorBeforeApply = new Error("corrupt page state");
          queueMicrotask(() =>
            mgr.attachGuest(payload.tabId, 331, {
              windowId: 1,
              workspaceKey: "/repo",
              sessionId: "session-a",
              residencyGeneration: payload.generation,
            }),
          );
        },
      },
    );
    await mgr.restoreTabs({
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });

    await mgr.ensureResidentFromRenderer({
      tabId,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });

    expect(recoveryStore.removePageState).toHaveBeenCalledWith(tabId);
    expect(replacementSpy?.loadedUrl).toBe(restoreUrl);
    expect(mgr.hasGuest(tabId)).toBe(true);
  });

  it("BTL16: Cold recover using current shell URL when pageState active URL is older than shell restoreUrl", async () => {
    const tabId = "browser:stale-page-state";
    const currentUrl = "https://example.com/current-shell";
    const stalePageState: BrowserTabPageStateRecord = {
      schemaVersion: 1,
      tabId,
      entries: [{ url: "https://example.com/old-snapshot", pageState: "old" }],
      activeIndex: 0,
      updatedAt: 1,
    };
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => stalePageState),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => [restoredShellRecord(tabId, currentUrl)]),
    };
    let replacementSpy: GuestSpy | undefined;
    let mgr: InstanceType<typeof BrowserGuestManager>;
    mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        recoveryStore,
        onRestoreTabRequested: (payload) => {
          const replacement = registerGuest(341);
          replacementSpy = replacement.spy;
          queueMicrotask(() =>
            mgr.attachGuest(payload.tabId, 341, {
              windowId: 1,
              workspaceKey: "/repo",
              sessionId: "session-a",
              residencyGeneration: payload.generation,
            }),
          );
        },
      },
    );
    await mgr.restoreTabs({
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });

    await mgr.ensureResidentFromRenderer({
      tabId,
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });

    expect(recoveryStore.removePageState).toHaveBeenCalledWith(tabId);
    expect(replacementSpy?.historyRestoreCalls).toEqual([]);
    expect(replacementSpy?.loadedUrl).toBe(currentUrl);
  });

  it("BTL13: Target-close orphan when all three types of forced restore facts are missing", async () => {
    const tabId = "browser:recovery-orphan";
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => null),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => [restoredShellRecord(tabId, null)]),
    };
    const orphanCloses: Array<{ tabId: string; reason: "recovery-orphan" }> = [];
    let mgr: InstanceType<typeof BrowserGuestManager>;
    mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        recoveryStore,
        onRecoveryOrphanCloseRequested: (payload) => orphanCloses.push(payload),
        onRestoreTabRequested: (payload) => {
          registerGuest(332);
          queueMicrotask(() =>
            mgr.attachGuest(payload.tabId, 332, {
              windowId: 1,
              workspaceKey: "/repo",
              sessionId: "session-a",
              residencyGeneration: payload.generation,
            }),
          );
        },
      },
    );
    await mgr.restoreTabs({
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });

    await expect(
      mgr.ensureResidentFromRenderer({
        tabId,
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
      }),
    ).rejects.toThrow("restore failed");
    expect(orphanCloses).toEqual([{ tabId, reason: "recovery-orphan" }]);
    expect(mgr.hasGuest(tabId)).toBe(false);
  });

  it("BTL19: remote owner 拒绝缺失 remoteSessionId 的 attach，且Other remote 不可 list/claim", async () => {
    const tabId = "browser:remote-owned";
    const record = restoredShellRecord(tabId);
    record.workspaceKey = "ssh://host/repo";
    record.remoteSessionId = "remote-a";
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => restoredPageState(tabId)),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => [record]),
    };
    let mismatchedGuestSpy: GuestSpy | undefined;
    let mgr: InstanceType<typeof BrowserGuestManager>;
    mgr = new BrowserGuestManager(
      undefined,
      5,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        recoveryStore,
        onRestoreTabRequested: (payload) => {
          if (payload.residency !== "restoring") return;
          const mismatched = registerGuest(347);
          mismatchedGuestSpy = mismatched.spy;
          queueMicrotask(() =>
            mgr.attachGuest(payload.tabId, 347, {
              windowId: 1,
              workspaceKey: "ssh://host/repo",
              sessionId: "session-a",
              residencyGeneration: payload.generation,
            }),
          );
        },
      },
    );
    await mgr.restoreTabs({
      windowId: 1,
      workspaceKey: "ssh://host/repo",
      remoteSessionId: "remote-a",
      sessionId: "session-a",
    });

    const remoteBContext = {
      requestId: "remote-b-list",
      browserId: "browser-b",
      browserGeneration: 1,
      windowId: 1,
      workspaceKey: "ssh://host/repo",
      remoteSessionId: "remote-b",
      sessionId: "session-a",
      clientMode: "desktop-continuous" as const,
    };
    expect((await mgr.execute(remoteBContext, { method: "listUserTabs" })).userTabs).toEqual([]);
    await expect(
      mgr.ensureResidentFromRenderer({
        tabId,
        windowId: 1,
        workspaceKey: "ssh://host/repo",
        remoteSessionId: "remote-a",
        sessionId: "session-a",
      }),
    ).rejects.toThrow("restore failed");
    expect(mismatchedGuestSpy?.closeCalls).toBe(1);

    const claim = await mgr.execute(
      { ...remoteBContext, requestId: "remote-b-claim" },
      { method: "claimTab", tabId },
    );
    expect(claim).toMatchObject({ ok: false, error: { code: "backend_unavailable" } });
  });

  it("BTL11: renderer close validates full scope, deletes recovery facts, and prevents late attach resurrection", async () => {
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => null),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => []),
    };
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { recoveryStore },
    );
    registerGuest(310);
    mgr.attachGuest("browser:close-authority", 310, {
      windowId: 8,
      workspaceKey: "ssh://host/repo",
      remoteSessionId: "remote-8",
      sessionId: "session-8",
    });

    await expect(
      mgr.closeTabFromRenderer({
        tabId: "browser:close-authority",
        windowId: 9,
        workspaceKey: "ssh://host/repo",
        remoteSessionId: "remote-8",
        sessionId: "session-8",
      }),
    ).rejects.toThrow("unavailable");
    await mgr.closeTabFromRenderer({
      tabId: "browser:close-authority",
      windowId: 8,
      workspaceKey: "ssh://host/repo",
      remoteSessionId: "remote-8",
      sessionId: "session-8",
    });
    expect(recoveryStore.remove).toHaveBeenCalledWith("browser:close-authority");
    expect(mgr.hasGuest("browser:close-authority")).toBe(false);

    registerGuest(311);
    mgr.attachGuest("browser:close-authority", 311, {
      windowId: 8,
      workspaceKey: "ssh://host/repo",
      remoteSessionId: "remote-8",
      sessionId: "session-8",
    });
    expect(mgr.hasGuest("browser:close-authority")).toBe(false);
  });

  it("BTL23: Agent close returns success and notifies renderer only after recovery store deletion completes", async () => {
    const removeStarted = createDeferred();
    const releaseRemove = createDeferred();
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => null),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => {
        removeStarted.resolve();
        await releaseRemove.promise;
      }),
      listShells: vi.fn(async () => []),
    };
    const closeNotifications: string[] = [];
    const closeOwners: unknown[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      (tabId, owner) => {
        closeNotifications.push(tabId);
        closeOwners.push(owner);
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { recoveryStore },
    );
    registerGuest(348);
    mgr.attachGuest("browser:durable-close", 348, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    let settled = false;
    const closeResult = mgr
      .execute(
        {
          requestId: "durable-close",
          browserId: "unclaimed-iab",
          browserGeneration: 0,
          windowId: 1,
          workspaceKey: "/repo",
          sessionId: "session-a",
          clientMode: "desktop-continuous",
        },
        { method: "close", tabId: "browser:durable-close" },
      )
      .finally(() => {
        settled = true;
      });

    await removeStarted.promise;
    expect(settled).toBe(false);
    expect(closeNotifications).toEqual([]);
    releaseRemove.resolve();

    await expect(closeResult).resolves.toMatchObject({ ok: true });
    expect(closeNotifications).toEqual(["browser:durable-close"]);
    expect(closeOwners).toMatchObject([{ workspaceKey: "/repo", sessionId: "session-a" }]);
    expect(mgr.hasGuest("browser:durable-close")).toBe(false);
  });

  it("BTL24: Renderer closing the same tab again after Agent close succeeds idempotently; UI shell is never stuck open", async () => {
    const recoveryStore = {
      upsert: vi.fn(async () => undefined),
      upsertPageState: vi.fn(async () => undefined),
      getPageState: vi.fn(async () => null),
      removePageState: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      listShells: vi.fn(async () => []),
    };
    const closeNotifications: string[] = [];
    const closeOwners: unknown[] = [];
    const mgr = new BrowserGuestManager(
      undefined,
      undefined,
      (tabId, owner) => {
        closeNotifications.push(tabId);
        closeOwners.push(owner);
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { recoveryStore },
    );
    registerGuest(352);
    mgr.attachGuest("browser:ghost-close", 352, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    await expect(
      mgr.execute(
        {
          requestId: "agent-close",
          browserId: "unclaimed-iab",
          browserGeneration: 0,
          windowId: 1,
          workspaceKey: "/repo",
          sessionId: "session-a",
          clientMode: "desktop-continuous",
        },
        { method: "close", tabId: "browser:ghost-close" },
      ),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      mgr.closeTabFromRenderer({
        tabId: "browser:ghost-close",
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
      }),
    ).resolves.toBeUndefined();
    expect(closeNotifications).toEqual(["browser:ghost-close"]);
    expect(closeOwners).toMatchObject([{ workspaceKey: "/repo", sessionId: "session-a" }]);
    expect(mgr.hasGuest("browser:ghost-close")).toBe(false);
  });

  it("BTL25: renderer closing a tab unknown to main succeeds idempotently and prevents late attach resurrection", async () => {
    const closeNotifications: string[] = [];
    const mgr = new BrowserGuestManager(undefined, undefined, (tabId) =>
      closeNotifications.push(tabId),
    );

    await expect(
      mgr.closeTabFromRenderer({
        tabId: "browser:unknown-shell",
        windowId: 1,
        workspaceKey: "/repo",
        sessionId: "session-a",
      }),
    ).resolves.toBeUndefined();
    expect(closeNotifications).toEqual([]);

    registerGuest(353);
    mgr.attachGuest("browser:unknown-shell", 353, {
      windowId: 1,
      workspaceKey: "/repo",
      sessionId: "session-a",
    });
    expect(mgr.hasGuest("browser:unknown-shell")).toBe(false);
  });
  it("BTL26: renderer close for remote human tab is not rejected due to missing/drifted remoteSessionId, but still rejects cross-window/workspace/session", async () => {
    const mgr = new BrowserGuestManager();
    registerGuest(360);
    mgr.attachGuest("browser:remote-missing", 360, {
      windowId: 1,
      workspaceKey: "ssh://host/repo",
      remoteSessionId: "remote-1",
      sessionId: "unscoped",
    });

    for (const overrides of [
      { windowId: 2 },
      { workspaceKey: "ssh://host/other" },
      { sessionId: "other-session" },
    ]) {
      await expect(
        mgr.closeTabFromRenderer({
          tabId: "browser:remote-missing",
          windowId: 1,
          workspaceKey: "ssh://host/repo",
          sessionId: "unscoped",
          ...overrides,
        }),
      ).rejects.toThrow("unavailable for renderer scope");
    }

    await expect(
      mgr.closeTabFromRenderer({
        tabId: "browser:remote-missing",
        windowId: 1,
        workspaceKey: "ssh://host/repo",
        sessionId: "unscoped",
      }),
    ).resolves.toBeUndefined();
    expect(mgr.hasGuest("browser:remote-missing")).toBe(false);

    registerGuest(361);
    mgr.attachGuest("browser:remote-drift", 361, {
      windowId: 1,
      workspaceKey: "ssh://host/repo",
      remoteSessionId: "remote-1",
      sessionId: "unscoped",
    });
    await expect(
      mgr.closeTabFromRenderer({
        tabId: "browser:remote-drift",
        windowId: 1,
        workspaceKey: "ssh://host/repo",
        remoteSessionId: "remote-2",
        sessionId: "unscoped",
      }),
    ).resolves.toBeUndefined();
    expect(mgr.hasGuest("browser:remote-drift")).toBe(false);
  });
});
