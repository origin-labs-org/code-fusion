import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformChannels, type ProcessResourceRole } from "@origin-ai/cf-shared";

const h = vi.hoisted(() => ({
  ipcListeners: new Map<string, Array<(...args: unknown[]) => unknown>>(),
  ipcHandlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  app: {
    getAppMetrics: vi.fn(() => []),
    getPath: vi.fn(() => "/tmp"),
    isPackaged: false,
    getAppPath: vi.fn(() => "/tmp/cf-app"),
  },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  ipcMain: {
    on: vi.fn((channel: string, listener: (...args: unknown[]) => unknown) => {
      const listeners = h.ipcListeners.get(channel) ?? [];
      listeners.push(listener);
      h.ipcListeners.set(channel, listeners);
    }),
    removeAllListeners: vi.fn((channel: string) => h.ipcListeners.delete(channel)),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) =>
      h.ipcHandlers.set(channel, handler),
    ),
  },
  webContents: { getAllWebContents: vi.fn(() => []) },
}));

vi.mock("../src/main/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const MAIN_WINDOW_WC_ID = 11;
const SECOND_MAIN_WINDOW_WC_ID = 12;
const AUX_WINDOW_WC_ID = 21;

interface Collected {
  heapSamples: Array<[ProcessResourceRole, number]>;
  roleSamples: number;
}

async function loadSource() {
  return import("../src/main/processResourceRendererHeapSource.js");
}

async function runSample(): Promise<Collected> {
  const { rendererHeapProcessResourceSampleSource } = await loadSource();
  const collected: Collected = { heapSamples: [], roleSamples: 0 };
  rendererHeapProcessResourceSampleSource.sample?.({
    now: 0,
    addRoleSample: () => {
      collected.roleSamples += 1;
    },
    addRoleHeapSample: (role, heapUsedKb) => collected.heapSamples.push([role, heapUsedKb]),
    addAppProcessTotals: () => {},
  });
  return collected;
}

describe("processResourceRendererHeapSource", () => {
  beforeEach(async () => {
    h.ipcListeners.clear();
    h.ipcHandlers.clear();
    const { registerMainApplicationWindow, unregisterMainApplicationWindow } =
      await import("../src/main/resourceManagerWindow.js");
    for (const id of [MAIN_WINDOW_WC_ID, SECOND_MAIN_WINDOW_WC_ID, AUX_WINDOW_WC_ID]) {
      unregisterMainApplicationWindow(id);
    }
    registerMainApplicationWindow(MAIN_WINDOW_WC_ID);
    const { rendererHeapProcessResourceSampleSource } = await loadSource();
    rendererHeapProcessResourceSampleSource.reset?.();
  });

  it("PRT-021: Main window renderer samples only contribute to renderer_main heap without creating additional role samples", async () => {
    const { ingestRendererHeapSample } = await loadSource();
    ingestRendererHeapSample(MAIN_WINDOW_WC_ID, { heapUsedKb: 51_200 });

    const collected = await runSample();

    expect(collected.heapSamples).toEqual([["renderer_main", 51_200]]);
    expect(collected.roleSamples).toBe(0);
  });

  it("Samples from non-main-window webContents (auxiliary windows / DevTools / webview guests) are ignored", async () => {
    const { ingestRendererHeapSample } = await loadSource();
    ingestRendererHeapSample(AUX_WINDOW_WC_ID, { heapUsedKb: 999_999 });

    expect((await runSample()).heapSamples).toEqual([]);
  });

  it("Take the maximum of readings received in this tick when multiple main windows exist", async () => {
    const { registerMainApplicationWindow } = await import("../src/main/resourceManagerWindow.js");
    registerMainApplicationWindow(SECOND_MAIN_WINDOW_WC_ID);
    const { ingestRendererHeapSample } = await loadSource();
    ingestRendererHeapSample(MAIN_WINDOW_WC_ID, { heapUsedKb: 51_200 });
    ingestRendererHeapSample(SECOND_MAIN_WINDOW_WC_ID, { heapUsedKb: 76_800 });

    expect((await runSample()).heapSamples).toEqual([["renderer_main", 76_800]]);
  });

  it("A single reading contributes only one heap sample; the next tick does not use old values as the current state", async () => {
    const { ingestRendererHeapSample } = await loadSource();
    ingestRendererHeapSample(MAIN_WINDOW_WC_ID, { heapUsedKb: 51_200 });

    expect((await runSample()).heapSamples).toEqual([["renderer_main", 51_200]]);
    expect((await runSample()).heapSamples).toEqual([]);
  });

  it("Samples with missing fields, type errors, or extra fields are discarded at the main entry without throwing errors", async () => {
    const { ingestRendererHeapSample } = await loadSource();
    for (const invalid of [
      undefined,
      null,
      "sample",
      {},
      { heapUsedKb: "512" },
      { heapUsedKb: Number.NaN },
      { heapUsedKb: -1 },
      { heapUsedKb: 512, workspacePath: "/Users/me/secret" },
    ]) {
      expect(() => ingestRendererHeapSample(MAIN_WINDOW_WC_ID, invalid)).not.toThrow();
    }

    expect((await runSample()).heapSamples).toEqual([]);
  });

  it("reset 丢弃尚未交付的样本", async () => {
    const { ingestRendererHeapSample, rendererHeapProcessResourceSampleSource } =
      await loadSource();
    ingestRendererHeapSample(MAIN_WINDOW_WC_ID, { heapUsedKb: 51_200 });
    rendererHeapProcessResourceSampleSource.reset?.();

    expect((await runSample()).heapSamples).toEqual([]);
  });

  it("已注册进来源注册表", async () => {
    const { PROCESS_RESOURCE_SAMPLE_SOURCES } =
      await import("../src/main/processResourceSampleSourceRegistry.js");
    const { rendererHeapProcessResourceSampleSource } = await loadSource();

    expect(PROCESS_RESOURCE_SAMPLE_SOURCES.map((source) => source.id)).toContain(
      rendererHeapProcessResourceSampleSource.id,
    );
  });

  it("The main side only listens for one-way send and attributes it by the sender webContents", async () => {
    const { registerRendererHeapSampleIpc } = await loadSource();
    registerRendererHeapSampleIpc();
    registerRendererHeapSampleIpc();

    expect(h.ipcHandlers.has(PlatformChannels.ReportRendererHeapSample)).toBe(false);
    const listeners = h.ipcListeners.get(PlatformChannels.ReportRendererHeapSample) ?? [];
    expect(listeners).toHaveLength(1);

    const listener = listeners[0];
    listener?.({ sender: { id: AUX_WINDOW_WC_ID } }, { heapUsedKb: 999_999 });
    listener?.({ sender: { id: MAIN_WINDOW_WC_ID } }, { heapUsedKb: 51_200 });

    expect((await runSample()).heapSamples).toEqual([["renderer_main", 51_200]]);
  });

  it("The preload bridge exposes only one-way send and does not expose invoke", async () => {
    const source = await readFile(
      join(import.meta.dirname, "../src/preload/index.ts"),
      "utf8",
    ).then((text) => text.replace(/\s+/g, ""));

    expect(source).toContain("ipcRenderer.send(PlatformChannels.ReportRendererHeapSample");
    expect(source).not.toContain("ipcRenderer.invoke(PlatformChannels.ReportRendererHeapSample");
  });
});
