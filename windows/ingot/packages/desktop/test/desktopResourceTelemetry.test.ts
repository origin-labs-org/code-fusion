import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ARMS_CUSTOM_EVENT_PROPERTY_LIMIT } from "@origin-ai/cf-shared";

const execFileSyncMock = vi.fn();
const execFileMock = vi.fn();
const spawnMock = vi.fn();
const spawnSyncMock = vi.fn();
const execMock = vi.fn();
const sendCustomMock = vi.fn();
const getAppMetricsMock = vi.fn(() => [] as unknown[]);
const getAllWebContentsMock = vi.fn(() => [] as unknown[]);
const getAllWindowsMock = vi.fn(() => [] as unknown[]);

let logicalCpuCount = 8;
let totalMemoryBytes = 16 * 1024 ** 3;

vi.mock("node:child_process", () => ({
  exec: execMock,
  execFile: execFileMock,
  execFileSync: execFileSyncMock,
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const cpus = (): unknown[] => Array.from({ length: logicalCpuCount }, () => ({ times: {} }));
  const totalmem = (): number => totalMemoryBytes;
  return {
    ...actual,
    cpus,
    totalmem,
    default: { ...actual, cpus, totalmem },
  };
});

vi.mock("electron", () => ({
  app: {
    getAppMetrics: getAppMetricsMock,
    getPath: vi.fn((name: string) => (name === "userData" ? "/tmp/cf-user" : "/tmp")),
    isPackaged: false,
    getAppPath: vi.fn(() => "/tmp/cf-app"),
  },
  BrowserWindow: {
    getAllWindows: getAllWindowsMock,
  },
  webContents: {
    getAllWebContents: getAllWebContentsMock,
  },
}));

vi.mock("../src/main/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@arms/rum-electron", () => ({
  default: {
    sendCustom: sendCustomMock,
    setConfig: vi.fn(),
  },
}));

const MAIN_PID = process.pid;
const MAIN_WINDOW_WC_ID = 11;
const MAIN_WINDOW_PID = 201;
const GUEST_WC_ID = 12;
const GUEST_PID = 202;
const GPU_PID = 203;
const HOST_PID = 204;
const SCHEDULER_PID = 205;
const OTHER_PID = 206;
const REPORT_INTERVAL_MS = 300_000;

interface FakeMetric {
  pid: number;
  type: string;
  cpu: { percentCPUUsage: number };
  memory: { workingSetSize: number };
  creationTime?: number;
}

function metric(
  pid: number,
  type: string,
  cpu: number,
  workingSetKb: number,
  creationTime?: number,
): FakeMetric {
  return {
    pid,
    type,
    cpu: { percentCPUUsage: cpu },
    memory: { workingSetSize: workingSetKb },
    ...(creationTime === undefined ? {} : { creationTime }),
  };
}

function cliSample(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    platform: "darwin",
    arch: "arm64",
    logicalCpuCount: 10,
    intervalMs: 60_000,
    cpuCores: 0.5,
    cpuPercent: 5,
    rssKb: 200_000,
    heapUsedKb: 40_000,
    uptimeMinutes: 8,
    totalMemoryGb: 32,
    instanceToken: "chat-instance-0001",
    lane: "chat",
    ...overrides,
  };
}

function fakeWebContents(id: number, pid: number, type: string): unknown {
  return {
    id,
    isDestroyed: () => false,
    getOSProcessId: () => pid,
    getType: () => type,
    getTitle: () => `wc-${id}`,
    getURL: () => "about:blank",
  };
}

async function loadTelemetry() {
  return import("../src/main/desktopResourceTelemetry.js");
}

async function registerAllChromiumRoles(): Promise<() => void> {
  const {
    registerHostProcess,
    registerMainApplicationWindow,
    registerSchedulerProcess,
    unregisterHostProcess,
    unregisterMainApplicationWindow,
    unregisterSchedulerProcess,
  } = await import("../src/main/resourceManagerWindow.js");

  const scheduler = { pid: SCHEDULER_PID } as never;
  registerHostProcess("local-1", { pid: HOST_PID } as never);
  registerSchedulerProcess(scheduler);
  registerMainApplicationWindow(MAIN_WINDOW_WC_ID);
  getAllWebContentsMock.mockReturnValue([
    fakeWebContents(MAIN_WINDOW_WC_ID, MAIN_WINDOW_PID, "window"),
    fakeWebContents(GUEST_WC_ID, GUEST_PID, "webview"),
  ]);

  return () => {
    unregisterHostProcess("local-1");
    unregisterSchedulerProcess(scheduler);
    unregisterMainApplicationWindow(MAIN_WINDOW_WC_ID);
  };
}

function processWindowEvents(): Array<{
  name: string;
  value: number;
  properties: Record<string, string>;
}> {
  return sendCustomMock.mock.calls
    .map(([event]) => event as { name: string; value: number; properties: Record<string, string> })
    .filter((event) => event.name === "perf_process_window");
}

function eventForRole(role: string) {
  return processWindowEvents().find((event) => event.properties.process_role === role);
}

describe("desktopResourceTelemetry perf_process_window", () => {
  afterEach(() => vi.restoreAllMocks());

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    logicalCpuCount = 8;
    totalMemoryBytes = 16 * 1024 ** 3;
    getAppMetricsMock.mockReset().mockReturnValue([]);
    getAllWebContentsMock.mockReset().mockReturnValue([]);
    getAllWindowsMock.mockReset().mockReturnValue([]);
    sendCustomMock.mockReset();
  });

  it("PRT-001 七类 Chromium 进程在 30 个 tick 后各发出一条角色事件，属性数不超 20", async () => {
    vi.useFakeTimers();
    const cleanupRoles = await registerAllChromiumRoles();
    getAppMetricsMock.mockReturnValue([
      metric(MAIN_PID, "Browser", 4, 100_000),
      metric(MAIN_WINDOW_PID, "Tab", 8, 200_000),
      metric(GUEST_PID, "Tab", 2, 50_000),
      metric(GPU_PID, "GPU", 1, 40_000),
      metric(HOST_PID, "Utility", 3, 90_000),
      metric(SCHEDULER_PID, "Utility", 0.5, 30_000),
      metric(OTHER_PID, "Utility", 0.25, 20_000),
    ]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-001-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      const events = processWindowEvents();
      expect(events.map((event) => event.properties.process_role)).toEqual([
        "main",
        "renderer_main",
        "renderer_guest",
        "gpu",
        "chromium_other",
        "host",
        "scheduler",
      ]);
      for (const event of events) {
        expect(event.group).toBe("resource");
        expect(Object.keys(event.properties).length).toBeLessThanOrEqual(
          ARMS_CUSTOM_EVENT_PROPERTY_LIMIT,
        );
        expect(event.properties.sample_count).toBe("30");
        expect(event.properties.runtime_surface).toBe("local");
        expect(event.properties.logical_cpu_count).toBe("8");
        expect(event.properties.total_memory_gb).toBe("16");
      }
      expect(eventForRole("renderer_main")).toMatchObject({
        value: 8,
        properties: { cpu_percent_peak: "8", rss_kb_total_mean: "200000" },
      });
    } finally {
      stopDesktopResourceTelemetry();
      cleanupRoles();
      vi.useRealTimers();
    }
  });

  it("PRT-002 Linux normalizes CPU by logical cores; darwin and win32 do not normalize", async () => {
    async function measureRoleCpu(platform: NodeJS.Platform): Promise<number> {
      vi.resetModules();
      sendCustomMock.mockReset();
      vi.useFakeTimers();
      const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue(platform);
      getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 80, 1_000)]);
      const logger = { info: vi.fn(), warn: vi.fn() };
      const {
        configureDesktopResourceTelemetry,
        registerDesktopResourceTelemetry,
        stopDesktopResourceTelemetry,
      } = await loadTelemetry();
      try {
        configureDesktopResourceTelemetry({
          deviceMid: "prt-002-device",
          platform,
          appVersion: "3.6.1-test",
          armsEnv: "test",
        });
        registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
        await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
        return eventForRole("main")?.value ?? Number.NaN;
      } finally {
        stopDesktopResourceTelemetry();
        platformSpy.mockRestore();
        vi.useRealTimers();
      }
    }

    expect(await measureRoleCpu("linux")).toBe(10);
    expect(await measureRoleCpu("darwin")).toBe(80);
    expect(await measureRoleCpu("win32")).toBe(80);
  });

  it("PRT-003 renderer_guest 给出总量、最大单进程与进程数", async () => {
    vi.useFakeTimers();
    const { registerMainApplicationWindow, unregisterMainApplicationWindow } =
      await import("../src/main/resourceManagerWindow.js");
    registerMainApplicationWindow(MAIN_WINDOW_WC_ID);
    getAllWebContentsMock.mockReturnValue([
      fakeWebContents(MAIN_WINDOW_WC_ID, MAIN_WINDOW_PID, "window"),
      fakeWebContents(21, 301, "webview"),
      fakeWebContents(22, 302, "webview"),
      fakeWebContents(23, 303, "webview"),
    ]);
    getAppMetricsMock.mockReturnValue([
      metric(MAIN_PID, "Browser", 1, 1_000),
      metric(301, "Tab", 1, 100),
      metric(302, "Tab", 1, 200),
      metric(303, "Tab", 1, 300),
    ]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-003-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      expect(eventForRole("renderer_guest")?.properties).toMatchObject({
        rss_kb_total_peak: "600",
        rss_kb_max_process_peak: "300",
        process_count_peak: "3",
      });
    } finally {
      stopDesktopResourceTelemetry();
      unregisterMainApplicationWindow(MAIN_WINDOW_WC_ID);
      vi.useRealTimers();
    }
  });

  it("PRT-005 uptime_minutes comes from creationTime, taking the maximum for multi-process roles", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
    const now = Date.now();
    const { registerMainApplicationWindow, unregisterMainApplicationWindow } =
      await import("../src/main/resourceManagerWindow.js");
    registerMainApplicationWindow(MAIN_WINDOW_WC_ID);
    getAllWebContentsMock.mockReturnValue([
      fakeWebContents(MAIN_WINDOW_WC_ID, MAIN_WINDOW_PID, "window"),
      fakeWebContents(21, 301, "webview"),
      fakeWebContents(22, 302, "webview"),
    ]);
    getAppMetricsMock.mockReturnValue([
      metric(MAIN_PID, "Browser", 1, 1_000, now - 90 * 60_000),
      metric(301, "Tab", 1, 100, now - 10 * 60_000),
      metric(302, "Tab", 1, 100, now - 90 * 60_000),
    ]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-005-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      expect(Number(eventForRole("main")?.properties.uptime_minutes)).toBe(95);
      expect(Number(eventForRole("renderer_guest")?.properties.uptime_minutes)).toBe(95);
    } finally {
      stopDesktopResourceTelemetry();
      unregisterMainApplicationWindow(MAIN_WINDOW_WC_ID);
      vi.useRealTimers();
    }
  });

  it("PRT-006 main event includes two heap items for a total of 20 attributes; gpu event has no heap for a total of 18 attributes", async () => {
    vi.useFakeTimers();
    const memoryUsageSpy = vi.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 300 * 1024 * 1024,
      heapTotal: 120 * 1024 * 1024,
      heapUsed: 90 * 1024 * 1024,
      external: 20 * 1024 * 1024,
      arrayBuffers: 2 * 1024 * 1024,
    } as NodeJS.MemoryUsage);
    getAppMetricsMock.mockReturnValue([
      metric(MAIN_PID, "Browser", 1, 1_000),
      metric(GPU_PID, "GPU", 1, 500),
    ]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-006-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      const mainEvent = eventForRole("main");
      expect(mainEvent?.properties).toMatchObject({
        heap_used_kb_mean: "92160",
        heap_used_kb_peak: "92160",
      });
      expect(Object.keys(mainEvent?.properties ?? {})).toHaveLength(20);

      const gpuEvent = eventForRole("gpu");
      expect(gpuEvent?.properties).not.toHaveProperty("heap_used_kb_mean");
      expect(gpuEvent?.properties).not.toHaveProperty("heap_used_kb_peak");
      expect(Object.keys(gpuEvent?.properties ?? {})).toHaveLength(18);
    } finally {
      stopDesktopResourceTelemetry();
      memoryUsageSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("PRT-006 Self-sampled heap of host and scheduler enters their respective role events, totaling 20 attributes without altering sample_count", async () => {
    vi.useFakeTimers();
    const cleanupRoles = await registerAllChromiumRoles();
    getAppMetricsMock.mockReturnValue([
      metric(HOST_PID, "Utility", 3, 90_000),
      metric(SCHEDULER_PID, "Utility", 0.5, 30_000),
    ]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();
    const { ingestHostSelfResourceSample, ingestSchedulerSelfResourceSample } =
      await import("../src/main/processResourceSelfHeapSource.js");

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-006-node-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      ingestHostSelfResourceSample({ cpuPercent: 2.5, rssKb: 89_000, heapUsedKb: 41_000 });
      ingestSchedulerSelfResourceSample({ cpuPercent: 0.4, rssKb: 29_000, heapUsedKb: 12_000 });
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      const hostEvent = eventForRole("host");
      expect(hostEvent?.properties).toMatchObject({
        heap_used_kb_mean: "41000",
        heap_used_kb_peak: "41000",
        rss_kb_total_mean: "90000",
        sample_count: "30",
      });
      expect(Object.keys(hostEvent?.properties ?? {})).toHaveLength(20);

      const schedulerEvent = eventForRole("scheduler");
      expect(schedulerEvent?.properties).toMatchObject({
        heap_used_kb_mean: "12000",
        heap_used_kb_peak: "12000",
        sample_count: "30",
      });
      expect(Object.keys(schedulerEvent?.properties ?? {})).toHaveLength(20);
    } finally {
      stopDesktopResourceTelemetry();
      cleanupRoles();
      vi.useRealTimers();
    }
  });

  it("PRT-021 Main window renderer heap enters renderer_main event with 20 attributes; non-main window samples are excluded from statistics", async () => {
    vi.useFakeTimers();
    const cleanupRoles = await registerAllChromiumRoles();
    getAppMetricsMock.mockReturnValue([
      metric(MAIN_WINDOW_PID, "Tab", 8, 200_000),
      metric(GUEST_PID, "Tab", 2, 50_000),
    ]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();
    const { ingestRendererHeapSample } =
      await import("../src/main/processResourceRendererHeapSource.js");

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-021-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      ingestRendererHeapSample(MAIN_WINDOW_WC_ID, { heapUsedKb: 51_200 });
      ingestRendererHeapSample(GUEST_WC_ID, { heapUsedKb: 999_999 });
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      const rendererEvent = eventForRole("renderer_main");
      expect(rendererEvent?.properties).toMatchObject({
        heap_used_kb_mean: "51200",
        heap_used_kb_peak: "51200",
        rss_kb_total_mean: "200000",
        sample_count: "30",
      });
      expect(Object.keys(rendererEvent?.properties ?? {})).toHaveLength(20);

      const guestEvent = eventForRole("renderer_guest");
      expect(guestEvent?.properties).not.toHaveProperty("heap_used_kb_mean");
      expect(guestEvent?.properties).not.toHaveProperty("heap_used_kb_peak");
      expect(Object.keys(guestEvent?.properties ?? {})).toHaveLength(18);
    } finally {
      stopDesktopResourceTelemetry();
      cleanupRoles();
      vi.useRealTimers();
    }
  });

  it("PRT-016 Stop with flush drains remaining windows and ceases subsequent sampling", async () => {
    vi.useFakeTimers();
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 2, 1_000)]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      RESOURCE_SAMPLE_INTERVAL_MS,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-016-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_INTERVAL_MS * 12);
      expect(processWindowEvents()).toHaveLength(0);

      const appMetricReadsBeforeStop = getAppMetricsMock.mock.calls.length;
      stopDesktopResourceTelemetry({ flushPendingWindows: true });

      expect(eventForRole("main")?.properties.sample_count).toBe("12");
      expect(getAppMetricsMock).toHaveBeenCalledTimes(appMetricReadsBeforeStop);

      sendCustomMock.mockReset();
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS * 2);
      expect(sendCustomMock).not.toHaveBeenCalled();
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });

  it("PRT-019 perf_resource_window no longer occurs", async () => {
    vi.useFakeTimers();
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 1, 1_000)]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-019-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      const names = sendCustomMock.mock.calls.map(([event]) => (event as { name: string }).name);
      expect(names).toContain("perf_process_window");
      expect(names).not.toContain("perf_resource_window");
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });

  it("Role events enter the shared E2E capture ring for the E2E channel to read final reported content", async () => {
    vi.useFakeTimers();
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 1, 1_000)]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { enableSharedFinalArmsCustomEventE2EController } =
      await import("../src/main/desktopArmsCustomEvent.js");
    const controller = enableSharedFinalArmsCustomEventE2EController();
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "e2e-bridge-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      controller.configure({ suppressedEventNames: ["perf_process_window"] });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      const captured = controller.read().map((entry) => entry.payload.name);
      expect(captured).toContain("perf_process_window");
      expect(
        sendCustomMock.mock.calls.map(([event]) => (event as { name: string }).name),
      ).not.toContain("perf_process_window");
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });

  it("Event attributes do not contain privacy dimensions such as pid, path, and workspace", async () => {
    vi.useFakeTimers();
    const cleanupRoles = await registerAllChromiumRoles();
    getAppMetricsMock.mockReturnValue([
      metric(MAIN_PID, "Browser", 1, 1_000),
      metric(MAIN_WINDOW_PID, "Tab", 1, 1_000),
    ]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "privacy-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      const { checkProcessResourceEventProperties } = await import("@origin-ai/cf-shared");
      for (const event of processWindowEvents()) {
        expect(
          checkProcessResourceEventProperties("perf_process_window", event.properties),
        ).toMatchObject({ ok: true });
      }
      const propertyValues = processWindowEvents().flatMap((event) =>
        Object.values(event.properties),
      );
      expect(propertyValues).not.toContain(String(MAIN_WINDOW_PID));
      expect(propertyValues).not.toContain(String(MAIN_PID));
    } finally {
      stopDesktopResourceTelemetry();
      cleanupRoles();
      vi.useRealTimers();
    }
  });

  it("ARMS sendCustom exceptions are not thrown from the role flush pipeline", async () => {
    vi.useFakeTimers();
    sendCustomMock.mockImplementation(() => {
      throw new Error("ARMS unavailable");
    });
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 1, 1_000)]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "arms-failure-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
      expect(sendCustomMock).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });
});

describe("desktopResourceTelemetry CLI role and Windows gate retain behavior", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    logicalCpuCount = 8;
    totalMemoryBytes = 16 * 1024 ** 3;
    getAppMetricsMock.mockReset().mockReturnValue([]);
    getAllWebContentsMock.mockReset().mockReturnValue([]);
    getAllWindowsMock.mockReset().mockReturnValue([]);
    sendCustomMock.mockReset();
  });

  it("PERF-RES-01 Periodic sampling after registering agent pid only logs skipped audits without spawning external processes", async () => {
    vi.useFakeTimers();
    vi.stubEnv("CF_ENV", "test");
    vi.stubEnv("CF_E2E_RUNTIME_LOG_DIR", "C:\\e2e\\runtime-logs\\desktop");
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { registerHostAgentProcess, unregisterHostAgentProcess } =
      await import("../src/main/resourceManagerWindow.js");
    const {
      registerDesktopResourceTelemetry,
      RESOURCE_SAMPLE_INTERVAL_MS,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();

    registerHostAgentProcess("local-1", {
      pid: 43210,
      provider: "glm",
      workspacePath: "C:\\repo\\demo",
      command: "cf-agent.exe",
      args: ["--stdio"],
      startedAt: 100,
    });

    try {
      registerDesktopResourceTelemetry(logger);
      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_INTERVAL_MS * 2);

      expect(execFileSyncMock).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        "[resource] agent_metric_probe action=skipped reason=main_process_external_probe_disabled agent_count=1",
      );
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining("agent_metric_probe action=spawn"),
      );
      expect(
        logger.info.mock.calls.filter(
          ([message]) =>
            message ===
            "[resource] agent_metric_probe action=skipped reason=main_process_external_probe_disabled agent_count=1",
        ),
      ).toHaveLength(1);
    } finally {
      stopDesktopResourceTelemetry();
      unregisterHostAgentProcess("local-1", 43210);
      platformSpy.mockRestore();
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });

  it("PRT-007 CLI samples from chat and plugin lanes aggregate into two role events: cli_chat and cli_aux", async () => {
    vi.useFakeTimers();
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 1, 1_000)]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();
    const { ingestCliResourceSample } = await import("../src/main/processResourceCliSource.js");

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-007-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      for (let period = 0; period < REPORT_INTERVAL_MS / 60_000; period += 1) {
        ingestCliResourceSample(cliSample({ instanceToken: "chat-0001" }), "local");
        ingestCliResourceSample(
          cliSample({
            instanceToken: "chat-0002",
            cpuPercent: 7,
            rssKb: 300_000,
            heapUsedKb: 90_000,
            uptimeMinutes: 12,
          }),
          "local",
        );
        ingestCliResourceSample(
          cliSample({ lane: "plugin", instanceToken: "aux-0001", cpuPercent: 1, rssKb: 90_000 }),
          "local",
        );
        await vi.advanceTimersByTimeAsync(60_000);
      }

      const chatEvent = eventForRole("cli_chat");
      expect(chatEvent?.properties).toMatchObject({
        runtime_surface: "local",
        cpu_percent_peak: "12",
        rss_kb_total_mean: "500000",
        rss_kb_total_peak: "500000",
        rss_kb_max_process_peak: "300000",
        heap_used_kb_mean: "90000",
        heap_used_kb_peak: "90000",
        process_count_peak: "2",
        uptime_minutes: "12",
        total_memory_gb: "32",
        sample_count: "5",
      });
      expect(chatEvent?.value).toBe(12);
      expect(Object.keys(chatEvent?.properties ?? {})).toHaveLength(20);

      const auxEvent = eventForRole("cli_aux");
      expect(auxEvent?.properties).toMatchObject({
        rss_kb_total_mean: "90000",
        rss_kb_max_process_peak: "90000",
        process_count_peak: "1",
        sample_count: "5",
      });
      expect(Object.keys(auxEvent?.properties ?? {})).toHaveLength(20);
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });

  it("PRT-008 远端 CLI 样本自带的运行机信息覆盖桌面机全局值", async () => {
    vi.useFakeTimers();
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 1, 1_000)]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();
    const { ingestCliResourceSample } = await import("../src/main/processResourceCliSource.js");

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-008-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      ingestCliResourceSample(
        cliSample({
          platform: "linux",
          arch: "x64",
          logicalCpuCount: 4,
          totalMemoryGb: 8,
          instanceToken: "remote-0001",
        }),
        "remote",
      );
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      expect(eventForRole("cli_chat")?.properties).toMatchObject({
        platform: "linux",
        runtime_surface: "remote",
        arch: "x64",
        logical_cpu_count: "4",
        total_memory_gb: "8",
      });
      expect(eventForRole("main")?.properties).toMatchObject({
        platform: "macos",
        runtime_surface: "local",
        logical_cpu_count: "8",
        total_memory_gb: "16",
      });
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });

  it("When legacy CLI samples lack total_memory_gb, it falls back to the desktop value per field", async () => {
    vi.useFakeTimers();
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 1, 1_000)]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();
    const { ingestCliResourceSample } = await import("../src/main/processResourceCliSource.js");

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "legacy-cli-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      ingestCliResourceSample(
        {
          platform: "darwin",
          arch: "arm64",
          logicalCpuCount: 10,
          intervalMs: 60_000,
          cpuCores: 0.5,
          cpuPercent: 5,
          rssKb: 200_000,
        },
        "local",
      );
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      const chatEvent = eventForRole("cli_chat");
      expect(chatEvent?.properties).toMatchObject({
        arch: "arm64",
        logical_cpu_count: "10",
        total_memory_gb: "16",
      });
      expect(chatEvent?.properties).not.toHaveProperty("heap_used_kb_mean");
      expect(Object.keys(chatEvent?.properties ?? {})).toHaveLength(18);
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });

  it("PRT-019 CLI samples no longer produce perf_resource_agent", async () => {
    vi.useFakeTimers();
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 1, 1_000)]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();
    const { ingestCliResourceSample } = await import("../src/main/processResourceCliSource.js");

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "prt-019-cli-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      ingestCliResourceSample(cliSample(), "local");
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      const names = sendCustomMock.mock.calls.map(([event]) => (event as { name: string }).name);
      expect(names).toContain("perf_process_window");
      expect(names).not.toContain("perf_resource_agent");
      expect(eventForRole("cli_chat")).toBeDefined();
      expect(eventForRole("agent_node")).toBeUndefined();
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });

  it("cli role events do not contain privacy dimensions such as instanceToken, pid, or workspace", async () => {
    vi.useFakeTimers();
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 1, 1_000)]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();
    const { ingestCliResourceSample } = await import("../src/main/processResourceCliSource.js");

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "cli-privacy-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      ingestCliResourceSample(cliSample({ instanceToken: "chat-secret-token" }), "local");
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);

      const { checkProcessResourceEventProperties } = await import("@origin-ai/cf-shared");
      const cliEvents = processWindowEvents().filter((event) =>
        event.properties.process_role?.startsWith("cli_"),
      );
      expect(cliEvents).toHaveLength(1);
      for (const event of cliEvents) {
        expect(
          checkProcessResourceEventProperties("perf_process_window", event.properties),
        ).toMatchObject({ ok: true });
      }
      expect(JSON.stringify(cliEvents)).not.toContain("chat-secret-token");
      expect(JSON.stringify(cliEvents)).not.toContain("lane");
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });

  it("On normal exit, remaining CLI role windows are drained along with main", async () => {
    vi.useFakeTimers();
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 1, 1_000)]);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      RESOURCE_SAMPLE_INTERVAL_MS,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();
    const { ingestCliResourceSample } = await import("../src/main/processResourceCliSource.js");

    try {
      configureDesktopResourceTelemetry({
        deviceMid: "cli-partial-window-device",
        platform: "darwin",
        appVersion: "3.6.1-test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });
      ingestCliResourceSample(cliSample(), "local");
      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_INTERVAL_MS);
      ingestCliResourceSample(cliSample({ rssKb: 300_000 }), "local");
      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_INTERVAL_MS);
      expect(processWindowEvents()).toHaveLength(0);

      const appMetricReadsBeforeStop = getAppMetricsMock.mock.calls.length;
      stopDesktopResourceTelemetry({ flushPendingWindows: true });

      expect(eventForRole("cli_chat")?.properties).toMatchObject({
        sample_count: "2",
        rss_kb_total_peak: "300000",
      });
      expect(getAppMetricsMock).toHaveBeenCalledTimes(appMetricReadsBeforeStop);
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });
});

describe("desktopResourceTelemetry memory diagnostics log", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    logicalCpuCount = 8;
    totalMemoryBytes = 16 * 1024 ** 3;
    getAppMetricsMock.mockReset().mockReturnValue([]);
    getAllWebContentsMock.mockReset().mockReturnValue([]);
    getAllWindowsMock.mockReset().mockReturnValue([]);
    sendCustomMock.mockReset();
  });

  it("MEM-009 Writes one role=main sample line every six 10s ticks (including working set by new roles)", async () => {
    vi.useFakeTimers();
    const memoryUsageSpy = vi.spyOn(process, "memoryUsage").mockReturnValue({
      rss: 300 * 1024 * 1024,
      heapTotal: 120 * 1024 * 1024,
      heapUsed: 90 * 1024 * 1024,
      external: 20 * 1024 * 1024,
      arrayBuffers: 2 * 1024 * 1024,
    } as NodeJS.MemoryUsage);
    getAppMetricsMock.mockReturnValue([
      metric(MAIN_PID, "Browser", 1, 4_096),
      metric(OTHER_PID, "Utility", 1, 8_192),
    ]);
    try {
      const {
        MEMORY_LOG_SAMPLE_EVERY_N_TICKS,
        RESOURCE_SAMPLE_INTERVAL_MS,
        registerDesktopResourceTelemetry,
        stopDesktopResourceTelemetry,
      } = await loadTelemetry();
      const logger = { info: vi.fn(), warn: vi.fn() };
      registerDesktopResourceTelemetry(logger, { reportIntervalMs: REPORT_INTERVAL_MS });

      await vi.advanceTimersByTimeAsync(
        RESOURCE_SAMPLE_INTERVAL_MS * (MEMORY_LOG_SAMPLE_EVERY_N_TICKS - 1),
      );
      expect(
        logger.info.mock.calls.filter((call) => String(call[0]).startsWith("[memory]")),
      ).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(RESOURCE_SAMPLE_INTERVAL_MS);
      const lines = logger.info.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.startsWith("[memory]"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe(
        "[memory] role=main reason=first rssKb=307200 heapUsedKb=92160 heapTotalKb=122880 externalKb=20480 arrayBuffersKb=2048 ws.chromium_other=8192 ws.main=4096",
      );
      stopDesktopResourceTelemetry();
    } finally {
      memoryUsageSpy.mockRestore();
      vi.useRealTimers();
    }
  });
  it("PRT-009: 两个 MCP ID 各发一条 19 属性事件，CPU 按运行机核数归一化", async () => {
    vi.useFakeTimers();
    getAppMetricsMock.mockReturnValue([metric(MAIN_PID, "Browser", 1, 1_000)]);
    const {
      configureDesktopResourceTelemetry,
      registerDesktopResourceTelemetry,
      stopDesktopResourceTelemetry,
    } = await loadTelemetry();
    const { ingestMcpResourceSamples } =
      await import("../src/main/processResourceMcpTelemetrySource.js");
    const sample = {
      instanceToken: "cli-instance-01",
      sampledAt: 300000,
      intervalMs: 300000,
      processCount: 2,
      rssKbTotal: 120000,
      rssKbMaxProcess: 80000,
      cpuTimeMsDelta: 180000,
      uptimeMinutes: 5,
      platform: "linux",
      arch: "x64",
      logicalCpuCount: 4,
      totalMemoryGb: 64,
    };
    try {
      configureDesktopResourceTelemetry({
        deviceMid: "mcp-device",
        platform: "darwin",
        appVersion: "test",
        armsEnv: "test",
      });
      registerDesktopResourceTelemetry(
        { info: vi.fn(), warn: vi.fn() },
        { reportIntervalMs: REPORT_INTERVAL_MS },
      );
      const samples = ["builtin:node_repl", "custom:123456789abc"].map((mcpId) => ({
        ...sample,
        mcpId,
      }));
      ingestMcpResourceSamples(samples, "remote");
      ingestMcpResourceSamples(samples, "remote");
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
      const events = sendCustomMock.mock.calls
        .map(([event]) => event)
        .filter((event) => event.properties?.process_role === "mcp");
      expect(events).toHaveLength(2);
      expect(events.map((event) => event.properties.mcp_id)).toEqual([
        "builtin:node_repl",
        "custom:123456789abc",
      ]);
      for (const event of events) {
        expect(Object.keys(event.properties)).toHaveLength(19);
        expect(event.properties).toMatchObject({
          platform: "linux",
          arch: "x64",
          logical_cpu_count: "4",
          total_memory_gb: "64",
          runtime_surface: "remote",
          cpu_percent_peak: "15",
          sample_count: "1",
          rss_kb_total_mean: "120000",
          rss_kb_max_process_peak: "80000",
          process_count_peak: "2",
          uptime_minutes: "5",
        });
        expect(event.properties).not.toHaveProperty("heap_used_kb_mean");
        expect(event.properties).not.toHaveProperty("instanceToken");
        expect(event.value).toBe(15);
      }
      await vi.advanceTimersByTimeAsync(REPORT_INTERVAL_MS);
      expect(
        sendCustomMock.mock.calls
          .map(([event]) => event)
          .filter((event) => event.properties?.process_role === "mcp"),
      ).toHaveLength(2);
    } finally {
      stopDesktopResourceTelemetry();
      vi.useRealTimers();
    }
  });
});

it.each(["linux", "win32"] as const)(
  "PRT-010: Host 完成通知立即上报 12/10 个白名单属性（%s）",
  async (platform) => {
    const { Emitter } = await import("@origin-ai/cf-rpc");
    const { hostResponseMessageSchema, PERF_TOOL_EXEC_RESOURCE_PROPERTY_KEYS } =
      await import("@origin-ai/cf-shared");
    const { registerHostToolExecResourceTelemetry } =
      await import("../src/host/hostToolExecResourceTelemetry.js");
    const { configureDesktopResourceTelemetry, ingestToolExecResource } = await loadTelemetry();
    configureDesktopResourceTelemetry({
      deviceMid: "device",
      appVersion: "1.0",
      armsEnv: "prod",
      platform: "darwin",
    });
    sendCustomMock.mockClear();
    const emitter = new Emitter<import("@origin-ai/cf-shared").CfToolExecResource>();
    const registration = registerHostToolExecResourceTelemetry({
      agentService: { onDynamicToolExecResource: () => emitter.event },
      runtimeSurface: "remote",
      postMessage: (raw) => {
        const message = hostResponseMessageSchema.parse(raw);
        if (message.type === "tool-exec-resource")
          ingestToolExecResource(message.sample, message.runtimeSurface);
      },
    });
    const sample = {
      platform,
      toolName: "bash" as const,
      durationMs: 40000,
      exitKind: "completed" as const,
      sampleCount: platform === "win32" ? 0 : 2,
      cliRssKb: 1024,
      systemFreeMemoryKb: 2048,
      ...(platform === "win32" ? {} : { treeRssKbPeak: 300, treeCpuTimeMs: 6000 }),
    };
    emitter.fire(sample);
    registration.dispose();
    emitter.fire(sample);
    expect(sendCustomMock).toHaveBeenCalledExactlyOnceWith({
      name: "perf_tool_exec_resource",
      type: "custom",
      group: "resource",
      value: 40000,
      properties: {
        platform: platform === "win32" ? "windows" : "linux",
        app_version: "1.0",
        arms_env: "prod",
        device_mid: "device",
        runtime_surface: "remote",
        tool_name: "bash",
        exit_kind: "completed",
        sample_count: platform === "win32" ? "0" : "2",
        cli_rss_kb: "1024",
        system_free_memory_kb: "2048",
        ...(platform === "win32" ? {} : { tree_rss_kb_peak: "300", tree_cpu_time_ms: "6000" }),
      },
    });
    const keys = Object.keys(sendCustomMock.mock.calls[0][0].properties);
    expect(keys.sort()).toEqual(
      PERF_TOOL_EXEC_RESOURCE_PROPERTY_KEYS.filter(
        (key) => platform !== "win32" || !key.startsWith("tree_"),
      )
        .slice()
        .sort(),
    );
  },
);

it("PRT-032 Multiple Hosts forwarding the same completion fact report only once; same metrics under different commands remain independent", async () => {
  const { Emitter } = await import("@origin-ai/cf-rpc");
  const { registerHostToolExecResourceTelemetry } =
    await import("../src/host/hostToolExecResourceTelemetry.js");
  const { hostResponseMessageSchema } = await import("@origin-ai/cf-shared");
  const { configureDesktopResourceTelemetry, ingestToolExecResource } = await loadTelemetry();
  configureDesktopResourceTelemetry({
    deviceMid: "test",
    appVersion: "test",
    armsEnv: "test",
    platform: "darwin",
  });
  sendCustomMock.mockClear();
  const emitter = new Emitter<import("@origin-ai/cf-shared").CfToolExecResource>();
  const registrations = Array.from({ length: 2 }, () =>
    registerHostToolExecResourceTelemetry({
      agentService: { onDynamicToolExecResource: () => emitter.event },
      runtimeSurface: "remote",
      postMessage(raw) {
        const message = hostResponseMessageSchema.parse(raw);
        if (message.type === "tool-exec-resource")
          ingestToolExecResource(message.sample, message.runtimeSurface);
      },
    }),
  );
  const sample = {
    platform: "linux" as const,
    toolName: "bash" as const,
    durationMs: 40_000,
    exitKind: "completed" as const,
    sampleCount: 0,
    cliRssKb: 1000,
    systemFreeMemoryKb: 2000,
    completionToken: "00000000-0000-4000-8000-000000000001",
  };
  try {
    emitter.fire(sample);
    expect(sendCustomMock).toHaveBeenCalledTimes(1);
    registrations[0].dispose();
    emitter.fire({ ...sample, completionToken: "00000000-0000-4000-8000-000000000002" });
    expect(sendCustomMock).toHaveBeenCalledTimes(2);
    expect(
      sendCustomMock.mock.calls.every(
        ([event]) =>
          !JSON.stringify(event).includes("completionToken") &&
          !JSON.stringify(event).includes(sample.completionToken),
      ),
    ).toBe(true);
    registrations[1].dispose();
    emitter.fire({ ...sample, completionToken: "00000000-0000-4000-8000-000000000003" });
    expect(sendCustomMock).toHaveBeenCalledTimes(2);
  } finally {
    registrations.forEach((registration) => registration.dispose());
    emitter.dispose();
  }
});

it("PRT-032 Completion identifiers are stored boundedly and cleared on reconfiguration; legacy CLIs without identifiers can still report", async () => {
  const { configureDesktopResourceTelemetry, ingestToolExecResource } = await loadTelemetry();
  const context = {
    deviceMid: "test",
    appVersion: "test",
    armsEnv: "test" as const,
    platform: "darwin" as const,
  };
  configureDesktopResourceTelemetry(context);
  sendCustomMock.mockClear();
  const sample = {
    platform: "linux",
    toolName: "bash",
    durationMs: 40_000,
    exitKind: "completed",
    sampleCount: 0,
    cliRssKb: 1000,
    systemFreeMemoryKb: 2000,
  };
  const token = (index: number) =>
    `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
  for (let index = 0; index < 1025; index++)
    ingestToolExecResource({ ...sample, completionToken: token(index) }, "remote");
  expect(sendCustomMock).toHaveBeenCalledTimes(1025);
  ingestToolExecResource({ ...sample, completionToken: token(1024) }, "remote");
  expect(sendCustomMock).toHaveBeenCalledTimes(1025);
  ingestToolExecResource({ ...sample, completionToken: token(0) }, "remote");
  expect(sendCustomMock).toHaveBeenCalledTimes(1026);
  configureDesktopResourceTelemetry(context);
  ingestToolExecResource({ ...sample, completionToken: token(0) }, "remote");
  ingestToolExecResource(sample, "remote");
  ingestToolExecResource(sample, "remote");
  expect(sendCustomMock).toHaveBeenCalledTimes(1029);
});
