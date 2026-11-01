import { describe, expect, it, vi } from "vitest";
import { HostResponseTypes, hostResponseMessageSchema } from "@origin-ai/cf-shared";
import { startHostSelfResourceTelemetry } from "../src/host/hostSelfResourceTelemetry.js";

const usage = (): NodeJS.MemoryUsage => ({
  rss: 380 * 1024 * 1024,
  heapTotal: 120 * 1024 * 1024,
  heapUsed: 90 * 1024 * 1024,
  external: 10 * 1024 * 1024,
  arrayBuffers: 1024 * 1024,
});

function sequence<T>(values: readonly T[]): () => T {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] as T;
}

interface HarnessOptions {
  postMessage?: ((message: unknown) => void) | undefined;
  collectCounters?: () => Record<string, number>;
}

function startHarness(options: HarnessOptions = {}) {
  const info = vi.fn();
  const setInterval = vi.fn<(callback: () => void, intervalMs: number) => { unref: () => void }>();
  const clearInterval = vi.fn();
  const unref = vi.fn();
  let tick: (() => void) | undefined;
  let intervalMs = 0;
  setInterval.mockImplementation((callback, ms) => {
    tick = callback;
    intervalMs = ms;
    return { unref };
  });

  const telemetry = startHostSelfResourceTelemetry({
    logger: { info },
    collectCounters: options.collectCounters ?? (() => ({ "terminal.open": 1 })),
    postMessage: options.postMessage,
    readMemoryUsage: usage,
    logicalCpuCount: 8,
    readCpuUsage: sequence([
      { user: 0, system: 0 },
      { user: 3_600_000, system: 1_200_000 },
      { user: 3_600_000, system: 1_200_000 },
    ]),
    readMonotonicTimeNs: sequence([0n, 60_000_000_000n, 120_000_000_000n]),
    now: sequence([60_000, 120_000]),
    timer: { setInterval, clearInterval },
  });

  return {
    info,
    setInterval,
    clearInterval,
    unref,
    telemetry,
    get intervalMs() {
      return intervalMs;
    },
    tick: () => tick?.(),
  };
}

describe("startHostSelfResourceTelemetry", () => {
  it("PRT-020: a single 60-second timer and one reading produce both parentPort sample and local [memory] log line", () => {
    const postMessage = vi.fn();
    const harness = startHarness({ postMessage });

    harness.tick();

    expect(harness.setInterval).toHaveBeenCalledOnce();
    expect(harness.intervalMs).toBe(60_000);
    expect(harness.unref).toHaveBeenCalledOnce();

    expect(postMessage).toHaveBeenCalledOnce();
    const message = postMessage.mock.calls[0]?.[0];
    expect(message).toEqual({
      type: HostResponseTypes.HostResourceSample,
      sample: { cpuPercent: 1, rssKb: 389_120, heapUsedKb: 92_160 },
    });
    expect(hostResponseMessageSchema.safeParse(message).success).toBe(true);

    expect(harness.info).toHaveBeenCalledOnce();
    expect(harness.info.mock.calls[0]?.[0]).toBe(
      "[memory] role=utility_host reason=first rssKb=389120 heapUsedKb=92160 heapTotalKb=122880 externalKb=10240 arrayBuffersKb=1024 terminal.open=1",
    );

    harness.telemetry.stop();
    expect(harness.clearInterval).toHaveBeenCalledOnce();
  });

  it("Telemetry samples are still sent during the minute when local logs are skipped by disk-write gating", () => {
    const postMessage = vi.fn();
    const harness = startHarness({ postMessage });

    harness.tick();
    harness.tick();

    expect(harness.info).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenCalledTimes(2);
    harness.telemetry.stop();
  });

  it("When parentPort is unavailable or postMessage throws, drop only current sample and write local log as usual", () => {
    const withoutPort = startHarness({ postMessage: undefined });
    expect(() => withoutPort.tick()).not.toThrow();
    expect(withoutPort.info).toHaveBeenCalledOnce();
    withoutPort.telemetry.stop();

    const broken = startHarness({
      postMessage: () => {
        throw new Error("main disconnected");
      },
    });
    expect(() => broken.tick()).not.toThrow();
    expect(broken.info).toHaveBeenCalledOnce();
    broken.telemetry.stop();
  });

  it("When domain counter throws, drop only local log line and send telemetry sample as usual", () => {
    const postMessage = vi.fn();
    const harness = startHarness({
      postMessage,
      collectCounters: () => {
        throw new Error("services disposed");
      },
    });

    expect(harness.telemetry.sampleNow()).toBe(false);
    expect(harness.info).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledOnce();
    harness.telemetry.stop();
  });
});
