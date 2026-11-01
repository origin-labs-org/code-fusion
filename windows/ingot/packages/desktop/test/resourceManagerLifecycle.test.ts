import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TestWindow = EventEmitter & {
  id: number;
  isDestroyed: () => boolean;
  loadFile: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  webContents: EventEmitter & { id: number };
};
const state = vi.hoisted(() => ({ window: null as TestWindow | null, metrics: vi.fn(() => []) }));
vi.mock("electron", () => ({
  app: { getAppMetrics: state.metrics, isPackaged: true },
  BrowserWindow: Object.assign(
    function () {
      return state.window;
    },
    { getAllWindows: () => [], fromWebContents: () => null },
  ),
  webContents: { getAllWebContents: () => [] },
}));
vi.mock("../src/main/logger.js", () => ({ logger: { info: vi.fn() } }));
vi.mock("../src/main/resourceManagerNetwork.js", () => ({
  observeNetworkWindow: vi.fn(),
  configureNetworkCaptureHost: vi.fn(),
}));

describe("resource manager window owns sampling", () => {
  beforeEach(() => {
    vi.resetModules();
    state.metrics.mockClear();
    state.window = Object.assign(new EventEmitter(), {
      id: 7,
      isDestroyed: () => false,
      loadFile: vi.fn(),
      focus: vi.fn(),
      webContents: Object.assign(new EventEmitter(), { id: 70 }),
    });
  });

  it("Do not sample requests for unopened or non-resource windows; closing windows cancels in-flight requests", async () => {
    const window = await import("../src/main/resourceManagerWindow.js");
    const child = { pid: 42, postMessage: vi.fn() };
    window.registerHostProcess("lifecycle-host", child as never);
    try {
      await expect(window.getResourceUsageSnapshot(70)).rejects.toThrow("inactive");
      window.openResourceManager();
      window.setResourceUsageSamplingActive(999, true);
      await expect(window.getResourceUsageSnapshot(70)).rejects.toThrow("inactive");
      expect(child.postMessage).not.toHaveBeenCalled();
      window.setResourceUsageSamplingActive(70, true);
      await expect(window.getResourceUsageSnapshot(999)).rejects.toThrow("inactive");
      const pending = window.getResourceUsageSnapshot(70).catch((error: unknown) => error);
      const requestId = child.postMessage.mock.calls[0][0].requestId;
      state.window!.emit("closed");
      expect(child.postMessage).toHaveBeenLastCalledWith({
        type: "resource-usage-snapshot-cancel",
        requestId,
      });
      expect(await pending).toMatchObject({ name: "AbortError" });
      await expect(window.getResourceUsageSnapshot(70)).rejects.toThrow("inactive");
    } finally {
      window.unregisterHostProcess("lifecycle-host");
    }
  });

  it("Stop queries after deactivation and renderer crash; recover only after re-enabling", async () => {
    const window = await import("../src/main/resourceManagerWindow.js");
    window.openResourceManager();
    window.setResourceUsageSamplingActive(70, true);
    await expect(window.getResourceUsageSnapshot(70)).resolves.toHaveProperty("processes");
    window.setResourceUsageSamplingActive(70, false);
    await expect(window.getResourceUsageSnapshot(70)).rejects.toThrow("inactive");
    window.setResourceUsageSamplingActive(70, true);
    state.window!.webContents.emit("render-process-gone");
    await expect(window.getResourceUsageSnapshot(70)).rejects.toThrow("inactive");
  });
});
