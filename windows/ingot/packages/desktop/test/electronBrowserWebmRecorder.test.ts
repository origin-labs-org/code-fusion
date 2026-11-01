import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RECORDER_PORT_CHANNEL = "cf-browser-video-recorder:port";
const DEFAULT_MIME = "video/webm;codecs=vp8";

type PortMessageListener = (event: { data: unknown }) => void;
type PortCloseListener = () => void;

class FakePort {
  readonly outbound: Array<Record<string, unknown>> = [];
  started = false;
  closed = false;
  closeError: Error | null = null;
  private readonly messageListeners = new Set<PortMessageListener>();
  private readonly closeListeners = new Set<PortCloseListener>();
  private onOutbound?: (message: Record<string, unknown>) => void;

  driveWith(handler: (message: Record<string, unknown>) => void): void {
    this.onOutbound = handler;
  }

  on(event: string, listener: PortMessageListener | PortCloseListener): void {
    if (event === "message") this.messageListeners.add(listener as PortMessageListener);
    if (event === "close") this.closeListeners.add(listener as PortCloseListener);
  }

  removeListener(event: string, listener: PortMessageListener | PortCloseListener): void {
    if (event === "message") this.messageListeners.delete(listener as PortMessageListener);
    if (event === "close") this.closeListeners.delete(listener as PortCloseListener);
  }

  start(): void {
    this.started = true;
  }

  close(): void {
    if (this.closeError) throw this.closeError;
    this.closed = true;
  }

  postMessage(message: Record<string, unknown>): void {
    this.outbound.push(message);
    this.onOutbound?.(message);
  }

  
  emit(message: Record<string, unknown>): void {
    for (const listener of this.messageListeners) listener({ data: message });
  }

  emitClose(): void {
    for (const listener of this.closeListeners) listener();
  }

  get messageListenerCount(): number {
    return this.messageListeners.size;
  }
}

interface FakeWebContents {
  setWindowOpenHandler: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
  mainFrame: object;
  emit(event: string, ...args: unknown[]): void;
  listenerCount(event: string): number;
}

interface FakeWindow {
  webContents: FakeWebContents;
  loadFile: ReturnType<typeof vi.fn>;
  isDestroyed(): boolean;
  destroy(): void;
  destroyCalls: number;
  options: Record<string, unknown>;
}

interface RendererScript {
  
  ready?: boolean;
  
  startedMimeType?: string | null;
  
  chunksOnStart?: unknown[];
  
  chunksOnStop?: unknown[];
  
  stopped?: boolean;
  
  cancelled?: boolean;
  
  errorOnStart?: string;
  
  errorOnStop?: string;
}

let windows: FakeWindow[] = [];
let ports: Array<{ port1: FakePort; port2: FakePort }> = [];
let sessions: Array<{
  partition: string;
  setDisplayMediaRequestHandler: ReturnType<typeof vi.fn>;
  handler: ((request: unknown, callback: (result: unknown) => void) => void) | null;
  clearError: Error | null;
}> = [];
let renderer: RendererScript = {};
let loadFileError: Error | null = null;

let failOutputWrites = false;

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (path: string, flags: string) => {
      const handle = await actual.open(path, flags);
      return {
        write: async (buffer: Buffer) => {
          if (failOutputWrites) throw new Error("ENOSPC: no space left on device");
          return handle.write(buffer);
        },
        close: () => handle.close(),
      };
    },
  };
});

function createFakeWebContents(): FakeWebContents {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    setWindowOpenHandler: vi.fn(),
    postMessage: vi.fn((channel: string) => {
      if (channel !== RECORDER_PORT_CHANNEL) return;
      if (renderer.ready !== false) ports.at(-1)?.port1.emit({ type: "ready" });
    }),
    mainFrame: { id: "recorder-main-frame" },
    on(event, listener) {
      const bucket = listeners.get(event) ?? new Set();
      bucket.add(listener);
      listeners.set(event, bucket);
    },
    removeListener(event, listener) {
      listeners.get(event)?.delete(listener);
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
    listenerCount(event) {
      return listeners.get(event)?.size ?? 0;
    },
  };
}

vi.mock("electron", () => ({
  BrowserWindow: class {
    webContents = createFakeWebContents();
    loadFile = vi.fn(async () => {
      if (loadFileError) throw loadFileError;
    });
    destroyCalls = 0;
    private destroyed = false;
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      windows.push(this as unknown as FakeWindow);
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    destroy(): void {
      this.destroyed = true;
      this.destroyCalls += 1;
    }
  },
  MessageChannelMain: class {
    port1 = new FakePort();
    port2 = new FakePort();
    constructor() {
      ports.push({ port1: this.port1, port2: this.port2 });
      driveRenderer(this.port1);
    }
  },
  session: {
    fromPartition: (partition: string) => {
      const entry = {
        partition,
        handler: null as ((request: unknown, callback: (result: unknown) => void) => void) | null,
        clearError: null as Error | null,
        setDisplayMediaRequestHandler: vi.fn(
          (handler: ((request: unknown, callback: (result: unknown) => void) => void) | null) => {
            if (handler === null && entry.clearError) throw entry.clearError;
            entry.handler = handler;
          },
        ),
      };
      sessions.push(entry);
      return entry;
    },
  },
}));

const { createElectronBrowserWebmRecorder } = await import(
  "../src/main/browserView/electronBrowserWebmRecorder.js"
);

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-webm-recorder-test-"));
  tempRoots.push(root);
  return root;
}

function driveRenderer(main: FakePort): void {
  main.driveWith((message) => {
    if (message.type === "start") {
      if (renderer.errorOnStart) {
        main.emit({ type: "error", message: renderer.errorOnStart });
        return;
      }
      for (const chunk of renderer.chunksOnStart ?? []) main.emit({ type: "chunk", data: chunk });
      const mime = renderer.startedMimeType === undefined ? DEFAULT_MIME : renderer.startedMimeType;
      if (mime !== null) main.emit({ type: "started", mimeType: mime });
      return;
    }
    if (message.type === "stop") {
      if (renderer.errorOnStop) {
        main.emit({ type: "error", message: renderer.errorOnStop });
        return;
      }
      for (const chunk of renderer.chunksOnStop ?? []) main.emit({ type: "chunk", data: chunk });
      if (renderer.stopped !== false) main.emit({ type: "stopped" });
      return;
    }
    if (message.type === "cancel" && renderer.cancelled) {
      main.emit({ type: "cancelled" });
    }
  });
}

function targetFrame(overrides: { destroyed?: boolean; detached?: boolean } = {}): object {
  return {
    isDestroyed: () => overrides.destroyed ?? false,
    detached: overrides.detached ?? false,
    id: "guest-main-frame",
  };
}

interface StartOptions {
  outputPath: string;
  frame?: object;
  signal?: AbortSignal;
  viewport?: { width: number; height: number };
  fps?: number;
  debug?: (message: string) => void;
}

function startRecorder(options: StartOptions) {
  return createElectronBrowserWebmRecorder(
    {
      outputPath: options.outputPath,
      targetFrame: options.frame ?? targetFrame(),
      viewport: options.viewport ?? { width: 800, height: 600 },
      fps: options.fps ?? 25,
      signal: options.signal ?? new AbortController().signal,
    },
    options.debug,
  );
}

beforeEach(() => {
  windows = [];
  ports = [];
  sessions = [];
  renderer = {};
  loadFileError = null;
  failOutputWrites = false;
});

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("createElectronBrowserWebmRecorder", () => {
  it("Sequentially write renderer chunks to output file and clear temporary recorder document after stop", async () => {
    const root = await createTempRoot();
    const outputPath = join(root, "ok.webm");
    renderer = {
      chunksOnStop: [
        new Uint8Array([0x1a, 0x45]).buffer,
        new Uint8Array([0xdf, 0xa3]),
        Buffer.from([0x42, 0x86]),
      ],
    };

    const recorder = await startRecorder({ outputPath });
    await recorder.stop();

    expect([...(await readFile(outputPath))]).toEqual([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86]);
    const leftovers = await readdir(root);
    expect(leftovers.filter((name) => name.endsWith(".html"))).toEqual([]);
    expect(windows.at(-1)?.isDestroyed()).toBe(true);
    expect(ports.at(-1)?.port1.messageListenerCount).toBe(0);
  });

  it("Ignore empty and non-binary chunks, writing no garbage bytes and not failing", async () => {
    const root = await createTempRoot();
    const outputPath = join(root, "junk.webm");
    renderer = {
      chunksOnStop: [
        new ArrayBuffer(0),
        "not-binary",
        { size: 12 },
        null,
        undefined,
        Buffer.from([0x01]),
      ],
    };

    const recorder = await startRecorder({ outputPath });
    await recorder.stop();

    expect([...(await readFile(outputPath))]).toEqual([0x01]);
  });

  it("BVR07: Reject non-VP8/WebM MediaRecorder MIME and reclaim window/port/session handler", async () => {
    const root = await createTempRoot();
    renderer = { startedMimeType: "video/mp4;codecs=avc1" };

    await expect(
      startRecorder({ outputPath: join(root, "mime.webm") }),
    ).rejects.toThrow(/unexpected MediaRecorder MIME type: video\/mp4;codecs=avc1/u);

    expect(windows.at(-1)?.isDestroyed()).toBe(true);
    expect(ports.at(-1)?.port1.closed).toBe(true);
    expect(ports.at(-1)?.port2.closed).toBe(true);
    expect(sessions.at(-1)?.handler).toBeNull();
  });

  it("BVR07: stop reports exit reason instead of silently producing an empty file when recorder renderer crashes", async () => {
    const root = await createTempRoot();
    const recorder = await startRecorder({ outputPath: join(root, "crash.webm") });

    windows.at(-1)?.webContents.emit("render-process-gone", {}, { reason: "oom" });

    await expect(recorder.stop()).rejects.toThrow(/recorder renderer exited: oom/u);
  });

  it("BVR07: start fails with original reason when renderer-side MediaRecorder throws an error", async () => {
    const root = await createTempRoot();
    renderer = { errorOnStart: "Chromium does not support VP8 WebM MediaRecorder" };

    await expect(startRecorder({ outputPath: join(root, "vp8.webm") })).rejects.toThrow(
      /Chromium does not support VP8 WebM MediaRecorder/u,
    );
    expect(windows.at(-1)?.isDestroyed()).toBe(true);
  });

  it("stop reports an error when MessagePort closes unexpectedly, rather than treating a partial file as complete", async () => {
    const root = await createTempRoot();
    const recorder = await startRecorder({ outputPath: join(root, "port.webm") });

    ports.at(-1)?.port1.emitClose();

    await expect(recorder.stop()).rejects.toThrow(/recorder MessagePort closed unexpectedly/u);
  });

  it("Disk write failure is thrown at stop, not considered successful just because renderer returned stopped", async () => {
    const root = await createTempRoot();
    const recorder = await startRecorder({ outputPath: join(root, "writefail.webm") });

    failOutputWrites = true;
    ports.at(-1)?.port1.emit({ type: "chunk", data: Buffer.from([0x01]) });

    await expect(recorder.stop()).rejects.toThrow(/ENOSPC/u);
  });

  it("Repeated stops only send stop once to renderer and reuse the same stop result", async () => {
    const root = await createTempRoot();
    const recorder = await startRecorder({ outputPath: join(root, "double.webm") });
    renderer.chunksOnStop = [Buffer.from([0x7f])];

    const first = recorder.stop();
    const second = recorder.stop();
    await Promise.all([first, second]);

    const stopMessages = (ports.at(-1)?.port1.outbound ?? []).filter(
      (message) => message.type === "stop",
    );
    expect(stopMessages).toHaveLength(1);
  });

  it("Subsequent stop after completion reports already closed, without reopening reclaimed window", async () => {
    const root = await createTempRoot();
    const recorder = await startRecorder({ outputPath: join(root, "closed.webm") });
    await recorder.stop();
    const destroyCallsAfterStop = windows.at(-1)?.destroyCalls;

    await expect(recorder.stop()).rejects.toThrow(/recorder is already closed/u);
    expect(windows.at(-1)?.destroyCalls).toBe(destroyCallsAfterStop);
  });

  it("cancel is idempotent: multiple calls reclaim window only once and send cancel only once", async () => {
    const root = await createTempRoot();
    renderer = { cancelled: true };
    const recorder = await startRecorder({ outputPath: join(root, "cancel.webm") });

    await recorder.cancel();
    await recorder.cancel();
    await recorder.cancel();

    expect(windows.at(-1)?.destroyCalls).toBe(1);
    const cancelMessages = (ports.at(-1)?.port1.outbound ?? []).filter(
      (message) => message.type === "cancel",
    );
    expect(cancelMessages).toHaveLength(1);
  });

  it("BVR04: External abort immediately reclaims recorder and causes stop to report already closed", async () => {
    const root = await createTempRoot();
    const controller = new AbortController();
    const recorder = await startRecorder({
      outputPath: join(root, "abort.webm"),
      signal: controller.signal,
    });

    controller.abort(new DOMException("turn ended", "AbortError"));

    await vi.waitFor(() => {
      expect(windows.at(-1)?.destroyCalls).toBe(1);
    });
    await expect(recorder.stop()).rejects.toThrow(/recorder is already closed/u);
  });

  it("Aborted signal does not create any recorder window", async () => {
    const root = await createTempRoot();
    const controller = new AbortController();
    controller.abort();

    await expect(
      startRecorder({ outputPath: join(root, "pre-abort.webm"), signal: controller.signal }),
    ).rejects.toThrow(/Browser recording cancelled/u);
    expect(windows).toHaveLength(0);
  });

  it("Reject directly when target frame is destroyed or detached, without creating recorder window", async () => {
    const root = await createTempRoot();

    await expect(
      startRecorder({
        outputPath: join(root, "destroyed.webm"),
        frame: targetFrame({ destroyed: true }),
      }),
    ).rejects.toThrow(/target WebFrameMain is unavailable/u);
    await expect(
      startRecorder({
        outputPath: join(root, "detached.webm"),
        frame: targetFrame({ detached: true }),
      }),
    ).rejects.toThrow(/target WebFrameMain is unavailable/u);
    expect(windows).toHaveLength(0);
  });

  it("Only deliver target guest frame to its own recorder document, rejecting all other display media requests", async () => {
    const root = await createTempRoot();
    const frame = targetFrame();
    const recorder = await startRecorder({ outputPath: join(root, "grant.webm"), frame });
    const handler = sessions.at(-1)?.handler;
    const recorderMainFrame = windows.at(-1)?.webContents.mainFrame;
    if (!handler || !recorderMainFrame) throw new Error("display media handler was not installed");

    const ask = (request: Record<string, unknown>): unknown => {
      let granted: unknown;
      handler(request, (result) => {
        granted = result;
      });
      return granted;
    };

    expect(ask({ frame: recorderMainFrame, videoRequested: true, audioRequested: false })).toEqual({
      video: frame,
    });
    expect(ask({ frame: { id: "someone-else" }, videoRequested: true, audioRequested: false })).toEqual({});
    expect(ask({ frame: recorderMainFrame, videoRequested: true, audioRequested: true })).toEqual({});
    expect(ask({ frame: recorderMainFrame, videoRequested: false, audioRequested: false })).toEqual({});

    await recorder.cancel();
    expect(ask({ frame: recorderMainFrame, videoRequested: true, audioRequested: false })).toEqual({});
  });

  it("No longer grant frames after target frame is destroyed during recording", async () => {
    const root = await createTempRoot();
    let destroyed = false;
    const frame = {
      isDestroyed: () => destroyed,
      detached: false,
      id: "guest-main-frame",
    };
    await startRecorder({ outputPath: join(root, "gone.webm"), frame });
    const handler = sessions.at(-1)?.handler;
    const recorderMainFrame = windows.at(-1)?.webContents.mainFrame;
    if (!handler || !recorderMainFrame) throw new Error("display media handler was not installed");

    destroyed = true;
    let granted: unknown;
    handler({ frame: recorderMainFrame, videoRequested: true, audioRequested: false }, (result) => {
      granted = result;
    });

    expect(granted).toEqual({});
  });

  it("recorder renderer runs with sandbox + contextIsolation and no Node integration", async () => {
    const root = await createTempRoot();
    await startRecorder({ outputPath: join(root, "sandbox.webm") });

    expect(windows.at(-1)?.options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    });
    expect(windows.at(-1)?.webContents.setWindowOpenHandler).toHaveBeenCalled();
  });

  it("start 按请求的 viewport 与 fps 驱动 renderer", async () => {
    const root = await createTempRoot();
    await startRecorder({
      outputPath: join(root, "params.webm"),
      viewport: { width: 1024, height: 768 },
      fps: 30,
    });

    expect(ports.at(-1)?.port1.outbound).toContainEqual({
      type: "start",
      fps: 30,
      width: 1024,
      height: 768,
    });
  });
});

